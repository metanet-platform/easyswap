// Configuration constants for the frontend

// ============== CHUNK SIZE CONFIGURATION ==============
// Minimum chunk size in USD dollars
// IMPORTANT: This must match the backend MIN_CHUNK_SIZE_CENTS configuration
// 
// After changing, rebuild and redeploy the frontend
export const MIN_CHUNK_SIZE_USD = 3; // $3

// Maximum number of chunks allowed per order
// IMPORTANT: This must match the backend MAX_CHUNKS_ALLOWED configuration
export const MAX_CHUNKS_ALLOWED = 30; // 30 chunks

// Helper to get chunk size in cents
export const MIN_CHUNK_SIZE_CENTS = MIN_CHUNK_SIZE_USD * 100;

// Maximum order size in USD (excluding fees)
export const MAX_ORDER_SIZE_USD = MAX_CHUNKS_ALLOWED * MIN_CHUNK_SIZE_USD;

// ============== ORDERBOOK LIMITS ==============
// Maximum total value of available orders in the orderbook (USD)
// This prevents the orderbook from growing too large
// When limit is reached, new orders stay idle until:
//   - Fillers clear existing orders (chunks filled)
//   - Prices move and orders go idle (delisted)
//   - Makers cancel orders
// IMPORTANT: This must match the backend MAX_ORDERBOOK_USD_LIMIT configuration
export const MAX_ORDERBOOK_USD_LIMIT = 2000; // $2,000

// ============== MAKER LIMITS ==============
// Maximum total value of active orders per maker (USD)
// This protects users from accidentally placing too many orders
// Only counts active order value (excluding fees)
// IMPORTANT: This must match the backend MAX_MAKER_TOTAL_ORDERS_USD configuration
export const MAX_MAKER_TOTAL_ORDERS_USD = 270; // $270

// ============== FEE CONFIGURATION ==============
// These percentages must match the backend config in src/config.rs
// All fees are in percentage (e.g., 3.9 = 3.9%)

// Total fee charged upfront to maker (activation fee + filler incentive)
// This is what the maker pays on top of the order amount
export const MAKER_FEE_PERCENT = 7.0;

// Activation fee: Transferred to treasury immediately (non-refundable)
// Provides liquidity and operational funding
export const ACTIVATION_FEE_PERCENT = 2.5;

// Filler incentive: Reserved with order for taker distribution (refundable if order cancelled)
// Incentivizes takers to fulfill orders quickly
export const FILLER_INCENTIVE_PERCENT = 4.5;

// ckUSDC transfer fee: Network fee for ckUSDC transfers on ICP
// This is charged by the ckUSDC ledger for each transfer
export const CKUSDC_TRANSFER_FEE_USD = 0.01; // $0.01 (10,000 e6s)

// ============== BSV PRICE CONFIGURATION ==============
// Price buffer percentage added to current BSV price when creating orders
// e.g., 2 = adds 2% buffer above current price
// This protects makers from price fluctuations during order fulfillment
export const BSV_PRICE_BUFFER_PERCENT = 5;

// ============== TIMING CONFIGURATION ==============
// These values must match the backend config.rs

// Trade timeout: How long a filler has to complete BSV payment to maker
// Maker receives BSV directly from filler during this window (no waiting)
export const TRADE_TIMEOUT_MINUTES = 45; // 45 minutes

// USDC release wait: How long filler must wait before claiming USDC
// This gives makers time to dispute if payment wasn't received
export const USDC_RELEASE_WAIT_HOURS = 3; // 3 hours after BSV payment submission

// Trade claim expiry: Maximum time allowed to claim USDC after BSV payment is confirmed
// If not claimed within this period, funds go to treasury
export const TRADE_CLAIM_EXPIRY_HOURS = 24; // 24 hours

// Confirmation depth: Number of BSV blocks required for filler to claim USDC
// Ensures the BSV payment to maker is deeply confirmed before releasing USDC to filler
export const CONFIRMATION_DEPTH = 18; // ~3 hours of confirmations (filler waits, not maker)

// ============== SECURITY CONFIGURATION ==============
// Security deposit percentage required from filler
// Held as collateral during trade fulfillment
export const SECURITY_DEPOSIT_PERCENT = 10; // 10% of trade value

// Resubmission penalty percentage (charged when filler edits BSV transaction)
// This prevents gaming the system during market volatility
// Penalty is paid to the maker as compensation
export const RESUBMISSION_PENALTY_PERCENT = 2.0; // 2% of trade value

// Resubmission window: Time limit for filler to resubmit BSV transaction
// After this window from initial submission, resubmission is locked
export const RESUBMISSION_WINDOW_HOURS = 2; // 2 hours from initial submission

// ============== LEDGER CONFIGURATION ==============
// ckETH Ledger Canister ID on Internet Computer (for gas fees)
export const CK_ETH_LEDGER = "ss2fx-dyaaa-aaaar-qacoq-cai";

// ckUSDC Ledger Canister ID on Internet Computer
export const CK_USDC_LEDGER = "xevnm-gaaaa-aaaar-qafnq-cai";

// ckUSDC Minter Canister ID (for ERC-20 withdrawals)
export const CK_USDC_MINTER = "sv3dd-oaaaa-aaaar-qacoa-cai";

// ============== ETHEREUM CONFIGURATION ==============
// Helper contract for bridging ERC-20 USDC to ckUSDC
export const HELPER_CONTRACT_ADDRESS = "0x6abDA0438307733FC299e9C229FD3cc074bD8cC0";

// USDC ERC-20 contract address on Ethereum mainnet
export const USDC_CONTRACT_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// ============== ADMIN CONFIGURATION ==============
export const ADMIN_PRINCIPAL = "dow63-puub5-ne7wq-knc6a-i3tqs-ur75n-ozxkz-ad22e-frcrk-vq5jo-jae";

// ============== DATA RETENTION & CLEANUP ==============
// These values must match the backend config.rs

// Order retention period (7 days)
// Only deletes orders where ALL chunks are in final states (Filled or Refunded)
export const ORDER_RETENTION_DAYS = 7;

// Trade retention period (7 days)
// Only applies to trades in final states: WithdrawalConfirmed, Cancelled, PenaltyApplied
export const TRADE_RETENTION_DAYS = 7;


// Admin events retention period (7 days)
// Old admin events are automatically cleaned up to prevent storage bloat
export const ADMIN_EVENTS_RETENTION_DAYS = 7;

// Cleanup interval (1 hour)
export const CLEANUP_INTERVAL_HOURS = 1;

// ============== OPEN SOURCE & TRANSPARENCY ==============
// GitHub repository URL for source code review
export const GIT_OPEN_SOURCE_URL = "https://github.com/metanet-platform/easyswap";
