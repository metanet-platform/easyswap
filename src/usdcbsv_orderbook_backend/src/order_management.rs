use crate::types::*;
use crate::state::*;
use crate::ckusdc_integration;
use crate::filler_accounts;
use crate::config::{MIN_CHUNK_SIZE, MAX_CHUNKS_ALLOWED, MAX_MAKER_TOTAL_ORDERS_USD, MAX_ORDERBOOK_USD_LIMIT, MIN_CYCLES_FOR_NEW_ORDERS, MAKER_FEE_PERCENT, ACTIVATION_FEE_PERCENT, FILLER_INCENTIVE_PERCENT};
use candid::Principal;

pub async fn create_order(
    amount_usd: f64,
    max_bsv_price: f64,
    bsv_address: String,
) -> Result<OrderId, String> {
    let caller = get_caller();
    
    // Reject anonymous principal
    if caller == candid::Principal::anonymous() {
        return Err("Anonymous principal cannot create orders. Please authenticate first.".to_string());
    }
    
    // Check if new orders are enabled (emergency control)
    if !are_new_orders_enabled() {
        return Err("New order creation is disabled due to maintenance or technical fixes. Existing orders and trades continue normally. Please try again later.".to_string());
    }
    
    // Check canister has sufficient cycles to continue operating
    let cycles_balance = ic_cdk::api::canister_balance128();
    if cycles_balance < MIN_CYCLES_FOR_NEW_ORDERS {
        return Err(format!(
            "Insufficient canister cycles. Current: {:.2} TC, Minimum required: {:.2} TC. Please try again later.",
            cycles_balance as f64 / 1_000_000_000_000.0,
            MIN_CYCLES_FOR_NEW_ORDERS as f64 / 1_000_000_000_000.0
        ));
    }
    
    // Validate amount is positive and multiple of minimum chunk size
    if amount_usd <= 0.0 {
        return Err("Amount must be greater than zero".to_string());
    }
    
    let remainder = amount_usd % MIN_CHUNK_SIZE;
    if amount_usd < MIN_CHUNK_SIZE || remainder.abs() > 0.000001 {
        return Err(format!("Amount must be a multiple of ${}", MIN_CHUNK_SIZE));
    }
    
    // Validate amount doesn't exceed maximum allowed
    let max_order_size = MIN_CHUNK_SIZE * (MAX_CHUNKS_ALLOWED as f64);
    if amount_usd > max_order_size {
        return Err(format!("Amount cannot exceed ${} (max {} chunks of ${})", max_order_size, MAX_CHUNKS_ALLOWED, MIN_CHUNK_SIZE));
    }
    
    // Validate BSV address format (mainnet)
    if !is_valid_bsv_mainnet_address(&bsv_address) {
        return Err("Invalid BSV mainnet address".to_string());
    }
    
    // Validate max price
    if max_bsv_price <= 0.0 {
        return Err("Max BSV price must be positive".to_string());
    }
    
    // Check if adding this order would exceed the orderbook limit
    let current_orderbook = get_available_orderbook();
    if current_orderbook + amount_usd > MAX_ORDERBOOK_USD_LIMIT {
        return Err(format!(
            "Orderbook limit exceeded. Current orderbook: ${:.2}, Your order: ${:.2}, Total would be: ${:.2}, Limit: ${:.2}. Please wait for existing orders to be filled.",
            current_orderbook, amount_usd, current_orderbook + amount_usd, MAX_ORDERBOOK_USD_LIMIT
        ));
    }
    
    ic_cdk::println!("✅ Orderbook limit check passed: ${:.2} + ${:.2} = ${:.2} / ${:.2}", 
        current_orderbook, amount_usd, current_orderbook + amount_usd, MAX_ORDERBOOK_USD_LIMIT);
    
    // Check maker's total active order value doesn't exceed limit
    let maker_orders = get_orders_by_maker(caller);
    let total_active_value: f64 = maker_orders.iter()
        .filter(|o| matches!(
            o.status, 
            OrderStatus::Active | OrderStatus::Idle
        ))
        .map(|o| {
            // For partially filled orders, count only remaining unfilled amount
            o.amount_usd - o.total_filled_usd
        })
        .sum();
    
    let new_total = total_active_value + amount_usd;
    
    if new_total > MAX_MAKER_TOTAL_ORDERS_USD {
        return Err(format!(
            "Maker order limit exceeded. Current active orders: ${:.2}, New order: ${:.2}, Total: ${:.2}, Limit: ${:.2}. Please wait for existing orders to be filled or cancel them.",
            total_active_value, amount_usd, new_total, MAX_MAKER_TOTAL_ORDERS_USD
        ));
    }
    
    ic_cdk::println!("✅ Maker limit check passed: ${:.2} / ${:.2}", new_total, MAX_MAKER_TOTAL_ORDERS_USD);
    
    // ALWAYS increment order ID - even if activation fails, we keep the ID sequence
    let order_id = create_order_id();
    
    // Get deposit info for ckUSDC
    let deposit_info = ckusdc_integration::get_deposit_info_for_order(caller, order_id).await?;
    
    ic_cdk::println!("========================================");
    ic_cdk::println!("🆕 CREATE_ORDER (with auto-activation)");
    ic_cdk::println!("   Order ID: {}", order_id);
    ic_cdk::println!("   Maker: {}", caller);
    ic_cdk::println!("   Amount: ${:.2}", amount_usd);
    ic_cdk::println!("   IC Principal: {}", deposit_info.principal);
    ic_cdk::println!("   Subaccount: {}", deposit_info.subaccount_hex);
    ic_cdk::println!("========================================");
    
    let now = get_time();
    
    // Calculate fees - exact percentage calculations with f64 precision
    // MAKER_FEE_PERCENT = 350 basis points = 3.5%
    // ACTIVATION_FEE_PERCENT = 150 basis points = 1.5% (sent to treasury, non-refundable)
    // FILLER_INCENTIVE_PERCENT = 200 basis points = 2.0% (stays in order balance, paid to filler on completion)
    let maker_fee_usd = amount_usd * (MAKER_FEE_PERCENT as f64 / 10000.0);  // 3.5% total
    let activation_fee_usd = amount_usd * (ACTIVATION_FEE_PERCENT as f64 / 10000.0); // 1.5% to treasury
    let filler_incentive_reserved = amount_usd * (FILLER_INCENTIVE_PERCENT as f64 / 10000.0); // 2.0% stays in balance
    let required_deposit_usd = amount_usd + maker_fee_usd; // What maker must deposit = amount + 3.5%
    
    ic_cdk::println!("💰 Fee Breakdown for ${:.6}:", amount_usd);
    ic_cdk::println!("   Activation Fee (1.5%): ${:.6}", activation_fee_usd);
    ic_cdk::println!("   Filler Incentive (2.0%): ${:.6}", filler_incentive_reserved);
    ic_cdk::println!("   Total Maker Fee (3.5%): ${:.6}", maker_fee_usd);
    ic_cdk::println!("   Total Required Deposit: ${:.6}", required_deposit_usd);
    
    // Check ckUSDC balance in order subaccount BEFORE creating the order
    let balance_e6 = ckusdc_integration::get_order_ckusdc_balance(caller, order_id).await?;
    let balance_usd = ckusdc_integration::ckusdc_e6_to_usd(balance_e6);
    
    ic_cdk::println!("💰 Current balance in order subaccount: ${:.6}", balance_usd);
    
    // If insufficient balance, try to top up from user's security deposit account
    if balance_usd < required_deposit_usd {
        let shortfall = required_deposit_usd - balance_usd;
        ic_cdk::println!("⚠️ Insufficient balance. Required: ${:.6}, Found: ${:.6}, Shortfall: ${:.6}", 
            required_deposit_usd, balance_usd, shortfall);
        
        // Check if user has available balance in their security deposit account
        match filler_accounts::get_available_security_balance(caller).await {
            Ok(available_balance) => {
                if available_balance >= shortfall {
                    ic_cdk::println!("🔄 Attempting to transfer ${:.6} from user security deposit...", shortfall);
                    
                    match transfer_from_user_account_to_order(caller, order_id, shortfall).await {
                        Ok(block_index) => {
                            ic_cdk::println!("✅ Transferred ${:.6} from user account (block: {})", shortfall, block_index);
                            
                            // Re-check balance after transfer
                            let new_balance_e6 = ckusdc_integration::get_order_ckusdc_balance(caller, order_id).await?;
                            let new_balance_usd = ckusdc_integration::ckusdc_e6_to_usd(new_balance_e6);
                            
                            if new_balance_usd < required_deposit_usd {
                                return Err(format!(
                                    "Order #{} created but not activated. Transfer succeeded but balance still insufficient: ${:.6} / ${:.6} required. Please deposit more ckUSDC to subaccount: {}",
                                    order_id, new_balance_usd, required_deposit_usd, deposit_info.subaccount_hex
                                ));
                            }
                        },
                        Err(e) => {
                            return Err(format!(
                                "Order #{} created but not activated. Insufficient balance in order subaccount (${:.6}) and transfer from user account failed: {}. Please deposit ${:.6} ckUSDC to: {}",
                                order_id, balance_usd, e, shortfall, deposit_info.subaccount_hex
                            ));
                        }
                    }
                } else {
                    return Err(format!(
                        "Order #{} created but not activated. Insufficient funds. Order subaccount: ${:.6}, Available in security deposit: ${:.6}, Required: ${:.6}. Please deposit ${:.6} more ckUSDC to: {}",
                        order_id, balance_usd, available_balance, required_deposit_usd, shortfall, deposit_info.subaccount_hex
                    ));
                }
            },
            Err(_) => {
                return Err(format!(
                    "Order #{} created but not activated. Insufficient balance: ${:.6} / ${:.6} required. Please deposit ${:.6} more ckUSDC to: {}",
                    order_id, balance_usd, required_deposit_usd, shortfall, deposit_info.subaccount_hex
                ));
            }
        }
    }
    
    // At this point, balance is sufficient - proceed with order creation and activation
    ic_cdk::println!("✅ Balance sufficient (${:.6}), creating and activating order...", balance_usd);
    
    // Transfer activation fee to treasury
    ic_cdk::println!("💸 Transferring ${:.6} activation fee to treasury", activation_fee_usd);
    let treasury_principal = ic_cdk::api::id(); // Treasury is the canister itself
    let fee_amount_e6 = ckusdc_integration::usd_to_ckusdc_e6(activation_fee_usd);
    
    let activation_block_index = ckusdc_integration::transfer_activation_fee_to_treasury(
        caller,
        order_id,
        treasury_principal,
        fee_amount_e6,
        Some(format!("Activation O{}", order_id).into_bytes()),
    ).await?;
    
    ic_cdk::println!("✅ Activation fee transferred! Block index: {}", activation_block_index);
    
    // Get current BSV price to determine if chunks should be Available or Idle
    let (current_bsv_price, _) = crate::state::get_cached_bsv_price();
    let price_exceeds_max = current_bsv_price > max_bsv_price;
    
    // Determine initial status and idle amount
    let (initial_status, initial_idle_usd, chunk_status) = if price_exceeds_max {
        ic_cdk::println!("⚠️ Current BSV price ${:.4} exceeds max ${:.4} - order starts as Idle", current_bsv_price, max_bsv_price);
        (OrderStatus::Idle, amount_usd, ChunkStatus::Idle)
    } else {
        ic_cdk::println!("✅ Current BSV price ${:.4} within limit ${:.4} - order starts as Active", current_bsv_price, max_bsv_price);
        (OrderStatus::Active, 0.0, ChunkStatus::Available)
    };
    
    // Create chunks with correct status from the start
    let chunk_amount = MIN_CHUNK_SIZE;
    let num_chunks = (amount_usd / chunk_amount).round() as u64;
    let mut chunk_ids = Vec::new();
    
    for _ in 0..num_chunks {
        let chunk_id = create_chunk_id();
        
        let chunk = Chunk {
            id: chunk_id,
            order_id,
            amount_usd: chunk_amount,
            status: chunk_status.clone(), // Use the determined status (Available or Idle)
            locked_by: None,
            filled_at: None,
            bsv_address: bsv_address.clone(),
            sats_amount: None,  // Will be set at trade creation time
            max_bsv_price,  // Inherit from order
        };
        insert_chunk(chunk);
        chunk_ids.push(chunk_id);
    }
    
    ic_cdk::println!("✅ Created {} chunks with status {:?}", num_chunks, chunk_status);
    
    let order = Order {
        id: order_id,
        maker: caller,
        amount_usd,
        total_deposited_usd: Some(balance_usd),
        activation_fee_usd: Some(activation_fee_usd),
        filler_incentive_reserved: Some(filler_incentive_reserved),
        deposit_principal: deposit_info.principal.to_string(),
        deposit_subaccount: deposit_info.subaccount_hex,
        max_bsv_price,
        allow_partial_fill: true,  // Always true - all orders allow partial filling
        bsv_address,
        status: initial_status,
        chunks: chunk_ids.clone(),
        created_at: now,
        deposit_confirmed_at: Some(now),
        funded_at: Some(now),
        activation_fee_block_index: Some(activation_block_index),
        activation_fee_confirmed_at: Some(now),
        total_filled_usd: 0.0,
        total_locked_usd: 0.0,
        total_idle_usd: initial_idle_usd,
        total_refunded_usd: None,
        refund_attempts: Vec::new(),
    };
    
    insert_order(order);
    
    ic_cdk::println!("✅ Order {} created and activated successfully!", order_id);
    
    Ok(order_id)
}

