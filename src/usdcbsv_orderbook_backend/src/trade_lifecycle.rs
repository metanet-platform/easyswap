use crate::types::*;
use crate::state::*;
use crate::chunk_allocation;
use crate::bsv_parser;
use crate::filler_accounts;
use crate::ckusdc_integration; // For ckUSDC transfers
use crate::bump_verification; // For SPV verification
use crate::block_headers::CONFIRMATION_DEPTH;
use crate::config::{SECURITY_DEPOSIT_PERCENT, USDC_RELEASE_WAIT_NS, TRADE_TIMEOUT_NS, SATOSHIS_PER_BSV, MAX_LOCK_MULTIPLIER, FILLER_INCENTIVE_PERCENT, TRADE_CLAIM_EXPIRY_NS, RESUBMISSION_PENALTY_PERCENT, RESUBMISSION_WINDOW_NS};
use candid::{CandidType, Deserialize, Principal};

/// Request structure for creating trades
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct CreateTradesRequest {
    pub requested_usd: f64,
    pub allow_partial: bool, // Kept for API compatibility but always treated as true
    pub min_bsv_price: f64,
    // agreed_bsv_price removed - uses canister's current market price to prevent manipulation
    // filler_evm_address removed - ckUSDC transfers go to filler's IC principal
}

/// Create multiple trades, one per order, grouped by FIFO matching
/// NOTE: All trades are now partial by default - if orderbook has less than requested, we fill what's available
pub async fn create_trades(request: CreateTradesRequest) -> Result<Vec<TradeId>, String> {
    let caller = get_caller();
    let now = get_time();
    
    // Reject anonymous principal
    if caller == candid::Principal::anonymous() {
        return Err("Anonymous principal cannot create trades. Please authenticate first.".to_string());
    }
    
    // 1. Get current market price from canister (prevents frontend manipulation)
    let agreed_bsv_price = crate::price_oracle::get_bsv_price().await?;
    
    ic_cdk::println!("📊 Creating trade with market price: ${}", agreed_bsv_price);
    
    // 2. Get orderbook balance from Available chunks (always accurate)
    let available = get_available_orderbook();
    
    ic_cdk::println!("💰 Available orderbook: ${:.2}", available);
    
    // Always allow partial fills - if requested amount > available, just use what's available
    if request.requested_usd > available {
        ic_cdk::println!("⚠️ Partial fill: Requested ${:.2}, available ${:.2}", request.requested_usd, available);
    }
    
    // 3. Validate prices
    if agreed_bsv_price <= 0.0 || request.min_bsv_price <= 0.0 {
        return Err("BSV prices must be positive".to_string());
    }
    
    if request.min_bsv_price > agreed_bsv_price {
        return Err(format!(
            "Minimum BSV price (${}) cannot exceed current market price (${})",
            request.min_bsv_price,
            agreed_bsv_price
        ));
    }
    
    // 4. Get live security balance from ckUSDC ledger
    let security_balance = filler_accounts::get_security_balance_for_principal(caller).await?;
    
    // Calculate required security deposit (5%)
    let required_security = request.requested_usd * (SECURITY_DEPOSIT_PERCENT as f64 / 100.0);
    
    // Create account record only when submitting first trade
    filler_accounts::create_account_if_needed(caller);
    
    let filler_account = get_filler_account(caller)
        .ok_or_else(|| "Failed to create filler account".to_string())?;
    
    // Convert security balance from USDC units to USD
    let security_balance_usd = security_balance as f64 / 1_000_000.0;
    
    // Check if filler has enough security balance
    if security_balance_usd < required_security {
        return Err(format!(
            "Insufficient security deposit. Required: ${}, Available: ${}",
            required_security,
            security_balance_usd
        ));
    }
    
    // Check 5% security deposit allows locking up to 20x
    let max_allowed = security_balance_usd * (MAX_LOCK_MULTIPLIER as f64);
    let total_pending = filler_account.pending_trades_total + request.requested_usd;
    
    if total_pending > max_allowed {
        return Err(format!(
            "Exceeds maximum lock capacity. Max allowed: ${}, Would be: ${}",
            max_allowed,
            total_pending
        ));
    }
    
    // 5. Find and create trades using new FIFO logic
    let trades = create_trades_from_chunks(
        caller,
        request.requested_usd,
        request.allow_partial,
        agreed_bsv_price,
        request.min_bsv_price,
        now,
    )?;
    
    if trades.is_empty() {
        return Err("No matching chunks found".to_string());
    }
    
    // 6. Calculate total locked
    let total_locked: f64 = trades.iter()
        .map(|&trade_id| get_trade(trade_id).unwrap().amount_usd)
        .sum();
    
    // 7. Update filler account stats (pending_trades_total calculated from active trades)
    update_filler_account(caller, |account| {
        account.total_trades += trades.len() as u64;
    })?;
    
    ic_cdk::println!("✅ Created {} trades totaling ${}", trades.len(), total_locked);
    
    Ok(trades)
}

