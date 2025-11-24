use candid::{Principal, CandidType, Encode, Decode};
use serde::{Serialize, Deserialize};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell, Storable};
use ic_stable_structures::storable::Bound;
use std::cell::RefCell;
use std::borrow::Cow;
use crate::types::*;

type Memory = VirtualMemory<DefaultMemoryImpl>;

// Stable AppState that persists across upgrades
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct AppState {
    pub next_order_id: OrderId,
    pub next_chunk_id: ChunkId,
    pub next_trade_id: TradeId,
    pub next_refund_id: u64,
    pub next_admin_event_id: u64,
    pub admin: Option<Principal>,
    pub cached_bsv_price: f64,
    pub last_price_update: u64,
    pub cached_eth_usd_price: f64,
    pub last_eth_price_update: u64,
    pub total_available_orderbook_usd: f64,
    pub treasury_address_arbitrum: Option<String>,
    pub treasury_address_optimism: Option<String>,
    pub new_orders_enabled: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            next_order_id: 0,
            next_chunk_id: 0,
            next_trade_id: 0,
            next_refund_id: 0,
            next_admin_event_id: 0,
            admin: None,
            cached_bsv_price: 0.0,
            last_price_update: 0,
            cached_eth_usd_price: 0.0,
            last_eth_price_update: 0,
            total_available_orderbook_usd: 0.0,
            treasury_address_arbitrum: None,
            treasury_address_optimism: None,
            new_orders_enabled: true, // Default: accept new orders
        }
    }
}

// Implement Storable for AppState
impl Storable for AppState {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(Encode!(self).unwrap())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).unwrap()
    }

    const BOUND: Bound = Bound::Unbounded;
}

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = 
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    
    // Stable storage maps
    pub static ORDERS: RefCell<StableBTreeMap<OrderId, Order, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))),
        )
    );
    
    pub static CHUNKS: RefCell<StableBTreeMap<ChunkId, Chunk, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))),
        )
    );
    
    pub static TRADES: RefCell<StableBTreeMap<TradeId, Trade, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(2))),
        )
    );
    
    pub static FILLER_ACCOUNTS: RefCell<StableBTreeMap<Principal, FillerAccount, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(3))),
        )
    );
    
    // Track used BSV transaction IDs to prevent reuse across different trades
    pub static USED_BSV_TXIDS: RefCell<StableBTreeMap<TxidKey, TradeIdValue, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(5))),
        )
    );
    
    // Admin event log for penalties and treasury reclaims
    pub static ADMIN_EVENTS: RefCell<StableBTreeMap<u64, AdminEvent, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(6))),
        )
    );
    
    // Stable app state - persists across upgrades!
    pub static APP_STATE: RefCell<StableCell<AppState, Memory>> = RefCell::new(
        StableCell::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(4))),
            AppState::default()
        ).expect("Failed to initialize stable app state")
    );
}

// ===== STATE GETTERS AND SETTERS =====

pub fn get_caller() -> Principal {
    ic_cdk::caller()
}

pub fn get_time() -> u64 {
    ic_cdk::api::time()
}

pub fn is_admin(principal: Principal) -> bool {
    APP_STATE.with(|cell| {
        let state = cell.borrow().get().clone();
        state.admin.map_or(false, |admin| admin == principal)
    })
}

pub fn get_admin() -> Principal {
    Principal::from_text(crate::config::ADMIN_PRINCIPAL)
        .expect("Invalid ADMIN_PRINCIPAL in config.rs - check the principal format")
}

pub fn get_treasury_principal() -> Principal {
    // Treasury is the canister itself
    ic_cdk::api::id()
}

pub fn set_admin(principal_str: String) -> Result<(), String> {
    let caller = get_caller();
    
    // Only allow setting admin if no admin exists or caller is current admin
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        if state.admin.is_some() && !is_admin(caller) {
            return Err("Unauthorized: only admin can set admin".to_string());
        }
        
        let new_admin = Principal::from_text(principal_str)
            .map_err(|e| format!("Invalid principal: {}", e))?;
        
        state.admin = Some(new_admin);
        cell.borrow_mut().set(state).expect("Failed to set admin");
        Ok(())
    })
}

