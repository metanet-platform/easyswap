use candid::{CandidType, Deserialize, Nat, Principal};
use ic_cdk::api::call::CallResult;
use serde::Serialize;
use crate::config::{CK_ETH_LEDGER, CK_USDC_LEDGER, CK_USDC_MINTER};

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct Account {
    pub owner: Principal,
    pub subaccount: Option<Vec<u8>>,
}

#[derive(CandidType, Deserialize)]
pub struct ApproveArgs {
    pub spender: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub from_subaccount: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
    pub expected_allowance: Option<Nat>,
    pub expires_at: Option<u64>,
}

#[derive(CandidType, Deserialize)]
pub struct TransferArgs {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize)]
pub struct TransferFromArgs {
    pub from: Account,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
    pub spender_subaccount: Option<Vec<u8>>,
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
    GenericError { message: String, error_code: Nat },
}

#[derive(CandidType, Deserialize, Debug)]
pub enum TransferFromError {
    BadFee { expected_fee: Nat },
    BadBurn { min_burn_amount: Nat },
    InsufficientFunds { balance: Nat },
    InsufficientAllowance { allowance: Nat },
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: Nat },
    TemporarilyUnavailable,
    GenericError { message: String, error_code: Nat },
}


#[derive(CandidType, Deserialize, Debug)]
pub enum ApproveError {
    GenericError { message: String, error_code: Nat },
    TemporarilyUnavailable,
    Duplicate { duplicate_of: Nat },
    BadFee { expected_fee: Nat },
    AllowanceChanged { current_allowance: Nat },
    CreatedInFuture { ledger_time: u64 },
    TooOld,
    Expired { ledger_time: u64 },
    InsufficientFunds { balance: Nat },
}

#[derive(CandidType, Deserialize)]
pub struct WithdrawErc20Arg {
    pub amount: Nat,
    pub ckerc20_ledger_id: Principal,
    pub recipient: String,
    pub from_cketh_subaccount: Option<Vec<u8>>,
    pub from_ckerc20_subaccount: Option<Vec<u8>>,
}

#[derive(CandidType, Deserialize, Debug, Serialize)]
pub struct RetrieveErc20Request {
    pub cketh_block_index: Nat,
    pub ckerc20_block_index: Nat,
}

#[derive(CandidType, Deserialize, Debug, Clone, Serialize)]
pub enum WithdrawalError {
    TokenNotSupported { supported_tokens: Vec<Principal> },
    CkEthLedgerError { error: LedgerError },
    CkErc20LedgerError { cketh_block_index: Nat, error: LedgerError },
    TemporarilyUnavailable(String),
    RecipientAddressBlocked { address: String },
}

#[derive(CandidType, Deserialize, Debug, Clone, Serialize)]
pub enum LedgerError {
    InsufficientFunds { balance: Nat, failed_burn_amount: Nat },
    AmountTooLow { minimum_burn_amount: Nat },
    InsufficientAllowance { allowance: Nat },
    TemporarilyUnavailable,
    GenericError { error_message: String, error_code: Nat },
}

/// Approve the minter to spend canister's ckETH for gas fees
pub async fn approve_cketh_for_gas(amount: Nat) -> Result<Nat, String> {
    let ledger = Principal::from_text(CK_ETH_LEDGER)
        .map_err(|e| format!("Invalid ckETH ledger principal: {}", e))?;
    
    let minter = Principal::from_text(CK_USDC_MINTER)
        .map_err(|e| format!("Invalid minter principal: {}", e))?;

    let args = ApproveArgs {
        spender: Account {
            owner: minter,
            subaccount: None,
        },
        amount,
        fee: None,
        memo: None,
        from_subaccount: None,
        created_at_time: None,
        expected_allowance: None, // Don't check existing allowance, just overwrite
        expires_at: None,
    };

    let result: CallResult<(Result<Nat, ApproveError>,)> = 
        ic_cdk::call(ledger, "icrc2_approve", (args,)).await;

    match result {
        Ok((Ok(block_index),)) => Ok(block_index),
        Ok((Err(approve_error),)) => Err(format!("Approval failed: {:?}", approve_error)),
        Err((code, msg)) => Err(format!("Call failed: {:?}: {}", code, msg)),
    }
}

/// Get current ETH/USD price from XRC oracle
async fn get_eth_usd_price() -> Result<f64, String> {
    crate::xrc_oracle::get_eth_usd_rate().await
}