/// Create trades from chunks using FIFO matching with proper partial filling logic
/// This function iterates through chunks in FIFO order and creates trades as we go
fn create_trades_from_chunks(
    filler: Principal,
    requested_usd: f64,
    allow_partial: bool,
    agreed_bsv_price: f64,
    min_bsv_price: f64,
    now: u64,
) -> Result<Vec<TradeId>, String> {
    let mut trade_ids = Vec::new();
    let mut total_filled = 0.0;
    
    // Get all active orders sorted by creation time (FIFO) - optimized to filter at storage level
    let orders = crate::state::get_active_orders_fifo();
    
    // Current trade being built
    let mut current_order_id: Option<OrderId> = None;
    let mut current_chunks: Vec<Chunk> = Vec::new();
    
    // Iterate through orders in FIFO order
    for order in orders {
        // Check if we've already filled the requested amount
        if total_filled >= requested_usd {
            break;
        }
        
        // Check if order accepts this price
        if order.max_bsv_price < agreed_bsv_price {
            continue; // Skip orders that don't accept current market price
        }
        
        // Iterate through chunks in this order
        for chunk_id in &order.chunks {
            // Check if we've already filled the requested amount
            if total_filled >= requested_usd {
                break;
            }
            
            if let Some(chunk) = get_chunk(*chunk_id) {
                // Only consider Available chunks
                if chunk.status != ChunkStatus::Available {
                    continue;
                }
                
                // Calculate how much more we need
                let remaining = requested_usd - total_filled;
                
                // Check if chunk + total_filled <= requested_usd
                if chunk.amount_usd <= remaining {
                    // This chunk fits!
                    
                    // If this is a different order, finalize previous trade first
                    if let Some(prev_order_id) = current_order_id {
                        if prev_order_id != order.id && !current_chunks.is_empty() {
                            // Create trade for previous order
                            let trade_id = create_single_trade(
                                filler,
                                prev_order_id,
                                current_chunks.clone(),
                                agreed_bsv_price,
                                min_bsv_price,
                                now,
                            )?;
                            trade_ids.push(trade_id);
                            
                            // Reset for new order
                            current_chunks.clear();
                        }
                    }
                    
                    // Add chunk to current trade
                    current_order_id = Some(order.id);
                    total_filled += chunk.amount_usd;
                    current_chunks.push(chunk);
                    
                    // Check if we've exactly filled the request
                    if total_filled >= requested_usd {
                        break;
                    }
                }
                // If chunk is larger than remaining, skip it (can't partially use a chunk)
            }
        }
    }
    
    // Finalize last trade if we have chunks
    if !current_chunks.is_empty() {
        if let Some(order_id) = current_order_id {
            let trade_id = create_single_trade(
                filler,
                order_id,
                current_chunks,
                agreed_bsv_price,
                min_bsv_price,
                now,
            )?;
            trade_ids.push(trade_id);
        }
    }
    
    // Check if we filled enough based on allow_partial
    if !allow_partial && total_filled < requested_usd {
        // Need to rollback any trades we created
        // For now, just return error - trades haven't been committed yet
        return Err(format!(
            "Cannot fill complete order. Requested: ${}, Available: ${}. Set allow_partial=true to proceed.",
            requested_usd,
            total_filled
        ));
    }
    
    // If allow_partial=true and we couldn't find any chunks
    if trade_ids.is_empty() {
        return Err("No matching chunks available at current market price".to_string());
    }
    
    Ok(trade_ids)
}