// ===== ORDERBOOK BALANCE TRACKING =====

/// Get available orderbook balance by summing all Available chunks
/// This is always accurate as it's calculated from the source of truth
pub fn get_available_orderbook() -> f64 {
    let available_chunks = get_available_chunks();
    available_chunks.iter()
        .map(|c| c.amount_usd)
        .sum()
}

// ===== TREASURY FUNCTIONS =====

pub fn get_treasury_addresses() -> (Option<String>, Option<String>) {
    APP_STATE.with(|cell| {
        let state = cell.borrow().get().clone();
        (state.treasury_address_arbitrum.clone(), state.treasury_address_optimism.clone())
    })
}

// ===== ORDER MANAGEMENT =====

// ===== ORDER FUNCTIONS =====

pub fn create_order_id() -> OrderId {
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        let id = state.next_order_id;
        state.next_order_id += 1;
        cell.borrow_mut().set(state).expect("Failed to increment order ID");
        id
    })
}

pub fn insert_order(order: Order) {
    ORDERS.with(|orders| {
        orders.borrow_mut().insert(order.id, order);
    });
}

pub fn get_order(order_id: OrderId) -> Option<Order> {
    ORDERS.with(|orders| {
        orders.borrow().get(&order_id)
    })
}

pub fn update_order<F>(order_id: OrderId, updater: F) -> Result<(), String>
where
    F: FnOnce(&mut Order),
{
    ORDERS.with(|orders| {
        let mut orders = orders.borrow_mut();
        let mut order = orders.get(&order_id)
            .ok_or_else(|| "Order not found".to_string())?;
        updater(&mut order);
        orders.insert(order_id, order);
        Ok(())
    })
}

pub fn get_orders_by_maker(maker: Principal) -> Vec<Order> {
    ORDERS.with(|orders| {
        let mut results: Vec<Order> = orders.borrow().iter()
            .filter(|(_, order)| order.maker == maker)
            .map(|(_, order)| order)
            .collect();
        // Sort by created_at descending (newest first)
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    })
}

pub fn get_orders_by_maker_and_status(maker: Principal, status: OrderStatus) -> Vec<Order> {
    ORDERS.with(|orders| {
        let mut results: Vec<Order> = orders.borrow().iter()
            .filter(|(_, order)| order.maker == maker && order.status == status)
            .map(|(_, order)| order)
            .collect();
        // Sort by created_at descending (newest first)
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    })
}

pub fn get_all_orders() -> Vec<Order> {
    ORDERS.with(|orders| {
        orders.borrow().iter()
            .map(|(_, order)| order)
            .collect()
    })
}

/// Get active/partially-filled orders sorted by created_at (FIFO) - optimized for matching algorithms
pub fn get_active_orders_fifo() -> Vec<Order> {
    ORDERS.with(|orders| {
        let mut results: Vec<Order> = orders.borrow().iter()
            .filter(|(_, order)| {
                matches!(order.status, OrderStatus::Active | OrderStatus::PartiallyFilled)
            })
            .map(|(_, order)| order)
            .collect();
        
        // Sort by created_at ascending (oldest first for FIFO)
        results.sort_by_key(|o| o.created_at);
        results
    })
}

/// Get orders by status - optimized to filter at storage level
pub fn get_orders_by_status(status: OrderStatus) -> Vec<Order> {
    ORDERS.with(|orders| {
        orders.borrow().iter()
            .filter(|(_, order)| order.status == status)
            .map(|(_, order)| order)
            .collect()
    })
}

// ===== CHUNK FUNCTIONS =====

pub fn create_chunk_id() -> ChunkId {
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        let id = state.next_chunk_id;
        state.next_chunk_id += 1;
        cell.borrow_mut().set(state).expect("Failed to increment chunk ID");
        id
    })
}

