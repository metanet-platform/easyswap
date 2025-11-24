import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-hot-toast';
import { Copy, ExternalLink, RefreshCw, ArrowDownUp, ArrowUpRight, ArrowRight, Wallet, Sparkles, ArrowDown } from 'lucide-react';
import { Button, Select } from '../common';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Link, useNavigate } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { useTranslation } from 'react-i18next';
import { canisterId as backendCanisterId } from '../../../../declarations/usdcbsv_orderbook_backend';
import { 
  getEOAAddress,
  transferETH,
  transferUSDC, 
  depositToHelper,
  getUSDCBalance,
  getETHBalance,
  withdrawCkUSDCToEth
} from '../../utils/wallet';
import { CK_ETH_LEDGER, CK_USDC_LEDGER, CK_USDC_MINTER, MIN_CHUNK_SIZE_USD, MAX_CHUNKS_ALLOWED, MAX_ORDER_SIZE_USD, BSV_PRICE_BUFFER_PERCENT, ACTIVATION_FEE_PERCENT, FILLER_INCENTIVE_PERCENT, MAKER_FEE_PERCENT } from '../../config';

// Contract addresses
const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Mainnet USDC
const HELPER_CONTRACT = '0x6abDA0438307733FC299e9C229FD3cc074bD8cC0'; // ckERC20 helper

// Public RPC endpoints
const RPC_ENDPOINTS = [
  'https://ethereum.publicnode.com',
  'https://rpc.ankr.com/eth',
  'https://eth.llamarpc.com',
];

// ICRC1 Ledger IDL Factory (for direct actor calls)
const ledgerIdlFactory = ({ IDL }) => {
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const TransferArg = IDL.Record({
    'to' : Account,
    'fee' : IDL.Opt(IDL.Nat),
    'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'created_at_time' : IDL.Opt(IDL.Nat64),
    'amount' : IDL.Nat,
  });
  const TransferError = IDL.Variant({
    'GenericError' : IDL.Record({
      'message' : IDL.Text,
      'error_code' : IDL.Nat,
    }),
    'TemporarilyUnavailable' : IDL.Null,
    'BadBurn' : IDL.Record({ 'min_burn_amount' : IDL.Nat }),
    'Duplicate' : IDL.Record({ 'duplicate_of' : IDL.Nat }),
    'BadFee' : IDL.Record({ 'expected_fee' : IDL.Nat }),
    'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }),
    'TooOld' : IDL.Null,
    'InsufficientFunds' : IDL.Record({ 'balance' : IDL.Nat }),
  });
  const Result = IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : TransferError });
  
  const ApproveArgs = IDL.Record({
    'fee' : IDL.Opt(IDL.Nat),
    'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'created_at_time' : IDL.Opt(IDL.Nat64),
    'amount' : IDL.Nat,
    'expected_allowance' : IDL.Opt(IDL.Nat),
    'expires_at' : IDL.Opt(IDL.Nat64),
    'spender' : Account,
  });
  const ApproveError = IDL.Variant({
    'GenericError' : IDL.Record({ 'message' : IDL.Text, 'error_code' : IDL.Nat }),
    'TemporarilyUnavailable' : IDL.Null,
    'Duplicate' : IDL.Record({ 'duplicate_of' : IDL.Nat }),
    'BadFee' : IDL.Record({ 'expected_fee' : IDL.Nat }),
    'AllowanceChanged' : IDL.Record({ 'current_allowance' : IDL.Nat }),
    'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }),
    'TooOld' : IDL.Null,
    'Expired' : IDL.Record({ 'ledger_time' : IDL.Nat64 }),
    'InsufficientFunds' : IDL.Record({ 'balance' : IDL.Nat }),
  });
  const ApproveResult = IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : ApproveError });

  return IDL.Service({
    'icrc1_balance_of' : IDL.Func([Account], [IDL.Nat], ['query']),
    'icrc1_transfer' : IDL.Func([TransferArg], [Result], []),
    'icrc1_fee' : IDL.Func([], [IDL.Nat], ['query']),
    'icrc2_approve' : IDL.Func([ApproveArgs], [ApproveResult], []),
  });
};

const MIN_AMOUNT = 1; // Minimum 1 USDC

// Minter canister IDL (minimal for withdraw_erc20 and fee estimation)
const minterIdl = ({ IDL }) => {
  const Subaccount = IDL.Vec(IDL.Nat8);
  const WithdrawErc20Arg = IDL.Record({
    amount: IDL.Nat,
    ckerc20_ledger_id: IDL.Principal,
    recipient: IDL.Text,
    from_cketh_subaccount: IDL.Opt(Subaccount),
    from_ckerc20_subaccount: IDL.Opt(Subaccount),
  });
  const RetrieveErc20Request = IDL.Record({
    cketh_block_index: IDL.Nat,
    ckerc20_block_index: IDL.Nat,
  });
  const LedgerError = IDL.Variant({
    InsufficientFunds: IDL.Record({ 
      balance: IDL.Nat,
      failed_burn_amount: IDL.Nat,
      token_symbol: IDL.Text,
      ledger_id: IDL.Principal
    }),
    InsufficientAllowance: IDL.Record({ 
      allowance: IDL.Nat,
      failed_burn_amount: IDL.Nat,
      token_symbol: IDL.Text,
      ledger_id: IDL.Principal
    }),
    AmountTooLow: IDL.Record({ 
      minimum_burn_amount: IDL.Nat,
      failed_burn_amount: IDL.Nat,
      token_symbol: IDL.Text,
      ledger_id: IDL.Principal
    }),
    TemporarilyUnavailable: IDL.Text,
  });
  const CkErc20Token = IDL.Record({
    erc20_contract_address: IDL.Text,
    ledger_canister_id: IDL.Principal,
  });
  const WithdrawErc20Error = IDL.Variant({
    TokenNotSupported: IDL.Record({ supported_tokens: IDL.Vec(CkErc20Token) }),
    RecipientAddressBlocked: IDL.Record({ address: IDL.Text }),
    CkEthLedgerError: IDL.Record({ error: LedgerError }),
    CkErc20LedgerError: IDL.Record({ cketh_block_index: IDL.Nat, error: LedgerError }),
    TemporarilyUnavailable: IDL.Text,
  });
  const Eip1559TransactionPriceArg = IDL.Record({
    ckerc20_ledger_id: IDL.Principal,
  });
  const Eip1559TransactionPrice = IDL.Record({
    gas_limit: IDL.Nat,
    max_fee_per_gas: IDL.Nat,
    max_priority_fee_per_gas: IDL.Nat,
    max_transaction_fee: IDL.Nat,
    timestamp: IDL.Opt(IDL.Nat64),
  });
  return IDL.Service({
    withdraw_erc20: IDL.Func(
      [WithdrawErc20Arg],
      [IDL.Variant({ Ok: RetrieveErc20Request, Err: WithdrawErc20Error })],
      []
    ),
    eip_1559_transaction_price: IDL.Func(
      [IDL.Opt(Eip1559TransactionPriceArg)],
      [Eip1559TransactionPrice],
      ['query']
    ),
  });
};

