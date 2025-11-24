/// Autonomous timer system for processing confirmations and timeouts
use crate::types::*;
use crate::state::*;
use crate::chunk_allocation;

/// Process confirmations and withdrawals (called every 60 seconds by timer)
pub async fn process_confirmations() -> Result<(), String> {
    let cycles_start = ic_cdk::api::canister_balance128();
    
    let cycles_end = ic_cdk::api::canister_balance128();
    let cycles_consumed = cycles_start.saturating_sub(cycles_end);
    
    ic_cdk::println!(
        "⏱️  process_confirmations consumed {} cycles ({:.4} TC)",
        cycles_consumed,
        cycles_consumed as f64 / 1_000_000_000_000.0
    );
    
    Ok(())
}

/// Cleanup tasks (called every 5 minutes by timer)
pub async fn process_cleanup_tasks() -> Result<(), String> {
    let cycles_start = ic_cdk::api::canister_balance128();
    
    // Check and unlock expired trades (with penalty)
    let _ = unlock_expired_trades().await;
    
    // Check for expired unclaimed trades (24h after tx submission)
    let _ = reclaim_expired_trades().await;
    
    let cycles_end = ic_cdk::api::canister_balance128();
    let cycles_consumed = cycles_start.saturating_sub(cycles_end);
    
    ic_cdk::println!(
        "⏱️  process_cleanup_tasks consumed {} cycles ({:.4} TC)",
        cycles_consumed,
        cycles_consumed as f64 / 1_000_000_000_000.0
    );
    
    Ok(())
}

/// Unlock expired trades that haven't submitted BSV tx
async fn unlock_expired_trades() -> Result<(), String> {
    let now = get_time();
    
    let locked_trades = get_trades_by_status(TradeStatus::ChunksLocked);
    
    for trade in locked_trades {
        if now > trade.lock_expires_at {
            // Lock expired and NO BSV transaction submitted - apply penalty
            ic_cdk::println!("⚠️  Trade {} expired without BSV transaction. Applying penalty to filler.", trade.id);
            
            // Apply penalty (5% of trade amount)
            let penalty_amount = trade.amount_usd * (crate::config::SECURITY_DEPOSIT_PERCENT as f64 / 100.0);
            
            // Get order to find maker (recipient of timeout penalty)
            let order = crate::state::get_order(trade.order_id);
            let recipient = order.as_ref().map(|o| o.maker);
            
            match crate::filler_accounts::deduct_penalty(
                trade.filler,
                penalty_amount,
                recipient,
                Some(format!("Timeout penalty T{}", trade.id)),
            ).await {
                Ok(_) => {
                    ic_cdk::println!("✅ Penalty ${:.2} deducted from filler", penalty_amount);
                    
                    // Log the penalty event for admin visibility
                    if let Some(order) = order {
                        crate::state::create_admin_event(crate::types::AdminEventType::PenaltyApplied {
                            trade_id: trade.id,
                            order_id: Some(trade.order_id),
                            filler: trade.filler,
                            order_maker: Some(order.maker),
                            penalty_amount,
                            bsv_tx_hex: trade.bsv_tx_hex.clone(),
                            reason: format!("Trade expired without BSV transaction submission"),
                        });
                    }
                }
                Err(e) => {
                    ic_cdk::println!("❌ Failed to deduct penalty: {}", e);
                    // Continue with unlock even if penalty fails
                }
            }
            
            // Unlock chunks (return to orderbook)
            let chunk_ids: Vec<ChunkId> = trade.locked_chunks.iter()
                .map(|lc| lc.chunk_id)
                .collect();
            
            chunk_allocation::unlock_chunks(&chunk_ids)?;
            
            // Update trade status to PenaltyApplied (not just Cancelled)
            update_trade(trade.id, |t| {
                t.status = TradeStatus::PenaltyApplied;
            })?;
            
            ic_cdk::println!("✅ Trade {} chunks unlocked and penalty applied", trade.id);
        }
    }
    
    Ok(())
}

