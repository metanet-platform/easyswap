// New trade creation logic - one trade per order
use crate::types::*;
use crate::state::*;
use crate::chunk_allocation;
use crate::config::{TRADE_TIMEOUT_NS, USDC_RELEASE_WAIT_NS};
use std::collections::BTreeMap;

/// Request structure for creating trades
pub struct CreateTradesRequest {
    pub requested_usd: u64,
    pub allow_partial: bool,
    pub agreed_bsv_price: f64,
    pub min_bsv_price: f64,
    pub filler_evm_address: String,
}

/// Create multiple trades, one per order, grouped by FIFO matching
pub async fn create_trades(request: CreateTradesRequest) -> Result<Vec<TradeId>, String> {
    let caller = get_caller();
    
    // 1. Validate EVM address
    if !is_valid_evm_address(&request.filler_evm_address) {
        return Err("Invalid EVM address format".to_string());
    }
    
    // 2. Validate prices
    if request.agreed_bsv_price <= 0.0 || request.min_bsv_price <= 0.0 {
        return Err("BSV prices must be positive".to_string());
    }
    
    if request.min_bsv_price > request.agreed_bsv_price {
        return Err("Minimum BSV price cannot exceed agreed price".to_string());
    }
    
    // 3. Find matching chunks grouped by order (FIFO)
    let chunks_by_order = find_matching_chunks_by_order(
        request.requested_usd,
        request.agreed_bsv_price,
    )?;
    
    if chunks_by_order.is_empty() {
        return Err("No matching chunks found".to_string());
    }
    
    // Calculate total found
    let total_found: u64 = chunks_by_order.values()
        .flat_map(|chunks| chunks.iter())
        .map(|c| c.amount_usd)
        .sum();
    
    // 4. Check if we found enough (if partial not allowed)
    if !request.allow_partial && total_found < request.requested_usd {
        return Err(format!(
            "Could not fill complete order. Requested: ${}, Found: ${}",
            request.requested_usd as f64 / 100.0,
            total_found as f64 / 100.0
        ));
    }
    
    // 5. Create one trade per order
    let mut trade_ids = Vec::new();
    
    for (order_id, chunks) in chunks_by_order {
        let trade_id = create_single_trade(
            caller,
            order_id,
            chunks,
            request.agreed_bsv_price,
            request.min_bsv_price,
            request.filler_evm_address.clone(),
        )?;
        
        trade_ids.push(trade_id);
    }
    
    Ok(trade_ids)
}

/// Find available chunks grouped by their order (FIFO)
fn find_matching_chunks_by_order(
    requested_usd: u64,
    agreed_bsv_price: f64,
) -> Result<BTreeMap<OrderId, Vec<Chunk>>, String> {
    let mut chunks_by_order: BTreeMap<OrderId, Vec<Chunk>> = BTreeMap::new();
    let mut total_allocated = 0u64;
    
    // Get all active orders sorted by creation time (FIFO) - optimized to filter at storage level
    let orders = crate::state::get_active_orders_fifo();
    
    for order in orders {
        if total_allocated >= requested_usd {
            break;
        }
        
        // Check if order accepts this price
        if order.max_bsv_price < agreed_bsv_price {
            continue;
        }
        
        // Find available chunks in this order
        let mut order_chunks = Vec::new();
        for chunk_id in &order.chunks {
            if total_allocated >= requested_usd {
                break;
            }
            
            if let Some(chunk) = get_chunk(*chunk_id) {
                // Only take Available chunks that won't exceed the requested amount
                if chunk.status == ChunkStatus::Available {
                    let remaining_needed = requested_usd - total_allocated;
                    
                    // Only take chunks that are <= remaining needed
                    // Skip chunks that are too large (would overfill the request)
                    if chunk.amount_usd <= remaining_needed {
                        total_allocated += chunk.amount_usd;
                        order_chunks.push(chunk);
                    }
                }
            }
        }
        
        if !order_chunks.is_empty() {
            chunks_by_order.insert(order.id, order_chunks);
        }
    }
    
    Ok(chunks_by_order)
}

/// Create a single trade from one order's chunks
fn create_single_trade(
    filler: Principal,
    order_id: OrderId,
    chunks: Vec<Chunk>,
    agreed_bsv_price: f64,
    min_bsv_price: f64,
    filler_evm_address: String,
) -> Result<TradeId, String> {
    let trade_id = create_trade_id();
    let now = get_time();
    
    let amount_usd: u64 = chunks.iter().map(|c| c.amount_usd).sum();
    let chunk_ids: Vec<ChunkId> = chunks.iter().map(|c| c.id).collect();
    
    // Lock the chunks
    chunk_allocation::lock_chunks_for_trade(&chunk_ids, trade_id)?;
    
    // Get order to retrieve its EVM deposit address and network
    let order = get_order(order_id)
        .ok_or_else(|| "Order not found".to_string())?;
    
    // Build locked chunks with all details
    let locked_chunks: Vec<LockedChunk> = chunks.iter().map(|chunk| {
        // Calculate sats_amount based on the agreed BSV price at trade time
        let chunk_usd_decimal = chunk.amount_usd as f64 / 100.0;
        let btc_amount = chunk_usd_decimal / agreed_bsv_price;
        let sats_amount = (btc_amount * SATOSHIS_PER_BSV as f64) as u64;
        
        LockedChunk {
            chunk_id: chunk.id,
            order_id: chunk.order_id,
            amount_usd: chunk.amount_usd,
            bsv_address: chunk.bsv_address.clone(),
            sats_amount,  // Calculated based on agreed_bsv_price
            network: order.network.clone(),
            evm_address: order.evm_deposit_address.clone(),
        }
    }).collect();
    
    let trade = Trade {
        id: trade_id,
        order_id,
        order_evm_address: order.evm_deposit_address.clone(),
        filler,
        filler_evm_address,
        amount_usd,
        locked_chunks,
        agreed_bsv_price,
        min_bsv_price,
        status: TradeStatus::ChunksLocked,
        bsv_tx_hex: None,
        created_at: now,
        tx_submitted_at: None,
        lock_expires_at: now + TRADE_TIMEOUT_NS,
        release_available_at: None,
        claim_expires_at: None,
        withdrawal_initiated_at: None,
        withdrawal_tx_hash: None,
        withdrawal_confirmed_at: None,
        usdc_claimed: false,
        usdc_claim_address: None,
    };
    
    insert_trade(trade);
    Ok(trade_id)
}

fn is_valid_evm_address(address: &str) -> bool {
    address.len() == 42 && 
    address.starts_with("0x") && 
    address[2..].chars().all(|c| c.is_ascii_hexdigit())
}