const EasySwapWallet = ({ prefilledAmount = null, onConversionComplete = null, showCompact = false }) => {
  const { t } = useTranslation(['wallet', 'common']);
  const { genericUseSeed, icIdentity, rootPrincipal, initiatorAddress, getBalance, requestCkUSDCPayment, onCommand, offCommand, sendCommand, actor, transferCkUSDC } = useSDK();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  // EOA state
  const [eoaAddress, setEoaAddress] = useState('');
  const [ethUSDCBalance, setEthUSDCBalance] = useState('0');
  const [ethETHBalance, setEthETHBalance] = useState('0');
  
  // ICP state
  const [ckusdcBalance, setCkusdcBalance] = useState('0');
  const [principalBytes32, setPrincipalBytes32] = useState('');
  const [minterActor, setMinterActor] = useState(null);
  const [httpAgent, setHttpAgent] = useState(null);
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('swap');
  const [swapDirection, setSwapDirection] = useState('eth-to-icp'); // 'eth-to-icp', 'icp-to-eth', or 'ckusdc-to-bsv'
  
  // Swap amounts
  const [swapAmount, setSwapAmount] = useState(prefilledAmount || '');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  
  // Send amounts
  const [sendAmount, setSendAmount] = useState('');
  const [sendAddress, setSendAddress] = useState('');
  const [sendDestination, setSendDestination] = useState('eth-usdc'); // 'eth-usdc', 'eth-native', or 'metanet'
  
  // Receive amounts
  const [receiveAmount, setReceiveAmount] = useState('');
  
  // Withdrawal fee estimation
  const [withdrawalFee, setWithdrawalFee] = useState(null);
  const [fetchingFee, setFetchingFee] = useState(false);
  
  // State for status messages
  const [withdrawStatus, setWithdrawStatus] = useState({ type: null, message: '' });
  const [swapStatus, setSwapStatus] = useState({ type: null, message: '' });
  const [sendStatus, setSendStatus] = useState({ type: null, message: '' });
  const [receiveStatus, setReceiveStatus] = useState({ type: null, message: '' });
  
  const [processing, setProcessing] = useState(false);

  // Initialize EOA on load
  useEffect(() => {
    if (!genericUseSeed || !icIdentity) return;

    const initializeAccount = async () => {
      try {
        // Convert principal to bytes32 using IC encoding format
        const principal = icIdentity.getPrincipal();
        const principalBytes = principal.toUint8Array();
        
        // IC encoding: [length][principal_bytes][zero_padding]
        const fixedBytes = new Uint8Array(32);
        fixedBytes[0] = principalBytes.length;  // First byte = length
        fixedBytes.set(principalBytes, 1);  // Copy principal starting at index 1
        
        const bytes32 = '0x' + Array.from(fixedBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        setPrincipalBytes32(bytes32);
        
        console.log('EasySwapWallet - Principal:', principal.toText());
        console.log('EasySwapWallet - Bytes32:', bytes32);

        // Get EOA address from genericUseSeed
        const address = getEOAAddress(genericUseSeed);
        setEoaAddress(address);
        setWithdrawAddress(address); // Prefill withdraw address
        console.log('✨ EOA Address:', address);

        // Create HTTP Agent for minter with authenticated identity
        const agent = new HttpAgent({ 
          host: 'https://ic0.app',
          identity: icIdentity  // Use authenticated identity
        });
        if (process.env.NODE_ENV !== 'production') {
          await agent.fetchRootKey();
        }
        setHttpAgent(agent);

        // Create minter actor
        const actor = Actor.createActor(minterIdl, {
          agent,
          canisterId: CK_USDC_MINTER,
        });
        setMinterActor(actor);
        console.log('✨ Minter actor created with identity:', principal.toText());

        // Fetch withdrawal fee estimation
        fetchWithdrawalFee(actor);

        // Fetch balances
        const usdcBal = await getUSDCBalance(address, 'https://ethereum.publicnode.com');
        setEthUSDCBalance(usdcBal);

        const ethBal = await getETHBalance(address, 'https://ethereum.publicnode.com');
        setEthETHBalance(ethBal);
      } catch (error) {
        console.error('Error initializing EOA:', error);
      }
    };

    initializeAccount();
  }, [genericUseSeed, icIdentity]);

  // Clear status messages when swap direction or amount changes
  useEffect(() => {
    setWithdrawStatus({ type: null, message: '' });
    setSwapStatus({ type: null, message: '' });
  }, [swapDirection, swapAmount]);

  // Clear send status when switching destination
  useEffect(() => {
    setSendStatus({ type: null, message: '' });
  }, [sendDestination, sendAmount]);

  // Clear receive status when amount changes
  useEffect(() => {
    setReceiveStatus({ type: null, message: '' });
  }, [receiveAmount]);

  // Fetch withdrawal fee estimation from minter
  const fetchWithdrawalFee = async (actor) => {
    if (!actor) return;
    
    setFetchingFee(true);
    try {
      // Call eip_1559_transaction_price with ckUSDC ledger ID
      const priceResult = await actor.eip_1559_transaction_price([{
        ckerc20_ledger_id: Principal.fromText(CK_USDC_LEDGER)
      }]);
      
      console.log('Withdrawal fee estimation:', priceResult);
      
      if (priceResult) {
        // max_transaction_fee is in Wei, convert to USD (approximate)
        // Assuming 1 ETH = $2500 for estimation (you can fetch real price if needed)
        const feeInWei = Number(priceResult.max_transaction_fee);
        const feeInEth = feeInWei / 1e18;
        const feeInUsd = feeInEth * 2500; // Rough estimate
        
        setWithdrawalFee({
          wei: feeInWei,
          eth: feeInEth,
          usd: feeInUsd,
          gasLimit: Number(priceResult.gas_limit),
          maxFeePerGas: Number(priceResult.max_fee_per_gas),
          timestamp: priceResult.timestamp ? Number(priceResult.timestamp[0]) : null
        });
      }
    } catch (error) {
      console.error('Error fetching withdrawal fee:', error);
    } finally {
      setFetchingFee(false);
    }
  };

  const fetchBalances = async () => {
    if (!eoaAddress) return;

    setLoading(true);
    try {
      // Fetch ETH USDC balance
      const usdcBal = await getUSDCBalance(eoaAddress, 'https://ethereum.publicnode.com');
      setEthUSDCBalance(usdcBal);

      // Fetch ETH balance
      const ethBal = await getETHBalance(eoaAddress, 'https://ethereum.publicnode.com');
      setEthETHBalance(ethBal);

      // Fetch ckUSDC balance (icpUSDC)
      if (getBalance && icIdentity) {
        try {
          console.log('Fetching ckUSDC balance for principal:', icIdentity.getPrincipal().toText());
          const ckBal = await getBalance();
          console.log('ckUSDC balance fetched:', ckBal);
          setCkusdcBalance(ckBal || '0');
        } catch (err) {
          console.error('Error fetching ckUSDC balance:', err);
          setCkusdcBalance('0');
        }
      } else {
        console.warn('Cannot fetch ckUSDC balance - SDK or identity not ready', {
          hasGetBalance: !!getBalance,
          hasIdentity: !!icIdentity
        });
      }
    } catch (error) {
      console.error('Error fetching balances:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (eoaAddress && getBalance && icIdentity) {
      fetchBalances();
      
      const balanceInterval = setInterval(fetchBalances, 30000);
      return () => clearInterval(balanceInterval);
    }
  }, [eoaAddress, getBalance, icIdentity]);

  useEffect(() => {
    if (prefilledAmount) {
      setSwapAmount(prefilledAmount);
    }
  }, [prefilledAmount]);

  const handleSwapToICP = async () => {
    if (!genericUseSeed || !principalBytes32) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.principalNotReady') });
      return;
    }

    const amount = parseFloat(swapAmount);
    
    if (!amount || amount <= 0) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.invalidAmount') });
      return;
    }

    if (amount < MIN_AMOUNT) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.minimumAmount', { min: MIN_AMOUNT }) });
      return;
    }

    if (amount > parseFloat(ethUSDCBalance)) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.insufficientBalance', { available: parseFloat(ethUSDCBalance).toFixed(2) }) });
      return;
    }

    setProcessing(true);
    try {
      setSwapStatus({ type: 'loading', message: 'Converting USDC to ckUSDC...' });
      
      const result = await depositToHelper(
        genericUseSeed,
        amount,
        principalBytes32,
        'https://ethereum.publicnode.com'
      );

      setSwapStatus({
        type: 'success',
        message: `Conversion complete!\nTx: ${result.depositHash.slice(0, 10)}...\nckUSDC will appear in ~20 minutes.`
      });

      setSwapAmount('');
      setTimeout(fetchBalances, 5000);

      if (onConversionComplete) {
        onConversionComplete(amount);
      }
    } catch (error) {
      console.error('Error swapping to ckUSDC:', error);
      setSwapStatus({ type: 'error', message: error.message || 'Failed to swap' });
    } finally {
      setProcessing(false);
    }
  };

  // Handler for ICP → ETH withdrawal
  const handleWithdrawToEth = async () => {
    if (!actor || !httpAgent || !icIdentity) {
      setWithdrawStatus({ type: 'error', message: t('wallet:errors.backendNotReady') });
      return;
    }

    const amount = parseFloat(swapAmount);
    
    if (!amount || amount <= 0) {
      setWithdrawStatus({ type: 'error', message: t('wallet:errors.invalidAmount') });
      return;
    }

    if (amount < MIN_AMOUNT) {
      setWithdrawStatus({ type: 'error', message: t('wallet:errors.minimumAmount', { min: MIN_AMOUNT }) });
      return;
    }

    if (amount > parseFloat(ckusdcBalance)) {
      setWithdrawStatus({ type: 'error', message: t('wallet:errors.insufficientCkUSDC') });
      return;
    }

    if (!withdrawAddress || !withdrawAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setWithdrawStatus({ type: 'error', message: t('wallet:errors.invalidEthereumAddress') });
      return;
    }

    setProcessing(true);
    try {
      // Convert amounts to proper units
      const withdrawalAmountE6 = BigInt(Math.floor(amount * 1_000_000)); // ckUSDC amount (6 decimals)
      
      // Step 1: Get dynamic gas fee from minter + XRC oracle
      setWithdrawStatus({ type: 'loading', message: 'Calculating gas fee...' });
      
      let gasFeeUsdcE6;
      let gasEstimateEth;
      let ethPriceUsd;
      let gasAmountWei;
      
      try {
        // Get gas cost in Wei from minter
        const priceResult = await minterActor.eip_1559_transaction_price([{
          ckerc20_ledger_id: Principal.fromText(CK_USDC_LEDGER)
        }]);
        
        const gasCostWei = Number(priceResult.max_transaction_fee);
        gasAmountWei = BigInt(gasCostWei);
        gasEstimateEth = gasCostWei / 1e18;
        
        // Get current ETH/USD price from backend (which uses XRC oracle)
        const ethPriceResult = await actor.get_eth_usd_price();
        
        if ('Ok' in ethPriceResult) {
          ethPriceUsd = ethPriceResult.Ok;
          console.log(`ETH price from XRC: $${ethPriceUsd}`);
        } else {
          console.warn('Failed to get ETH price from XRC, using fallback $4100');
          ethPriceUsd = 4100; // Fallback (conservative estimate)
        }
        
        // Calculate gas cost in USD
        const gasCostUsd = gasEstimateEth * ethPriceUsd;
        
        // Add 15% buffer for price volatility
        const gasCostWithBuffer = gasCostUsd * 1.15;
        
        gasFeeUsdcE6 = BigInt(Math.ceil(gasCostWithBuffer * 1_000_000));
        
        console.log(`Gas estimate: ${gasEstimateEth} ETH × $${ethPriceUsd} = $${gasCostUsd.toFixed(2)} + 15% buffer = $${gasCostWithBuffer.toFixed(2)}`);
        console.log(`Gas amount in wei: ${gasAmountWei.toString()}`);
      } catch (error) {
        console.error('Failed to get gas estimate, using fallback:', error);
        // Fallback: 0.0002 ETH * $4100 = $0.82 + 15% = $0.943
        gasAmountWei = BigInt(200_000_000_000_000);
        gasFeeUsdcE6 = BigInt(943_000); 
        gasEstimateEth = 0.0002;
        ethPriceUsd = 4100;
      }
      
      const totalAmountE6 = withdrawalAmountE6 + gasFeeUsdcE6;
      const gasFeeUsd = Number(gasFeeUsdcE6) / 1_000_000;
      
      // Treasury fee: 20% of gas fee, minimum $0.05 (covers XRC oracle calls and operational costs)
      const minTreasuryFeeE6 = BigInt(50_000); // $0.05 minimum
      const percentageFeeE6 = gasFeeUsdcE6 * BigInt(20) / BigInt(100); // 20% of gas
      const treasuryFeeE6 = percentageFeeE6 > minTreasuryFeeE6 ? percentageFeeE6 : minTreasuryFeeE6;
      const treasuryFeeUsd = Number(treasuryFeeE6) / 1_000_000;
      
      // Total approval needed (including ICRC-2 transfer_from fee of 0.01 USDC)
      const transferFeeE6 = BigInt(10_000); // 0.01 USDC standard ICRC-2 fee
      const totalWithFeesE6 = totalAmountE6 + treasuryFeeE6 + transferFeeE6;
      const totalUsd = amount + gasFeeUsd + treasuryFeeUsd + 0.01;
      
      console.log(`Approval breakdown:
        Withdrawal: ${withdrawalAmountE6} ($${amount})
        Gas fee: ${gasFeeUsdcE6} ($${gasFeeUsd.toFixed(2)})
        Treasury fee: ${treasuryFeeE6} ($${treasuryFeeUsd.toFixed(2)})
        Transfer fee: ${transferFeeE6} ($0.01)
        Total approving: ${totalWithFeesE6} ($${totalUsd.toFixed(2)})`);
      
      // Step 2: Approve backend canister to spend ckUSDC (withdrawal + gas fee + treasury fee + transfer fee)
      // Approval expires in 5 minutes for security
      setWithdrawStatus({ 
        type: 'loading', 
        message: `Step 1/2: Approving $${totalUsd.toFixed(2)} ckUSDC (${amount} + $${gasFeeUsd.toFixed(2)} gas + $${treasuryFeeUsd.toFixed(2)} treasury + $0.01 fee)...` 
      });
      
      const ledgerActor = Actor.createActor(ledgerIdlFactory, {
        agent: httpAgent,
        canisterId: CK_USDC_LEDGER
      });
      
      // Get backend canister ID from imported canisterId
      const backendCanisterPrincipal = Principal.fromText(backendCanisterId);
      
      // Set approval to expire in 5 minutes (300 seconds)
      const expirationNs = BigInt(Date.now() * 1_000_000 + 300_000_000_000); // 5 min from now in nanoseconds
      
      const approvalResult = await ledgerActor.icrc2_approve({
        spender: {
          owner: backendCanisterPrincipal,
          subaccount: []
        },
        amount: totalWithFeesE6,
        fee: [],
        memo: [],
        from_subaccount: [],
        created_at_time: [],
        expected_allowance: [],
        expires_at: [expirationNs], // Approval expires in 5 minutes
      });
      
      if ('Err' in approvalResult) {
        const errorKey = Object.keys(approvalResult.Err)[0];
        throw new Error(`Approval failed: ${errorKey}`);
      }
      
      console.log('ckUSDC approval successful, block:', approvalResult.Ok);
      console.log(`Approval expires at: ${new Date(Number(expirationNs) / 1_000_000).toISOString()}`);
      
      // Step 3: Call backend's withdraw_ckusdc_to_eth (must happen within 5 minutes)
      setWithdrawStatus({ type: 'loading', message: 'Step 2/2: Initiating withdrawal (canister pays gas with ckETH)...' });
      
      const result = await actor.withdraw_ckusdc_to_eth(
        withdrawalAmountE6,
        gasFeeUsdcE6,
        treasuryFeeE6,
        gasAmountWei,
        withdrawAddress
      );
      
      console.log('Withdrawal result:', result);
      
      if ('Ok' in result) {
        setWithdrawStatus({
          type: 'success',
          message: `Withdrawal initiated!\nckETH burn: ${result.Ok.cketh_block_index}\nckUSDC burn: ${result.Ok.ckerc20_block_index}\nethUSDC will arrive on Ethereum in ~20-30 minutes.\n\nYou paid: $${amount} USDC + $${gasFeeUsd.toFixed(2)} gas (${gasEstimateEth} ETH) + $${treasuryFeeUsd.toFixed(2)} treasury fee`
        });
        setSwapAmount('');
        setTimeout(fetchBalances, 5000);
      } else {
        const errorMsg = result.Err || 'Unknown error';
        setWithdrawStatus({ type: 'error', message: `Withdrawal failed: ${errorMsg}` });
      }
    } catch (error) {
      console.error('Error withdrawing to ETH:', error);
      setWithdrawStatus({ type: 'error', message: error.message || 'Failed to withdraw' });
    } finally {
      setProcessing(false);
    }
  };

  // Helper to format withdrawal errors (no longer needed with backend handling)
  const getWithdrawErrorMessage = (error) => {
    if (error.TokenNotSupported) {
      return 'Token not supported by minter';
    }
    if (error.RecipientAddressBlocked) {
      return `Recipient address blocked: ${error.RecipientAddressBlocked.address}`;
    }
    if (error.CkEthLedgerError) {
      const errorObj = error.CkEthLedgerError.error;
      const errorType = Object.keys(errorObj)[0];
      const errorData = errorObj[errorType];
      
      // Handle BigInt values by converting to string
      if (errorType === 'InsufficientAllowance') {
        return `Insufficient ckETH allowance. Please ensure you have ckETH for gas fees.`;
      }
      
      return `ckETH ledger error: ${errorType}`;
    }
    if (error.CkErc20LedgerError) {
      return `ckERC20 ledger error (ckETH reimbursed at block ${error.CkErc20LedgerError.cketh_block_index})`;
    }
    if (error.TemporarilyUnavailable) {
      return `Service temporarily unavailable: ${error.TemporarilyUnavailable}`;
    }
    return JSON.stringify(error);
  };

  // Format ICRC-1 transfer error to human-readable message
  const formatTransferError = (error) => {
    const errorKey = Object.keys(error)[0];
    const errorValue = error[errorKey];
    
    switch(errorKey) {
      case 'InsufficientFunds':
        const balanceE6 = errorValue?.balance ? Number(errorValue.balance) : 0;
        const balanceUsd = (balanceE6 / 1_000_000).toFixed(6);
        return `Insufficient funds. Your balance: $${balanceUsd} ckUSDC`;
      case 'BadFee':
        const expectedFeeE6 = errorValue?.expected_fee ? Number(errorValue.expected_fee) : 0;
        const expectedFeeUsd = (expectedFeeE6 / 1_000_000).toFixed(6);
        return `Bad fee. Expected fee: $${expectedFeeUsd}`;
      case 'TooOld':
        return 'Transaction too old';
      case 'CreatedInFuture':
        return 'Transaction created in future';
      case 'Duplicate':
        return 'Duplicate transaction';
      case 'TemporarilyUnavailable':
        return 'Service temporarily unavailable';
      case 'GenericError':
        return errorValue?.message || 'Unknown error';
      case 'BadBurn':
        return `Invalid burn amount. Minimum: ${errorValue?.min_burn_amount || 'unknown'}`;
      default:
        return `Transfer error: ${errorKey}`;
    }
  };

  // Handler for sending icpUSDC to Metanet (using ICRC1 transfer from EasySwap balance)
  const handleTransferToMetanet = async () => {
    if (!rootPrincipal || !httpAgent || !icIdentity) {
      setSendStatus({ type: 'error', message: 'Metanet principal not available or agent not ready' });
      return;
    }

    const amount = parseFloat(sendAmount);
    if (!amount || amount <= 0) {
      setSendStatus({ type: 'error', message: 'Please enter a valid amount' });
      return;
    }

    // ckUSDC transfer fee is 0.01 USD (10,000 e6)
    const transferFeeUsd = 0.01;
    const currentBalance = parseFloat(ckusdcBalance);
    
    if (amount > currentBalance) {
      setSendStatus({ type: 'error', message: `Insufficient ckUSDC balance. You have $${currentBalance.toFixed(6)}, trying to send $${amount.toFixed(6)}` });
      return;
    }

    // Check if balance can cover amount + fee
    if (amount + transferFeeUsd > currentBalance) {
      setSendStatus({ 
        type: 'error', 
        message: `Insufficient balance to cover transfer fee. Need $${(amount + transferFeeUsd).toFixed(6)} (amount + $${transferFeeUsd.toFixed(2)} fee), have $${currentBalance.toFixed(6)}` 
      });
      return;
    }

    setProcessing(true);
    
    try {
      setSendStatus({ type: 'loading', message: 'Sending ckUSDC to Metanet Balance...' });
      
      // Create ledger actor with user's authenticated identity (uses caller's balance)
      const ledgerActor = Actor.createActor(ledgerIdlFactory, {
        agent: httpAgent,
        canisterId: CK_USDC_LEDGER
      });

      // Convert amount to e6 units (ckUSDC has 6 decimals)
      const amountE6 = BigInt(Math.floor(amount * 1_000_000));
      
      // Transfer to root principal (Metanet balance)
      // This uses the caller's (icIdentity) default subaccount
      const result = await ledgerActor.icrc1_transfer({
        to: { 
          owner: Principal.fromText(rootPrincipal), 
          subaccount: [] 
        },
        amount: amountE6,
        fee: [], // Use default fee
        memo: [], // No memo
        from_subaccount: [], // From caller's default subaccount
        created_at_time: []
      });

      if ('Ok' in result) {
        const blockIndex = result.Ok.toString();
        setSendStatus({ 
          type: 'success', 
          message: `Successfully sent ${amount} ckUSDC to Metanet Balance!\nBlock: ${blockIndex}` 
        });
        setSendAmount('');
        setTimeout(fetchBalances, 3000);
      } else {
        const errorMessage = formatTransferError(result.Err);
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error transferring to Metanet:', error);
      setSendStatus({ type: 'error', message: 'Failed to transfer: ' + (error.message || 'Unknown error') });
    } finally {
      setProcessing(false);
    }
  };

  // Handler for depositing from Metanet to icpUSDC (uses sendCommand - this is correct)
  const handleDepositFromMetanet = async () => {
    if (!requestCkUSDCPayment || !icIdentity) {
      setReceiveStatus({ type: 'error', message: 'SDK not ready' });
      return;
    }

    const amount = parseFloat(receiveAmount);
    if (!amount || amount <= 0) {
      setReceiveStatus({ type: 'error', message: 'Please enter a valid amount' });
      return;
    }

    setProcessing(true);
    const paymentRef = `deposit_from_metanet_${Date.now()}`;
    
    try {
      setReceiveStatus({ type: 'loading', message: 'Requesting ckUSDC from Metanet Balance...' });
      
      // Listen for pay-response command from Metanet
      const paymentPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          offCommand(paymentListener);
          reject(new Error('Payment timeout - no response received'));
        }, 120000); // 2 minute timeout

        const paymentListener = (data) => {
          console.log('🔔 Payment listener received:', data);
          
          // Check if this is a pay-response type
          if (data.type === 'pay-response' && data.payload) {
            const { ref, success, transferOutcome, responseCode, message, timestamp } = data.payload;
            
            console.log('📦 Pay-response payload:', data.payload);
            
            // Check if this is our payment response (by ref match)
            if (ref === paymentRef) {
              clearTimeout(timeout);
              offCommand(paymentListener);
              
              // ICP Payment Success
              if (success === true && responseCode === 'OK_SUCCESS') {
                console.log('✅ Payment successful:', { transferOutcome, timestamp });
                resolve({
                  transferOutcome,
                  responseCode,
                  timestamp
                });
              } 
              // ICP Payment Failure
              else {
                console.error('❌ Payment failed:', { message, responseCode, timestamp });
                reject(new Error(message || `Payment failed with code: ${responseCode}`));
              }
            }
          }
        };

        onCommand(paymentListener);

        // Request payment FROM Metanet balance TO user's IC principal
        const userPrincipal = icIdentity.getPrincipal().toText();
        requestCkUSDCPayment(amount, userPrincipal, "Deposit from Metanet to EasySwap", paymentRef);
      });

      const result = await paymentPromise;
      setReceiveStatus({ 
        type: 'success', 
        message: `Successfully received ${amount} ckUSDC from Metanet Balance!\nTransaction: ${result.transferOutcome}\nTime: ${new Date(result.timestamp).toLocaleString()}` 
      });
      setReceiveAmount('');
      setTimeout(fetchBalances, 3000);
    } catch (error) {
      console.error('Error depositing from Metanet:', error);
      setReceiveStatus({ type: 'error', message: 'Failed to deposit: ' + (error.message || 'Unknown error') });
    } finally {
      setProcessing(false);
    }
  };

  // Handler for ckUSDC to BSV (creates order, deposits, and activates seamlessly)
  const handleSwapToBSV = async () => {
    if (!actor || !icIdentity || !httpAgent || !initiatorAddress) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.connectWalletFirst') });
      return;
    }

    const amount = parseFloat(swapAmount);
    
    if (!amount || amount <= 0) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.invalidAmount') });
      return;
    }
    
    if (amount < MIN_CHUNK_SIZE_USD) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.minimumAmount', { min: MIN_CHUNK_SIZE_USD }) });
      return;
    }
    
    if (amount > MAX_ORDER_SIZE_USD) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.maximumAmount', { max: MAX_ORDER_SIZE_USD, chunks: MAX_CHUNKS_ALLOWED }) });
      return;
    }
    
    if (amount % MIN_CHUNK_SIZE_USD !== 0) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.amountMultiple', { multiple: MIN_CHUNK_SIZE_USD }) });
      return;
    }

    if (amount > parseFloat(ckusdcBalance)) {
      setSwapStatus({ type: 'error', message: t('wallet:errors.insufficientCkUSDC') });
      return;
    }

    setProcessing(true);
    
    try {
      // Step 1: Get current BSV price
      setSwapStatus({ type: 'loading', message: 'Fetching current BSV price...' });
      const priceResult = await actor.get_bsv_price();
      
      if (!('Ok' in priceResult)) {
        throw new Error('Failed to fetch BSV price');
      }
      
      const currentPrice = Number(priceResult.Ok);
      const bufferMultiplier = 1 + (BSV_PRICE_BUFFER_PERCENT / 100);
      const maxPrice = currentPrice * bufferMultiplier;
      
      // Step 2: Calculate total amount needed and transfer to canister user subaccount
      // Need 2x transfer fees: one for wallet→canister, one for canister internal transfer
      const makerFee = amount * (MAKER_FEE_PERCENT / 100);
      const transferFees = 0.01 * 2; // 2x CKUSDC_TRANSFER_FEE_USD
      const totalRequired = amount + makerFee + transferFees;
      
      console.log('Swap to BSV:', {
        orderAmount: amount,
        makerFee: makerFee,
        transferFees: transferFees,
        totalRequired: totalRequired,
        currentBalance: ckusdcBalance
      });
      
      // Check balance one more time
      if (totalRequired > parseFloat(ckusdcBalance)) {
        throw new Error(`Insufficient balance. Need ${totalRequired.toFixed(6)} ckUSDC (${amount.toFixed(6)} for order + ${makerFee.toFixed(6)} maker fee + ${transferFees.toFixed(2)} transfer fees)`);
      }
      
      // Transfer to canister user subaccount
      setSwapStatus({ type: 'loading', message: 'Transferring ckUSDC to canister...' });
      const blockIndex = await transferCkUSDC(totalRequired);
      console.log('Transfer successful, block index:', blockIndex);
      
      // Step 3: Create order (backend will pull from user subaccount and activate)
      setSwapStatus({ type: 'loading', message: 'Creating your order...' });
      const createResult = await actor.create_order(
        amount,
        maxPrice,
        initiatorAddress // BSV address from Metanet wallet
      );
      
      if (!('Ok' in createResult)) {
        // Order creation failed after transfer
        // Funds are safe in user's canister subaccount
        throw new Error(
          `Order creation failed: ${createResult.Err}\n\n` +
          `Your ${totalRequired.toFixed(6)} ckUSDC has been transferred to your canister account and is safe. ` +
          `You can see it in the Trader page balance.`
        );
      }
      
      const orderId = createResult.Ok;
      console.log('Order created and activated:', orderId);
      
      // Success!
      setSwapStatus({
        type: 'success',
        message: `🎉 Order #${orderId.toString()} placed successfully!\n\nYour BSV will arrive at ${initiatorAddress} once a trader fills your order.\n\nRedirecting to order details...`
      });
      
      setSwapAmount('');
      setTimeout(fetchBalances, 1000);
      
      // Navigate to order details page after 3 seconds
      setTimeout(() => {
        navigate(`/order/${orderId}`);
      }, 3000);
      
    } catch (error) {
      console.error('Error swapping to BSV:', error);
      
      // Determine error type and show appropriate message
      const errorMessage = error.message || error.toString();
      if (errorMessage.includes('Transfer failed') || errorMessage.includes('Insufficient')) {
        // Transfer failed - funds still in user's wallet
        setSwapStatus({ type: 'error', message: 'Transfer failed: ' + errorMessage });
      } else {
        // Other error (could be after successful transfer)
        setSwapStatus({ type: 'error', message: errorMessage });
      }
    } finally {
      setProcessing(false);
    }
  };

  // Handler for sending ETH USDC
  const handleSendUSDC = async () => {
    if (!genericUseSeed) {
      setSendStatus({ type: 'error', message: t('wallet:errors.walletNotInitialized') });
      return;
    }

    const amount = parseFloat(sendAmount);
    if (!amount || amount < MIN_AMOUNT) {
      setSendStatus({ type: 'error', message: t('wallet:errors.minimumAmount', { min: MIN_AMOUNT }) });
      return;
    }

    if (amount > parseFloat(ethUSDCBalance)) {
      setSendStatus({ type: 'error', message: t('wallet:errors.insufficientBalance', { available: parseFloat(ethUSDCBalance).toFixed(2) }) });
      return;
    }

    if (!sendAddress || !sendAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setSendStatus({ type: 'error', message: t('wallet:errors.invalidEthereumAddress') });
      return;
    }

    setProcessing(true);
    try {
      setSendStatus({ type: 'loading', message: 'Sending USDC...' });
      const result = await transferUSDC(
        genericUseSeed,
        sendAddress,
        amount,
        'https://ethereum.publicnode.com'
      );
      setSendStatus({
        type: 'success',
        message: `Sent ${amount} USDC!\nTx: ${result.hash.slice(0, 10)}...`
      });
      setSendAmount('');
      setSendAddress('');
      fetchBalances();
    } catch (error) {
      console.error('Error sending USDC:', error);
      setSendStatus({ type: 'error', message: 'Failed to send: ' + (error.message || 'Unknown error') });
    } finally {
      setProcessing(false);
    }
  };

  const handleSendETH = async () => {
    if (!genericUseSeed) {
      setSendStatus({ type: 'error', message: t('wallet:errors.walletNotInitialized') });
      return;
    }

    const amount = parseFloat(sendAmount);
    if (!amount || amount <= 0) {
      setSendStatus({ type: 'error', message: 'Please enter a valid amount' });
      return;
    }

    if (amount > parseFloat(ethETHBalance)) {
      setSendStatus({ type: 'error', message: `Insufficient ETH balance. Available: ${parseFloat(ethETHBalance).toFixed(6)} ETH` });
      return;
    }

    if (!sendAddress || !sendAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setSendStatus({ type: 'error', message: t('wallet:errors.invalidEthereumAddress') });
      return;
    }

    setProcessing(true);
    try {
      setSendStatus({ type: 'loading', message: 'Sending ETH...' });
      const result = await transferETH(
        genericUseSeed,
        sendAddress,
        amount,
        'https://ethereum.publicnode.com'
      );
      setSendStatus({
        type: 'success',
        message: `Sent ${amount} ETH!\nTx: ${result.hash.slice(0, 10)}...`
      });
      setSendAmount('');
      setSendAddress('');
      fetchBalances();
    } catch (error) {
      console.error('Error sending ETH:', error);
      setSendStatus({ type: 'error', message: 'Failed to send: ' + (error.message || 'Unknown error') });
    } finally {
      setProcessing(false);
    }
  };

  const copyToClipboard = (text, label) => {
    sendCommand({
      type: "write-clipboard",
      text: text
    });
    toast.success(t('wallet:messages.copied', { label }));
  };
   const openLink = (url, label) => {
    sendCommand({
      type: "open-link",
      text: url
    });
    toast.success(`${label} copied to clipboard`);
  };

  if (!genericUseSeed) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <p className="text-red-300 text-sm">{t('wallet:connectFirst')}</p>
      </div>
    );
  }

  if (showCompact) {
    return (
      <div className={`rounded-lg p-3 transition-colors duration-300 ${
        theme === 'dark' 
          ? 'bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30' 
          : 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 shadow-sm'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wallet size={16} className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} />
            <h4 className={`text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>{t('wallet:title')}</h4>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={fetchBalances} 
              disabled={loading} 
              className={`p-1 ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>
            <Link to="/wallet">
              <Button 
                variant="ghost" 
                size="sm" 
                className={`text-sm p-1 ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
              >
                <span>{t('wallet:openWallet')}</span>
                <ExternalLink size={14} />
              </Button>
            </Link>
          </div>
        </div>

        <div className="space-y-2">
          {/* Ethereum Network */}
          <div className={`rounded-lg p-2 border transition-colors duration-300 ${
            theme === 'dark' 
              ? 'bg-black/20 border-purple-500/30' 
              : 'bg-white/80 border-purple-200 shadow-sm'
          }`}>
            <div className="flex items-center gap-1 mb-1">
              <img src="/ethereum.svg" alt="Ethereum" className="w-3 h-3" />
              <p className={`text-[10px] font-medium ${theme === 'dark' ? 'text-purple-400' : 'text-purple-700'}`}>{t('wallet:networks.ethereum')}</p>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <div>
                <p className={`text-[9px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('wallet:balances.usdc')}</p>
                <p className={`font-semibold text-xs ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{parseFloat(ethUSDCBalance).toFixed(6)}</p>
              </div>
              <div>
                <p className={`text-[9px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('wallet:balances.ethGas')}</p>
                <p className={`font-semibold text-xs ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{parseFloat(ethETHBalance).toFixed(4)}</p>
              </div>
            </div>
          </div>

          {/* ICP Network */}
          <div className={`rounded-lg p-2 border transition-colors duration-300 ${
            theme === 'dark' 
              ? 'bg-black/20 border-blue-500/30' 
              : 'bg-white/80 border-blue-200 shadow-sm'
          }`}>
            <div className="flex items-center gap-1 mb-1">
              <img src="/icp.png" alt="ICP" className="w-3 h-3" />
              <p className={`text-[10px] font-medium ${theme === 'dark' ? 'text-blue-400' : 'text-blue-700'}`}>{t('wallet:networks.icp')}</p>
            </div>
            <div>
              <p className={`text-[9px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('wallet:balances.ckUSDC')}</p>
              <p className={`font-semibold text-xs ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{parseFloat(ckusdcBalance).toFixed(6)}</p>
            </div>
          </div>
        </div>

        {/* Information Notice */}
        <div className={`mt-2 rounded-lg p-2 border transition-colors duration-300 ${
          theme === 'dark' 
            ? 'bg-blue-500/10 border-blue-500/30' 
            : 'bg-blue-50 border-blue-200'
        }`}>
          <p className={`text-[9px] leading-relaxed ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            {t('wallet:info.compact')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 sm:space-y-4 transition-colors duration-300`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet size={18} className={`sm:w-5 sm:h-5 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />
          <h3 className={`font-semibold text-sm sm:text-base ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>{t('wallet:title')}</h3>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={fetchBalances} 
          disabled={loading} 
          className={theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      

      {/* Network Balances */}
      <div className="space-y-3">
        {/* Ethereum Network */}
        <div className={`rounded-lg p-3 border transition-colors duration-300 ${
          theme === 'dark' 
            ? 'bg-black/20 border-purple-500/30' 
            : 'bg-white/80 border-purple-200 shadow-sm'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <img src="/ethereum.svg" alt="Ethereum" className="w-4 h-4" />
            <h4 className={`font-semibold text-xs ${theme === 'dark' ? 'text-purple-400' : 'text-purple-700'}`}>{t('wallet:networks.ethereum')}</h4>
          </div>
          {eoaAddress && (
          <div className="space-y-2 mb-1">
            <div className={`rounded-lg p-2 sm:p-3 border transition-colors duration-300 ${
              theme === 'dark' 
                ? 'bg-black/20 border-green-500/30' 
                : 'bg-green-50/80 border-green-200'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <Wallet size={12} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                <p className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-700'}`}>{t('wallet:balances.yourEthereumAddress')}</p>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
              <code className={`font-mono text-[10px] sm:text-xs flex-1 truncate ${theme === 'dark' ? 'text-green-400' : 'text-gray-800'}`}>{eoaAddress}</code>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => copyToClipboard(eoaAddress, 'Wallet')} 
                className={`p-1 ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
              >
                <Copy size={12} />
              </Button>
              </div>
            </div>
          </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded p-2 border transition-colors duration-300 ${
              theme === 'dark' 
                ? 'bg-black/30 border-purple-500/20' 
                : 'bg-white/60 border-gray-200'
            }`}>
              <p className={`text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('wallet:balances.usdc')}</p>
              <p className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{parseFloat(ethUSDCBalance).toFixed(6)}</p>
            </div>
            <div className={`rounded p-2 border transition-colors duration-300 ${
              theme === 'dark' 
                ? 'bg-black/30 border-purple-500/20' 
                : 'bg-white/60 border-gray-200'
            }`}>
              <p className={`text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('wallet:balances.ethGas')}</p>
              <p className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{parseFloat(ethETHBalance).toFixed(4)}</p>
            </div>
          </div>
        </div>

        {/* Internet Computer Protocol */}
        <div className={`rounded-lg p-3 border transition-colors duration-300 ${
          theme === 'dark' 
            ? 'bg-black/20 border-blue-500/30' 
            : 'bg-white/80 border-blue-200 shadow-sm'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <img src="/icp.png" alt="ICP" className="w-4 h-4" />
            <h4 className={`font-semibold text-xs ${theme === 'dark' ? 'text-blue-400' : 'text-blue-700'}`}>{t('wallet:networks.icp')}</h4>
          </div>
          <div className="space-y-2 mb-1">
            <div className={`rounded-lg p-2 sm:p-3 border transition-colors duration-300 ${
              theme === 'dark' 
                ? 'bg-black/20 border-green-500/30' 
                : 'bg-green-50/80 border-green-200'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <Wallet size={12} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                <p className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-700'}`}>{t('wallet:balances.yourPrincipalAddress')}</p>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <code className={`font-mono text-[10px] sm:text-xs flex-1 truncate ${theme === 'dark' ? 'text-green-400' : 'text-gray-800'}`}>{icIdentity.getPrincipal().toText()}</code>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => copyToClipboard(icIdentity.getPrincipal().toText(), 'Principal')} 
                  className={`p-1 ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
                >
                  <Copy size={12} />
                </Button>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-2">
            <div className={`rounded p-2 border transition-colors duration-300 ${
              theme === 'dark' 
                ? 'bg-black/30 border-blue-500/20' 
                : 'bg-white/60 border-gray-200'
            }`}>
              <p className={`text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('wallet:balances.ckUSDC')}</p>
              <p className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{parseFloat(ckusdcBalance).toFixed(6)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className={`flex gap-1 sm:gap-2 border-b ${theme === 'dark' ? 'border-blue-500/30' : 'border-blue-200'}`}>
        {['swap', 'send', 'receive'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors ${
              activeTab === tab 
                ? theme === 'dark'
                  ? 'text-blue-400 border-b-2 border-blue-400' 
                  : 'text-blue-700 border-b-2 border-blue-500'
                : theme === 'dark'
                  ? 'text-gray-400 hover:text-gray-300'
                  : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {tab === 'swap' && t('wallet:tabs.swap')}
            {tab === 'send' && t('wallet:tabs.send')}
            {tab === 'receive' && t('wallet:tabs.receive')}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {activeTab === 'swap' && (
          <div className="space-y-3">
            {/* Swap Direction Toggle */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setSwapDirection('eth-to-icp')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                  swapDirection === 'eth-to-icp' 
                    ? 'bg-blue-500 text-white' 
                    : theme === 'dark'
                      ? 'bg-black/20 text-gray-400 hover:text-gray-300 border border-blue-500/20'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm'
                }`}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1">
                    <img src="/ethereum.svg" alt="ETH" className={`w-3 h-3 ${theme === 'light' && swapDirection !== 'eth-to-icp' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                    <span className="text-[10px]">USDC</span>
                    
                  </div>
                  <ArrowDown size={12} />
                  <div className="flex items-center gap-1">
                    <img src="/icp.png" alt="ICP" className={`w-3 h-3 ${theme === 'light' && swapDirection !== 'eth-to-icp' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                    <span className="text-[10px]">ckUSDC</span>
                    
                  </div>
                </div>
              </button>
              <button
                onClick={() => setSwapDirection('icp-to-eth')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                  swapDirection === 'icp-to-eth' 
                    ? 'bg-blue-500 text-white' 
                    : theme === 'dark'
                      ? 'bg-black/20 text-gray-400 hover:text-gray-300 border border-blue-500/20'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm'
                }`}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1">
                    <img src="/icp.png" alt="ICP" className={`w-3 h-3 ${theme === 'light' && swapDirection !== 'icp-to-eth' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                    <span className="text-[10px]">ckUSDC</span>
                    
                  </div>
                  <ArrowDown size={12} />
                  <div className="flex items-center gap-1">
                    <img src="/ethereum.svg" alt="ETH" className={`w-3 h-3 ${theme === 'light' && swapDirection !== 'icp-to-eth' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                    <span className="text-[10px]">USDC</span>
                    
                  </div>
                </div>
              </button>
              <button
                onClick={() => setSwapDirection('ckusdc-to-bsv')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                  swapDirection === 'ckusdc-to-bsv' 
                    ? 'bg-green-500 text-white' 
                    : theme === 'dark'
                      ? 'bg-black/20 text-gray-400 hover:text-gray-300 border border-green-500/20'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm'
                }`}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1">
                    <img src="/icp.png" alt="ICP" className={`w-3 h-3 ${theme === 'light' && swapDirection !== 'ckusdc-to-bsv' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                    <span className="text-[10px]">ckUSDC</span>
                    
                  </div>
                  <ArrowDown size={12} />
                  <div className="flex items-center gap-1">
                    <img src="/bitcoin.svg" alt="BSV" className={`w-4 h-4 ${theme === 'light' && swapDirection !== 'ckusdc-to-bsv' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                    <span className="text-[10px]">BSV</span>
                  </div>
                </div>
              </button>
            </div>

            {/* Amount Input */}
            <div>
              <label className={`text-xs sm:text-sm mb-1 block font-medium flex items-center gap-1.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                {swapDirection === 'icp-to-eth' && (
                  <>
                    <img src="/icp.png" alt="ICP" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>ckUSDC</span>
                    
                    <ArrowRight size={14} className="mx-0.5" />
                    <img src="/ethereum.svg" alt="ETH" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>USDC</span>
                    
                  </>
                )}
                {swapDirection === 'eth-to-icp' && (
                  <>
                    <img src="/ethereum.svg" alt="ETH" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>USDC</span>
                    
                    <ArrowRight size={14} className="mx-0.5" />
                    <img src="/icp.png" alt="ICP" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>ckUSDC</span>
                    
                  </>
                )}
                {swapDirection === 'ckusdc-to-bsv' && (
                  <>
                    <img src="/icp.png" alt="ICP" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>ckUSDC</span>
                    
                    <ArrowRight size={14} className="mx-0.5" />
                    <img src="/bitcoin.svg" alt="BSV" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>BSV</span>
                  </>
                )}
              </label>
              
              {swapDirection === 'ckusdc-to-bsv' ? (
                <Select
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                  options={(() => {
                    const balance = parseFloat(ckusdcBalance) || 0;
                    const maxAffordable = Math.floor(balance / MIN_CHUNK_SIZE_USD);
                    const maxOptions = Math.min(maxAffordable, MAX_CHUNKS_ALLOWED);
                    
                    return [
                      { value: '', label: t('wallet:swap.selectAmount') },
                      ...Array.from({ length: Math.max(1, maxOptions) }, (_, i) => {
                        const chunks = i + 1;
                        const value = chunks * MIN_CHUNK_SIZE_USD;
                        return {
                          value: value.toString(),
                          label: `$${value}`
                        };
                      })
                    ];
                  })()}
                  className="text-sm"
                />
              ) : (
                <input
                  type="number"
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                  placeholder={t('wallet:swap.placeholder')}
                  className={`w-full rounded-lg px-3 py-2 text-sm transition-colors duration-300 focus:outline-none ${
                    theme === 'dark'
                      ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                      : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm'
                  }`}
                  min="0"
                  step="0.01"
                />
              )}
              
              <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {swapDirection === 'eth-to-icp' 
                  ? t('wallet:swap.availableBalance', { 
                      balance: parseFloat(ethUSDCBalance).toFixed(6), 
                      currency: 'ETH USDC' 
                    })
                  : t('wallet:swap.availableBalance', { 
                      balance: parseFloat(ckusdcBalance).toFixed(6), 
                      currency: 'ckUSDC' 
                    })
                }
              </p>
              
              {/* ETH gas balance for eth-to-icp swap */}
              {swapDirection === 'eth-to-icp' && (
                <div className={`mt-2 p-2 rounded-lg border transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-blue-500/10 border-blue-500/20'
                    : 'bg-blue-50 border-blue-200'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-xs font-medium ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                      {t('ethBalanceGas.title')}
                    </p>
                    <p className={`text-xs font-semibold ${theme === 'dark' ? 'text-blue-200' : 'text-blue-800'}`}>
                      {parseFloat(ethETHBalance).toFixed(6)} ETH
                    </p>
                  </div>
                  <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-blue-300/80' : 'text-blue-600'}`}>
                    {t('ethBalanceGas.description')}
                  </p>
                </div>
              )}
              
              {/* Fee explanation for BSV swap */}
              {swapDirection === 'ckusdc-to-bsv' && swapAmount && (
                <div className={`mt-2 p-2 rounded-lg border transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-yellow-500/10 border-yellow-500/20'
                    : 'bg-yellow-50 border-yellow-200'
                }`}>
                  <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>
                    {t('wallet:swap.feeExplanation', {
                      totalFee: MAKER_FEE_PERCENT,
                      activationFee: ACTIVATION_FEE_PERCENT,
                      fillerIncentive: FILLER_INCENTIVE_PERCENT,
                      transferFee: '0.02'
                    })}
                    {' '}
                    {t('wallet:swap.feeTotal', { 
                      amount: (parseFloat(swapAmount) * (1 + MAKER_FEE_PERCENT / 100) + 0.02).toFixed(6) 
                    })}
                  </p>
                </div>
              )}
            </div>

            {/* BSV Address display for ckUSDC→BSV */}
            {swapDirection === 'ckusdc-to-bsv' && initiatorAddress && (
              <div className={`rounded-lg p-3 border transition-colors duration-300 ${
                theme === 'dark'
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-green-50 border-green-200'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <Wallet size={12} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                  <p className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-700'}`}>{t('wallet:swap.bsvDestination')}</p>
                </div>
                <code className={`font-mono text-xs block break-all ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>{initiatorAddress}</code>
              </div>
            )}

            {/* ETH Address for ICP→ETH withdrawal */}
            {swapDirection === 'icp-to-eth' && (
              <>
                <div>
                  <label className={`text-xs sm:text-sm mb-1 block ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('wallet:swap.ethereumAddress')}
                  </label>
                  <input
                    type="text"
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    placeholder="0x..."
                    className={`w-full rounded-lg px-3 py-2 text-xs sm:text-sm font-mono transition-colors duration-300 focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                        : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                    }`}
                  />
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t('wallet:swap.ethereumAddressHelper')}
                  </p>
                </div>

                {/* Withdrawal Fee Estimate */}
                <div className={`rounded-lg p-3 space-y-2 border transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-orange-500/10 border-orange-500/30'
                    : 'bg-orange-50 border-orange-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('wallet:swap.gasFeeLabel')}</span>
                    <span className={`text-sm font-semibold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>
                      {t('wallet:swap.gasFeeAmount')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('wallet:swap.treasuryFeeLabel')}</span>
                    <span className={`text-sm font-semibold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>
                      {t('wallet:swap.treasuryFeeAmount')}
                    </span>
                  </div>
                  <div className={`pt-2 border-t ${theme === 'dark' ? 'border-orange-500/20' : 'border-orange-200'}`}>
                    <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      {t('wallet:swap.gasFeeExplanation')}
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* Action Button */}
            {swapDirection === 'eth-to-icp' ? (
              <>
                <Button
                  onClick={handleSwapToICP}
                  disabled={processing || !swapAmount || !eoaAddress}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
                >
                  {processing ? (
                    <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('wallet:swap.buttons.converting')}</>
                  ) : (
                    <><ArrowDown size={16} className="mr-2" /> {t('wallet:swap.buttons.convertToIcp')}</>
                  )}
                </Button>
                
                {/* Swap Status Message */}
                {swapStatus.type && (
                  <div className={`p-3 rounded-lg border ${
                    swapStatus.type === 'success' ? 'bg-green-500/10 border-green-500/30' :
                    swapStatus.type === 'error' ? 'bg-red-500/10 border-red-500/30' :
                    'bg-blue-500/10 border-blue-500/30'
                  }`}>
                    <div className="flex items-start gap-2">
                      {swapStatus.type === 'loading' && <RefreshCw size={14} className="text-blue-400 animate-spin mt-0.5 flex-shrink-0" />}
                      {swapStatus.type === 'success' && <span className="text-green-400 text-lg flex-shrink-0">✓</span>}
                      {swapStatus.type === 'error' && <span className="text-red-400 text-lg flex-shrink-0">✗</span>}
                      <p className={`text-xs whitespace-pre-line ${
                        swapStatus.type === 'success' ? 'text-green-300' :
                        swapStatus.type === 'error' ? 'text-red-300' :
                        'text-blue-300'
                      }`}>
                        {swapStatus.message}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : swapDirection === 'icp-to-eth' ? (
              <>
                <Button
                  onClick={handleWithdrawToEth}
                  disabled={processing || !swapAmount || !withdrawAddress}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                >
                  {processing ? (
                    <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('wallet:swap.buttons.withdrawing')}</>
                  ) : (
                    <><ArrowUpRight size={16} className="mr-2" /> {t('wallet:swap.buttons.withdrawToEth')}</>
                  )}
                </Button>
                
                {/* Withdrawal Status Message */}
                {withdrawStatus.type && (
                  <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                    withdrawStatus.type === 'success' 
                      ? theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                      : withdrawStatus.type === 'error' 
                        ? theme === 'dark' ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
                        : theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      {withdrawStatus.type === 'loading' && <RefreshCw size={14} className={`animate-spin mt-0.5 flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />}
                      {withdrawStatus.type === 'success' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>✓</span>}
                      {withdrawStatus.type === 'error' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>✗</span>}
                      <p className={`text-xs whitespace-pre-line ${
                        withdrawStatus.type === 'success' 
                          ? theme === 'dark' ? 'text-green-300' : 'text-green-700'
                          : withdrawStatus.type === 'error' 
                            ? theme === 'dark' ? 'text-red-300' : 'text-red-700'
                            : theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                      }`}>
                        {withdrawStatus.message}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <Button
                  onClick={handleSwapToBSV}
                  disabled={processing || !swapAmount || !initiatorAddress}
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
                >
                  {processing ? (
                    <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('wallet:swap.buttons.creatingOrder')}</>
                  ) : (
                    <><ArrowDownUp size={16} className="mr-2" /> {t('wallet:swap.buttons.swapToBsv')}</>
                  )}
                </Button>
                
                {/* Swap Status Message */}
                {swapStatus.type && (
                  <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                    swapStatus.type === 'success' 
                      ? theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                      : swapStatus.type === 'error' 
                        ? theme === 'dark' ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
                        : theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      {swapStatus.type === 'loading' && <RefreshCw size={14} className={`animate-spin mt-0.5 flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />}
                      {swapStatus.type === 'success' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>✓</span>}
                      {swapStatus.type === 'error' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>✗</span>}
                      <p className={`text-xs whitespace-pre-line ${
                        swapStatus.type === 'success' 
                          ? theme === 'dark' ? 'text-green-300' : 'text-green-700'
                          : swapStatus.type === 'error' 
                            ? theme === 'dark' ? 'text-red-300' : 'text-red-700'
                            : theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                      }`}>
                        {swapStatus.message}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Warnings */}
            {!eoaAddress && swapDirection === 'eth-to-icp' && (
              <p className={`text-xs text-center ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>{t('wallet:swap.warnings.connectFirst')}</p>
            )}
            {swapDirection === 'icp-to-eth' && (
              <p className={`text-xs text-center ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>
                {t('wallet:swap.warnings.withdrawalTime')}
              </p>
            )}
            {swapDirection === 'ckusdc-to-bsv' && (
              <div className={`rounded-lg p-3 border transition-colors duration-300 ${
                theme === 'dark'
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-green-50 border-green-200'
              }`}>
                <p className={`text-xs text-center ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>
                  {t('wallet:swap.warnings.bsvOrderInfo', { buffer: BSV_PRICE_BUFFER_PERCENT })}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'send' && (
          <div className="space-y-3">
            {/* Destination Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setSendDestination('eth-usdc')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  sendDestination === 'eth-usdc' 
                    ? 'bg-purple-500 text-white' 
                    : theme === 'dark'
                      ? 'bg-black/20 text-gray-400 hover:text-gray-300'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <img src="/ethereum.svg" alt="ETH" className={`w-3.5 h-3.5 ${theme === 'light' && sendDestination !== 'eth-usdc' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                  <span>USDC</span>
                </div>
              </button>
              <button
                onClick={() => setSendDestination('eth-native')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  sendDestination === 'eth-native' 
                    ? 'bg-purple-500 text-white' 
                    : theme === 'dark'
                      ? 'bg-black/20 text-gray-400 hover:text-gray-300'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <img src="/ethereum.svg" alt="ETH" className={`w-3.5 h-3.5 ${theme === 'light' && sendDestination !== 'eth-native' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                  <span>ETH</span>
                </div>
              </button>
              <button
                onClick={() => setSendDestination('metanet')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  sendDestination === 'metanet' 
                    ? 'bg-purple-500 text-white' 
                    : theme === 'dark'
                      ? 'bg-black/20 text-gray-400 hover:text-gray-300'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <img src="/icp.png" alt="ICP" className={`w-3.5 h-3.5 ${theme === 'light' && sendDestination !== 'metanet' ? 'bg-gray-100 rounded-full p-0.5' : ''}`} />
                  <span>ckUSDC</span>
                </div>
              </button>
            </div>

            {sendDestination === 'eth-usdc' ? (
              // Send ethUSDC
              <>
                <div>
                  <label className={`text-xs sm:text-sm mb-1 block ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('wallet:send.recipientAddress')}</label>
                  <input
                    type="text"
                    value={sendAddress}
                    onChange={(e) => setSendAddress(e.target.value)}
                    placeholder="0x..."
                    className={`w-full rounded-lg px-3 py-2 text-xs sm:text-sm transition-colors duration-300 focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                        : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                    }`}
                  />
                </div>

                <div>
                  <label className={`text-xs sm:text-sm mb-1 block flex items-center gap-1.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    <span>{t('send.buttons.sendEthUSDC')}</span>
                    <img src="/ethereum.svg" alt="ETH" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>USDC</span>
                    
                  </label>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    placeholder={t('wallet:swap.placeholder')}
                    className={`w-full rounded-lg px-3 py-2 text-sm transition-colors duration-300 focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                        : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                    }`}
                    min="0"
                    step="0.01"
                  />
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t('wallet:send.availableAmount', { amount: parseFloat(ethUSDCBalance).toFixed(6), currency: 'ethUSDC' })}
                  </p>
                </div>

                <Button
                  onClick={handleSendUSDC}
                  disabled={processing || !sendAmount || !sendAddress || !eoaAddress}
                  className="w-full bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white"
                >
                  {processing ? (
                    <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('wallet:send.buttons.sending')}</>
                  ) : (
                    <><ArrowUpRight size={16} className="mr-2" /> {t('wallet:send.buttons.sendEthUSDC')}</>
                  )}
                </Button>
                
                {/* Send Status Message */}
                {sendStatus.type && (
                  <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                    sendStatus.type === 'success' 
                      ? theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                      : sendStatus.type === 'error' 
                        ? theme === 'dark' ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
                        : theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      {sendStatus.type === 'loading' && <RefreshCw size={14} className={`animate-spin mt-0.5 flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />}
                      {sendStatus.type === 'success' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>✓</span>}
                      {sendStatus.type === 'error' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>✗</span>}
                      <p className={`text-xs whitespace-pre-line ${
                        sendStatus.type === 'success' 
                          ? theme === 'dark' ? 'text-green-300' : 'text-green-700'
                          : sendStatus.type === 'error' 
                            ? theme === 'dark' ? 'text-red-300' : 'text-red-700'
                            : theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                      }`}>
                        {sendStatus.message}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : sendDestination === 'eth-native' ? (
              // Send ETH (native)
              <>
                <div>
                  <label className={`text-xs sm:text-sm mb-1 block ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('wallet:send.recipientAddress')}</label>
                  <input
                    type="text"
                    value={sendAddress}
                    onChange={(e) => setSendAddress(e.target.value)}
                    placeholder="0x..."
                    className={`w-full rounded-lg px-3 py-2 text-xs sm:text-sm transition-colors duration-300 focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                        : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                    }`}
                  />
                </div>

                <div>
                  <label className={`text-xs sm:text-sm mb-1 block flex items-center gap-1.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    <span>{t('send.buttons.sendEthUSDC')}</span>
                    <img src="/ethereum.svg" alt="ETH" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>ETH</span>
                  </label>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    placeholder={t('wallet:swap.placeholder')}
                    className={`w-full rounded-lg px-3 py-2 text-sm transition-colors duration-300 focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                        : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                    }`}
                    min="0"
                    step="0.001"
                  />
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t('wallet:send.availableAmount', { amount: parseFloat(ethETHBalance).toFixed(6), currency: 'ETH' })}
                  </p>
                </div>

                <Button
                  onClick={handleSendETH}
                  disabled={processing || !sendAmount || !sendAddress || !eoaAddress}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
                >
                  {processing ? (
                    <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('wallet:send.buttons.sending')}</>
                  ) : (
                    <><ArrowUpRight size={16} className="mr-2" /> {t('send.buttons.sendEthUSDC')} ETH</>
                  )}
                </Button>
                
                {/* Send Status Message */}
                {sendStatus.type && (
                  <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                    sendStatus.type === 'success' 
                      ? theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                      : sendStatus.type === 'error' 
                        ? theme === 'dark' ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
                        : theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      {sendStatus.type === 'loading' && <RefreshCw size={14} className={`animate-spin mt-0.5 flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />}
                      {sendStatus.type === 'success' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>✓</span>}
                      {sendStatus.type === 'error' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>✗</span>}
                      <p className={`text-xs whitespace-pre-line ${
                        sendStatus.type === 'success' 
                          ? theme === 'dark' ? 'text-green-300' : 'text-green-700'
                          : sendStatus.type === 'error' 
                            ? theme === 'dark' ? 'text-red-300' : 'text-red-700'
                            : theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                      }`}>
                        {sendStatus.message}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              // Send to Metanet
              <>
                <div>
                  <label className={`text-xs sm:text-sm mb-1 block flex items-center gap-1.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    <span>{t('send.buttons.sendEthUSDC')}</span>
                    <img src="/icp.png" alt="ICP" className={`w-4 h-4 ${theme === 'light' ? 'bg-white rounded-full p-0.5' : ''}`} />
                    <span>ckUSDC</span>
                    
                  </label>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    placeholder={t('wallet:swap.placeholder')}
                    className={`w-full rounded-lg px-3 py-2 text-sm transition-colors duration-300 focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                        : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                    }`}
                    min="0"
                    step="0.01"
                  />
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t('wallet:send.availableAmount', { amount: parseFloat(ckusdcBalance).toFixed(6), currency: 'ckUSDC' })}
                  </p>
                </div>

                <div className={`rounded-lg p-3 border transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-blue-50 border-blue-200'
                }`}>
                  <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                    {t('wallet:send.metanetInfo')}
                  </p>
                  <div className="space-y-1">
                    <div>
                      <p className={`text-[10px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('wallet:send.icpPrincipal')}</p>
                      <p className={`text-xs font-mono break-all ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                        {rootPrincipal || t('wallet:send.notConnected')}
                      </p>
                    </div>
                  
                  </div>
                </div>

                <Button
                  onClick={handleTransferToMetanet}
                  disabled={processing || !sendAmount || !rootPrincipal}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                >
                  {processing ? (
                    <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('wallet:send.buttons.sending')}</>
                  ) : (
                    <><ArrowUpRight size={16} className="mr-2" /> {t('wallet:send.sendToMetanet')}</>
                  )}
                </Button>

                {/* Send Status Message */}
                {sendStatus.type && (
                  <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                    sendStatus.type === 'success' 
                      ? theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                      : sendStatus.type === 'error' 
                        ? theme === 'dark' ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
                        : theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      {sendStatus.type === 'loading' && <RefreshCw size={14} className={`animate-spin mt-0.5 flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />}
                      {sendStatus.type === 'success' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>✓</span>}
                      {sendStatus.type === 'error' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>✗</span>}
                      <p className={`text-xs whitespace-pre-line ${
                        sendStatus.type === 'success' 
                          ? theme === 'dark' ? 'text-green-300' : 'text-green-700'
                          : sendStatus.type === 'error' 
                            ? theme === 'dark' ? 'text-red-300' : 'text-red-700'
                            : theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                      }`}>
                        {sendStatus.message}
                      </p>
                    </div>
                  </div>
                )}

                <p className={`text-xs text-center ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('wallet:send.icrcTransferInfo')}
                </p>
              </>
            )}

            {!eoaAddress && sendDestination === 'eth' && (
              <p className={`text-xs text-center ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>{t('wallet:send.warnings.connectFirst')}</p>
            )}
          </div>
        )}

        {activeTab === 'receive' && (
          <div className="space-y-3">
            {/* Receive from Metanet */}
              <h4 className={`text-sm font-semibold mb-3 ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>{t('wallet:receive.title')}</h4>
              <p className={`text-xs mb-3 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('wallet:receive.description')}
              </p>
              
              <div>
                <label className={`text-xs sm:text-sm mb-1 block ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('wallet:receive.amountLabel')}</label>
                <input
                  type="number"
                  value={receiveAmount}
                  onChange={(e) => setReceiveAmount(e.target.value)}
                  placeholder={t('wallet:swap.placeholder')}
                  className={`w-full rounded-lg px-3 py-2 text-sm transition-colors duration-300 focus:outline-none ${
                    theme === 'dark'
                      ? 'bg-black/30 border border-blue-500/30 text-white placeholder-gray-500 focus:border-blue-400'
                      : 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                  }`}
                  min="0"
                  step="0.01"
                />
              </div>

              <Button
                onClick={handleDepositFromMetanet}
                disabled={processing || !receiveAmount}
                className="w-full mt-3 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white"
              >
                {processing ? (
                  <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('wallet:receive.buttons.requesting')}</>
                ) : (
                  <><ArrowDown size={16} className="mr-2" /> {t('wallet:receive.buttons.requestFromMetanet')}</>
                )}
              </Button>

              {/* Receive Status Message */}
              {receiveStatus.type && (
                <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                  receiveStatus.type === 'success' 
                    ? theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                    : receiveStatus.type === 'error' 
                      ? theme === 'dark' ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
                      : theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                }`}>
                  <div className="flex items-start gap-2">
                    {receiveStatus.type === 'loading' && <RefreshCw size={14} className={`animate-spin mt-0.5 flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />}
                    {receiveStatus.type === 'success' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>✓</span>}
                    {receiveStatus.type === 'error' && <span className={`text-lg flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>✗</span>}
                    <p className={`text-xs whitespace-pre-line ${
                      receiveStatus.type === 'success' 
                        ? theme === 'dark' ? 'text-green-300' : 'text-green-700'
                        : receiveStatus.type === 'error' 
                          ? theme === 'dark' ? 'text-red-300' : 'text-red-700'
                          : theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                    }`}>
                      {receiveStatus.message}
                    </p>
                  </div>
                </div>
              )}
          </div>
        )}
      </div>

      {/* Information Notice - Full Width */}
      <div className={`mt-4 rounded-lg p-3 border transition-colors duration-300 ${
        theme === 'dark'
          ? 'bg-blue-500/10 border-blue-500/30'
          : 'bg-blue-50 border-blue-200'
      }`}>
        <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
          {t('wallet:info.full')}
        </p>
      </div>
    </div>
  );
};

export default EasySwapWallet;