/// Create a single trade from one order's chunks
fn create_single_trade(
    filler: Principal,
    order_id: OrderId,
    chunks: Vec<Chunk>,
    agreed_bsv_price: f64,
    min_bsv_price: f64,
    now: u64,
) -> Result<TradeId, String> {
    let trade_id = create_trade_id();
    
    let amount_usd: f64 = chunks.iter().map(|c| c.amount_usd).sum();
    let chunk_ids: Vec<ChunkId> = chunks.iter().map(|c| c.id).collect();
    
    // Lock the chunks (this also decrements orderbook balance)
    chunk_allocation::lock_chunks_for_trade(&chunk_ids, trade_id)?;
    
    // Build locked chunks with all details
    let locked_chunks: Vec<LockedChunk> = chunks.iter().map(|chunk| {
        // Calculate sats_amount based on the agreed BSV price at trade time
        // chunk.amount_usd is already in USD (e.g., 1.0 = $1)
        let bsv_amount = chunk.amount_usd / agreed_bsv_price;
        let sats_amount = (bsv_amount * SATOSHIS_PER_BSV as f64) as u64;
        
        LockedChunk {
            chunk_id: chunk.id,
            order_id: chunk.order_id,
            amount_usd: chunk.amount_usd,
            bsv_address: chunk.bsv_address.clone(),
            sats_amount,  // Calculated based on agreed_bsv_price
        }
    }).collect();
    
    let trade = Trade {
        id: trade_id,
        order_id,
        filler,
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
    };
    
    insert_trade(trade);
    
    Ok(trade_id)
}

pub async fn submit_bsv_transaction(trade_id: TradeId, raw_tx_hex: String) -> Result<(), String> {
    let caller = get_caller();
    let now = get_time();
    
    // Reject anonymous principal
    if caller == candid::Principal::anonymous() {
        return Err("Anonymous principal cannot submit transactions. Please authenticate first.".to_string());
    }
    
    let trade = get_trade(trade_id)
        .ok_or_else(|| "Trade not found".to_string())?;
    
    // Verify caller is the filler
    if trade.filler != caller {
        return Err("Only the trade filler can submit transaction".to_string());
    }
    
    // Verify trade status
    if trade.status != TradeStatus::ChunksLocked {
        return Err("Trade is not in ChunksLocked status".to_string());
    }
    
    // Check if lock has expired - NO SUBMISSION ALLOWED after expiry
    if now > trade.lock_expires_at {
        return Err("Trade lock has expired. Submission no longer allowed. Penalty will be applied automatically.".to_string());
    }
    
    // Compute transaction ID to check for duplicates
    let txid = compute_bsv_txid(&raw_tx_hex)?;
    
    // Check if this transaction has been used in another trade
    if let Some(other_trade_id) = get_trade_using_tx(&txid) {
        if other_trade_id != trade_id {
            return Err(format!(
                "This transaction has already been used in trade #{}. Each transaction can only be used once.",
                other_trade_id
            ));
        }
    }
    
    // Parse BSV transaction
    let parsed_tx = bsv_parser::parse_bsv_transaction(&raw_tx_hex)?;
    
    // Validate outputs match locked chunks
    bsv_parser::validate_transaction_outputs(&parsed_tx, &trade.locked_chunks)?;
    
    // Mark transaction as used by this trade
    mark_bsv_tx_used(txid, trade_id);
    
    // Update trade
    let release_time = now + USDC_RELEASE_WAIT_NS;
    let claim_expiry = now + TRADE_CLAIM_EXPIRY_NS;
    
    update_trade(trade_id, |trade| {
        trade.status = TradeStatus::TxSubmitted;
        trade.bsv_tx_hex = Some(raw_tx_hex);
        trade.tx_submitted_at = Some(now);
        trade.release_available_at = Some(release_time);
        trade.claim_expires_at = Some(claim_expiry);
    })?;
    
    Ok(())
}

