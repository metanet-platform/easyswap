use candid::{CandidType, Deserialize, Principal, Nat};
use serde::Serialize;
use ic_cdk::api::management_canister::main::CanisterId;
use icrc_ledger_types::icrc1::account::Account;
use sha2::{Sha256, Digest};

// ckUSDC Ledger Canister ID (Ethereum)
pub const CKUSDC_LEDGER_CANISTER_ID: &str = "xevnm-gaaaa-aaaar-qafnq-cai";

// ICRC-1 Transfer Arguments
#[derive(CandidType, Deserialize)]
pub struct TransferArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

// ICRC-1 Transfer Result
#[derive(CandidType, Deserialize)]
pub enum TransferResult {
    Ok(Nat),
    Err(TransferError),
}

#[derive(CandidType, Deserialize, Debug)]
pub enum TransferError {
    BadFee { expected_fee: Nat },
    BadBurn { min_burn_amount: Nat },
    InsufficientFunds { balance: Nat },
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: Nat },
    TemporarilyUnavailable,
    GenericError { error_code: Nat, message: String },
}

// Deposit information for frontend
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct DepositInfo {
    pub principal: Principal,            // IC principal (this canister)
    pub subaccount_hex: String,          // Subaccount in hex format
}

/// Generate a unique subaccount for an order
/// Format: SHA256(maker_principal_bytes || order_id_bytes)
/// This allows recovery by iterating through maker_{0..N} patterns
pub fn order_subaccount(maker: Principal, order_id: u64) -> [u8; 32] {
    let mut hasher = Sha256::new();
    
    // Hash maker principal bytes
    hasher.update(maker.as_slice());
    
    // Hash order_id bytes (8 bytes, big-endian for consistency)
    hasher.update(&order_id.to_be_bytes());
    
    let result = hasher.finalize();
    
    // Convert to fixed-size array
    let mut subaccount = [0u8; 32];
    subaccount.copy_from_slice(&result);
    subaccount
}

/// Get ICRC-1 Account for an order's deposit subaccount
/// Account owner is this canister, subaccount is derived from maker+order_id
pub fn get_order_deposit_account(maker: Principal, order_id: u64) -> Account {
    let owner = ic_cdk::id(); // This canister
    let subaccount = order_subaccount(maker, order_id);
    Account {
        owner,
        subaccount: Some(subaccount),
    }
}

/// Get full deposit information for frontend
pub async fn get_deposit_info_for_order(maker: Principal, order_id: u64) -> Result<DepositInfo, String> {
    let canister_id = ic_cdk::api::id();
    let subaccount = order_subaccount(maker, order_id);
    let subaccount_hex = hex::encode(&subaccount);
    
    ic_cdk::println!("========================================");
    ic_cdk::println!("📍 DEPOSIT INFO FOR ORDER {}", order_id);
    ic_cdk::println!("   Maker: {}", maker);
    ic_cdk::println!("   IC Principal: {}", canister_id);
    ic_cdk::println!("   Subaccount: 0x{}", subaccount_hex);
    ic_cdk::println!("   💡 Recoverable via: maker_{}", order_id);
    ic_cdk::println!("========================================");
    
    Ok(DepositInfo {
        principal: canister_id,
        subaccount_hex,
    })
}

/// Check the ckUSDC balance for a specific order's subaccount
pub async fn get_order_ckusdc_balance(maker: Principal, order_id: u64) -> Result<u128, String> {
    let subaccount = order_subaccount(maker, order_id);
    let this_canister = ic_cdk::api::id();
    
    let ledger_principal = Principal::from_text(CKUSDC_LEDGER_CANISTER_ID)
        .map_err(|e| format!("Invalid ledger principal: {}", e))?;
    
    let account = Account {
        owner: this_canister,
        subaccount: Some(subaccount),
    };
    
    let result: Result<(Nat,), _> = ic_cdk::call(
        ledger_principal,
        "icrc1_balance_of",
        (account,),
    ).await;
    
    match result {
        Ok((balance,)) => {
            // Convert Nat to u128 (ckUSDC has 6 decimals)
            nat_to_u128(&balance)
        },
        Err((code, msg)) => Err(format!("Failed to get balance: {:?} - {}", code, msg)),
    }
}

/// Transfer ckUSDC from order subaccount to a recipient (INTERNAL - use transfer_ckusdc_from_order_with_fee instead)
/// This is the low-level transfer function that sends the exact amount specified
async fn transfer_ckusdc_from_order_raw(
    maker: Principal,
    order_id: u64,
    to_principal: Principal,
    to_subaccount: Option<[u8; 32]>,
    amount_e6: u128, // Amount in ckUSDC base units (6 decimals) - will be sent as-is
    memo: Option<Vec<u8>>,
) -> Result<u64, String> {
    let from_subaccount = order_subaccount(maker, order_id);
    
    let ledger_principal = Principal::from_text(CKUSDC_LEDGER_CANISTER_ID)
        .map_err(|e| format!("Invalid ledger principal: {}", e))?;
    
    let arg = TransferArg {
        from_subaccount: Some(from_subaccount.to_vec()), // Convert [u8; 32] to Vec<u8>
        to: Account {
            owner: to_principal,
            subaccount: to_subaccount,
        },
        amount: Nat::from(amount_e6),
        fee: None, // Use default fee
        memo,
        created_at_time: None,
    };
    
    let result: Result<(TransferResult,), _> = ic_cdk::call(
        ledger_principal,
        "icrc1_transfer",
        (arg,),
    ).await;
    
    match result {
        Ok((TransferResult::Ok(block_index),)) => {
            nat_to_u64(&block_index)
        },
        Ok((TransferResult::Err(err),)) => {
            // Format error with human-readable USD values
            match err {
                TransferError::InsufficientFunds { balance } => {
                    let balance_e6 = nat_to_u128(&balance).unwrap_or(0);
                    let balance_usd = ckusdc_e6_to_usd(balance_e6);
                    let attempted_usd = ckusdc_e6_to_usd(amount_e6);
                    Err(format!(
                        "Insufficient funds in order #{} deposit account. Available: ${} (attempted to send: ${})",
                        order_id, balance_usd, attempted_usd
                    ))
                },
                _ => Err(format!("Transfer failed: {:?}", err))
            }
        },
        Err((code, msg)) => {
            Err(format!("Transfer call failed: {:?} - {}", code, msg))
        },
    }
}