/// Helper function to transfer funds from caller's security deposit subaccount to order subaccount
/// The caller's subaccount is shared for all canister operations (maker orders + filler trades)
/// Only transfers the available balance (after accounting for locked security deposits in active trades)
async fn transfer_from_user_account_to_order(
    user: Principal,
    order_id: OrderId,
    amount_usd: f64,
) -> Result<u64, String> {
    use crate::ckusdc_integration::usd_to_ckusdc_e6;
    use candid::{Nat, Principal as CandidPrincipal};
    use icrc_ledger_types::icrc1::account::Account;
    use icrc_ledger_types::icrc1::transfer::{TransferArg, TransferError, Memo};
    
    let amount_e6 = usd_to_ckusdc_e6(amount_usd);
    
    // Get user's security deposit subaccount (same subaccount used for trading)
    let from_account = filler_accounts::get_deposit_account(user);
    
    // Get order's subaccount
    let to_account = ckusdc_integration::get_order_deposit_account(user, order_id);
    
    ic_cdk::println!("💸 Transferring ${:.6} ({} e6) from user {} account to order {}", 
        amount_usd, amount_e6, user, order_id);
    
    let transfer_args = TransferArg {
        from_subaccount: from_account.subaccount,
        to: to_account,
        fee: None, // Ledger will use default fee
        created_at_time: None,
        memo: Some(Memo::from(format!("Order {} funding", order_id).into_bytes())),
        amount: Nat::from(amount_e6),
    };
    
    let ledger_id = CandidPrincipal::from_text(crate::config::CK_USDC_LEDGER)
        .map_err(|e| format!("Invalid ledger canister ID: {:?}", e))?;
    
    let result: Result<(Result<Nat, TransferError>,), _> = 
        ic_cdk::call(ledger_id, "icrc1_transfer", (transfer_args,)).await;
    
    match result {
        Ok((Ok(block_index),)) => {
            let block_u64 = crate::ckusdc_integration::nat_to_u64(&block_index)
                .unwrap_or_else(|_| 0);
            ic_cdk::println!("✅ Transfer successful! Block: {}", block_u64);
            Ok(block_u64)
        }
        Ok((Err(e),)) => {
            Err(format!("Transfer failed: {:?}", e))
        }
        Err((code, msg)) => {
            Err(format!("Call failed: {:?}: {}", code, msg))
        }
    }
}
// ===== QUERY FUNCTIONS =====

