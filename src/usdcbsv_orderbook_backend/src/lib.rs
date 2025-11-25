mod config;
mod types;
mod state;
mod order_management;
mod chunk_allocation;
mod trade_lifecycle;
mod bsv_parser;
mod price_oracle;
mod xrc_oracle;
mod ckusdc_integration;
mod filler_accounts;
mod heartbeat;
mod withdrawal_treasury;
mod block_headers;
mod block_sync;
mod chain_sync;
mod bump_verification;
mod data_cleanup;

use ic_cdk::{init, post_upgrade, query, update};
use ic_cdk_timers::{set_timer, set_timer_interval};
use std::time::Duration;
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use types::*;
use state::*;
use config::ADMIN_PRINCIPAL;
use block_headers::{BlockHeader, BlocksWithMetadata};

fn is_admin(caller: Principal) -> bool {
    caller.to_string() == ADMIN_PRINCIPAL
}

use ic_cdk::api::management_canister::http_request::{TransformArgs, HttpResponse};

/// Start all background timers
/// Called by both init and post_upgrade to ensure timers run after canister start/upgrade
fn start_timers() {
    ic_cdk::println!("🔄 Starting background timers...");
    
    // Timer 1: Check pending orders and process confirmations (every 60 seconds)
    set_timer_interval(Duration::from_secs(60), || {
        ic_cdk::spawn(async {
            let _ = heartbeat::process_confirmations().await;
        });
    });
    
    // Timer 2: Idle chunk reactivation (every 60 seconds)
    set_timer_interval(Duration::from_secs(60), || {
        ic_cdk::spawn(async {
            let _ = heartbeat::reactivate_idle_chunks().await;
        });
    });
    
    // Timer 3: Cleanup tasks (every 5 minutes)
    set_timer_interval(Duration::from_secs(5 * 60), || {
        ic_cdk::spawn(async {
            let _ = heartbeat::process_cleanup_tasks().await;
        });
    });
    
    // Timer 4: Sync BSV blocks (every 20 minutes)
    set_timer_interval(Duration::from_secs(20 * 60), || {
        ic_cdk::spawn(async {
            let cycles_start = ic_cdk::api::canister_balance128();
            
            match chain_sync::sync_blocks().await {
                Ok(result) => {
                    ic_cdk::println!(
                        "✅ Block sync successful: {} blocks added, {} removed",
                        result.blocks_added,
                        result.blocks_removed
                    );
                    block_headers::update_sync_time(ic_cdk::api::time() / 1_000_000_000);
                }
                Err(e) => {
                    ic_cdk::println!("❌ Block sync failed: {}", e);
                }
            }
            
            let cycles_end = ic_cdk::api::canister_balance128();
            let cycles_consumed = cycles_start.saturating_sub(cycles_end);
            
            ic_cdk::println!(
                "⏱️  sync_blocks consumed {} cycles ({:.4} TC)",
                cycles_consumed,
                cycles_consumed as f64 / 1_000_000_000_000.0
            );
        });
    });
    
    // Timer 5: Data cleanup (every 24 hours)
    set_timer_interval(Duration::from_secs(config::CLEANUP_INTERVAL_SECONDS), || {
        ic_cdk::spawn(async {
            let cycles_start = ic_cdk::api::canister_balance128();
            
            let (orders, trades, blocks, admin_events) = data_cleanup::run_cleanup();
            ic_cdk::println!("🧹 Cleanup: {} orders, {} trades, {} blocks, {} admin_events deleted", orders, trades, blocks, admin_events);
            
            let cycles_end = ic_cdk::api::canister_balance128();
            let cycles_consumed = cycles_start.saturating_sub(cycles_end);
            
            ic_cdk::println!(
                "⏱️  data_cleanup consumed {} cycles ({:.4} TC)",
                cycles_consumed,
                cycles_consumed as f64 / 1_000_000_000_000.0
            );
        });
    });
    
    ic_cdk::println!("✅ All timers started successfully");
}

#[init]
fn init_canister() {
    ic_cdk::println!("EasySwap initialized with admin: {}", ADMIN_PRINCIPAL);
    ic_cdk::println!("Block storage in stable memory - timer will sync last 720 blocks every 20 minutes");
    start_timers();
}

