import { ethers } from 'ethers';

const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const HELPER_CONTRACT = '0x6abDA0438307733FC299e9C229FD3cc074bD8cC0';

const USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

const HELPER_ABI = [
  'function deposit(address erc20, uint256 amount, bytes32 principal) payable'
];

/**
 * Get EOA address from genericUseSeed
 */
export function getEOAAddress(privateKey) {
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const wallet = new ethers.Wallet(key);
  return wallet.address;
}

/**
 * Get USDC balance
 */
export async function getUSDCBalance(address, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(USDC_CONTRACT, USDC_ABI, provider);
  const balance = await contract.balanceOf(address);
  return ethers.formatUnits(balance, 6);
}

/**
 * Get ETH balance
 */
export async function getETHBalance(address, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
}

/**
 * Transfer ETH - native token transfer
 */
export async function transferETH(privateKey, toAddress, amount, rpcUrl) {
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(key, provider);
  
  const amountInWei = ethers.parseEther(amount.toString());
  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: amountInWei
  });
  const receipt = await tx.wait();
  
  return { hash: tx.hash, receipt };
}

/**
 * Transfer USDC - user pays gas in ETH
 */
export async function transferUSDC(privateKey, toAddress, amount, rpcUrl) {
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(key, provider);
  const contract = new ethers.Contract(USDC_CONTRACT, USDC_ABI, wallet);
  
  const amountInUnits = ethers.parseUnits(amount.toString(), 6);
  const tx = await contract.transfer(toAddress, amountInUnits);
  const receipt = await tx.wait();
  
  return { hash: tx.hash, receipt };
}

/**
 * Deposit USDC to helper contract (approve + deposit) - user pays gas in ETH
 */
export async function depositToHelper(privateKey, amount, principalBytes32, rpcUrl) {
  // CRITICAL SAFETY CHECKS
  if (!principalBytes32 || typeof principalBytes32 !== 'string') {
    throw new Error('Invalid principalBytes32 parameter');
  }

  if (!principalBytes32.startsWith('0x') || principalBytes32.length !== 66) {
    throw new Error(`Invalid bytes32 format: ${principalBytes32} (length: ${principalBytes32.length})`);
  }

  console.log('🔐 depositToHelper called with:');
  console.log('  - Amount:', amount, 'USDC');
  console.log('  - Principal bytes32:', principalBytes32);
  console.log('  - Helper contract:', HELPER_CONTRACT);
  console.log('  - USDC contract:', USDC_CONTRACT);

  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(key, provider);
  
  console.log('  - From address:', wallet.address);

  const usdcContract = new ethers.Contract(USDC_CONTRACT, USDC_ABI, wallet);
  const helperContract = new ethers.Contract(HELPER_CONTRACT, HELPER_ABI, wallet);
  
  const amountInUnits = ethers.parseUnits(amount.toString(), 6);
  console.log('  - Amount in units:', amountInUnits.toString());
  
  // Step 1: Approve
  console.log('\n📝 Step 1: Approving helper contract...');
  const approveTx = await usdcContract.approve(HELPER_CONTRACT, amountInUnits);
  console.log('  - Approve tx hash:', approveTx.hash);
  console.log('  - Waiting for confirmation...');
  const approveReceipt = await approveTx.wait();
  console.log('  ✅ Approval confirmed in block:', approveReceipt.blockNumber);
  
  // Step 2: Deposit
  console.log('\n📦 Step 2: Depositing to helper...');
  console.log('  - Calling deposit with:');
  console.log('    • erc20:', USDC_CONTRACT);
  console.log('    • amount:', amountInUnits.toString());
  console.log('    • principal:', principalBytes32);
  
  const depositTx = await helperContract.deposit(USDC_CONTRACT, amountInUnits, principalBytes32);
  console.log('  - Deposit tx hash:', depositTx.hash);
  console.log('  - View on Etherscan: https://etherscan.io/tx/' + depositTx.hash);
  console.log('  - Waiting for confirmation...');
  
  const depositReceipt = await depositTx.wait();
  console.log('  ✅ Deposit confirmed in block:', depositReceipt.blockNumber);
  console.log('\n⏳ ckUSDC will be minted to your IC principal in ~20 minutes');
  console.log('   Monitor progress: https://sv3dd-oaaaa-aaaar-qacoa-cai.raw.icp0.io/dashboard');
  
  return { 
    approveHash: approveTx.hash, 
    depositHash: depositTx.hash, 
    receipt: depositReceipt 
  };
}

/**
 * Withdraw ckUSDC to Ethereum USDC
 * @param {Actor} minterActor - Minter canister actor instance
 * @param {string} amount - Amount in USDC (will be converted to e6 units)
 * @param {string} recipientAddress - Ethereum address to send USDC to
 * @param {string} ledgerCanisterId - ckUSDC ledger canister ID
 * @param {Array} fromCkethSubaccount - Optional subaccount for ckETH fee payment
 * @param {Array} fromCkerc20Subaccount - Optional subaccount for ckUSDC burn
 * @returns {Promise} Result with RetrieveErc20Request or error
 */
export async function withdrawCkUSDCToEth(
  minterActor,
  amount,
  recipientAddress,
  ledgerCanisterId,
  fromCkethSubaccount = null,
  fromCkerc20Subaccount = null
) {
  console.log('🔄 withdrawCkUSDCToEth called with:');
  console.log('  - Amount:', amount, 'USDC');
  console.log('  - Recipient:', recipientAddress);
  console.log('  - Ledger:', ledgerCanisterId);

  // Validate recipient address
  if (!recipientAddress || !recipientAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error('Invalid Ethereum address');
  }

  // Convert amount to e6 units (USDC has 6 decimals)
  const amountE6 = BigInt(Math.floor(parseFloat(amount) * 1_000_000));
  
  console.log('  - Amount in e6:', amountE6.toString());

  // Prepare withdrawal arguments
  const withdrawArg = {
    amount: amountE6,
    ckerc20_ledger_id: { toText: () => ledgerCanisterId }, // Principal
    recipient: recipientAddress,
    from_cketh_subaccount: fromCkethSubaccount ? [fromCkethSubaccount] : [],
    from_ckerc20_subaccount: fromCkerc20Subaccount ? [fromCkerc20Subaccount] : []
  };

  console.log('\n📤 Calling minter.withdraw_erc20...');
  
  try {
    const result = await minterActor.withdraw_erc20(withdrawArg);
    
    if (result.Ok) {
      console.log('  ✅ Withdrawal initiated successfully');
      console.log('  - Block index:', result.Ok.block_index?.toString());
      return { success: true, data: result.Ok };
    } else if (result.Err) {
      console.error('  ❌ Withdrawal failed:', result.Err);
      throw new Error(getWithdrawErrorMessage(result.Err));
    }
  } catch (error) {
    console.error('  ❌ Error calling withdraw_erc20:', error);
    throw error;
  }
}

/**
 * Convert withdrawal error to human-readable message
 */
function getWithdrawErrorMessage(error) {
  if (error.InsufficientFunds) {
    return `Insufficient funds. Balance: ${error.InsufficientFunds.balance}`;
  }
  if (error.TemporarilyUnavailable) {
    return 'Service temporarily unavailable. Please try again later.';
  }
  if (error.GenericError) {
    return error.GenericError.message || 'Unknown error occurred';
  }
  if (error.InvalidDestination) {
    return 'Invalid destination address';
  }
  if (error.AmountTooLow) {
    return `Amount too low. Minimum: ${error.AmountTooLow.min_withdrawal_amount}`;
  }
  return JSON.stringify(error);
}