/// Get all orders for the caller (for "Past Orders" page - shows everything)
pub fn get_my_orders() -> Vec<Order> {
    let caller = get_caller();
    get_orders_by_maker(caller)
}

/// Get active orders for the caller (for "My Requests" page - only orders with active chunks)
/// An order is "active" if it has ANY chunks with status: Available, Idle, or Locked
/// Optimized to filter at storage level instead of loading all orders into memory
pub fn get_my_active_orders() -> Vec<Order> {
    let caller = get_caller();
    
    // Filter at storage level to avoid loading unnecessary orders
    ORDERS.with(|orders| {
        let mut results: Vec<Order> = orders.borrow().iter()
            .filter(|(_, order)| {
                // Must be owned by caller
                if order.maker != caller {
                    return false;
                }
                
                
                // Include if order has any active chunks (Available, Idle, or Locked)
                order.chunks.iter().any(|chunk_id| {
                    if let Some(chunk) = crate::state::get_chunk(*chunk_id) {
                        matches!(chunk.status, ChunkStatus::Available | ChunkStatus::Idle | ChunkStatus::Locked)
                    } else {
                        false
                    }
                })
            })
            .map(|(_, order)| order)
            .collect();
        
        // Sort by created_at descending (newest first)
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    })
}

pub fn get_my_orders_paginated(offset: u64, limit: u64, status_filter: Option<Vec<OrderStatus>>) -> PaginatedOrders {
    let caller = get_caller();
    
    // Filter at storage level to avoid loading unnecessary orders
    let filtered_orders: Vec<Order> = crate::state::ORDERS.with(|orders| {
        let mut results: Vec<Order> = orders.borrow().iter()
            .filter(|(_, order)| {
                // Must be owned by caller
                if order.maker != caller {
                    return false;
                }
                
                // Apply status filter if provided
                if let Some(ref statuses) = status_filter {
                    statuses.contains(&order.status)
                } else {
                    true // No filter, include all
                }
            })
            .map(|(_, order)| order)
            .collect();
        
        // Sort by created_at descending (newest first)
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    });
    
    let total = filtered_orders.len() as u64;
    
    let start = offset as usize;
    let orders: Vec<Order> = filtered_orders.into_iter()
        .skip(start)
        .take(limit as usize)
        .collect();
    
    PaginatedOrders {
        orders,
        total,
        offset,
        limit,
    }
}

