use crate::types::*;
use crate::state::*;
use crate::config::{MAX_LOCK_MULTIPLIER};
use candid::{Nat, Principal};
use icrc_ledger_types::icrc1::account::Account;
use icrc_ledger_types::icrc1::transfer::{TransferArg, TransferError, Memo};
use sha2::{Sha256, Digest};

// ckUSDC Ledger canister ID (mainnet)
const CK_USDC_LEDGER_ID: &str = "xevnm-gaaaa-aaaar-qafnq-cai";

// Subaccount type (32 bytes)
type Subaccount = [u8; 32];

// Convert Principal to Subaccount using SHA-256 (mimics b3_utils::Subaccount::from_principal)
fn principal_to_subaccount(principal: Principal) -> Subaccount {
    let mut hasher = Sha256::new();
    hasher.update(principal.as_slice());
    let result = hasher.finalize();
    let mut subaccount = [0u8; 32];
    subaccount.copy_from_slice(&result);
    subaccount
}
pub fn create_account_if_needed(principal: Principal) {
    if get_filler_account(principal).is_none() {
        let now = get_time();
        let account = FillerAccount {
            id: principal,
            pending_trades_total: 0.0,
            total_trades: 0,
            successful_trades: 0,
            penalties_paid: 0.0,
            created_at: now,
        };
        insert_filler_account(account);
    }
}

// Get deposit account for a user
pub fn get_deposit_account(user_principal: Principal) -> Account {
    let owner = ic_cdk::id(); // Canister's principal
    let subaccount = principal_to_subaccount(user_principal);
    Account {
        owner,
        subaccount: Some(subaccount),
    }
}

pub async fn deposit_security(amount: u64) -> Result<(), String> {
    let caller = get_caller();
    
    // Get the deposit account for this filler
    let account = get_deposit_account(caller);
    
    // Check ckUSDC balance of the filler's subaccount in our canister
    let balance = check_ckusdc_balance(account).await?;
    
    if balance < amount {
        return Err(format!(
            "Insufficient ckUSDC balance in subaccount. Required: {}, Available: {}",
            amount, balance
        ));
    }
    
    // Balance is live from ledger - no need to store it
    Ok(())
}

// Just return account info if exists, don't create anything
// User doesn't need an "account" to see their deposit address or balance
pub fn get_my_filler_account() -> Option<FillerAccount> {
    let caller = get_caller();
    get_filler_account(caller)
}

// Helper function to get balance for any principal (used internally during trade creation)
pub async fn get_security_balance_for_principal(principal: Principal) -> Result<u64, String> {
    let account = get_deposit_account(principal);
    check_ckusdc_balance(account).await
}

/// Get available security balance (total balance - locked in pending trades)
pub async fn get_available_security_balance(principal: Principal) -> Result<f64, String> {
    // Get total balance from ckUSDC ledger
    let balance_e6s = get_security_balance_for_principal(principal).await?;
    let total_balance_usd = (balance_e6s as f64) / 1_000_000.0;
    
    // Get filler account to check pending trades
    let filler_account = crate::state::get_filler_account(principal);
    let locked_in_trades = if let Some(account) = filler_account {
        // Locked amount is 5% of pending trade total
        account.pending_trades_total * 0.05
    } else {
        0.0
    };
    
    // Available = Total - Locked
    let available = total_balance_usd - locked_in_trades;
    
    Ok(available.max(0.0)) // Never return negative
}

pub async fn deduct_penalty(filler: Principal, penalty_amount: f64, recipient: Option<Principal>, memo_hint: Option<String>) -> Result<(), String> {
    // Update penalty tracking
    update_filler_account(filler, |account| {
        account.penalties_paid += penalty_amount;
    })?;
    
    // Determine recipient: Some(maker) for timeout penalties, None for treasury
    let treasury_principal = ic_cdk::api::id(); // Treasury is the canister itself
    let recipient_account = match recipient {
        Some(maker) => Account {
            owner: maker,
            subaccount: None, // Maker's main account
        },
        None => Account {
            owner: treasury_principal,
            subaccount: None, // Treasury default account
        },
    };
    
    let recipient_name = match recipient {
        Some(maker) => format!("order maker {}", maker),
        None => "treasury".to_string(),
    };
    
    // Transfer the penalty from filler subaccount to recipient
    let from_account = get_deposit_account(filler);
    let amount_e6 = crate::ckusdc_integration::usd_to_ckusdc_e6(penalty_amount);
    
    // Deduct transfer fee
    let amount_after_fee = amount_e6.saturating_sub(crate::config::CKUSDC_TRANSFER_FEE);
    
    ic_cdk::println!("💰 Deducting penalty ${:.6} from filler {} to {}", penalty_amount, filler, recipient_name);
    
    // Determine memo: prefer provided hint, fallback to a generic message (max 80 bytes)
    let memo_bytes = memo_hint
        .map(|s| {
            let bytes = s.into_bytes();
            if bytes.len() <= 80 {
                bytes
            } else {
                // Truncate to 80 bytes if too long
                bytes[..80].to_vec()
            }
        })
        .unwrap_or_else(|| b"Penalty".to_vec());

    // Use icrc1_transfer to send to recipient account
    let transfer_args = TransferArg {
        from_subaccount: from_account.subaccount,
        to: recipient_account,
        fee: None,
        created_at_time: None,
        memo: Some(Memo::from(memo_bytes)),
        amount: Nat::from(amount_after_fee),
    };
    
    let ledger_id = Principal::from_text(CK_USDC_LEDGER_ID)
        .map_err(|e| format!("Invalid ledger canister ID: {:?}", e))?;
    
    let result: Result<(Result<Nat, TransferError>,), _> = 
        ic_cdk::call(ledger_id, "icrc1_transfer", (transfer_args,)).await;
    
    match result {
        Ok((Ok(_block_index),)) => {
            ic_cdk::println!("✅ Penalty transferred to {}", recipient_name);
            Ok(())
        }
        Ok((Err(e),)) => Err(format!("Transfer failed: {:?}", e)),
        Err((code, msg)) => Err(format!("Call failed: {:?}: {}", code, msg)),
    }
}