#[post_upgrade]
fn post_upgrade_canister() {
    ic_cdk::println!("EasySwap upgraded - restarting timers");
    ic_cdk::println!("Block storage persisted in stable memory - timer will sync any missing blocks");
    
    start_timers();

    
    // Start block sync immediately after upgrade (don't wait 20 minutes)
    // Use one-shot timer to schedule it for next execution round
    ic_cdk_timers::set_timer(Duration::from_secs(1), || {
        ic_cdk::spawn(async {
            ic_cdk::println!("🔄 Starting immediate block sync after upgrade...");
            match chain_sync::sync_blocks().await {
                Ok(result) => {
                    ic_cdk::println!(
                        "✅ Initial sync successful: {} blocks added, tip height: {}",
                        result.blocks_added,
                        result.new_tip_height
                    );
                    block_headers::update_sync_time(ic_cdk::api::time() / 1_000_000_000);
                }
                Err(e) => {
                    ic_cdk::println!("❌ Initial sync failed: {}", e);
                }
            }
        });
    });
}

// ===== MAKER FUNCTIONS =====

#[update]
async fn create_order(
    amount_usd: f64,
    max_bsv_price: f64,
    bsv_address: String,
) -> Result<OrderId, String> {
    // Creates order with auto-activation if balance sufficient
    order_management::create_order(amount_usd, max_bsv_price, bsv_address).await
}

#[query]
fn get_my_orders() -> Vec<Order> {
    order_management::get_my_orders()
}

#[query]
fn get_my_active_orders() -> Vec<Order> {
    order_management::get_my_active_orders()
}

#[query]
fn get_my_orders_paginated(offset: u64, limit: u64, status_filter: Option<Vec<types::OrderStatus>>) -> types::PaginatedOrders {
    order_management::get_my_orders_paginated(offset, limit, status_filter)
}

#[query]
fn get_my_active_orders_paginated(offset: u64, limit: u64) -> types::PaginatedOrders {
    order_management::get_my_active_orders_paginated(offset, limit)
}

#[query]
fn get_my_orders_by_status_paginated(status: OrderStatus, offset: u64, limit: u64) -> types::PaginatedOrders {
    order_management::get_my_orders_by_status_paginated(status, offset, limit)
}

#[query]
fn get_order(order_id: OrderId) -> Option<Order> {
    let caller = ic_cdk::caller();
    let order = order_management::get_order(order_id)?;
    
    // Only the order maker or admin can see full order details
    let admin = state::get_admin();
    if caller == order.maker || caller == admin {
        Some(order)
    } else {
        None
    }
}

#[query]
fn get_order_chunks(order_id: OrderId) -> Vec<types::ChunkDetails> {
    order_management::get_order_chunks(order_id)
}

#[update]
async fn update_max_bsv_price(order_id: OrderId, new_max_bsv_price: f64) -> Result<(), String> {
    order_management::update_max_bsv_price(order_id, new_max_bsv_price).await
}

#[update]
async fn cancel_order(order_id: OrderId) -> Result<(), String> {
    order_management::cancel_order(order_id).await
}

// ===== FILLER FUNCTIONS =====

#[update]
async fn deposit_security(amount: u64) -> Result<(), String> {
    filler_accounts::deposit_security(amount).await
}

#[query]
fn get_my_filler_account() -> Option<FillerAccount> {
    filler_accounts::get_my_filler_account()
}

#[update]
async fn withdraw_security(amount: u64, to_principal: String) -> Result<(), String> {
    let principal = Principal::from_text(to_principal)
        .map_err(|e| format!("Invalid principal: {}", e))?;
    filler_accounts::withdraw_security(amount, principal).await
}

#[query]
fn get_filler_subaccount_address() -> String {
    let caller = ic_cdk::caller();
    filler_accounts::get_filler_subaccount_address(caller)
}

#[update]
async fn create_trades(request: trade_lifecycle::CreateTradesRequest) -> Result<Vec<TradeId>, String> {
    trade_lifecycle::create_trades(request).await
}