/// Get active orders paginated (for "My Requests" page)
/// Includes orders awaiting deposit OR orders with any Available/Idle/Locked chunks
/// Optimized to filter at storage level instead of loading all orders into memory
pub fn get_my_active_orders_paginated(offset: u64, limit: u64) -> PaginatedOrders {
    let caller = get_caller();
    
    // Filter at storage level to avoid loading unnecessary orders
    let active_orders: Vec<Order> = ORDERS.with(|orders| {
        let mut results: Vec<Order> = orders.borrow().iter()
            .filter(|(_, order)| {
                // Must be owned by caller
                if order.maker != caller {
                    return false;
                }
                
                // Include if order is awaiting deposit
                // Include if order has any active chunks (Available, Idle, or Locked)
                order.chunks.iter().any(|chunk_id| {
                    if let Some(chunk) = crate::state::get_chunk(*chunk_id) {
                        matches!(chunk.status, ChunkStatus::Available | ChunkStatus::Idle | ChunkStatus::Locked)
                    } else {
                        false
                    }
                })
            })
            .map(|(_, order)| order)
            .collect();
        
        // Sort by created_at descending (newest first)
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    });
    
    let total = active_orders.len() as u64;
    let start = offset as usize;
    let orders: Vec<Order> = active_orders.into_iter()
        .skip(start)
        .take(limit as usize)
        .collect();
    
    PaginatedOrders {
        orders,
        total,
        offset,
        limit,
    }
}