/// One-time migration: Transfer any remaining funds from old penalty subaccount to treasury
/// Returns the amount migrated (in e6s)
pub async fn migrate_old_penalty_funds() -> Result<u64, String> {
    // Get the old admin penalty account
    let old_penalty_account = get_old_penalty_account();
    
    // Check balance
    let balance = check_ckusdc_balance(old_penalty_account.clone()).await?;
    
    if balance == 0 {
        return Ok(0); // Nothing to migrate
    }
    
    ic_cdk::println!("💰 Found {} e6 (${:.6}) in old penalty account", balance, (balance as f64) / 1_000_000.0);
    
    // Deduct transfer fee (convert from u128 to u64)
    let transfer_fee = crate::config::CKUSDC_TRANSFER_FEE as u64;
    let amount_after_fee = balance.saturating_sub(transfer_fee);
    
    if amount_after_fee == 0 {
        return Err("Balance too low to cover transfer fee".to_string());
    }
    
    // Transfer to treasury
    let treasury_principal = ic_cdk::api::id();
    let transfer_args = TransferArg {
        from_subaccount: old_penalty_account.subaccount,
        to: Account {
            owner: treasury_principal,
            subaccount: None, // Treasury default account
        },
        fee: None,
        created_at_time: None,
        memo: Some(Memo::from(b"Penalty migration to treasury".to_vec())),
        amount: Nat::from(amount_after_fee),
    };
    
    let ledger_id = Principal::from_text(CK_USDC_LEDGER_ID)
        .map_err(|e| format!("Invalid ledger canister ID: {:?}", e))?;
    
    let result: Result<(Result<Nat, TransferError>,), _> = 
        ic_cdk::call(ledger_id, "icrc1_transfer", (transfer_args,)).await;
    
    match result {
        Ok((Ok(_block_index),)) => {
            ic_cdk::println!("✅ Migrated {} e6 from old penalty account to treasury", amount_after_fee);
            Ok(amount_after_fee as u64)
        }
        Ok((Err(e),)) => Err(format!("Migration transfer failed: {:?}", e)),
        Err((code, msg)) => Err(format!("Migration call failed: {:?}: {}", code, msg)),
    }
}

/// Get the old penalty subaccount (for migration only)
fn get_old_penalty_account() -> Account {
    let admin_bytes = b"admin-penalty-account";
    let mut subaccount = [0u8; 32];
    subaccount[..admin_bytes.len()].copy_from_slice(admin_bytes);
    
    Account {
        owner: ic_cdk::id(),
        subaccount: Some(subaccount),
    }
}

// DEPRECATED: No longer used - penalties go directly to treasury
// Generate admin subaccount for penalty collections
fn get_admin_account_deprecated() -> Account {
    // Create a special admin subaccount using a deterministic string
    let admin_bytes = b"admin-penalty-account";
    let mut subaccount = [0u8; 32];
    subaccount[..admin_bytes.len()].copy_from_slice(admin_bytes);
    
    Account {
        owner: ic_cdk::id(),
        subaccount: Some(subaccount),
    }
}

// Check ckUSDC balance using direct inter-canister call
async fn check_ckusdc_balance(account: Account) -> Result<u64, String> {
    let ledger_id = Principal::from_text(CK_USDC_LEDGER_ID)
        .map_err(|e| format!("Invalid ledger canister ID: {:?}", e))?;
    
    #[allow(deprecated)]
    let result: Result<(Nat,), _> = ic_cdk::call(ledger_id, "icrc1_balance_of", (account,)).await;
    
    match result {
        Ok((balance,)) => {
            ic_cdk::println!("Balance query succeeded: {:?}", balance);
            nat_to_u64(&balance)
        }
        Err((code, msg)) => {
            ic_cdk::println!("Balance query failed: {:?}: {}", code, msg);
            Err(format!("Failed to check balance: {:?}: {}", code, msg))
        }
    }
}

