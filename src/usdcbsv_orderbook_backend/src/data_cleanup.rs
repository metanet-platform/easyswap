/// Automated data cleanup to prevent storage exhaustion
use crate::types::*;
use crate::state::*;
use crate::config::{TRADE_RETENTION_SECONDS, ORDER_RETENTION_SECONDS};
use crate::block_headers::CONFIRMATION_DEPTH;

/// Clean up old orders where ALL chunks are in final states (Filled or Refunded)
/// Does NOT delete orders with any active, idle, locked, or pending chunks
pub fn cleanup_old_orders() -> u64 {
    let now = get_time();
    let retention_threshold = now.saturating_sub(ORDER_RETENTION_SECONDS * 1_000_000_000);
    
    let mut deleted_count = 0u64;
    
    // Get all order IDs to check (just IDs, not full orders)
    let order_ids_to_check: Vec<OrderId> = ORDERS.with(|orders| {
        orders.borrow().iter().filter_map(|(id, order)| {
            // Skip orders newer than retention threshold
            if order.created_at >= retention_threshold {
                return None;
            }
            
            Some(id.clone())
        }).collect()
    });
    
    // Process each order one-by-one for fault tolerance
    for order_id in order_ids_to_check {
        // Get order details
        let order = match ORDERS.with(|orders| orders.borrow().get(&order_id)) {
            Some(o) => o,
            None => continue, // Order already deleted
        };
        
        // Get all chunks for this specific order
        let order_chunks = CHUNKS.with(|chunks| {
            chunks.borrow()
                .iter()
                .filter(|(_, chunk)| chunk.order_id == order_id)
                .map(|(id, chunk)| (id.clone(), chunk.clone()))
                .collect::<Vec<_>>()
        });
        
        // Check if ALL chunks are in final states (Filled or Refunded)
        let all_chunks_final = order_chunks.iter().all(|(_, chunk)| {
            matches!(chunk.status, ChunkStatus::Filled | ChunkStatus::Refunded)
        });
        
        // If any chunk is NOT in a final state, skip this order
        if !all_chunks_final {
            continue;
        }
        
        // Safe to delete - all chunks are in final states
        // Delete order first
        ORDERS.with(|orders| {
            orders.borrow_mut().remove(&order_id);
        });
        
        // Then delete chunks one by one
        CHUNKS.with(|chunks| {
            let mut chunks_mut = chunks.borrow_mut();
            for (chunk_id, _) in order_chunks.iter() {
                chunks_mut.remove(chunk_id);
            }
        });
        
        deleted_count += 1;
        
        ic_cdk::println!(
            "🗑️  Deleted old order #{} with {} chunks (age: {} days)",
            order_id,
            order_chunks.len(),
            (now - order.created_at) / (24 * 60 * 60 * 1_000_000_000)
        );
    }
    
    if deleted_count > 0 {
        ic_cdk::println!("✅ Cleanup: Deleted {} old orders", deleted_count);
    }
    
    deleted_count
}

/// Clean up old trades that are in final states and older than retention period
pub fn cleanup_old_trades() -> u64 {
    let now = get_time();
    let retention_threshold = now.saturating_sub(TRADE_RETENTION_SECONDS * 1_000_000_000);
    
    let mut deleted_count = 0u64;
    
    // Get trade IDs to check (only final states, older than threshold)
    let trade_ids_to_check: Vec<TradeId> = TRADES.with(|trades| {
        trades.borrow().iter().filter_map(|(id, trade)| {
            // Only consider trades in final states
            let is_final_state = matches!(
                trade.status,
                TradeStatus::WithdrawalConfirmed | TradeStatus::Cancelled | TradeStatus::PenaltyApplied
            );
            
            if !is_final_state {
                return None;
            }
            
            // Only cleanup old trades
            if trade.created_at >= retention_threshold {
                return None;
            }
            
            Some(id.clone())
        }).collect()
    });
    
    // Delete each trade one by one (fault tolerant)
    // Process each trade one-by-one for fault tolerance
    for trade_id in trade_ids_to_check {
        // Get trade details for logging
        let trade = match TRADES.with(|trades| trades.borrow().get(&trade_id)) {
            Some(t) => t,
            None => continue, // Trade already deleted
        };
        
        // Delete the trade
        TRADES.with(|trades| {
            trades.borrow_mut().remove(&trade_id);
        });
        
        deleted_count += 1;
        
        ic_cdk::println!(
            "🗑️  Deleted old trade #{} (status: {:?}, age: {} days)",
            trade_id,
            trade.status,
            (now - trade.created_at) / (24 * 60 * 60 * 1_000_000_000)
        );
    }
    
    if deleted_count > 0 {
        ic_cdk::println!("✅ Cleanup: Deleted {} old trades", deleted_count);
    }
    
    deleted_count
}