/// Get orders paginated by status (for "All Orders" page with status tabs)
pub fn get_my_orders_by_status_paginated(status: OrderStatus, offset: u64, limit: u64) -> PaginatedOrders {
    let caller = get_caller();
    let orders_with_status = crate::state::get_orders_by_maker_and_status(caller, status);
    
    let total = orders_with_status.len() as u64;
    let start = offset as usize;
    let orders: Vec<Order> = orders_with_status.into_iter()
        .skip(start)
        .take(limit as usize)
        .collect();
    
    PaginatedOrders {
        orders,
        total,
        offset,
        limit,
    }
}

pub fn get_order(order_id: OrderId) -> Option<Order> {
    crate::state::get_order(order_id)
}

pub fn get_order_chunks(order_id: OrderId) -> Vec<ChunkDetails> {
    let order = match crate::state::get_order(order_id) {
        Some(o) => o,
        None => return Vec::new(),
    };
    
    let mut chunk_details = Vec::new();
    for chunk_id in &order.chunks {
        if let Some(chunk) = crate::state::get_chunk(*chunk_id) {
            chunk_details.push(ChunkDetails {
                id: chunk.id,
                order_id: chunk.order_id,
                amount_usd: chunk.amount_usd,
                status: chunk.status.clone(),
                locked_by: chunk.locked_by,
                filled_at: chunk.filled_at,
            });
        }
    }
    
    chunk_details
}

