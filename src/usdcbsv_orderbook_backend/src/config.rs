// Configuration constants for the orderbook system

// ============== ADMIN CONFIGURATION ==============
// Admin principal - copy from Profile page (Delegated Identity Principal)
// TO CHANGE: Replace with your principal, rebuild and redeploy
pub const ADMIN_PRINCIPAL: &str = "dow63-puub5-ne7wq-knc6a-i3tqs-ur75n-ozxkz-ad22e-frcrk-vq5jo-jae";

// ============== CHUNK SIZE CONFIGURATION ==============
// Minimum chunk size in USD (floating point)
pub const MIN_CHUNK_SIZE: f64 = 3.0;

// Maximum number of chunks allowed per order
pub const MAX_CHUNKS_ALLOWED: usize = 30; // 30 chunks

// ============== ORDERBOOK LIMITS ==============
// Maximum total value of available orders in the orderbook (USD)
// This prevents the orderbook from growing too large
// When limit is reached, new orders are rejected until:
//   - Fillers clear existing orders (chunks filled)
//   - Prices move and orders go idle (delisted)
//   - Makers cancel orders
//
pub const MAX_ORDERBOOK_USD_LIMIT: f64 = 2000.0; // $2,000

// ============== BLOCK SYNC CONFIGURATION ==============
// Number of block confirmations required before claiming USDC
// Higher values = more security but longer wait time
// BSV typically mines ~1 block per 10 minutes
// 18 blocks = ~3 hours of confirmations
// 
// TO CHANGE: Adjust based on your security requirements
pub const CONFIRMATION_DEPTH: u64 = 18; // Blocks required for safe confirmation (default: 18 = ~3 hours)

// Sync interval for block headers (seconds)
pub const SYNC_INTERVAL_SECONDS: u64 = 15 * 60; // 15 minutes

// ============== MAKER LIMITS ==============
// Maximum total value of active orders per maker (USD)
// This protects users from accidentally placing too many orders
// and limits exposure in case of errors
// 
// Only counts ACTIVE order value (excluding fees):
//   - Counts: Active, Idle
//   - Does NOT count: Filled, Cancelled, Refunded, PartiallyFilled
//   - Partially filled orders count remaining unfilled amount
// 
// When limit is reached, new orders are rejected until:
//   - Existing orders are filled (chunks completed)
//   - Existing orders are cancelled/refunded
// 
pub const MAX_MAKER_TOTAL_ORDERS_USD: f64 = 270.0; 

// ============== OTHER CONSTANTS ==============
pub const SATOSHIS_PER_BSV: u64 = 100_000_000;

// Fee structure
pub const MAKER_FEE_PERCENT: u64 = 700;  // 7.0% total fee shown to maker (in basis points: 700/10000)
pub const ACTIVATION_FEE_PERCENT: u64 = 250; // 2.5% activation fee to treasury (in basis points: 250/10000)
pub const FILLER_INCENTIVE_PERCENT: u64 = 450; // 4.5% reserved for filler bonus (in basis points: 450/10000)
// Maker deposits order + 7.0% fee
// Platform takes 2.5% upfront to treasury (ACTIVATION_FEE_PERCENT) non refundable
// 4.5% stays in order address for filler bonus on filled chunks value (FILLER_INCENTIVE_PERCENT)

// Security deposit percentage (10% of trade amount)
pub const SECURITY_DEPOSIT_PERCENT: u64 = 10;

// Maximum lock multiplier - security deposit allows locking this many times the deposit amount
// With 10% security, allows locking 10x the deposit amount
pub const MAX_LOCK_MULTIPLIER: u64 = 10;

// ============== BLOCKCHAIN SYNC CONFIGURATION ==============
// Maximum reorg depth to check AND maximum number of blocks to keep
// 720 blocks = ~5 days at 10 minute average block time
// This is sufficient for:
// - Trade validation (needs CONFIRMATION_DEPTH = 18 blocks)
// - Reorg protection
// - Historical merkle proofs
// We only keep the last 288 blocks from the chain tip
// Fullfilled trades must be claimed within 24h so this window is sufficient. After this they automatically expire as unclaimed.
pub const MAX_BLOCKS_TO_KEEP: u64 = 288;