/// Calculate expected gas fee in USD based on Wei amount and current ETH price
async fn calculate_expected_gas_fee_usd(gas_wei: u64) -> Result<f64, String> {
    let eth_price = get_eth_usd_price().await?;
    let gas_eth = gas_wei as f64 / 1e18;
    let gas_usd = gas_eth * eth_price;
    Ok(gas_usd)
}

/// Withdraw ckUSDC to Ethereum USDC
/// User pays: withdrawal_amount + gas_fee_in_usdc + treasury_fee (20% of gas, min $0.05)
/// Canister uses its ckETH treasury to pay Ethereum gas
/// 
/// Security measures:
/// 1. User approval expires in 5 minutes (set by frontend)
/// 2. Gas fee validated against actual cost (with 15% buffer check)
/// 3. Only caller's approved funds can be pulled
/// 4. Transfer happens atomically before minter call
/// 
/// Fee structure:
/// - Gas fee: Dynamic based on ETH price (typically $0.40-$0.80)
/// - Treasury fee: 20% of gas fee, minimum $0.05 (covers XRC oracle calls + operational costs)
pub async fn withdraw_ckusdc_to_eth(
    user: Principal,
    withdrawal_amount_e6: Nat,
    gas_fee_usdc_e6: Nat,
    treasury_fee_e6: Nat,
    gas_amount_wei: Nat,
    recipient_address: String,
) -> Result<RetrieveErc20Request, String> {
    let canister_id = ic_cdk::id();
    
    // Validate treasury fee: must be at least 20% of gas fee, with $0.05 minimum
    let gas_fee_usdc = gas_fee_usdc_e6.0.to_u64_digits();
    let gas_fee_amount = if gas_fee_usdc.len() > 0 { gas_fee_usdc[0] } else { 0 };
    
    let treasury_fee_usdc = treasury_fee_e6.0.to_u64_digits();
    let treasury_fee_amount = if treasury_fee_usdc.len() > 0 { treasury_fee_usdc[0] } else { 0 };
    
    let min_treasury_fee = std::cmp::max(
        (gas_fee_amount as f64 * 0.20) as u64,  // 20% of gas
        50_000  // Minimum $0.05
    );
    
    if treasury_fee_amount < min_treasury_fee {
        return Err(format!(
            "Treasury fee too low. Minimum ${:.2} required (20% of gas fee: ${:.2})",
            min_treasury_fee as f64 / 1_000_000.0,
            gas_fee_amount as f64 / 1_000_000.0
        ));
    }
    
    // Convert gas amount from Nat to u64
    let gas_wei_digits = gas_amount_wei.0.to_u64_digits();
    let gas_wei = if gas_wei_digits.len() > 0 { gas_wei_digits[0] } else { 
        return Err("Invalid gas amount".to_string());
    };
    
    // Gas amount in ckETH (e18) - from minter's estimate
    let gas_amount_e18 = gas_amount_wei.clone();
    
    // Validate gas fee is reasonable
    // First check: hard limits ($0.30 to $2.00)
    let gas_fee_usdc = gas_fee_usdc_e6.0.to_u64_digits();
    let gas_fee_amount = if gas_fee_usdc.len() > 0 { gas_fee_usdc[0] } else { 0 };
    
    if gas_fee_amount < 300_000 {
        return Err("Gas fee too low. Minimum $0.30 required.".to_string());
    }
    if gas_fee_amount > 2_000_000 {
        return Err("Gas fee too high. Maximum $2.00 allowed.".to_string());
    }
    
    // Second check: validate against current ETH price from XRC
    // Calculate expected gas cost based on actual gas amount from minter
    let expected_gas_usd = match calculate_expected_gas_fee_usd(gas_wei).await {
        Ok(cost) => cost * 1.15, // Add 15% buffer for price volatility
        Err(e) => {
            ic_cdk::println!("Warning: Could not validate gas fee against XRC: {}", e);
            // If XRC fails, accept any fee within hard limits
            gas_fee_amount as f64 / 1_000_000.0
        }
    };
    
    let user_gas_fee_usd = gas_fee_amount as f64 / 1_000_000.0;
    
    // User must pay at least 80% of expected cost (protects treasury)
    if user_gas_fee_usd < expected_gas_usd * 0.8 {
        return Err(format!(
            "Gas fee too low for current ETH price. Expected ${:.2}, got ${:.2}",
            expected_gas_usd, user_gas_fee_usd
        ));
    }
    
    ic_cdk::println!(
        "Gas fee validation: Expected ${:.2}, User paying ${:.2}", 
        expected_gas_usd, 
        user_gas_fee_usd
    );
    
    // Step 1: Transfer total ckUSDC from user to canister (withdrawal + gas fee + treasury fee)
    // Note: ICRC-2 transfer_from has a fee (typically 0.01 USDC = 10,000 e6)
    // The user's approval must cover: total + transfer fee
    // But we only transfer the total (ledger deducts fee automatically)
    let total_usdc = withdrawal_amount_e6.clone() + gas_fee_usdc_e6.clone() + treasury_fee_e6.clone();
    
    let ckusdc_ledger = Principal::from_text(CK_USDC_LEDGER)
        .map_err(|e| format!("Invalid ckUSDC ledger principal: {}", e))?;
    
    // Transfer from user to canister using icrc2_transfer_from (user must approve backend first)
    let transfer_result: CallResult<(Result<Nat, TransferFromError>,)> = ic_cdk::call(
        ckusdc_ledger,
        "icrc2_transfer_from",
        (
            TransferFromArgs {
                from: Account {
                    owner: user,
                    subaccount: None,
                },
                to: Account {
                    owner: canister_id,
                    subaccount: None,
                },
                amount: total_usdc.clone(),
                fee: None,
                memo: Some(b"ETH withdrawal + gas + treasury fee".to_vec()),
                created_at_time: None,
                spender_subaccount: None,
            },
        ),
    ).await;
    
    match transfer_result {
        Ok((Ok(_block_index),)) => {},
        Ok((Err(transfer_error),)) => return Err(format!("Failed to transfer ckUSDC from user: {:?}", transfer_error)),
        Err((code, msg)) => return Err(format!("Failed to call transfer_from: {:?}: {}", code, msg)),
    }
    
    // Step 2: Check canister has enough ckETH (including ICRC-2 fee)
    let canister_id = ic_cdk::id();
    let account = Account {
        owner: canister_id,
        subaccount: None,
    };
    let cketh_ledger = Principal::from_text(CK_ETH_LEDGER)
        .map_err(|e| format!("Invalid ckETH ledger principal: {}", e))?;
    let balance_result: CallResult<(Nat,)> = ic_cdk::call(cketh_ledger, "icrc1_balance_of", (account,)).await;
    let cketh_balance = match balance_result {
        Ok((balance,)) => balance,
        Err((code, msg)) => return Err(format!("Failed to get ckETH balance: {:?}: {}", code, msg)),
    };
    
    // ckETH ICRC-2 fee is 2,000,000,000,000 wei (0.000002 ETH)
    // But the minter also needs to BURN ckETH which has its own fee
    // Approve 2x gas amount to avoid issues with existing allowances
    let cketh_icrc2_fee = Nat::from(2_000_000_000_000u64); // 0.000002 ETH
    let cketh_burn_fee = Nat::from(2_000_000_000_000u64);  // 0.000002 ETH (burn fee)
    let cketh_total_needed = gas_amount_e18.clone() + cketh_icrc2_fee.clone() + cketh_burn_fee.clone();
    
    if cketh_balance < cketh_total_needed {
        return Err(format!(
            "Insufficient ckETH in treasury. Have: {}, Need: {} (gas: {} + icrc2_fee: {} + burn_fee: {})",
            cketh_balance, cketh_total_needed, gas_amount_e18, cketh_icrc2_fee, cketh_burn_fee
        ));
    }
    
    // Step 3: Approve minter to spend canister's ckETH for gas
    // Approve 2x the needed amount to handle existing allowances
    let cketh_approval_amount = cketh_total_needed.clone() * Nat::from(2u8);
    ic_cdk::println!("Approving ckETH: {} wei (2x needed amount)", cketh_approval_amount);
    approve_cketh_for_gas(cketh_approval_amount).await?;
    
    // Step 4: Approve minter to spend canister's ckUSDC (only withdrawal amount, not gas fee)
    // ckUSDC ICRC-2 fee is 10,000 e6 (0.01 USDC)
    let ckusdc_fee_e6 = Nat::from(10_000u64);
    let ckusdc_approval_amount = withdrawal_amount_e6.clone() + ckusdc_fee_e6;
    approve_ckusdc_for_withdrawal(ckusdc_approval_amount).await?;
    
    // Step 5: Call minter's withdraw_erc20
    let minter = Principal::from_text(CK_USDC_MINTER)
        .map_err(|e| format!("Invalid minter principal: {}", e))?;
    
    let withdraw_arg = WithdrawErc20Arg {
        amount: withdrawal_amount_e6,
        ckerc20_ledger_id: ckusdc_ledger,
        recipient: recipient_address,
        from_cketh_subaccount: None,
        from_ckerc20_subaccount: None,
    };
    
    let result: CallResult<(Result<RetrieveErc20Request, WithdrawalError>,)> = 
        ic_cdk::call(minter, "withdraw_erc20", (withdraw_arg,)).await;
    
    match result {
        Ok((Ok(retrieve_request),)) => Ok(retrieve_request),
        Ok((Err(withdrawal_error),)) => Err(format!("Withdrawal failed: {:?}", withdrawal_error)),
        Err((code, msg)) => Err(format!("Failed to call withdraw_erc20: {:?}: {}", code, msg)),
    }
}
/// Approve the minter to spend canister's ckUSDC (user deposited)
pub async fn approve_ckusdc_for_withdrawal(amount: Nat) -> Result<Nat, String> {
    let ledger = Principal::from_text(CK_USDC_LEDGER)
        .map_err(|e| format!("Invalid ckUSDC ledger principal: {}", e))?;
    
    let minter = Principal::from_text(CK_USDC_MINTER)
        .map_err(|e| format!("Invalid minter principal: {}", e))?;

    let args = ApproveArgs {
        spender: Account {
            owner: minter,
            subaccount: None,
        },
        amount,
        fee: None,
        memo: None,
        from_subaccount: None,
        created_at_time: None,
        expected_allowance: None,
        expires_at: None,
    };

    let result: CallResult<(Result<Nat, ApproveError>,)> = 
        ic_cdk::call(ledger, "icrc2_approve", (args,)).await;

    match result {
        Ok((Ok(block_index),)) => Ok(block_index),
        Ok((Err(approve_error),)) => Err(format!("Approval failed: {:?}", approve_error)),
        Err((code, msg)) => Err(format!("Call failed: {:?}: {}", code, msg)),
    }
}