/// Allow trader to resubmit/edit BSV transaction within first 3 hours of INITIAL submission
/// Charges 1% penalty and resets claim timer by 3 hours to prevent gaming during volatility
pub async fn resubmit_bsv_transaction(trade_id: TradeId, raw_tx_hex: String) -> Result<(), String> {
    let caller = get_caller();
    let now = get_time();
    
    // Reject anonymous principal
    if caller == candid::Principal::anonymous() {
        return Err("Anonymous principal cannot resubmit transactions. Please authenticate first.".to_string());
    }
    
    let trade = get_trade(trade_id)
        .ok_or_else(|| "Trade not found".to_string())?;
    
    // Verify caller is the filler
    if trade.filler != caller {
        return Err("Only the trade filler can resubmit transaction".to_string());
    }
    
    // Verify trade status - must be TxSubmitted
    if trade.status != TradeStatus::TxSubmitted {
        return Err("Trade is not in TxSubmitted status. Cannot resubmit.".to_string());
    }
    
    // Check if still within 3-hour resubmission window from INITIAL submission
    let initial_submission_time = trade.tx_submitted_at
        .ok_or_else(|| "Transaction submission time not found".to_string())?;
    
    if now > initial_submission_time + RESUBMISSION_WINDOW_NS {
        return Err("Resubmission window expired. You can only resubmit within 3 hours of initial submission.".to_string());
    }
    
    // Calculate 1% resubmission penalty (of trade amount, not security deposit)
    let penalty_amount = trade.amount_usd * (RESUBMISSION_PENALTY_PERCENT / 100.0);
    
    // Get filler's AVAILABLE security balance (total - locked in other trades)
    let available_balance_usd = filler_accounts::get_available_security_balance(caller).await
        .map_err(|e| format!("Failed to check available security balance: {}", e))?;
    
    // Check if filler has enough AVAILABLE balance to cover penalty
    if available_balance_usd < penalty_amount {
        return Err(format!(
            "Insufficient available security balance. Need ${:.2} for 1% resubmission penalty (1% of ${:.2} trade), but only have ${:.2} available. Deposit more security or close some trades.",
            penalty_amount,
            trade.amount_usd,
            available_balance_usd
        ));
    }
    
    // Compute new transaction ID
    let new_txid = compute_bsv_txid(&raw_tx_hex)?;
    
    // Check if this NEW transaction has been used in another trade
    if let Some(other_trade_id) = get_trade_using_tx(&new_txid) {
        if other_trade_id != trade_id {
            return Err(format!(
                "This transaction has already been used in trade #{}. Each transaction can only be used once.",
                other_trade_id
            ));
        }
    }
    
    // Parse BSV transaction
    let parsed_tx = bsv_parser::parse_bsv_transaction(&raw_tx_hex)?;
    
    // Validate outputs match locked chunks (same validation as initial submission)
    bsv_parser::validate_transaction_outputs(&parsed_tx, &trade.locked_chunks)?;
    
    ic_cdk::println!("🔄 Resubmitting BSV transaction for trade {} with 1% penalty (${:.2})", trade_id, penalty_amount);
    
    // Get order to find maker (recipient of resubmission penalty)
    let order = crate::state::get_order(trade.order_id);
    let recipient = order.map(|o| o.maker);
    
    // Deduct penalty from filler's security balance and transfer to maker
    filler_accounts::deduct_penalty(
        caller,
        penalty_amount,
        recipient,
        Some(format!("Resubmit penalty T{}", trade_id)),
    ).await?;
    
    // If trade already has a previous tx, unmark it
    if let Some(old_tx_hex) = &trade.bsv_tx_hex {
        if let Ok(old_txid) = compute_bsv_txid(old_tx_hex) {
            unmark_bsv_tx(&old_txid);
        }
    }
    
    // Mark new transaction as used by this trade
    mark_bsv_tx_used(new_txid, trade_id);
    
    // Reset claim timer: Add 3 more hours from NOW
    // NOTE: We do NOT extend claim_expires_at - trader still has 24h from initial submission to claim
    let new_release_time = now + USDC_RELEASE_WAIT_NS;
    
    // Update transaction hex and reset claim availability timer
    // Keep original tx_submitted_at (for resubmission window) and claim_expires_at (still 24h limit)
    update_trade(trade_id, |trade| {
        trade.bsv_tx_hex = Some(raw_tx_hex);
        trade.release_available_at = Some(new_release_time);
        // claim_expires_at stays unchanged - 24h limit from initial submission
    })?;
    
    Ok(())
}

