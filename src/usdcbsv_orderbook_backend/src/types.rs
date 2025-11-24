use candid::{CandidType, Deserialize, Principal, Encode, Decode};
use serde::Serialize;
use ic_stable_structures::{Storable, storable::Bound};
use std::borrow::Cow;

pub type OrderId = u64;
pub type ChunkId = u64;
pub type TradeId = u64;
pub type FillerAccountId = Principal;

// ===== ORDER TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum OrderStatus {
    // Lifecycle states (order actively being processed)
    Active,             // Order fully funded and chunks available for filling
    Idle,               // Max price exceeded - chunks delisted from orderbook
    
    // Final states (set only once order lifecycle ends, based on chunk statuses):
    PartiallyFilled,    // Some chunks Filled, some Refunded
    Filled,             // All chunks Filled
    Cancelled,          // Order cancelled before completion
    Refunded,           // Deposit refunded, all chunks Refunded
}

// ===== REFUND TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum RefundStatus {
    Pending,      // Request created, tx not sent yet
    Sent,         // Transaction sent, awaiting confirmation
    Confirmed,    // Confirmed on chain
    Failed,       // Failed/dropped, needs admin review
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct RefundAttempt {
    pub refund_id: u64,
    pub requested_at: u64,
    pub chunk_ids: Vec<ChunkId>,
    pub total_amount: f64,
    pub recipient_address: String,
    pub tx_hash: Option<String>,
    pub tx_sent_at: Option<u64>,
    pub confirmed_at: Option<u64>,
    pub status: RefundStatus,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct Order {
    pub id: OrderId,
    pub maker: Principal,
    pub amount_usd: f64,
    pub total_deposited_usd: Option<f64>,
    pub activation_fee_usd: Option<f64>,
    pub filler_incentive_reserved: Option<f64>,
    pub deposit_principal: String,
    pub deposit_subaccount: String,
    pub max_bsv_price: f64,
    pub allow_partial_fill: bool,
    pub bsv_address: String,
    pub status: OrderStatus,
    pub chunks: Vec<ChunkId>,
    pub created_at: u64,
    pub deposit_confirmed_at: Option<u64>,
    pub funded_at: Option<u64>,
    pub activation_fee_block_index: Option<u64>,
    pub activation_fee_confirmed_at: Option<u64>,
    pub total_filled_usd: f64,
    pub total_locked_usd: f64,
    pub total_idle_usd: f64,
    pub total_refunded_usd: Option<f64>,
    pub refund_attempts: Vec<RefundAttempt>,
}

// ===== CHUNK TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum ChunkStatus {
    Available,     // In orderbook, ready to fill
    Locked,        // Locked in a trade
    Filled,        // Successfully filled
    Idle,          // Delisted due to price breaking upward
    Refunding,     // Refund transaction sent, awaiting confirmation
    Refunded,      // Refunded to maker (confirmed)
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct Chunk {
    pub id: ChunkId,
    pub order_id: OrderId,
    pub amount_usd: f64,
    pub status: ChunkStatus,
    pub locked_by: Option<TradeId>,
    pub filled_at: Option<u64>,
    pub bsv_address: String,
    pub sats_amount: Option<u64>,  // Not set at creation, only for reference/legacy
    pub max_bsv_price: f64,  // Inherited from order - chunks go idle if BSV price exceeds this
}

// ChunkInfo removed - no longer needed with ckUSDC-only approach

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct ChunkDetails {
    pub id: ChunkId,
    pub order_id: OrderId,
    pub amount_usd: f64,
    pub status: ChunkStatus,
    pub locked_by: Option<TradeId>,
    pub filled_at: Option<u64>,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct OrderbookChunk {
    pub order_id: OrderId,
    pub amount_usd: f64,  // The actual USD amount of this specific chunk
    pub max_price_per_bsv_in_cents: u64,
}

// ===== TRADE TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum TradeStatus {
    ChunksLocked,           // Chunks locked, waiting for BSV tx
    TxSubmitted,            // BSV tx submitted, waiting for release timer
    ReadyForRelease,        // Wait period passed, can claim USDC
    WithdrawalConfirmed,    // ckUSDC transferred (instant on ICP)
    Cancelled,              // Cancelled (timeout or admin)
    PenaltyApplied,         // Penalty deducted
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct LockedChunk {
    pub chunk_id: ChunkId,
    pub order_id: OrderId,
    pub amount_usd: f64,
    pub bsv_address: String,
    pub sats_amount: u64,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct Trade {
    pub id: TradeId,
    pub order_id: OrderId,              // Which order this trade is from
    pub filler: Principal,
    pub amount_usd: f64,
    pub locked_chunks: Vec<LockedChunk>,
    pub agreed_bsv_price: f64,          // BSV price at trade creation
    pub min_bsv_price: f64,             // Minimum acceptable BSV price (filler protection)
    pub status: TradeStatus,
    pub bsv_tx_hex: Option<String>,
    pub created_at: u64,
    pub tx_submitted_at: Option<u64>,
    pub lock_expires_at: u64,           // 30 minutes from creation
    pub release_available_at: Option<u64>, // Configured wait time from tx submission
    pub claim_expires_at: Option<u64>,  // 24 hours from tx submission - funds go to treasury if not claimed
    
    // Withdrawal tracking (ckUSDC transfers to filler's principal)
    pub withdrawal_initiated_at: Option<u64>,
    pub withdrawal_tx_hash: Option<String>,
    pub withdrawal_confirmed_at: Option<u64>,
}

// ===== FILLER ACCOUNT TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct FillerAccount {
    pub id: FillerAccountId,
    pub pending_trades_total: f64,  // Total USD in pending trades
    pub total_trades: u64,
    pub successful_trades: u64,
    pub penalties_paid: f64,
    pub created_at: u64,
}

// ===== STATS TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct OrderbookStats {
    pub total_active_chunks: u64,
    pub total_available_usd: f64,
    pub total_locked_usd: f64,
    pub total_orders: u64,
    pub total_trades: u64,
    pub current_bsv_price: f64,
}

// ===== BSV TRANSACTION TYPES =====

#[derive(Debug, Clone)]
pub struct BsvOutput {
    pub address: String,
    pub satoshis: u64,
}

#[derive(Debug)]
pub struct ParsedBsvTx {
    pub version: u32,
    pub inputs: Vec<BsvInput>,
    pub outputs: Vec<BsvOutput>,
    pub locktime: u32,
}

#[derive(Debug, Clone)]
pub struct BsvInput {
    pub prev_tx_hash: Vec<u8>,
    pub prev_output_index: u32,
    pub script_sig: Vec<u8>,
    pub sequence: u32,
}

// ===== STORABLE IMPLEMENTATIONS =====

impl Storable for Order {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(Encode!(self).unwrap())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).unwrap()
    }

    const BOUND: Bound = Bound::Unbounded;
}