/// Admin function to withdraw ckUSDC from treasury to admin principal
/// Transfers all ckUSDC balance minus the ICRC-2 transfer fee (10,000 e6)
/// Note: Admin check is enforced in lib.rs before calling this function
pub async fn admin_withdraw_ckusdc_treasury() -> Result<Nat, String> {
    let stored_admin = crate::state::get_admin();
    
    let ledger = Principal::from_text(CK_USDC_LEDGER)
        .map_err(|e| format!("Invalid ckUSDC ledger principal: {}", e))?;
    
    // Get canister's ckUSDC balance
    let canister_id = ic_cdk::id();
    let account = Account {
        owner: canister_id,
        subaccount: None,
    };
    
    let balance_result: CallResult<(Nat,)> = ic_cdk::call(ledger, "icrc1_balance_of", (account,)).await;
    let balance = match balance_result {
        Ok((balance,)) => balance,
        Err((code, msg)) => return Err(format!("Failed to get ckUSDC balance: {:?}: {}", code, msg)),
    };
    
    // ICRC-2 transfer fee is 10,000 e6 (0.01 USDC)
    let fee = Nat::from(10_000u64);
    
    if balance <= fee {
        return Err(format!("Insufficient balance. Have: {}, Need more than fee: {}", balance, fee));
    }
    
    // Transfer amount = balance - fee
    let transfer_amount = balance - fee;
    
    let transfer_args = TransferArgs {
        from_subaccount: None,
        to: Account {
            owner: stored_admin,
            subaccount: None,
        },
        amount: transfer_amount.clone(),
        fee: None, // Use default fee
        memo: None,
        created_at_time: None,
    };
    
    let transfer_result: CallResult<(Result<Nat, TransferError>,)> = 
        ic_cdk::call(ledger, "icrc1_transfer", (transfer_args,)).await;
    
    match transfer_result {
        Ok((Ok(block_index),)) => Ok(block_index),
        Ok((Err(transfer_error),)) => Err(format!("Transfer failed: {:?}", transfer_error)),
        Err((code, msg)) => Err(format!("Failed to call transfer: {:?}: {}", code, msg)),
    }
}