pub fn insert_chunk(chunk: Chunk) {
    CHUNKS.with(|chunks| {
        chunks.borrow_mut().insert(chunk.id, chunk);
    });
}

pub fn get_chunk(chunk_id: ChunkId) -> Option<Chunk> {
    CHUNKS.with(|chunks| {
        chunks.borrow().get(&chunk_id)
    })
}

pub fn update_chunk<F>(chunk_id: ChunkId, updater: F) -> Result<(), String>
where
    F: FnOnce(&mut Chunk),
{
    CHUNKS.with(|chunks| {
        let mut chunks = chunks.borrow_mut();
        let mut chunk = chunks.get(&chunk_id)
            .ok_or_else(|| "Chunk not found".to_string())?;
        updater(&mut chunk);
        chunks.insert(chunk_id, chunk);
        Ok(())
    })
}

pub fn get_available_chunks() -> Vec<Chunk> {
    CHUNKS.with(|chunks| {
        chunks.borrow().iter()
            .filter(|(_, chunk)| chunk.status == ChunkStatus::Available)
            .map(|(_, chunk)| chunk)
            .collect()
    })
}

pub fn get_chunks_by_order(order_id: OrderId) -> Vec<Chunk> {
    CHUNKS.with(|chunks| {
        chunks.borrow().iter()
            .filter(|(_, chunk)| chunk.order_id == order_id)
            .map(|(_, chunk)| chunk)
            .collect()
    })
}

// ===== TRADE FUNCTIONS =====

pub fn create_trade_id() -> TradeId {
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        let id = state.next_trade_id;
        state.next_trade_id += 1;
        cell.borrow_mut().set(state).expect("Failed to increment trade ID");
        id
    })
}

pub fn insert_trade(trade: Trade) {
    TRADES.with(|trades| {
        trades.borrow_mut().insert(trade.id, trade);
    });
}

pub fn get_trade(trade_id: TradeId) -> Option<Trade> {
    TRADES.with(|trades| {
        trades.borrow().get(&trade_id)
    })
}

pub fn update_trade<F>(trade_id: TradeId, updater: F) -> Result<(), String>
where
    F: FnOnce(&mut Trade),
{
    TRADES.with(|trades| {
        let mut trades = trades.borrow_mut();
        let mut trade = trades.get(&trade_id)
            .ok_or_else(|| "Trade not found".to_string())?;
        updater(&mut trade);
        trades.insert(trade_id, trade);
        Ok(())
    })
}

pub fn get_trades_by_filler(filler: Principal) -> Vec<Trade> {
    TRADES.with(|trades| {
        let mut results: Vec<Trade> = trades.borrow().iter()
            .filter(|(_, trade)| trade.filler == filler)
            .map(|(_, trade)| trade)
            .collect();
        // Sort by created_at descending (newest first)
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    })
}

pub fn get_trades_by_status(status: TradeStatus) -> Vec<Trade> {
    TRADES.with(|trades| {
        trades.borrow().iter()
            .filter(|(_, trade)| trade.status == status)
            .map(|(_, trade)| trade)
            .collect()
    })
}

pub fn get_all_trades() -> Vec<Trade> {
    TRADES.with(|trades| {
        trades.borrow().iter()
            .map(|(_, trade)| trade)
            .collect()
    })
}

// ===== FILLER ACCOUNT FUNCTIONS =====

/// Calculate pending trades total from actual active trades
/// Active trades are those not in final states (WithdrawalConfirmed, Cancelled, PenaltyApplied)
pub fn calculate_pending_trades_for_filler(filler: Principal) -> f64 {
    TRADES.with(|trades| {
        let all_trades: Vec<_> = trades.borrow().iter().collect();
        ic_cdk::println!("🔍 Calculating pending trades for filler: {}", filler);
        ic_cdk::println!("   Total trades in system: {}", all_trades.len());
        
        let mut pending_total = 0.0;
        let mut count = 0;
        
        for (trade_id, trade) in all_trades {
            if trade.filler == filler {
                let is_pending = matches!(trade.status, 
                    TradeStatus::ChunksLocked | 
                    TradeStatus::TxSubmitted | 
                    TradeStatus::ReadyForRelease
                );
                
                ic_cdk::println!("   Trade {}: status={:?}, amount=${:.2}, pending={}", 
                    trade_id, trade.status, trade.amount_usd, is_pending);
                
                if is_pending {
                    pending_total += trade.amount_usd;
                    count += 1;
                }
            }
        }
        
        ic_cdk::println!("   ✅ Result: {} pending trades, total ${:.2}", count, pending_total);
        pending_total
    })
}