// Maximum blocks to check per reorg detection call (prevents instruction limit issues)
pub const MAX_REORG_CHECK_PER_CALL: u64 = 50;

// Trade timeout in nanoseconds (45 minutes)
pub const TRADE_TIMEOUT_NS: u64 = 45 * 60 * 1_000_000_000;

// USDC release wait time after BSV tx submission
// 3 hours = 3 * 60 * 60 * 1_000_000_000 nanoseconds 
pub const USDC_RELEASE_WAIT_NS: u64 = 3 * 60 * 60 * 1_000_000_000; 

// Transaction resubmission penalty (2% of trade amount, deducted from security deposit)
// This prevents traders from gaming the system by repeatedly resubmitting during market volatility
pub const RESUBMISSION_PENALTY_PERCENT: f64 = 2.0;

// Resubmission window: Traders can only resubmit within 2 hours of INITIAL submission
// After this window, resubmission is locked to prevent eternal claim delays
pub const RESUBMISSION_WINDOW_NS: u64 = 2 * 60 * 60 * 1_000_000_000; // 2 hours

// Trade claim expiry - if no successful claim after 24 hours, funds go to treasury
// 24 hours = 24 * 60 * 60 * 1_000_000_000 nanoseconds
pub const TRADE_CLAIM_EXPIRY_NS: u64 = 24 * 60 * 60 * 1_000_000_000; 

// ============== LEDGER CONFIGURATION ==============
// ckETH Ledger Canister ID (for paying Ethereum gas fees)
pub const CK_ETH_LEDGER: &str = "ss2fx-dyaaa-aaaar-qacoq-cai";

// ckUSDC Ledger Canister ID 
pub const CK_USDC_LEDGER: &str = "xevnm-gaaaa-aaaar-qafnq-cai";

// ckUSDC Minter Canister ID (for ERC-20 withdrawals)
pub const CK_USDC_MINTER: &str = "sv3dd-oaaaa-aaaar-qacoa-cai";

// ckUSDC transfer fee (0.01 USDC = 10,000 e6s)
pub const CKUSDC_TRANSFER_FEE: u128 = 10_000;

// ============== DATA RETENTION & CLEANUP ==============
// Automatic cleanup to prevent storage exhaustion

// Order retention period (7 days in seconds)
// Only deletes orders where ALL chunks are in final states (Filled or Refunded)
// Orders with PendingFunding status or any active/idle/locked chunks are NEVER auto-deleted
pub const ORDER_RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60; // 7 days

// Trade retention period (7 days in seconds)
// Only applies to trades in final states: WithdrawalConfirmed, Cancelled, PenaltyApplied
// Very important that this be LONGER than MAX_BLOCKS_TO_KEEP in relative time and LONGER than TRADE_CLAIM_EXPIRY_NS, to ensure transactions submitted in trades can properly confirm and claimed BUT ALSO avoid scam traders reusing older transaction in new trade. Any txid already in our Trade DB is rejected as duplicate. We must keep trades long enough to cover block retention period.
pub const TRADE_RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60; // 7 days

// Admin events retention period (7 days in seconds)
// Old admin events are automatically cleaned up to prevent storage bloat
pub const ADMIN_EVENTS_RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60; // 7 days

// Cleanup interval (1 hour in seconds)
pub const CLEANUP_INTERVAL_SECONDS: u64 = 1 * 60 * 60; // Run hourly

// ============== CYCLES MANAGEMENT ==============
// Minimum cycles balance required to accept new orders
// If canister balance drops below this, new order creation is rejected
// This prevents canister from running out of cycles and becoming unresponsive
pub const MIN_CYCLES_FOR_NEW_ORDERS: u128 = 500_000_000_000; // 500 Billion Cycles