/// Transfer ckUSDC from order subaccount to a recipient - AUTOMATICALLY DEDUCTS TRANSFER FEE
/// This is the recommended method to use for all transfers from order subaccounts
/// The fee is deducted from the desired amount, so recipient gets (amount - fee)
/// 
/// Used for: refunds to maker, payments to filler, any outbound transfers
pub async fn transfer_ckusdc_from_order(
    maker: Principal,
    order_id: u64,
    to_principal: Principal,
    to_subaccount: Option<[u8; 32]>,
    desired_amount_e6: u128, // Desired amount in ckUSDC base units (6 decimals)
    memo: Option<Vec<u8>>,
) -> Result<u64, String> {
    // Subtract the transfer fee from the desired amount
    // The fee is paid from the sender's balance, so we send (desired_amount - fee)
    // This ensures we don't try to send more than available
    let amount_minus_fee = desired_amount_e6.saturating_sub(crate::config::CKUSDC_TRANSFER_FEE);
    
    if amount_minus_fee == 0 {
        return Err("Amount too small to cover transfer fee".to_string());
    }
    
    ic_cdk::println!("💸 Transfer ckUSDC from order {} subaccount", order_id);
    ic_cdk::println!("   Desired amount: {} e6 (${:.6})", desired_amount_e6, ckusdc_e6_to_usd(desired_amount_e6));
    ic_cdk::println!("   Transfer fee: {} e6 ($0.01)", crate::config::CKUSDC_TRANSFER_FEE);
    ic_cdk::println!("   Net to send: {} e6 (${:.6})", amount_minus_fee, ckusdc_e6_to_usd(amount_minus_fee));
    
    transfer_ckusdc_from_order_raw(
        maker,
        order_id,
        to_principal,
        to_subaccount,
        amount_minus_fee,
        memo,
    ).await
}

/// Transfer ckUSDC from order subaccount for activation fee to treasury
/// The transfer fee is deducted FROM the activation fee amount
/// So treasury receives (activation_fee - transfer_fee) and order balance remains correct
pub async fn transfer_activation_fee_to_treasury(
    maker: Principal,
    order_id: u64,
    treasury_principal: Principal,
    activation_fee_e6: u128,
    memo: Option<Vec<u8>>,
) -> Result<u64, String> {
    // Subtract transfer fee from activation fee amount
    // This ensures the order balance is only reduced by activation_fee_e6 total
    let amount_minus_fee = activation_fee_e6.saturating_sub(crate::config::CKUSDC_TRANSFER_FEE);
    
    if amount_minus_fee == 0 {
        return Err("Activation fee too small to cover transfer fee".to_string());
    }
    
    ic_cdk::println!("💰 Transfer activation fee to treasury from order {} subaccount", order_id);
    ic_cdk::println!("   Activation fee (gross): {} e6 (${:.6})", activation_fee_e6, ckusdc_e6_to_usd(activation_fee_e6));
    ic_cdk::println!("   Transfer fee: {} e6 ($0.01)", crate::config::CKUSDC_TRANSFER_FEE);
    ic_cdk::println!("   Treasury receives (net): {} e6 (${:.6})", amount_minus_fee, ckusdc_e6_to_usd(amount_minus_fee));
    
    transfer_ckusdc_from_order_raw(
        maker,
        order_id,
        treasury_principal,
        None,
        amount_minus_fee, // Send activation fee minus transfer fee
        memo,
    ).await
}

/// Convert USD amount to ckUSDC base units (6 decimals)
/// Only rounds at the final conversion to u128 (blockchain requires integer)
pub fn usd_to_ckusdc_e6(usd_amount: f64) -> u128 {
    (usd_amount * 1_000_000.0) as u128
}

/// Convert ckUSDC base units to USD with full precision
pub fn ckusdc_e6_to_usd(amount_e6: u128) -> f64 {
    (amount_e6 as f64) / 1_000_000.0
}

pub fn nat_to_u64(nat: &Nat) -> Result<u64, String> {
    let bytes = nat.0.to_bytes_le();
    if bytes.len() > 8 {
        return Err("Nat value too large for u64".to_string());
    }
    let mut arr = [0u8; 8];
    arr[..bytes.len()].copy_from_slice(&bytes);
    Ok(u64::from_le_bytes(arr))
}

fn nat_to_u128(nat: &Nat) -> Result<u128, String> {
    let bytes = nat.0.to_bytes_le();
    if bytes.len() > 16 {
        return Err("Nat value too large for u128".to_string());
    }
    let mut arr = [0u8; 16];
    arr[..bytes.len()].copy_from_slice(&bytes);
    Ok(u128::from_le_bytes(arr))
}