pub async fn claim_usdc(trade_id: TradeId, tx_hex: String, bump_hex: String) -> Result<(), String> {
    let caller = get_caller();
    let now = get_time();
    
    // Reject anonymous principal
    if caller == candid::Principal::anonymous() {
        return Err("Anonymous principal cannot claim USDC. Please authenticate first.".to_string());
    }
    
    let trade = get_trade(trade_id)
        .ok_or_else(|| "Trade not found".to_string())?;
    
    // Verify caller is the filler
    if trade.filler != caller {
        return Err("Only the trade filler can claim USDC".to_string());
    }
    
    // Verify trade status
    if trade.status != TradeStatus::TxSubmitted && trade.status != TradeStatus::ReadyForRelease {
        return Err("Trade is not ready for USDC release".to_string());
    }
    
    // CRITICAL: Verify submitted tx_hex matches the one stored in the trade
    let stored_tx_hex = trade.bsv_tx_hex.as_ref()
        .ok_or_else(|| "No BSV transaction submitted for this trade".to_string())?;
    
    if tx_hex.to_lowercase() != stored_tx_hex.to_lowercase() {
        return Err("Transaction hex does not match the submitted transaction for this trade".to_string());
    }
    
    // Check if release time has passed
    if let Some(release_time) = trade.release_available_at {
        if now < release_time {
            return Err(format!(
                "USDC release available in {} minutes",
                (release_time - now) / 60_000_000_000
            ));
        }
    } else {
        return Err("Release time not set".to_string());
    }
    
    // Check if claim has expired (24 hours passed)
    if let Some(claim_expiry) = trade.claim_expires_at {
        if now > claim_expiry {
            return Err("This trade was not claimed within 24 hours. The ckUSDC has been sent to treasury. Please contact support if you believe this was an error.".to_string());
        }
    }
    
    // ===== SPV VERIFICATION - NEW REQUIREMENT =====
    // Verify the BSV transaction is included in a confirmed block before releasing USDC
    // Uses TxArchive fallback if local block storage has gaps
    ic_cdk::println!("🔍 Verifying BSV transaction with SPV for trade {}", trade_id);
    
    let verification = match bump_verification::verify_tx_raw_async(&tx_hex, &bump_hex).await {
        Ok(v) => v,
        Err(e) => {
            ic_cdk::println!("❌ SPV verification failed: {}", e);
            return Err(format!("Transaction verification failed: {}", e));
        }
    };
    
    if !verification.verified {
        ic_cdk::println!("❌ Transaction not verified: {}", verification.message);
        return Err(format!("Transaction not verified: {}", verification.message));
    }
    
    if verification.confirmations < CONFIRMATION_DEPTH {
        ic_cdk::println!("❌ Insufficient confirmations: {} (need {})", 
            verification.confirmations, CONFIRMATION_DEPTH);
        return Err(format!(
            "Insufficient confirmations: {} blocks (need {} blocks). Please wait for more confirmations.",
            verification.confirmations, CONFIRMATION_DEPTH
        ));
    }
    
    ic_cdk::println!("✅ Transaction verified at block {} (hash: {}) with {} confirmations", 
        verification.block_height, verification.block_hash, verification.confirmations);
    // ===== END SPV VERIFICATION =====
    
    // Transfer ckUSDC to filler from order's subaccount
    // Filler receives chunk amount + incentive % (from config)
    let incentive_multiplier = 1.0 + (FILLER_INCENTIVE_PERCENT as f64 / 10000.0);
    let total_to_send = trade.amount_usd * incentive_multiplier;
    let total_to_send_e6 = ckusdc_integration::usd_to_ckusdc_e6(total_to_send);
    
    let incentive_percent = FILLER_INCENTIVE_PERCENT as f64 / 100.0;
    ic_cdk::println!("💰 Claiming USDC for trade {}", trade_id);
    ic_cdk::println!("  Base amount: ${:.6}", trade.amount_usd);
    ic_cdk::println!("  With {:.1}% incentive: {} e6 (${:.6})", incentive_percent, total_to_send_e6, ckusdc_integration::ckusdc_e6_to_usd(total_to_send_e6));
    
    // Get order to extract maker for subaccount
    let order = get_order(trade.order_id)
        .ok_or_else(|| "Order not found".to_string())?;
    
    // Transfer ckUSDC to filler from order's subaccount
    // ckUSDC transfers on ICP are instant (ICRC-1 ledger)
    // transfer_ckusdc_from_order automatically deducts the transfer fee
    // Compute txid for memo if available
    let txid = match compute_bsv_txid(&stored_tx_hex) {
        Ok(id) => id,
        Err(_) => format!("trade_{}", trade_id),
    };

    let block_index = ckusdc_integration::transfer_ckusdc_from_order(
        order.maker,
        trade.order_id,
        trade.filler,
        None, // Filler's default subaccount
        total_to_send_e6,
        Some(format!("Claim T{}", trade_id).into_bytes()),
    ).await?;
    
    // Record block index and mark as confirmed (instant on ICP)
    update_trade(trade_id, |trade| {
        trade.withdrawal_tx_hash = Some(format!("{}", block_index));
        trade.withdrawal_confirmed_at = Some(now);
        trade.withdrawal_initiated_at = Some(now);
        trade.status = TradeStatus::WithdrawalConfirmed;
    })?;
    
    // Mark chunks as filled (autonomous heartbeat will confirm withdrawal later)
    let chunk_ids: Vec<ChunkId> = trade.locked_chunks.iter()
        .map(|lc| lc.chunk_id)
        .collect();
    chunk_allocation::mark_chunks_filled(&chunk_ids)?;
    
    // Update filler account stats (pending_trades_total calculated from active trades)
    update_filler_account(caller, |account| {
        account.successful_trades += 1;
    })?;
    
    Ok(())
}