#[update]
async fn submit_bsv_transaction(trade_id: TradeId, raw_tx_hex: String) -> Result<(), String> {
    trade_lifecycle::submit_bsv_transaction(trade_id, raw_tx_hex).await
}

#[update]
async fn resubmit_bsv_transaction(trade_id: TradeId, raw_tx_hex: String) -> Result<(), String> {
    trade_lifecycle::resubmit_bsv_transaction(trade_id, raw_tx_hex).await
}

#[update]
async fn claim_usdc(trade_id: TradeId, tx_hex: String, bump_hex: String) -> Result<(), String> {
    trade_lifecycle::claim_usdc(trade_id, tx_hex, bump_hex).await
}

#[query]
fn get_my_trades() -> Vec<Trade> {
    trade_lifecycle::get_my_trades()
}

#[query]
fn get_my_trades_paginated(offset: u64, limit: u64, status_filter: Option<Vec<types::TradeStatus>>) -> types::PaginatedTrades {
    trade_lifecycle::get_my_trades_paginated(offset, limit, status_filter)
}

#[query]
fn get_trade(trade_id: TradeId) -> Option<Trade> {
    let caller = ic_cdk::caller();
    let trade = trade_lifecycle::get_trade(trade_id)?;
    
    // Only the filler, order maker, or admin can see full trade details
    let admin = state::get_admin();
    let order = state::get_order(trade.order_id);
    let is_maker = order.map_or(false, |o| o.maker == caller);
    
    if caller == trade.filler || is_maker || caller == admin {
        Some(trade)
    } else {
        None
    }
}

// ===== ORDERBOOK FUNCTIONS =====

#[query]
fn get_active_chunks() -> Vec<OrderbookChunk> {
    chunk_allocation::get_active_chunks()
}

#[query]
fn get_active_chunks_paginated(offset: u64, limit: u64) -> types::PaginatedChunks {
    chunk_allocation::get_active_chunks_paginated(offset, limit)
}

#[query]
fn get_orderbook_stats() -> OrderbookStats {
    chunk_allocation::get_orderbook_stats()
}

#[query]
fn get_available_orderbook() -> f64 {
    state::get_available_orderbook()
}

// ===== TREASURY =====

// Get canister's cycles balance
#[query]
fn get_cycles_balance() -> u64 {
    ic_cdk::api::canister_balance()
}

// Withdraw ckUSDC to Ethereum USDC
// User must first approve canister to spend (withdrawal_amount + gas_fee + treasury_fee) ckUSDC
// Canister pays Ethereum gas using its ckETH treasury
// Treasury fee (0.05 USDC) covers operational costs (XRC calls, etc.)
#[update]
async fn withdraw_ckusdc_to_eth(
    withdrawal_amount_e6: candid::Nat,
    gas_fee_usdc_e6: candid::Nat,
    treasury_fee_e6: candid::Nat,
    gas_amount_wei: candid::Nat,
    recipient_address: String,
) -> Result<withdrawal_treasury::RetrieveErc20Request, String> {
    let caller = ic_cdk::caller();
    withdrawal_treasury::withdraw_ckusdc_to_eth(
        caller,
        withdrawal_amount_e6,
        gas_fee_usdc_e6,
        treasury_fee_e6,
        gas_amount_wei,
        recipient_address,
    ).await
}

// ===== PRICE ORACLE =====

#[update]
async fn get_bsv_price() -> Result<f64, String> {
    price_oracle::get_bsv_price().await
}

#[update]
async fn get_eth_usd_price() -> Result<f64, String> {
    xrc_oracle::get_eth_usd_rate().await
}

// ===== HEARTBEAT =====

// ===== ADMIN FUNCTIONS =====

#[query]
fn get_filler_incentive_percent() -> f64 {
    // Returns as percentage (e.g., 2.0 for 2%)
    config::FILLER_INCENTIVE_PERCENT as f64 / 100.0
}
#[query]
fn get_admin_events(limit: Option<u64>) -> Vec<types::AdminEvent> {
    let caller = ic_cdk::caller();
    let admin = state::get_admin();
    
    if caller != admin {
        return Vec::new(); // Only admin can view events
    }
    
    match limit {
        Some(n) => state::get_recent_admin_events(n as usize),
        None => state::get_admin_events(),
    }
}