// Helper function to check and mark orders as idle if price exceeds max
// Optimized to filter at storage level instead of loading all orders
pub async fn check_and_mark_idle_orders() -> Result<(), String> {
    let orders = crate::state::get_orders_by_status(OrderStatus::Active);
    
    for order in orders {
        let price_exceeds = crate::price_oracle::price_exceeds_max(order.max_bsv_price)?;
        
        if price_exceeds {
            // Mark all available chunks as idle
            for chunk_id in &order.chunks {
                if let Some(chunk) = get_chunk(*chunk_id) {
                    if chunk.status == ChunkStatus::Available {
                        update_chunk(*chunk_id, |c| {
                            c.status = ChunkStatus::Idle;
                        })?;
                    }
                }
            }
            
            // Update order to idle
            update_order(order.id, |o| {
                o.status = OrderStatus::Idle;
            })?;
        }
    }
    
    Ok(())
}

fn is_valid_bsv_mainnet_address(address: &str) -> bool {
    // BSV mainnet addresses start with '1' (P2PKH) or '3' (P2SH)
    if address.is_empty() {
        return false;
    }
    
    let first_char = address.chars().next().unwrap();
    if first_char != '1' && first_char != '3' {
        return false;
    }
    
    // Length check: typically 26-35 characters
    if address.len() < 26 || address.len() > 35 {
        return false;
    }
    
    // Try to decode as base58
    match bs58::decode(address).into_vec() {
        Ok(decoded) => {
            // Should be at least 25 bytes (1 version + 20 hash + 4 checksum)
            if decoded.len() < 25 {
                return false;
            }
            
            // Verify checksum
            let payload = &decoded[..decoded.len() - 4];
            let checksum = &decoded[decoded.len() - 4..];
            
            use sha2::{Sha256, Digest};
            let hash1 = Sha256::digest(payload);
            let hash2 = Sha256::digest(&hash1);
            
            &hash2[..4] == checksum
        }
        Err(_) => false,
    }
}