async fn apply_penalty_and_cancel(trade_id: TradeId) -> Result<(), String> {
    let trade = get_trade(trade_id)
        .ok_or_else(|| "Trade not found".to_string())?;
    
    // Get the order to find the maker (recipient of penalty)
    let order = get_order(trade.order_id)
        .ok_or_else(|| format!("Order {} not found for trade {}", trade.order_id, trade_id))?;
    
    let penalty_amount = trade.amount_usd * (SECURITY_DEPOSIT_PERCENT as f64 / 100.0);
    
    // Deduct penalty from filler account and send to order maker
    filler_accounts::deduct_penalty(
        trade.filler,
        penalty_amount,
        Some(order.maker),
        Some(format!("Timeout penalty T{}", trade_id)),
    ).await?;
    
    // Unlock chunks
    let chunk_ids: Vec<ChunkId> = trade.locked_chunks.iter()
        .map(|lc| lc.chunk_id)
        .collect();
    chunk_allocation::unlock_chunks(&chunk_ids)?;
    
    // Update trade status
    update_trade(trade_id, |trade| {
        trade.status = TradeStatus::PenaltyApplied;
    })?;
    
    // Update filler account (pending_trades_total calculated from active trades)
    // Penalty already deducted above
    
    Ok(())
}

pub fn get_my_trades() -> Vec<Trade> {
    let caller = get_caller();
    get_trades_by_filler(caller)
}

pub fn get_my_trades_paginated(offset: u64, limit: u64, status_filter: Option<Vec<TradeStatus>>) -> PaginatedTrades {
    let caller = get_caller();
    
    // Filter at storage level to avoid loading unnecessary trades
    let filtered_trades: Vec<Trade> = crate::state::TRADES.with(|trades| {
        let mut results: Vec<Trade> = trades.borrow().iter()
            .filter(|(_, trade)| {
                // Must be owned by caller
                if trade.filler != caller {
                    return false;
                }
                
                // Apply status filter if provided
                if let Some(ref statuses) = status_filter {
                    statuses.contains(&trade.status)
                } else {
                    true // No filter, include all
                }
            })
            .map(|(_, trade)| trade)
            .collect();
        
        // Sort by created_at descending (newest first)
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    });
    
    let total = filtered_trades.len() as u64;
    
    let start = offset as usize;
    let _end = (offset + limit) as usize;
    let trades: Vec<Trade> = filtered_trades.into_iter()
        .skip(start)
        .take(limit as usize)
        .collect();
    
    PaginatedTrades {
        trades,
        total,
        offset,
        limit,
    }
}

pub fn get_trade(trade_id: TradeId) -> Option<Trade> {
    crate::state::get_trade(trade_id)
}

fn is_valid_evm_address(address: &str) -> bool {
    address.len() == 42 && 
    address.starts_with("0x") && 
    address[2..].chars().all(|c| c.is_ascii_hexdigit())
}