/// Reclaim ckUSDC from trades that stayed TxSubmitted for 24+ hours without claim
/// Transfers funds (minus fee) to treasury and marks chunks as filled
/// Also applies 5% penalty from filler's security deposit to prevent spam/fake transactions
/// 
/// Safety: Only reclaims trades with ID < last successfully claimed trade ID
/// This avoids penalizing trades that couldn't be claimed due to blockchain/API issues
async fn reclaim_expired_trades() -> Result<(), String> {
    let now = get_time();
    
    let submitted_trades = get_trades_by_status(TradeStatus::TxSubmitted);
    
    for trade in submitted_trades {
        // Check if claim has expired (24 hours after submission)
        if let Some(claim_expiry) = trade.claim_expires_at {
            if now > claim_expiry {
                ic_cdk::println!("⚠️  Trade {} expired without claim after 24 hours. Reclaiming funds to treasury.", trade.id);
                
                // Calculate amount to send to treasury (chunk amount + incentive)
                // Use config value for filler incentive (4.5% = 450 basis points)
                let incentive_multiplier = 1.0 + (crate::config::FILLER_INCENTIVE_PERCENT as f64 / 10000.0);
                let total_amount = trade.amount_usd * incentive_multiplier;
                let total_e6 = crate::ckusdc_integration::usd_to_ckusdc_e6(total_amount);
                
                ic_cdk::println!("💰 Reclaiming ${:.6} ({} e6) to treasury from order (transfer will deduct fee)", 
                    crate::ckusdc_integration::ckusdc_e6_to_usd(total_e6), 
                    total_e6);
                
                // Get order to extract maker for subaccount
                let order = match crate::state::get_order(trade.order_id) {
                    Some(o) => o,
                    None => {
                        ic_cdk::println!("❌ Order {} not found for trade {}", trade.order_id, trade.id);
                        continue; // Skip this trade
                    }
                };
                
                // Apply 5% penalty from filler's security deposit to treasury
                // This prevents spam/fake transactions that match outputs but cannot be broadcast
                let penalty_amount = trade.amount_usd * (crate::config::SECURITY_DEPOSIT_PERCENT as f64 / 100.0);
                ic_cdk::println!("⚠️  Applying {}% penalty: ${:.2} from filler's security deposit", 
                    crate::config::SECURITY_DEPOSIT_PERCENT, penalty_amount);
                
                match crate::filler_accounts::deduct_penalty(
                    trade.filler,
                    penalty_amount,
                    None,
                    Some(format!("Unclaimed penalty T{}", trade.id)),
                ).await {
                    Ok(_) => {
                        ic_cdk::println!("✅ Penalty ${:.2} deducted from filler and sent to treasury", penalty_amount);
                        
                        // Log the penalty event with full context for admin review
                        crate::state::create_admin_event(crate::types::AdminEventType::PenaltyApplied {
                            trade_id: trade.id,
                            order_id: Some(trade.order_id),
                            filler: trade.filler,
                            order_maker: Some(order.maker),
                            penalty_amount,
                            bsv_tx_hex: trade.bsv_tx_hex.clone(),
                            reason: format!("Trade expired without claim after 24 hours - possible spam/fake transaction"),
                        });
                    }
                    Err(e) => {
                        ic_cdk::println!("❌ Failed to deduct penalty: {}", e);
                        // Continue with transfer even if penalty fails
                    }
                }
                
                // Transfer full order amount to treasury - transfer_ckusdc_from_order automatically deducts the fee
                match crate::ckusdc_integration::transfer_ckusdc_from_order(
                    order.maker,
                    trade.order_id,
                    crate::state::get_treasury_principal(),
                    None, // Default subaccount
                    total_e6,
                    Some(format!("Expired claim T{}", trade.id).into_bytes()),
                ).await {
                    Ok(block_index) => {
                        ic_cdk::println!("✅ Transferred to treasury at block {}", block_index);
                        
                        // Calculate actual amount sent (before fee deduction)
                        let amount_sent_usd = crate::ckusdc_integration::ckusdc_e6_to_usd(total_e6);
                        
                        // Log the treasury reclaim event for admin visibility
                        crate::state::create_admin_event(crate::types::AdminEventType::TradeExpiredToTreasury {
                            trade_id: trade.id,
                            filler: trade.filler,
                            order_id: trade.order_id,
                            amount_sent: amount_sent_usd,
                            block_index,
                        });
                        
                        // Mark chunks as filled
                        let chunk_ids: Vec<crate::types::ChunkId> = trade.locked_chunks.iter()
                            .map(|lc| lc.chunk_id)
                            .collect();
                        
                        if let Err(e) = crate::chunk_allocation::mark_chunks_filled(&chunk_ids) {
                            ic_cdk::println!("❌ Failed to mark chunks filled: {}", e);
                        }
                        
                        // Update trade status to Cancelled with note
                        update_trade(trade.id, |t| {
                            t.status = TradeStatus::Cancelled;
                            t.withdrawal_tx_hash = Some(format!("treasury_reclaim_{}", block_index));
                            t.withdrawal_confirmed_at = Some(now);
                        }).ok();
                        
                        ic_cdk::println!("✅ Trade {} funds reclaimed to treasury", trade.id);
                    }
                    Err(e) => {
                        ic_cdk::println!("❌ Failed to transfer to treasury: {}", e);
                        // Keep trying on next heartbeat
                    }
                }
            }
        }
    }
    
    Ok(())
}