async fn transfer_ckusdc_internal(
    from_account: Account,
    to_account: Account,
    amount: f64,
) -> Result<Nat, String> {
    use icrc_ledger_types::icrc1::transfer::{TransferArg, TransferError};
    
    let ledger_id = Principal::from_text(CK_USDC_LEDGER_ID)
        .map_err(|e| format!("Invalid ledger canister ID: {:?}", e))?;
    
    // Convert f64 to USDC base units (6 decimals)
    let usdc_amount = (amount * 1_000_000.0).round() as u64;
    
    let transfer_args = TransferArg {
        from_subaccount: from_account.subaccount,
        to: to_account,
        amount: Nat::from(usdc_amount),
        fee: None,
        memo: None,
        created_at_time: Some(get_time()),
    };
    
    #[allow(deprecated)]
    let result: Result<(Result<Nat, TransferError>,), _> = 
        ic_cdk::call(ledger_id, "icrc1_transfer", (transfer_args,)).await;
    
    match result {
        Ok((Ok(block_index),)) => Ok(block_index),
        Ok((Err(e),)) => Err(format!("Transfer failed: {:?}", e)),
        Err((code, msg)) => Err(format!("Transfer call failed: {:?}: {}", code, msg)),
    }
}

fn nat_to_u64(nat: &Nat) -> Result<u64, String> {
    use num_traits::cast::ToPrimitive;
    nat.0.to_u64().ok_or_else(|| "Nat too large to convert to u64".to_string())
}

// Return the ICRC-1 account string for deposits
pub fn get_filler_subaccount_address(principal: Principal) -> String {
    let account = get_deposit_account(principal);
    let owner = account.owner.to_text();
    
    // Get subaccount as hex string
    if let Some(subaccount) = account.subaccount {
        let subaccount_hex = hex::encode(subaccount);
        
        // Debug: log what address we're returning
        ic_cdk::println!("Returning deposit address for principal {}: owner={}, subaccount={}", 
                        principal.to_text(), owner, subaccount_hex);
        
        format!("{}.{}", owner, subaccount_hex)
    } else {
        owner
    }
}

pub async fn withdraw_security(amount: u64, to_principal: Principal) -> Result<(), String> {
    let caller = get_caller();
    
    // Get live balance from ledger
    let from_account = get_deposit_account(caller);
    let current_balance = check_ckusdc_balance(from_account.clone()).await?;
    
    // ckUSDC transfer fee is 10,000 e6s (0.01 ckUSDC)
    const CKUSDC_FEE: u64 = 10_000;
    
    // Check if user has enough available balance (amount + fee)
    let total_needed = amount.checked_add(CKUSDC_FEE)
        .ok_or_else(|| "Amount overflow".to_string())?;
        
    if current_balance < total_needed {
        return Err(format!(
            "Insufficient balance. Available: {}, Requested: {} (including fee: {})",
            current_balance, amount, CKUSDC_FEE
        ));
    }
    
    // If filler account exists, check security requirements for locked chunks
    if let Some(account) = get_filler_account(caller) {
        // Check that withdrawal maintains 5% security for pending locked chunks
        // Remaining balance after withdrawal AND fee
        let remaining_balance = current_balance.checked_sub(total_needed)
            .ok_or_else(|| "Insufficient balance for withdrawal".to_string())?;
        
        // Convert remaining balance to USD
        let remaining_balance_usd = remaining_balance as f64 / 1_000_000.0;
        let max_allowed_pending = remaining_balance_usd * (MAX_LOCK_MULTIPLIER as f64);
        
        if account.pending_trades_total > max_allowed_pending {
            return Err(format!(
                "Cannot withdraw: would violate security requirements. Need at least ${:.6} for pending locked chunks of ${:.6}",
                account.pending_trades_total / (MAX_LOCK_MULTIPLIER as f64),
                account.pending_trades_total
            ));
        }
    }
    // If no filler account, user can freely withdraw (no pending trades)
    
    // Transfer ckUSDC from filler's subaccount to their external account
    use icrc_ledger_types::icrc1::transfer::{TransferArg, TransferError};
    
    let ledger_id = Principal::from_text(CK_USDC_LEDGER_ID)
        .map_err(|e| format!("Invalid ledger canister ID: {:?}", e))?;
    
    let transfer_args = TransferArg {
        from_subaccount: from_account.subaccount,
        to: Account {
            owner: to_principal,
            subaccount: None,
        },
        amount: Nat::from(amount),
        fee: Some(Nat::from(CKUSDC_FEE)), // Explicitly set fee
        memo: None,
        created_at_time: Some(get_time()),
    };
    
    #[allow(deprecated)]
    let result: Result<(Result<Nat, TransferError>,), _> = 
        ic_cdk::call(ledger_id, "icrc1_transfer", (transfer_args,)).await;
    
    match result {
        Ok((Ok(_block_index),)) => Ok(()),
        Ok((Err(e),)) => Err(format!("Withdrawal transfer failed: {:?}", e)),
        Err((code, msg)) => Err(format!("Transfer call failed: {:?}: {}", code, msg)),
    }
}