pub async fn update_max_bsv_price(order_id: OrderId, new_max_price: f64) -> Result<(), String> {
    let caller = get_caller();
    let mut order = get_order(order_id)
        .ok_or_else(|| "Order not found".to_string())?;
    
    // Verify caller is the maker
    if order.maker != caller {
        return Err("Only the order maker can update price".to_string());
    }
    
    // Validate new price
    if new_max_price <= 0.0 {
        return Err("Max BSV price must be positive".to_string());
    }
    
    // Check if order has any chunks that can be updated (Available or Idle only)
    let mut has_editable_chunks = false;
    let mut has_locked_chunks = false;
    
    for chunk_id in &order.chunks {
        if let Some(chunk) = get_chunk(*chunk_id) {
            match chunk.status {
                ChunkStatus::Available | ChunkStatus::Idle => {
                    has_editable_chunks = true;
                },
                ChunkStatus::Locked | ChunkStatus::Filled | ChunkStatus::Refunding | ChunkStatus::Refunded => {
                    has_locked_chunks = true;
                },
                _ => {}
            }
        }
    }
    
    // Only allow update if there are Available or Idle chunks
    if !has_editable_chunks {
        return Err("Cannot update price: no Available or Idle chunks. All chunks are either locked, filled, or inactive.".to_string());
    }
    
    ic_cdk::println!("📝 Updating max BSV price for order {} from ${:.4} to ${:.4}", order_id, order.max_bsv_price, new_max_price);
    if has_locked_chunks {
        ic_cdk::println!("⚠️  Order has some locked/filled chunks - they will keep their existing price");
    }
    
    order.max_bsv_price = new_max_price;
    
    // Get current BSV price
    let (current_bsv_price, _) = get_cached_bsv_price();
    ic_cdk::println!("💹 Current BSV price: ${:.4}", current_bsv_price);
    
    // Update chunk states based on new price (only for Available and Idle chunks)
    for chunk_id in &order.chunks {
        match get_chunk(*chunk_id) {
            Some(chunk) => {
                match chunk.status {
                    ChunkStatus::Available => {
                        // If new price is too low, delist to Idle
                        if new_max_price < current_bsv_price {
                            ic_cdk::println!("   Chunk {} (${:.2}): Available → Idle (price exceeded)", chunk_id, chunk.amount_usd);
                            update_chunk(*chunk_id, |c| {
                                c.status = ChunkStatus::Idle;
                                c.max_bsv_price = new_max_price;
                            })?;
                            
                            // Update order tracking
                            order.total_idle_usd += chunk.amount_usd;
                        } else {
                            ic_cdk::println!("   Chunk {} (${:.2}): Available (price updated)", chunk_id, chunk.amount_usd);
                            update_chunk(*chunk_id, |c| {
                                c.max_bsv_price = new_max_price;
                            })?;
                        }
                    },
                    ChunkStatus::Idle => {
                        // If new price is acceptable, re-list to Available
                        if new_max_price >= current_bsv_price {
                            ic_cdk::println!("   Chunk {} (${:.2}): Idle → Available (price now acceptable)", chunk_id, chunk.amount_usd);
                            update_chunk(*chunk_id, |c| {
                                c.status = ChunkStatus::Available;
                                c.max_bsv_price = new_max_price;
                            })?;
                            
                            // Update order tracking
                            order.total_idle_usd -= chunk.amount_usd;
                        } else {
                            ic_cdk::println!("   Chunk {} (${:.2}): Idle (price updated)", chunk_id, chunk.amount_usd);
                            update_chunk(*chunk_id, |c| {
                                c.max_bsv_price = new_max_price;
                            })?;
                        }
                    },
                    // For Locked, Filled, Refunding, Refunded - DO NOT update (price locked at trade time)
                    ChunkStatus::Locked | ChunkStatus::Filled | ChunkStatus::Refunding | ChunkStatus::Refunded => {
                        ic_cdk::println!("   Chunk {} (${:.2}): {:?} (price locked, not updated)", chunk_id, chunk.amount_usd, chunk.status);
                        // Don't update max_bsv_price for these - they're committed at their trade price
                    }
                }
            },
            None => {}
        }
    }
    
    update_order(order_id, |o| {
        o.max_bsv_price = new_max_price;
        o.total_idle_usd = order.total_idle_usd;
    })?;
    
    ic_cdk::println!("✅ Max BSV price updated successfully. Order total idle: ${:.2}", order.total_idle_usd);
    Ok(())
}