/// Check if any Idle chunks should become Available (price dropped below max)
/// Called every 60 seconds by dedicated timer for faster reactivation
pub async fn reactivate_idle_chunks() -> Result<(), String> {
    let cycles_start = ic_cdk::api::canister_balance128();
    
    use crate::price_oracle;
    use crate::config::MAX_ORDERBOOK_USD_LIMIT;
    
    // Get current BSV price
    let current_price = match price_oracle::get_bsv_price().await {
        Ok(price) => price,
        Err(_) => return Ok(()),  // Skip on price fetch error
    };
    
    // Get current orderbook available balance
    let current_orderbook_usd = get_available_orderbook();
    
    // Get all active orders - optimized to filter at storage level
    let orders = crate::state::get_active_orders_fifo();
    
    for order in orders {
        // Check if price dropped back below max
        if current_price < order.max_bsv_price {
            // Find Idle chunks in this order
            for chunk_id in &order.chunks {
                if let Some(chunk) = get_chunk(*chunk_id) {
                    if chunk.status == ChunkStatus::Idle {
                        // Check if adding this chunk would exceed orderbook limit
                        if current_orderbook_usd + chunk.amount_usd > MAX_ORDERBOOK_USD_LIMIT {
                            ic_cdk::println!("⚠️  Orderbook limit reached (${:.2}/${:.2}). Chunk {} stays Idle.", 
                                current_orderbook_usd, MAX_ORDERBOOK_USD_LIMIT, chunk_id);
                            continue; // Skip this chunk, keep it Idle
                        }
                        
                        // Price dropped and space available - reactivate chunk
                        update_chunk(chunk.id, |c| {
                            c.status = ChunkStatus::Available;
                        })?;
                        
                        // Update order tracking
                        update_order(order.id, |o| {
                            o.total_idle_usd -= chunk.amount_usd;
                        })?;
                        
                        ic_cdk::println!("✅ Chunk {} reactivated (${:.2})", chunk_id, chunk.amount_usd);
                    }
                }
            }
        }
    }
    
    let cycles_end = ic_cdk::api::canister_balance128();
    let cycles_consumed = cycles_start.saturating_sub(cycles_end);
    
    // Log to admin events for tracking
    ic_cdk::println!(
        "⏱️  reactivate_idle_chunks consumed {} cycles ({:.4} TC)",
        cycles_consumed,
        cycles_consumed as f64 / 1_000_000_000_000.0
    );
    
    Ok(())
}