pub fn insert_filler_account(account: FillerAccount) {
    FILLER_ACCOUNTS.with(|accounts| {
        accounts.borrow_mut().insert(account.id, account);
    });
}

pub fn get_filler_account(principal: Principal) -> Option<FillerAccount> {
    FILLER_ACCOUNTS.with(|accounts| {
        accounts.borrow().get(&principal).map(|mut account| {
            // Recalculate pending_trades_total from actual active trades
            account.pending_trades_total = calculate_pending_trades_for_filler(principal);
            account
        })
    })
}

pub fn update_filler_account<F>(principal: Principal, updater: F) -> Result<(), String>
where
    F: FnOnce(&mut FillerAccount),
{
    FILLER_ACCOUNTS.with(|accounts| {
        let mut accounts = accounts.borrow_mut();
        let mut account = accounts.get(&principal)
            .ok_or_else(|| "Filler account not found".to_string())?;
        updater(&mut account);
        accounts.insert(principal, account);
        Ok(())
    })
}

// ===== BSV PRICE CACHING =====

pub fn get_cached_bsv_price() -> (f64, u64) {
    APP_STATE.with(|cell| {
        let state = cell.borrow().get().clone();
        (state.cached_bsv_price, state.last_price_update)
    })
}

pub fn update_cached_bsv_price(price: f64) {
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        state.cached_bsv_price = price;
        state.last_price_update = get_time();
        cell.borrow_mut().set(state).expect("Failed to update cached price");
    })
}

// ===== ETH/USD PRICE CACHING =====

pub fn get_cached_eth_usd_price() -> (f64, u64) {
    APP_STATE.with(|cell| {
        let state = cell.borrow().get().clone();
        (state.cached_eth_usd_price, state.last_eth_price_update)
    })
}

pub fn update_cached_eth_usd_price(price: f64) {
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        state.cached_eth_usd_price = price;
        state.last_eth_price_update = get_time();
        cell.borrow_mut().set(state).expect("Failed to update cached ETH price");
    })
}


// ===== PLATFORM FEES - REMOVED =====
// Fees are now collected upfront during order activation (2.9% to treasury)
// No need for accumulated fee tracking or manual withdrawal

pub fn create_refund_id() -> u64 {
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        let id = state.next_refund_id;
        state.next_refund_id += 1;
        cell.borrow_mut().set(state).expect("Failed to increment refund ID");
        id
    })
}

// ===== BSV TRANSACTION DEDUPLICATION =====

/// Compute BSV transaction ID (txid) from raw transaction hex
/// Txid = reverse(SHA256(SHA256(raw_tx_bytes)))
pub fn compute_bsv_txid(raw_tx_hex: &str) -> Result<String, String> {
    use sha2::{Sha256, Digest};
    
    // Decode hex to bytes
    let tx_bytes = hex::decode(raw_tx_hex)
        .map_err(|e| format!("Invalid hex in transaction: {}", e))?;
    
    // Double SHA256
    let hash1 = Sha256::digest(&tx_bytes);
    let hash2 = Sha256::digest(&hash1);
    
    // Reverse bytes and convert to hex string
    let mut txid_bytes: Vec<u8> = hash2.to_vec();
    txid_bytes.reverse();
    
    Ok(hex::encode(txid_bytes))
}

/// Check if a BSV transaction has already been used in any trade
pub fn is_bsv_tx_used(txid: &str) -> bool {
    USED_BSV_TXIDS.with(|map| {
        map.borrow().get(&TxidKey(txid.to_string())).is_some()
    })
}