impl Storable for Chunk {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(Encode!(self).unwrap())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).unwrap()
    }

    const BOUND: Bound = Bound::Unbounded;
}

impl Storable for Trade {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(Encode!(self).unwrap())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).unwrap()
    }

    const BOUND: Bound = Bound::Unbounded;
}

impl Storable for FillerAccount {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(Encode!(self).unwrap())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).unwrap()
    }

    const BOUND: Bound = Bound::Unbounded;
}

// ===== PAGINATION TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct PaginatedOrders {
    pub orders: Vec<Order>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct PaginatedTrades {
    pub trades: Vec<Trade>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct PaginatedChunks {
    pub chunks: Vec<OrderbookChunk>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}

// ===== WRAPPER TYPES FOR STABLE STORAGE =====

/// Wrapper for String to use as key in StableBTreeMap (for BSV txids)
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TxidKey(pub String);

impl Storable for TxidKey {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.as_bytes().to_vec())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        TxidKey(String::from_utf8(bytes.to_vec()).expect("Invalid UTF-8 in stored txid"))
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: 64, // BSV txid is 64 hex chars
        is_fixed_size: true,
    };
}

/// Wrapper for u64 to use as value in StableBTreeMap (for TradeId values)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeIdValue(pub u64);

impl Storable for TradeIdValue {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.to_le_bytes().to_vec())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut arr = [0u8; 8];
        arr.copy_from_slice(&bytes[..8]);
        TradeIdValue(u64::from_le_bytes(arr))
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: 8,
        is_fixed_size: true,
    };
}