/// Cancel order and refund unfilled chunks
/// - If order not yet fully used: Refund ckUSDC for unfilled chunks (not locked/filled)
/// - Note: 1.5% activation fee is non-refundable (already sent to treasury)
pub async fn cancel_order(order_id: OrderId) -> Result<(), String> {
    let caller = get_caller();
    
    // Reject anonymous principal
    if caller == candid::Principal::anonymous() {
        return Err("Anonymous principal cannot cancel orders. Please authenticate first.".to_string());
    }
    
    let order = get_order(order_id)
        .ok_or_else(|| "Order not found".to_string())?;
    
    // Verify caller is the maker
    if order.maker != caller {
        return Err("Only the order maker can cancel".to_string());
    }
    
    // Cannot cancel if order is already completed/cancelled
    if matches!(order.status, OrderStatus::Filled | OrderStatus::Cancelled | OrderStatus::Refunded) {
        return Err(format!("Order is already {:?}", order.status));
    }
    
    let now = get_time();
    
    ic_cdk::println!("========================================");
    ic_cdk::println!("❌ CANCEL ORDER {}", order_id);
    ic_cdk::println!("   Status: {:?}", order.status);
    ic_cdk::println!("========================================");
    
    // Calculate locked chunks amount (these need to stay in the account)
    let mut locked_chunk_amount = 0.0;
    let mut locked_chunk_count = 0;
    
    for chunk_id in order.chunks.iter() {
        if let Some(chunk) = get_chunk(*chunk_id) {
            if chunk.status == ChunkStatus::Locked {
                locked_chunk_amount += chunk.amount_usd;
                locked_chunk_count += 1;
            }
        }
    }
    
    ic_cdk::println!("� Locked chunks: {} chunks = ${:.6}", locked_chunk_count, locked_chunk_amount);
    
    // Calculate amount needed for locked chunks (including filler incentive)
    let filler_incentive_percent = crate::config::FILLER_INCENTIVE_PERCENT as f64 / 10000.0;
    let locked_with_incentive = locked_chunk_amount * (1.0 + filler_incentive_percent);
    
    ic_cdk::println!("💵 Amount reserved for locked chunks (with incentive): ${:.6}", locked_with_incentive);
    
    // Check actual balance in order subaccount
    match ckusdc_integration::get_order_ckusdc_balance(order.maker, order_id).await {
        Ok(balance_e6) => {
            let balance_usd = ckusdc_integration::ckusdc_e6_to_usd(balance_e6);
            ic_cdk::println!("💰 Order deposit balance: ${:.6}", balance_usd);
            
            // Calculate refundable amount = balance - locked_with_incentive
            let refundable_usd = balance_usd - locked_with_incentive;
            
            if refundable_usd > 0.01 { // Only refund if more than 1 cent
                let refund_amount_e6 = ckusdc_integration::usd_to_ckusdc_e6(refundable_usd);
                
                ic_cdk::println!("💸 Transferring refund: ${:.6}", refundable_usd);
                
                match ckusdc_integration::transfer_ckusdc_from_order(
                    order.maker,
                    order_id,
                    order.maker,
                    None, // Maker's default subaccount
                    refund_amount_e6,
                    Some(format!("Refund O{}", order_id).into_bytes()),
                ).await {
                    Ok(block_index) => {
                        let net_refund = ckusdc_integration::ckusdc_e6_to_usd(
                            refund_amount_e6.saturating_sub(crate::config::CKUSDC_TRANSFER_FEE)
                        );
                        ic_cdk::println!("✅ Refunded ${:.6} to maker. Block: {}", net_refund, block_index);
                    },
                    Err(e) => {
                        ic_cdk::println!("⚠️ Failed to refund: {}", e);
                        // Continue with cancellation even if refund fails
                    }
                }
            } else {
                ic_cdk::println!("   No refundable amount (balance needed for locked chunks)");
            }
        },
        Err(e) => {
            ic_cdk::println!("⚠️ Could not check balance: {}", e);
            // Continue with cancellation
        }
    }
        
        // Update order status based on what happened
        let any_locked = order.chunks.iter().any(|id| {
            get_chunk(*id).map(|c| c.status == ChunkStatus::Locked).unwrap_or(false)
        });
        
        let new_status = if any_locked {
            OrderStatus::PartiallyFilled // Has locked chunks that takers will claim
        } else {
            OrderStatus::Cancelled
        };
        
        // Update ONLY Available and Idle chunks to Refunded status (the ones we actually refunded)
        // Do NOT mark already Refunded chunks again - they were refunded in a previous cancel call
        for chunk_id in order.chunks.iter() {
            if let Some(chunk) = get_chunk(*chunk_id) {
                if matches!(chunk.status, ChunkStatus::Available | ChunkStatus::Idle) {
                    update_chunk(*chunk_id, |c| {
                        c.status = ChunkStatus::Refunded;
                    }).ok(); // Ignore errors, continue with other chunks
                    ic_cdk::println!("   Updated chunk {} to Refunded status", chunk_id);
                }
            }
        }
        
        let status_for_log = new_status.clone();
        
        update_order(order_id, |o| {
            o.status = new_status;
        })?;
        
        ic_cdk::println!("✅ Order {} cancelled successfully (status: {:?})", order_id, status_for_log);
        Ok(())
}

// Helper functions to remove from stable storage
fn remove_order(order_id: OrderId) {
    ORDERS.with(|orders| {
        orders.borrow_mut().remove(&order_id);
    });
}

fn remove_chunk(chunk_id: ChunkId) {
    CHUNKS.with(|chunks| {
        chunks.borrow_mut().remove(&chunk_id);
    });
}

// update_order_network removed - no longer needed with ckUSDC-only approach