/// Clean up old block headers - keep only the last MAX_BLOCKS_TO_KEEP from tip
pub fn cleanup_old_blocks() -> u64 {
    use crate::config::MAX_BLOCKS_TO_KEEP;
    
    let mut deleted_count = 0u64;
    
    // Get current tip
    let highest_block = crate::block_headers::get_highest_block();
    
    // Calculate minimum height to keep (last 720 blocks)
    let min_height_to_keep = highest_block.saturating_sub(MAX_BLOCKS_TO_KEEP - 1);
    
    ic_cdk::println!(
        "Block cleanup: tip={}, min_to_keep={}, will delete blocks below {}",
        highest_block, min_height_to_keep, min_height_to_keep
    );
    
    // Get block heights to delete (all blocks below min_height_to_keep)
    let heights_to_delete: Vec<u64> = crate::block_headers::BLOCK_HEADERS.with(|headers| {
        headers.borrow().iter().filter_map(|(height, _)| {
            if height < min_height_to_keep {
                Some(height)
            } else {
                None
            }
        }).collect()
    });
    
    // Delete old blocks
    for height in heights_to_delete {
        crate::block_headers::BLOCK_HEADERS.with(|headers| {
            headers.borrow_mut().remove(&height);
        });
        deleted_count += 1;
    }
    
    if deleted_count > 0 {
        ic_cdk::println!("✅ Cleanup: Deleted {} old blocks (keeping last {} blocks)", deleted_count, MAX_BLOCKS_TO_KEEP);
    }
    
    deleted_count
}

/// Clean up old admin events
pub fn cleanup_old_admin_events() -> u64 {
    let now = get_time();
    let retention_threshold_ns = now.saturating_sub(crate::config::ADMIN_EVENTS_RETENTION_SECONDS * 1_000_000_000);
    
    let mut deleted_count = 0u64;
    
    // Get admin event IDs to check (only old enough events)
    let event_ids_to_check: Vec<u64> = crate::state::ADMIN_EVENTS.with(|events| {
        events.borrow().iter().filter_map(|(id, event)| {
            if event.timestamp < retention_threshold_ns {
                Some(id.clone())
            } else {
                None
            }
        }).collect()
    });
    
    // Process each event one-by-one for fault tolerance
    for event_id in event_ids_to_check {
        crate::state::ADMIN_EVENTS.with(|events| {
            events.borrow_mut().remove(&event_id);
        });
        deleted_count += 1;
    }
    
    if deleted_count > 0 {
        ic_cdk::println!("✅ Cleanup: Deleted {} old admin events", deleted_count);
    }
    
    deleted_count
}

/// Run all cleanup operations
/// Returns tuple of (orders_deleted, trades_deleted, blocks_deleted, admin_events_deleted)
pub fn run_cleanup() -> (u64, u64, u64, u64) {
    ic_cdk::println!("🧹 Starting automated cleanup...");
    
    let orders_deleted = cleanup_old_orders();
    let trades_deleted = cleanup_old_trades();
    let blocks_deleted = cleanup_old_blocks();
    let admin_events_deleted = cleanup_old_admin_events();
    
    ic_cdk::println!(
        "✅ Cleanup complete: {} orders, {} trades, {} blocks, {} admin events deleted",
        orders_deleted,
        trades_deleted,
        blocks_deleted,
        admin_events_deleted
    );
    
    (orders_deleted, trades_deleted, blocks_deleted, admin_events_deleted)
}