// ===== ADMIN EVENT LOG =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub enum AdminEventType {
    PenaltyApplied {
        trade_id: TradeId,
        order_id: Option<OrderId>,
        filler: Principal,
        order_maker: Option<Principal>,
        penalty_amount: f64,
        bsv_tx_hex: Option<String>,
        reason: String,
    },
    TradeExpiredToTreasury {
        trade_id: TradeId,
        filler: Principal,
        order_id: OrderId,
        amount_sent: f64,
        block_index: u64,
    },
    BlockInsertionError {
        block_height: u64,
        error_message: String,
    },
    HeartbeatExecution {
        operation: String,
        cycles_consumed: u128,
        timestamp: u64,
    },
    NewOrdersEnabled,
    NewOrdersDisabled,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct AdminEvent {
    pub id: u64,
    pub timestamp: u64,
    pub event_type: AdminEventType,
}

impl Storable for AdminEvent {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(Encode!(self).expect("Failed to encode AdminEvent"))
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).expect("Failed to decode AdminEvent")
    }

    const BOUND: Bound = Bound::Unbounded;
}

// ===== AUDIT TYPES =====

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct ChunkAuditInfo {
    pub chunk_id: ChunkId,
    pub amount_usd: f64,
    pub status: ChunkStatus,
    pub locked_by_trade: Option<TradeId>,
    pub filled_at: Option<u64>,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct OrderAuditRecord {
    pub order_id: OrderId,
    pub maker: Principal,
    pub amount_usd: f64,
    pub total_deposited_usd: Option<f64>,
    pub activation_fee_usd: Option<f64>,
    pub deposit_principal: String,
    pub deposit_subaccount: String,
    pub max_bsv_price: f64,
    pub allow_partial_fill: bool,
    pub bsv_address: String,
    pub status: OrderStatus,
    pub chunks: Vec<ChunkAuditInfo>,
    pub created_at: u64,
    pub deposit_confirmed_at: Option<u64>,
    pub funded_at: Option<u64>,
    pub activation_fee_confirmed_at: Option<u64>,
    pub total_filled_usd: f64,
    pub total_locked_usd: f64,
    pub total_idle_usd: f64,
    pub total_refunded_usd: Option<f64>,
    pub refund_count: u64,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct TradeAuditRecord {
    pub trade_id: TradeId,
    pub order_id: OrderId,
    pub maker: Principal,
    pub filler: Principal,
    pub amount_usd: f64,
    pub chunks_count: usize,
    pub agreed_bsv_price: f64,
    pub min_bsv_price: f64,
    pub status: TradeStatus,
    pub bsv_tx_hex: Option<String>,
    pub maker_bsv_address: String,
    pub created_at: u64,
    pub tx_submitted_at: Option<u64>,
    pub lock_expires_at: u64,
    pub release_available_at: Option<u64>,
    pub claim_expires_at: Option<u64>,
    pub withdrawal_initiated_at: Option<u64>,
    pub withdrawal_tx_hash: Option<String>,
    pub withdrawal_confirmed_at: Option<u64>,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct AuditQueryParams {
    pub start_time: Option<u64>,
    pub end_time: Option<u64>,
    pub page: u64,
    pub page_size: u64,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct OrderAuditResponse {
    pub records: Vec<OrderAuditRecord>,
    pub total_count: u64,
    pub page: u64,
    pub page_size: u64,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct TradeAuditResponse {
    pub records: Vec<TradeAuditRecord>,
    pub total_count: u64,
    pub page: u64,
    pub page_size: u64,
}