#[query]
fn get_admin_events_paginated(offset: u64, limit: u64) -> Vec<types::AdminEvent> {
    let caller = ic_cdk::caller();
    let admin = state::get_admin();
    
    if caller != admin {
        return Vec::new(); // Only admin can view events
    }
    
    state::get_paginated_admin_events(offset as usize, limit as usize)
}

#[query]
fn get_admin_events_count() -> u64 {
    let caller = ic_cdk::caller();
    let admin = state::get_admin();
    
    if caller != admin {
        return 0; // Only admin can view count
    }
    
    state::get_admin_events_count()
}

#[update]
async fn admin_withdraw_ckusdc_treasury() -> Result<candid::Nat, String> {
    let caller = ic_cdk::caller();
    let admin = state::get_admin();
    
    if caller != admin {
        return Err("Only admin can withdraw from treasury".to_string());
    }
    
    withdrawal_treasury::admin_withdraw_ckusdc_treasury().await
}

// ===== EMERGENCY CONTROLS =====

#[query]
fn are_new_orders_enabled() -> bool {
    state::are_new_orders_enabled()
}

#[update]
fn admin_toggle_new_orders(enable: bool) -> Result<String, String> {
    let caller = ic_cdk::caller();
    let admin = state::get_admin();
    
    if caller != admin {
        return Err("Only admin can toggle new order acceptance".to_string());
    }
    
    let was_enabled = state::are_new_orders_enabled();
    state::set_new_orders_enabled(enable);
    
    let action_msg = if enable {
        "ENABLED - new orders are now being accepted"
    } else {
        "DISABLED - new orders are temporarily disabled (existing orders and trades continue normally)"
    };
    
    // Log admin event
    let event_type = if enable {
        types::AdminEventType::NewOrdersEnabled
    } else {
        types::AdminEventType::NewOrdersDisabled
    };
    state::create_admin_event(event_type);
    
    ic_cdk::println!(
        "🔐 ADMIN ACTION: New orders {} by {}",
        action_msg,
        caller
    );
    
    Ok(format!(
        "New orders {}. Previous state: {}",
        action_msg,
        if was_enabled { "enabled" } else { "disabled" }
    ))
}

// ===== AUDIT METHODS (ADMIN ONLY) =====

#[query]
fn admin_get_orders_audit(params: types::AuditQueryParams) -> Result<types::OrderAuditResponse, String> {
    let caller = ic_cdk::caller();
    let admin = state::get_admin();
    
    if caller != admin {
        return Err("Only admin can access audit records".to_string());
    }

    // Validate page size
    if params.page_size == 0 || params.page_size > 500 {
        return Err("Page size must be between 1 and 500".to_string());
    }

    // Get all orders from state
    let all_orders = state::get_all_orders();
    
    // Filter by time range if provided
    let filtered_orders: Vec<_> = all_orders
        .into_iter()
        .filter(|order| {
            let in_start_range = params.start_time.map_or(true, |start| order.created_at >= start);
            let in_end_range = params.end_time.map_or(true, |end| order.created_at <= end);
            in_start_range && in_end_range
        })
        .collect();

    let total_count = filtered_orders.len() as u64;
    
    // Calculate pagination
    let skip = params.page * params.page_size;
    let page_orders: Vec<_> = filtered_orders
        .into_iter()
        .skip(skip as usize)
        .take(params.page_size as usize)
        .collect();

    // Convert to audit records
    let records: Vec<types::OrderAuditRecord> = page_orders
        .into_iter()
        .map(|order| {
            // Get chunk details for this order
            let chunk_info: Vec<types::ChunkAuditInfo> = order.chunks
                .iter()
                .filter_map(|chunk_id| {
                    state::get_chunk(*chunk_id).map(|chunk| types::ChunkAuditInfo {
                        chunk_id: chunk.id,
                        amount_usd: chunk.amount_usd,
                        status: chunk.status,
                        locked_by_trade: chunk.locked_by,
                        filled_at: chunk.filled_at,
                    })
                })
                .collect();

            types::OrderAuditRecord {
                order_id: order.id,
                maker: order.maker,
                amount_usd: order.amount_usd,
                total_deposited_usd: order.total_deposited_usd,
                activation_fee_usd: order.activation_fee_usd,
                deposit_principal: order.deposit_principal,
                deposit_subaccount: order.deposit_subaccount,
                max_bsv_price: order.max_bsv_price,
                allow_partial_fill: order.allow_partial_fill,
                bsv_address: order.bsv_address,
                status: order.status,
                chunks: chunk_info,
                created_at: order.created_at,
                deposit_confirmed_at: order.deposit_confirmed_at,
                funded_at: order.funded_at,
                activation_fee_confirmed_at: order.activation_fee_confirmed_at,
                total_filled_usd: order.total_filled_usd,
                total_locked_usd: order.total_locked_usd,
                total_idle_usd: order.total_idle_usd,
                total_refunded_usd: order.total_refunded_usd,
                refund_count: order.refund_attempts.len() as u64,
            }
        })
        .collect();

    Ok(types::OrderAuditResponse {
        records,
        total_count,
        page: params.page,
        page_size: params.page_size,
    })
}