/// Get which trade ID used a specific transaction
pub fn get_trade_using_tx(txid: &str) -> Option<TradeId> {
    USED_BSV_TXIDS.with(|map| {
        map.borrow().get(&TxidKey(txid.to_string())).map(|v| v.0)
    })
}

/// Mark a transaction as used by a specific trade
pub fn mark_bsv_tx_used(txid: String, trade_id: TradeId) {
    USED_BSV_TXIDS.with(|map| {
        map.borrow_mut().insert(TxidKey(txid), TradeIdValue(trade_id));
    });
}

/// Unmark a transaction (for resubmissions within same trade)
pub fn unmark_bsv_tx(txid: &str) {
    USED_BSV_TXIDS.with(|map| {
        map.borrow_mut().remove(&TxidKey(txid.to_string()));
    });
}

// ===== ADMIN EVENT LOG =====

/// Create a new admin event and return its ID
pub fn create_admin_event(event_type: AdminEventType) -> u64 {
    APP_STATE.with(|state| {
        let mut app_state = state.borrow().get().clone();
        let event_id = app_state.next_admin_event_id;
        app_state.next_admin_event_id += 1;
        state.borrow_mut().set(app_state).expect("Failed to update app state");
        
        let event = AdminEvent {
            id: event_id,
            timestamp: get_time(),
            event_type,
        };
        
        ADMIN_EVENTS.with(|events| {
            let mut events_map = events.borrow_mut();
            events_map.insert(event_id, event);
            
            // Keep only the 10000 most recent events
            const MAX_ADMIN_EVENTS: u64 = 10000;
            if events_map.len() > MAX_ADMIN_EVENTS {
                // Get all event IDs sorted by timestamp (oldest first)
                let mut event_list: Vec<(u64, u64)> = events_map.iter()
                    .map(|(id, evt)| (id, evt.timestamp))
                    .collect();
                event_list.sort_by_key(|(_, ts)| *ts);
                
                // Remove oldest events until we have MAX_ADMIN_EVENTS
                let to_remove = (events_map.len() - MAX_ADMIN_EVENTS) as usize;
                for i in 0..to_remove {
                    events_map.remove(&event_list[i].0);
                }
            }
        });
        
        event_id
    })
}

/// Get all admin events (newest first)
pub fn get_admin_events() -> Vec<AdminEvent> {
    ADMIN_EVENTS.with(|events| {
        let map = events.borrow();
        let mut result: Vec<AdminEvent> = map.iter()
            .map(|(_, event)| event.clone())
            .collect();
        result.sort_by(|a, b| b.timestamp.cmp(&a.timestamp)); // Newest first
        result
    })
}

/// Get recent admin events (last N events)
pub fn get_recent_admin_events(limit: usize) -> Vec<AdminEvent> {
    let all_events = get_admin_events();
    all_events.into_iter().take(limit).collect()
}

/// Get paginated admin events (offset + limit)
pub fn get_paginated_admin_events(offset: usize, limit: usize) -> Vec<AdminEvent> {
    let all_events = get_admin_events();
    all_events.into_iter()
        .skip(offset)
        .take(limit)
        .collect()
}

/// Get total count of admin events
pub fn get_admin_events_count() -> u64 {
    ADMIN_EVENTS.with(|events| {
        events.borrow().len()
    })
}

// ===== EMERGENCY CONTROLS =====

/// Check if new orders are currently enabled
pub fn are_new_orders_enabled() -> bool {
    APP_STATE.with(|cell| {
        cell.borrow().get().new_orders_enabled
    })
}

/// Set whether new orders are enabled (admin only)
pub fn set_new_orders_enabled(enabled: bool) {
    APP_STATE.with(|cell| {
        let mut state = cell.borrow().get().clone();
        state.new_orders_enabled = enabled;
        cell.borrow_mut().set(state).expect("Failed to update new_orders_enabled");
    });
}

