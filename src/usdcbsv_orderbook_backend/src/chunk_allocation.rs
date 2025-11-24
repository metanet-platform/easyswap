use crate::types::*;
use crate::state::*;

pub fn allocate_chunks_fifo(requested_usd: f64) -> Result<Vec<Chunk>, String> {
    let available_chunks = get_available_chunks();
    
    if available_chunks.is_empty() {
        return Err("No available chunks in orderbook".to_string());
    }
    
    let mut selected_chunks = Vec::new();
    let mut accumulated_usd = 0.0;
    
    for chunk in available_chunks {
        // Check if adding this chunk would exceed requested amount
        if accumulated_usd + chunk.amount_usd > requested_usd {
            // Skip this chunk (too large)
            continue;
        }
        
        // Add this chunk
        selected_chunks.push(chunk.clone());
        accumulated_usd += chunk.amount_usd;
        
        // Check if we've reached the requested amount
        if (accumulated_usd - requested_usd).abs() < 0.000001 {
            break;
        }
    }
    
    // Verify we matched exactly
    if (accumulated_usd - requested_usd).abs() > 0.000001 {
        return Err(format!(
            "Could not match exact amount. Requested: ${}, Found: ${}",
            requested_usd,
            accumulated_usd
        ));
    }
    
    Ok(selected_chunks)
}

pub fn lock_chunks_for_trade(chunk_ids: &[ChunkId], trade_id: TradeId) -> Result<(), String> {
    for chunk_id in chunk_ids {
        if let Some(chunk) = get_chunk(*chunk_id) {
            // Verify chunk is Available
            if chunk.status != ChunkStatus::Available {
                return Err(format!("Chunk {} is not available for locking", chunk_id));
            }
            
            update_chunk(*chunk_id, |c| {
                c.status = ChunkStatus::Locked;
                c.locked_by = Some(trade_id);
            })?;
            
            // Update order's locked amount
            update_order(chunk.order_id, |o| {
                o.total_locked_usd += chunk.amount_usd;
            })?;
            
            // Orderbook balance will be recalculated on next query
        }
    }
    Ok(())
}

pub fn unlock_chunks(chunk_ids: &[ChunkId]) -> Result<(), String> {
    let (current_bsv_price, _) = get_cached_bsv_price();
    
    for chunk_id in chunk_ids {
        if let Some(chunk) = get_chunk(*chunk_id) {
            let order_id = chunk.order_id;
            let amount = chunk.amount_usd;
            
            if let Some(order) = get_order(order_id) {
                // Check if current BSV price exceeded max → Idle, else → Available
                let new_status = if current_bsv_price > order.max_bsv_price {
                    ChunkStatus::Idle
                } else {
                    ChunkStatus::Available
                };
                
                update_chunk(*chunk_id, |c| {
                    c.status = new_status.clone();
                    c.locked_by = None;
                })?;
                
                // Update order's locked amount
                update_order(order_id, |o| {
                    o.total_locked_usd -= amount;
                    if new_status == ChunkStatus::Idle {
                        o.total_idle_usd += amount;
                    }
                })?;
                
                // Orderbook balance will be recalculated on next query
            }
        }
    }
    Ok(())
}

pub fn mark_chunks_filled(chunk_ids: &[ChunkId]) -> Result<(), String> {
    let now = get_time();
    
    for chunk_id in chunk_ids {
        if let Some(chunk) = get_chunk(*chunk_id) {
            let order_id = chunk.order_id;
            let amount = chunk.amount_usd;
            
            update_chunk(*chunk_id, |c| {
                c.status = ChunkStatus::Filled;
                c.filled_at = Some(now);
                c.locked_by = None;
            })?;
            
            // Update order's filled and locked amounts
            // Note: Platform fees (2.9%) already collected upfront during order activation
            update_order(order_id, |o| {
                o.total_filled_usd += amount;
                // Decrease locked amount since chunk is now filled
                o.total_locked_usd -= amount;
                
                // Check if order is fully filled
                if (o.total_filled_usd - o.amount_usd).abs() < 0.000001 || o.total_filled_usd >= o.amount_usd {
                    o.status = OrderStatus::Filled;
                } else if o.total_filled_usd > 0.0 {
                    o.status = OrderStatus::PartiallyFilled;
                }
            })?;
        }
    }
    Ok(())
}

pub fn get_active_chunks() -> Vec<OrderbookChunk> {
    let available_chunks = get_available_chunks();
    
    available_chunks.iter()
        .map(|chunk| {
            // Convert f64 max_bsv_price to cents (chunk has its own max_bsv_price)
            let max_price_cents = (chunk.max_bsv_price * 100.0).round() as u64;
            
            OrderbookChunk {
                order_id: chunk.order_id,
                amount_usd: chunk.amount_usd,
                max_price_per_bsv_in_cents: max_price_cents,
            }
        })
        .collect()
}

pub fn get_active_chunks_paginated(offset: u64, limit: u64) -> PaginatedChunks {
    // Optimized: Calculate total and paginate at storage level instead of loading all chunks
    let (chunks, total) = CHUNKS.with(|chunks_map| {
        let available: Vec<Chunk> = chunks_map.borrow().iter()
            .filter(|(_, chunk)| chunk.status == ChunkStatus::Available)
            .map(|(_, chunk)| chunk)
            .collect();
        
        let total = available.len() as u64;
        
        // Convert to OrderbookChunk and paginate
        let start = offset as usize;
        let paginated_chunks: Vec<OrderbookChunk> = available.into_iter()
            .skip(start)
            .take(limit as usize)
            .map(|chunk| {
                // Convert f64 max_bsv_price to cents (chunk has its own max_bsv_price)
                let max_price_cents = (chunk.max_bsv_price * 100.0).round() as u64;
                
                OrderbookChunk {
                    order_id: chunk.order_id,
                    amount_usd: chunk.amount_usd,
                    max_price_per_bsv_in_cents: max_price_cents,
                }
            })
            .collect();
        
        (paginated_chunks, total)
    });
    
    PaginatedChunks {
        chunks,
        total,
        offset,
        limit,
    }
}

pub fn get_orderbook_stats() -> OrderbookStats {
    // Optimized: Calculate stats in a single pass instead of loading all chunks then filtering multiple times
    let (total_active_chunks, total_available_usd, total_locked_usd) = CHUNKS.with(|chunks| {
        let mut active_count = 0u64;
        let mut available_sum = 0.0;
        let mut locked_sum = 0.0;
        
        for (_, chunk) in chunks.borrow().iter() {
            match chunk.status {
                ChunkStatus::Available => {
                    active_count += 1;
                    available_sum += chunk.amount_usd;
                }
                ChunkStatus::Locked => {
                    locked_sum += chunk.amount_usd;
                }
                _ => {}
            }
        }
        
        (active_count, available_sum, locked_sum)
    });
    
    let total_orders = ORDERS.with(|orders| {
        orders.borrow().iter().count() as u64
    });
    
    let total_trades = TRADES.with(|trades| {
        trades.borrow().iter().count() as u64
    });
    
    let (current_bsv_price, _) = get_cached_bsv_price();
    
    OrderbookStats {
        total_active_chunks,
        total_available_usd,
        total_locked_usd,
        total_orders,
        total_trades,
        current_bsv_price,
    }
}

use crate::state::{CHUNKS, ORDERS, TRADES};