#[query]
fn admin_get_trades_audit(params: types::AuditQueryParams) -> Result<types::TradeAuditResponse, String> {
    let caller = ic_cdk::caller();
    let admin = state::get_admin();
    
    if caller != admin {
        return Err("Only admin can access audit records".to_string());
    }

    // Validate page size
    if params.page_size == 0 || params.page_size > 500 {
        return Err("Page size must be between 1 and 500".to_string());
    }

    // Get all trades from state
    let all_trades = state::get_all_trades();
    
    // Filter by time range if provided
    let filtered_trades: Vec<_> = all_trades
        .into_iter()
        .filter(|trade| {
            let in_start_range = params.start_time.map_or(true, |start| trade.created_at >= start);
            let in_end_range = params.end_time.map_or(true, |end| trade.created_at <= end);
            in_start_range && in_end_range
        })
        .collect();

    let total_count = filtered_trades.len() as u64;
    
    // Calculate pagination
    let skip = params.page * params.page_size;
    let page_trades: Vec<_> = filtered_trades
        .into_iter()
        .skip(skip as usize)
        .take(params.page_size as usize)
        .collect();

    // Convert to audit records
    let records: Vec<types::TradeAuditRecord> = page_trades
        .into_iter()
        .map(|trade| {
            // Get maker principal and BSV address from the order
            let (maker, maker_bsv_address) = state::get_order(trade.order_id)
                .map(|order| (order.maker, order.bsv_address))
                .unwrap_or((Principal::anonymous(), "Unknown".to_string()));

            types::TradeAuditRecord {
                trade_id: trade.id,
                order_id: trade.order_id,
                maker,
                filler: trade.filler,
                amount_usd: trade.amount_usd,
                chunks_count: trade.locked_chunks.len(),
                agreed_bsv_price: trade.agreed_bsv_price,
                min_bsv_price: trade.min_bsv_price,
                status: trade.status,
                bsv_tx_hex: trade.bsv_tx_hex,
                maker_bsv_address,
                created_at: trade.created_at,
                tx_submitted_at: trade.tx_submitted_at,
                lock_expires_at: trade.lock_expires_at,
                release_available_at: trade.release_available_at,
                claim_expires_at: trade.claim_expires_at,
                withdrawal_initiated_at: trade.withdrawal_initiated_at,
                withdrawal_tx_hash: trade.withdrawal_tx_hash,
                withdrawal_confirmed_at: trade.withdrawal_confirmed_at,
            }
        })
        .collect();

    Ok(types::TradeAuditResponse {
        records,
        total_count,
        page: params.page,
        page_size: params.page_size,
    })
}

// ===== BLOCK DISPLAY (UI ONLY) =====

#[query]
fn get_recent_blocks(count: u64) -> BlocksWithMetadata {
    block_headers::get_recent_blocks(count)
}

// Note: Block sync, verification, and other SPV functions are internal only
// They are used automatically by claim_usdc and the background timer
// No public access needed for security

// Export candid interface
ic_cdk::export_candid!();
