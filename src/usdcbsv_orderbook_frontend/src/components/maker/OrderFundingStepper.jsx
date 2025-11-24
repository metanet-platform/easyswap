import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Wallet, 
  ArrowRight, 
  CheckCircle, 
  Circle, 
  Loader,
  AlertCircle,
  RefreshCw,
  Zap,
  ArrowDownUp,
  CreditCard,
  Info,
  Copy
} from 'lucide-react';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { Button, Card, Tooltip, InfoTooltip, FadeIn, SlideUp, SuccessAnimation, LoadingSpinner, ProgressBar } from '../common';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { toast } from 'react-hot-toast';
import {
  getEOAAddress,
  getUSDCBalance,
  getETHBalance,
  depositToHelper
} from '../../utils/wallet';
import { CK_USDC_LEDGER, MAKER_FEE_PERCENT, ACTIVATION_FEE_PERCENT, FILLER_INCENTIVE_PERCENT } from '../../config';
import { IcrcLedgerCanister } from '@dfinity/ledger-icrc';

const OrderFundingStepper = ({ order, onFundingComplete, onRefresh, orderDepositBalance }) => {
  const { t } = useTranslation(['maker', 'common']);
  const { theme } = useTheme();
  const {
    actor,
    icIdentity,
    genericUseSeed,
    rootPrincipal,
    getBalance,
    requestCkUSDCPayment,
    onCommand,
    offCommand,
    sendCommand,
    httpAgent,
    canisterId
  } = useSDK();

  // Local httpAgent state (create if SDK doesn't provide one)
  const [localHttpAgent, setLocalHttpAgent] = useState(null);

  // Funding path selection
  const [selectedPath, setSelectedPath] = useState(null); // 'instant', 'metanet', or 'swap'
  const [currentStep, setCurrentStep] = useState(0);
  
  // Balances
  const [metanetBalance, setMetanetBalance] = useState(null);
  const [ckusdcBalance, setCkusdcBalance] = useState(null);
  const [ethUsdcBalance, setEthUsdcBalance] = useState('0');
  const [ethBalance, setEthBalance] = useState('0');
  const [eoaAddress, setEoaAddress] = useState('');
  const [icrc1Fee, setIcrc1Fee] = useState(0.01); // Default $0.01 ckUSDC transfer fee, will be fetched
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [checkingBalances, setCheckingBalances] = useState(false);
  const [fundingAmount, setFundingAmount] = useState('');
  const [principalBytes32, setPrincipalBytes32] = useState('');

  const orderAmount = Number(order.amount_usd || 0);
  const makerFee = orderAmount * (MAKER_FEE_PERCENT / 100);
  const totalCost = orderAmount + makerFee;
  const depositSubaccount = order.deposit_subaccount || '';
  
  // Calculate what's already deposited in the order subaccount
  // Use live orderDepositBalance (from ICRC1 ledger) if available, otherwise fall back to backend state
  const alreadyDeposited = orderDepositBalance !== null && orderDepositBalance !== undefined
    ? orderDepositBalance
    : (order.total_deposited_usd && order.total_deposited_usd.length > 0
      ? Number(order.total_deposited_usd[0])
      : 0);
  
  // Calculate shortfall - how much MORE is needed to activate
  const shortfall = Math.max(0, totalCost - alreadyDeposited);
  const amountNeededWithFee = shortfall + icrc1Fee;

  // Use SDK httpAgent if available, otherwise use local
  const activeHttpAgent = httpAgent || localHttpAgent;

  // Create local HttpAgent if SDK doesn't provide one
  useEffect(() => {
    const createAgent = async () => {
      if (!httpAgent && icIdentity) {
        try {
          const agent = new HttpAgent({
            host: 'https://ic0.app',
            identity: icIdentity
          });
          if (process.env.NODE_ENV !== 'production') {
            await agent.fetchRootKey();
          }
          setLocalHttpAgent(agent);
          console.log('✅ Created local HttpAgent');
        } catch (error) {
          console.error('Error creating local HttpAgent:', error);
        }
      }
    };
    createAgent();
  }, [httpAgent, icIdentity]);

  // Initialize and fetch balances - NON-BLOCKING
  useEffect(() => {
    const initializeWallet = async () => {
      if (!icIdentity || !genericUseSeed) return;

      try {
        // Get EOA address
        const address = getEOAAddress(genericUseSeed);
        setEoaAddress(address);

        // Convert principal to bytes32 for helper contract
        // CRITICAL: Must follow IC encoding format - [length][principal_bytes][padding]
        const principal = icIdentity.getPrincipal();
        const principalBytes = principal.toUint8Array();
        
        console.log('🔑 Principal for ckUSDC minting:', principal.toText());
        console.log('📦 Principal bytes length:', principalBytes.length);
        console.log('📦 Principal bytes (hex):', Array.from(principalBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
        
        // IC encoding: first byte is length, then principal bytes, then zero-padding
        const fixedBytes = new Uint8Array(32);
        fixedBytes[0] = principalBytes.length;  // First byte = length
        fixedBytes.set(principalBytes, 1);  // Copy principal starting at index 1
        // Rest is automatically zero-padded
        
        const bytes32 = '0x' + Array.from(fixedBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        console.log('✅ Principal as bytes32 (IC format):', bytes32);
        console.log('⚠️  VERIFY THIS MATCHES: https://sv3dd-oaaaa-aaaar-qacoa-cai.raw.icp0.io/dashboard');
        console.log('📝 Paste your principal there and compare the bytes32 output');
        
        setPrincipalBytes32(bytes32);

        // Fetch balances asynchronously in background (non-blocking)
        fetchAllBalances(address).catch(err => {
          console.error('Background balance fetch failed:', err);
        });
        
        // Fetch ICRC1 transfer fee in background (non-blocking)
        fetchIcrc1Fee().catch(err => {
          console.error('Background fee fetch failed:', err);
        });
      } catch (error) {
        console.error('Error initializing wallet:', error);
      }
    };

    initializeWallet();
  }, [icIdentity, genericUseSeed]);

  const fetchIcrc1Fee = async () => {
    if (!httpAgent || !icIdentity) return;
    
    try {
      const ledger = IcrcLedgerCanister.create({
        agent: httpAgent,
        canisterId: CK_USDC_LEDGER
      });
      
      const fee = await ledger.transactionFee();
      const feeInUsd = Number(fee) / 1_000_000; // Convert from e6 to USD
      setIcrc1Fee(feeInUsd);
      console.log('✅ ICRC1 transfer fee:', feeInUsd, 'USDC');
    } catch (error) {
      console.error('Error fetching ICRC1 fee:', error);
      // Keep default $0.01 (standard ckUSDC transfer fee)
    }
  };

  const fetchAllBalances = async (eoaAddr = eoaAddress) => {
    setCheckingBalances(true);
    try {
      // Fetch ckUSDC balance for user's principal
      if (getBalance && icIdentity) {
        const ckBal = await getBalance();
        setCkusdcBalance(ckBal);
        console.log('✅ ckUSDC balance loaded:', ckBal);
      }

      // Fetch ETH USDC balance
      if (eoaAddr) {
        const usdcBal = await getUSDCBalance(eoaAddr, 'https://ethereum.publicnode.com');
        setEthUsdcBalance(usdcBal);

        const ethBal = await getETHBalance(eoaAddr, 'https://ethereum.publicnode.com');
        setEthBalance(ethBal);
      }

      // Fetch Metanet ckUSDC balance for rootPrincipal
      if (rootPrincipal && activeHttpAgent) {
        try {
          const ledger = IcrcLedgerCanister.create({
            agent: activeHttpAgent,
            canisterId: Principal.fromText(CK_USDC_LEDGER)
          });
          
          const metanetBalanceE6 = await ledger.balance({
            owner: Principal.fromText(rootPrincipal),
            certified: false
          });
          
          const metanetBalUsd = Number(metanetBalanceE6) / 1_000_000;
          setMetanetBalance(metanetBalUsd);
          console.log('✅ Metanet ckUSDC balance loaded:', metanetBalUsd);
        } catch (error) {
          console.error('Error fetching Metanet balance:', error);
          setMetanetBalance(null);
        }
      }
    } catch (error) {
      console.error('Error fetching balances:', error);
      // Set to 0 on error so UI doesn't stay in loading state
      setCkusdcBalance('0');
    } finally {
      setCheckingBalances(false);
    }
  };

  // Refresh balance when order changes (e.g., user switches between orders)
  useEffect(() => {
    if (order && icIdentity && eoaAddress) {
      console.log('📊 Order changed, refreshing balance...');
      fetchAllBalances().catch(err => {
        console.error('Failed to refresh balance on order change:', err);
      });
    }
  }, [order?.id]); // Only re-fetch when order ID changes

  // Retry fetching Metanet balance when rootPrincipal or activeHttpAgent becomes available
  useEffect(() => {
    if (rootPrincipal && activeHttpAgent && metanetBalance === null) {
      fetchAllBalances().catch(err => {
        console.error('Failed to fetch Metanet balance after SDK ready:', err);
      });
    }
  }, [rootPrincipal, activeHttpAgent]);

  // Path 0: Instant Activate (if user already has sufficient ckUSDC balance)
  const handleInstantActivate = async () => {
    console.log('🔍 Instant Activate Debug:', {
      hasIdentity: !!icIdentity,
      depositSubaccount,
      hasHttpAgent: !!httpAgent,
      hasLocalHttpAgent: !!localHttpAgent,
      hasActiveHttpAgent: !!activeHttpAgent,
      depositPrincipal: order.deposit_principal,
      alreadyDeposited,
      shortfall,
      amountNeededWithFee,
      orderKeys: Object.keys(order)
    });
    
    if (!icIdentity || !depositSubaccount || !activeHttpAgent || !order.deposit_principal) {
      toast.error('Missing identity, deposit subaccount, or deposit principal');
      return;
    }

    // Check if user has enough balance to cover the SHORTFALL (not the full amount)
    const currentBalance = parseFloat(ckusdcBalance || 0);
    
    if (currentBalance < amountNeededWithFee) {
      toast.error(t('funding.insufficientBalance', { needed: amountNeededWithFee.toFixed(6), have: currentBalance.toFixed(6) }));
      return;
    }

    setSelectedPath('instant');
    setLoading(true);
    setCurrentStep(1);

    try {
      toast.loading('Transferring ckUSDC to order subaccount...', { id: 'instant' });

      // Use IcrcLedgerCanister to transfer directly to order's subaccount
      const ledger = IcrcLedgerCanister.create({
        agent: activeHttpAgent,
        canisterId: CK_USDC_LEDGER,
      });

      // Convert subaccount hex to Uint8Array
      const subaccountBytes = new Uint8Array(
        depositSubaccount.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );

      // Transfer ONLY the shortfall amount (what's still needed)
      // Amount must include the fee so the full shortfall arrives at destination
      const transferArgs = {
        to: {
          owner: Principal.fromText(order.deposit_principal),
          subaccount: [subaccountBytes], // Order-specific subaccount
        },
        amount: BigInt(Math.round(amountNeededWithFee * 1_000_000)), // Shortfall + fee
        // Fee will be deducted by ledger, leaving exactly shortfall in the subaccount
      };

      console.log(`📤 Transferring shortfall: $${shortfall.toFixed(6)} + fee $${icrc1Fee.toFixed(6)} = $${amountNeededWithFee.toFixed(6)}`);

      const blockIndex = await ledger.transfer(transferArgs);
      
      console.log(`✅ ICRC transfer successful! Block index: ${blockIndex}`);
      
      setCurrentStep(2);
      toast.success('Transfer successful! Confirming with backend...', { id: 'instant', duration: Infinity });
      
      // Call backend to check balance and activate
      await confirmDepositWithBackend();
      
      // Remove the loading toast after confirmation
      toast.dismiss('instant');

    } catch (error) {
      console.error('Error instant activating:', error);
      toast.error(error.message || 'Failed to activate', { id: 'instant' });
      setCurrentStep(0);
      setSelectedPath(null);
    } finally {
      setLoading(false);
    }
  };

  // Path 1: Fund from Metanet Balance
  const handleFundFromMetanet = async () => {
    if (!icIdentity || !depositSubaccount) {
      toast.error('Missing identity or deposit subaccount');
      return;
    }

    const amount = parseFloat(fundingAmount);
    if (!amount || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Check if amount is at least the shortfall needed
    if (amount < shortfall) {
      toast.error(t('funding.minimumAmount', { amount: shortfall.toFixed(6) }));
      return;
    }

    setLoading(true);
    setCurrentStep(1);

    try {
      // Use structured ref format: c:{canister}__o:{orderId}__t:{timestamp}
      // This allows pay-response handler to know which canister and order to activate
      const paymentRef = `c:${canisterId}__o:${order.id}__t:${Date.now()}`;
      
      toast.loading('Requesting payment from Metanet balance...', { id: 'funding' });

      // Listen for payment response
      const paymentPromise = new Promise((resolve, reject) => {
        const paymentListener = (data) => {
          console.log('💳 Payment listener received:', data);
          
          // Check if this is our payment response
          if (data.type === 'pay-response' && data.payload?.ref === paymentRef) {
            console.log('✅ Matched payment ref:', paymentRef);
            
            // Parse the ref to extract order info: c:{canister}__o:{orderId}__t:{timestamp}
            try {
              const refParts = paymentRef.split('__');
              const canisterPart = refParts[0]; // c:{canister}
              const orderPart = refParts[1]; // o:{orderId}
              const extractedCanisterId = canisterPart.split(':')[1];
              const extractedOrderId = parseInt(orderPart.split(':')[1]);
              
              console.log('📦 Parsed ref - Canister:', extractedCanisterId, 'Order ID:', extractedOrderId);
            } catch (parseError) {
              console.error('Failed to parse payment ref:', parseError);
            }
            
            clearTimeout(timeout);
            offCommand(paymentListener);
            
            // Check success field (not status)
            if (data.payload.success === true) {
              console.log('✅ Payment successful');
              resolve(data);
            } else {
              // User aborted or payment failed
              console.log('❌ Payment failed/aborted:', data.payload.message);
              reject(new Error(data.payload.message || 'Payment failed'));
            }
          }
        };

        const timeout = setTimeout(() => {
          console.log('⏱️ Payment timeout');
          offCommand(paymentListener);
          reject(new Error('Payment timeout - please try again'));
        }, 120000); // 2 minute timeout

        onCommand(paymentListener);

        // Create payment object for order subaccount
        const payObj = {
          type: "pay",
          ref: paymentRef,
          token: {
            protocol: "ICP",
            specification: {
              ledgerId: CK_USDC_LEDGER
            }
          },
          recipients: [
            {
              // Send to order's subaccount (format: canister_principal.subaccount)
              address: `${order.deposit_principal}.${depositSubaccount}`,
              value: amount,
              note: `Fund Order #${order.id}`
            }
          ]
        };

        // Use sendCommand directly
        window.parent.postMessage({ command: "ninja-app-command", detail: payObj }, "*");
      });

      await paymentPromise;
      
      setCurrentStep(2);
      toast.success('Payment successful! Confirming deposit...', { id: 'funding' });

      // Now confirm the deposit with backend
      await confirmDepositWithBackend();

    } catch (error) {
      console.error('Error funding from Metanet:', error);
      
      // Show retry option for payment failures
      const retry = window.confirm(
        `${error.message}\n\nWould you like to try again?`
      );
      
      if (retry) {
        // Reset to allow retry, keep path selected
        setLoading(false);
        setCurrentStep(0);
        return; // Don't reset selectedPath
      } else {
        // User chose not to retry
        toast.error(error.message || 'Payment cancelled', { id: 'funding' });
        setCurrentStep(0);
      }
    } finally {
      setLoading(false);
    }
  };

  // Path 2: Swap ETH USDC to ckUSDC
  const handleSwapAndFund = async () => {
    // CRITICAL SAFETY CHECKS
    if (!icIdentity) {
      toast.error('IC Identity not available. Please reconnect wallet.');
      return;
    }

    if (!genericUseSeed) {
      toast.error('ETH wallet seed not available. Please reconnect wallet.');
      return;
    }

    if (!principalBytes32) {
      toast.error('Principal bytes32 not initialized. Please refresh the page.');
      return;
    }

    // Verify principal bytes32 format (should start with 0x and be 66 chars)
    if (!principalBytes32.startsWith('0x') || principalBytes32.length !== 66) {
      console.error('❌ Invalid bytes32 format:', principalBytes32);
      toast.error('Invalid principal encoding detected. Please refresh the page.');
      return;
    }

    // Re-verify principal encoding before swap
    const principal = icIdentity.getPrincipal();
    const principalBytes = principal.toUint8Array();
    const fixedBytes = new Uint8Array(32);
    fixedBytes[0] = principalBytes.length;
    fixedBytes.set(principalBytes, 1);
    const verifiedBytes32 = '0x' + Array.from(fixedBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (verifiedBytes32 !== principalBytes32) {
      console.error('❌ Principal bytes32 mismatch!');
      console.error('Stored:', principalBytes32);
      console.error('Verified:', verifiedBytes32);
      toast.error('Principal encoding mismatch. Refreshing...');
      setPrincipalBytes32(verifiedBytes32);
      return;
    }

    console.log('✅ Principal verification passed');
    console.log('🔑 Using principal:', principal.toText());
    console.log('📦 Using bytes32:', verifiedBytes32);

    const amount = parseFloat(fundingAmount);
    if (!amount || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Calculate the minimum required (remaining shortfall after current balance)
    const currentBalance = ckusdcBalance ? parseFloat(ckusdcBalance) : 0;
    const remaining = Math.max(0, amountNeededWithFee - currentBalance);

    if (amount < remaining) {
      toast.error(`Amount must be at least $${remaining.toFixed(6)} (the remaining shortfall)`);
      return;
    }

    if (amount > parseFloat(ethUsdcBalance)) {
      toast.error('Insufficient ETH USDC balance');
      return;
    }

    const minEthForGas = 0.002; // Minimum ETH needed for gas
    if (parseFloat(ethBalance) < minEthForGas) {
      toast.error(`Insufficient ETH for gas fees. Need at least ${minEthForGas} ETH`);
      return;
    }

    setLoading(true);
    setCurrentStep(1);

    try {
      toast.loading('Converting ETH USDC to ckUSDC...', { id: 'swap' });

      console.log('🚀 Initiating swap with:');
      console.log('  - Amount:', amount, 'USDC');
      console.log('  - Principal:', principal.toText());
      console.log('  - Bytes32:', verifiedBytes32);
      console.log('  - Helper Contract: 0x6abDA0438307733FC299e9C229FD3cc074bD8cC0');

      const result = await depositToHelper(
        genericUseSeed,
        amount,
        verifiedBytes32,  // Use verified bytes32
        'https://ethereum.publicnode.com'
      );

      console.log('✅ Swap transaction successful!');
      console.log('  - Approve Tx:', result.approveHash);
      console.log('  - Deposit Tx:', result.depositHash);
      console.log('  - Expected ckUSDC arrival: ~20 minutes');
      console.log('  - Verify on dashboard: https://sv3dd-oaaaa-aaaar-qacoa-cai.raw.icp0.io/dashboard');

      setCurrentStep(2);
      toast.success(
        `Swap initiated! Tx: ${result.depositHash.slice(0, 10)}...\nckUSDC will arrive in ~20 minutes`,
        { id: 'swap', duration: 8000 }
      );

      // Wait a bit then move to next step
      setTimeout(() => {
        setCurrentStep(3);
        toast.loading('Waiting for ckUSDC to arrive...', { id: 'swap' });
      }, 2000);

      // User will need to wait ~20 mins then transfer to order subaccount
      // For now, show instructions
      
    } catch (error) {
      console.error('❌ Swap error:', error);
      toast.error(error.message || 'Failed to swap', { id: 'swap' });
      setCurrentStep(0);
    } finally {
      setLoading(false);
    }
  };

  // Transfer ckUSDC from user principal to order subaccount
  const handleTransferToOrder = async () => {
    if (!icIdentity || !depositSubaccount) {
      toast.error('Missing identity or deposit subaccount');
      return;
    }

    const amount = parseFloat(fundingAmount || orderAmount);

    setLoading(true);
    try {
      const paymentRef = `transfer_to_order_${order.id}_${Date.now()}`;
      
      toast.loading('Transferring ckUSDC to order...', { id: 'transfer' });

      const paymentPromise = new Promise((resolve, reject) => {
        const paymentListener = (data) => {
          console.log('💸 Transfer listener received:', data);
          
          // Check if this is our transfer response
          if (data.type === 'pay-response' && data.payload?.ref === paymentRef) {
            console.log('✅ Matched transfer ref:', paymentRef);
            clearTimeout(timeout);
            offCommand(paymentListener);
            
            // Check success field (not status)
            if (data.payload.success === true) {
              console.log('✅ Transfer successful');
              resolve(data);
            } else {
              console.log('❌ Transfer failed/aborted:', data.payload.message);
              reject(new Error(data.payload.message || 'Transfer failed'));
            }
          }
        };

        const timeout = setTimeout(() => {
          console.log('⏱️ Transfer timeout');
          offCommand(paymentListener);
          reject(new Error('Transfer timeout'));
        }, 120000);

        onCommand(paymentListener);

        // Send to order subaccount (canister's principal, not user's)
        requestCkUSDCPayment(
          amount,
          `${order.deposit_principal}.${depositSubaccount}`,
          `Fund Order #${order.id}`,
          paymentRef
        );
      });

      await paymentPromise;
      
      toast.success('Transfer successful! Confirming deposit...', { id: 'transfer' });
      
      // Confirm deposit
      await confirmDepositWithBackend();

    } catch (error) {
      console.error('Error transferring to order:', error);
      
      // Show retry option
      const retry = window.confirm(
        `${error.message}\n\nWould you like to try again?`
      );
      
      if (retry) {
        setLoading(false);
        return; // Allow retry
      } else {
        toast.error(error.message || 'Transfer cancelled', { id: 'transfer' });
      }
    } finally {
      setLoading(false);
    }
  };

  const confirmDepositWithBackend = async () => {
    // Explicit check for order.id (could be 0, which is falsy but valid)
    if (!order || order.id === undefined || order.id === null || !actor) {
      console.error('❌ Cannot confirm deposit: missing order.id or actor', { 
        hasOrder: !!order, 
        orderId: order?.id, 
        hasActor: !!actor 
      });
      throw new Error('Cannot confirm deposit: missing order.id or actor');
    }

    try {
      console.log('🔄 Confirming deposit for order', order.id);
      toast.loading('Checking balance and activating order...', { id: 'confirm' });
      
      const result = await actor.confirm_deposit(order.id);
      console.log('📋 Confirm deposit result:', result);

      if ('Ok' in result) {
        console.log('✅ Order funded and activated!');
        toast.success('Order funded and activated successfully!', { id: 'confirm' });
        setCurrentStep(4); // Success step
        
        // Notify parent to refresh
        if (onFundingComplete) {
          onFundingComplete();
        }
      } else {
        const errorMsg = result.Err || 'Failed to confirm deposit';
        console.error('❌ Confirmation error:', errorMsg);
        toast.error(errorMsg, { id: 'confirm' });
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('❌ Error confirming deposit:', error);
      toast.error(error.message || 'Failed to confirm deposit', { id: 'confirm' });
      throw error; // Re-throw so caller knows it failed
    }
  };

  const PathSelectionView = () => {
    const balanceLoaded = ckusdcBalance !== null;
    const currentBalance = balanceLoaded ? parseFloat(ckusdcBalance) : 0;
    const hasSufficientBalance = balanceLoaded && currentBalance >= amountNeededWithFee;
    
    const metanetBalanceLoaded = metanetBalance !== null;
    const metanetBalanceNum = metanetBalanceLoaded ? parseFloat(metanetBalance) : 0;
    const hasMetanetBalance = metanetBalanceLoaded && metanetBalanceNum >= amountNeededWithFee;

    return (
      <div className="space-y-3">
        {/* Header - Clear explanation of what's needed */}
        <div className={`text-center p-3 rounded-lg border ${
          theme === 'dark'
            ? 'bg-blue-500/10 border-blue-500/30'
            : 'bg-blue-50 border-blue-200'
        }`}>
          <p className={`text-xs sm:text-sm mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {alreadyDeposited > 0 ? t('funding.additionalNeeded') : t('funding.totalNeeded')}
          </p>
          <p className={`text-lg sm:text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            ${amountNeededWithFee.toFixed(6)}
          </p>
          <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
            (${shortfall.toFixed(6)} + ${icrc1Fee.toFixed(6)} {t('funding.transferFee')})
          </p>
        </div>

        {/* Balance Display - Your Current ckUSDC Balance */}
        <div className={`rounded-lg p-3 border ${
          theme === 'dark'
            ? 'bg-white/5 border-white/10'
            : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wallet size={16} className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} />
              <span className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('funding.yourBalance')}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchAllBalances()}
              disabled={checkingBalances}
              className="h-6 w-6 p-0"
            >
              <RefreshCw size={12} className={checkingBalances ? 'animate-spin' : ''} />
            </Button>
          </div>
          <div className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {balanceLoaded ? `$${currentBalance.toFixed(6)}` : (
              checkingBalances ? <Loader size={16} className="animate-spin inline-block" /> : 'Loading...'
            )}
          </div>
          {hasSufficientBalance && (
            <div className={`mt-2 text-xs flex items-center gap-1 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
              <CheckCircle size={12} />
              <span>{t('funding.youHaveEnough')}</span>
            </div>
          )}
          {balanceLoaded && !hasSufficientBalance && currentBalance > 0 && (
            <div className={`mt-2 text-xs flex items-center gap-1 ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>
              <AlertCircle size={12} />
              <span>{t('funding.needMore', { amount: (amountNeededWithFee - currentBalance).toFixed(6) })}</span>
            </div>
          )}
          {balanceLoaded && currentBalance === 0 && (
            <div className={`mt-2 text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              No ckUSDC balance - use funding options below
            </div>
          )}
        </div>

        {/* Option 1: Instant Activate - Only if user has enough balance */}
        {hasSufficientBalance && (
          <button
            onClick={handleInstantActivate}
            disabled={loading}
            className={`w-full font-semibold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl disabled:cursor-not-allowed ${
              theme === 'dark'
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-500 disabled:to-gray-600 text-white'
                : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white'
            }`}
          >
            <Zap size={18} />
            <span>{loading ? t('funding.activating') : t('funding.activateNow')}</span>
            <span className="text-xs opacity-80">(~30 sec)</span>
          </button>
        )}

        {/* Funding Options - Only show if user doesn't have enough balance */}
        {!hasSufficientBalance && (
          <>
            {/* Funding Options Header */}
            <div className={`text-xs font-semibold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} text-center`}>
              Choose a funding method:
            </div>

            {/* Option 2 & 3: Metanet or ETH Swap */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {/* Metanet Balance Option - Always enabled, user can complement */}
              <button
                onClick={() => {
                  setFundingAmount(amountNeededWithFee.toFixed(6));
                  setSelectedPath('metanet');
                }}
                disabled={loading}
                className={`rounded-lg p-3 text-left transition-all duration-200 hover:scale-[1.01] disabled:cursor-not-allowed border ${
                  theme === 'dark'
                    ? 'bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/60 disabled:border-gray-500/30'
                    : 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-300 hover:border-purple-400 disabled:border-gray-300'
                } disabled:opacity-50`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('funding.depositFromMetanet')}</h4>
                  <Zap className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={16} />
                </div>
                <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {metanetBalanceLoaded ? (
                    `Available: $${metanetBalanceNum.toFixed(6)}`
                  ) : (
                    'Checking balance...'
                  )}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>Instant</span>
                  <span className={theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}>~30 sec</span>
                </div>
              </button>

              {/* ETH Swap Option */}
              <button
                onClick={() => {
                  // Prefill with the remaining amount needed (shortfall), not total
                  const remaining = Math.max(0, amountNeededWithFee - currentBalance);
                  setFundingAmount(remaining.toFixed(6));
                  setSelectedPath('swap');
                }}
                disabled={loading || !balanceLoaded}
                className={`rounded-lg p-3 text-left transition-all duration-200 hover:scale-[1.01] disabled:cursor-not-allowed border ${
                  theme === 'dark'
                    ? 'bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/30 hover:border-blue-500/60 disabled:border-gray-500/30'
                    : 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-300 hover:border-blue-400 disabled:border-gray-300'
                } disabled:opacity-50`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('funding.swapFromEthereum')}</h4>
                  <ArrowDownUp className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} size={16} />
                </div>
                <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('funding.convertEthereumUsdc')}
                  {balanceLoaded && currentBalance > 0 && (
                    <span className="block mt-1">Only need ${(amountNeededWithFee - currentBalance).toFixed(6)} more</span>
                  )}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>Flexible</span>
                  <span className={theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}>~20-30 min</span>
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    );
  };


  const MetanetFundingFlow = () => {
    const balanceLoaded = ckusdcBalance !== null;
    const currentBalance = balanceLoaded ? parseFloat(ckusdcBalance) : 0;
    
    return (
      <div className="space-y-6">
        {currentStep === 0 && (
          <button
            onClick={() => {
              setSelectedPath(null);
              setCurrentStep(0);
            }}
            className={`text-xs hover:underline transition-colors py-2 ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
          >
            ← Back to funding options
          </button>
        )}

        <div className="text-center mb-4">
          <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            Fund from Metanet Balance
          </h3>
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            Transfer ${amountNeededWithFee.toFixed(6)} ckUSDC from your Metanet platform balance
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-8">
          <StepIndicator step={1} current={currentStep} label="Initiate Payment" />
          <div className={`flex-1 h-1 mx-2 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
          <StepIndicator step={2} current={currentStep} label="Confirm Deposit" />
          <div className={`flex-1 h-1 mx-2 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
          <StepIndicator step={3} current={currentStep} label="Activate Order" />
        </div>

        {currentStep === 0 && (
          <div className="space-y-4">
            {/* Removed explanation box as this funds directly to order deposit account */}
          
          <div>
            <label className={`block text-sm mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-700'}`}>
              Amount to Fund (total required: ${totalCost.toFixed(6)})
            </label>
            <input
              type="number"
              step="0.000001"
              min={shortfall}
              value={fundingAmount}
              onChange={(e) => setFundingAmount(e.target.value)}
              placeholder={shortfall.toFixed(6)}
              className={`w-full px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 border ${
                theme === 'dark'
                  ? 'bg-white/5 border-white/10 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
            <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>
              {alreadyDeposited > 0 
                ? `Remaining needed: $${shortfall.toFixed(6)} (already have $${alreadyDeposited.toFixed(6)})`
                : `Includes $${makerFee.toFixed(6)} maker fee (${MAKER_FEE_PERCENT}%)`
              }
            </p>
          </div>

          <Button
            variant="primary"
            size="lg"
            onClick={handleFundFromMetanet}
            loading={loading}
            disabled={!fundingAmount || parseFloat(fundingAmount) < shortfall}
            className={`w-full ${
              theme === 'dark'
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600'
                : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600'
            }`}
          >
            <CreditCard size={20} />
            Pay ${fundingAmount || shortfall.toFixed(6)} from Metanet Balance
          </Button>
        </div>
      )}

      {currentStep > 0 && currentStep < 4 && (
        <div className="space-y-3">
          <div className={`rounded-lg p-4 text-center border ${
            theme === 'dark'
              ? 'bg-black/20 border-blue-500/30'
              : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-center justify-center mb-3">
              <RefreshCw size={20} className={`animate-spin ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />
            </div>
            <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              {currentStep === 1 && 'Processing payment...'}
              {currentStep === 2 && 'Confirming deposit...'}
              {currentStep === 3 && 'Activating order...'}
            </p>
          </div>
          
          {/* Allow going back if stuck */}
          <button
            onClick={() => {
              setCurrentStep(0);
              setLoading(false);
            }}
            className={`w-full text-xs transition-colors py-2 ${
              theme === 'dark'
                ? 'text-gray-400 hover:text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            ← Start Over
          </button>
        </div>
      )}

      {currentStep === 4 && (
        <div className={`rounded-lg p-6 text-center border ${
          theme === 'dark'
            ? 'bg-gradient-to-br from-green-500/10 to-blue-500/10 border-green-500/30'
            : 'bg-gradient-to-br from-green-50 to-blue-50 border-green-300'
        }`}>
          <div className="flex items-center justify-center mb-3">
            <CheckCircle size={48} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
          </div>
          <h3 className={`text-lg font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Order Funded Successfully!</h3>
          <p className={`text-xs mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Your order is now active in the orderbook</p>
          <Button
            variant="primary"
            onClick={onRefresh}
            className={`${
              theme === 'dark'
                ? 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600'
                : 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600'
            }`}
          >
            View Order Status
          </Button>
        </div>
      )}
    </div>
    );
  };

  const SwapFundingFlow = () => {
    const balanceLoaded = ckusdcBalance !== null;
    const currentBalance = balanceLoaded ? parseFloat(ckusdcBalance) : 0;
    
    // Calculate remaining amount needed from ETH swap
    // User needs amountNeededWithFee total, but already has currentBalance
    const remaining = Math.max(0, amountNeededWithFee - currentBalance);
    
    return (
      <div className="space-y-4">
        {currentStep === 0 && (
          <button
            onClick={() => {
              setSelectedPath(null);
              setCurrentStep(0);
            }}
            className={`text-xs hover:underline transition-colors flex items-center gap-1 ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
          >
            ← Back to funding options
          </button>
        )}

        <div className="text-center mb-3">
          <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            Swap ETH USDC to ckUSDC
          </h3>
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            Convert your Ethereum USDC to fund your order
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-8">
          <StepIndicator step={1} current={currentStep} label="Swap USDC" />
          <div className={`flex-1 h-1 mx-2 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
          <StepIndicator step={2} current={currentStep} label="Wait for ckUSDC" />
          <div className={`flex-1 h-1 mx-2 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
          <StepIndicator step={3} current={currentStep} label="Fund Order" />
          <div className={`flex-1 h-1 mx-2 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
          <StepIndicator step={4} current={currentStep} label="Activate" />
        </div>

        {currentStep === 0 && (
          <div className="space-y-4">
            {/* Explanation Box - Show math clearly */}
            <div className={`rounded-lg p-3 border ${
              theme === 'dark'
                ? 'bg-blue-500/10 border-blue-500/30'
                : 'bg-blue-50 border-blue-200'
            }`}>
              <p className={`text-xs ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                💡 Total needed: ${amountNeededWithFee.toFixed(6)} = ${shortfall.toFixed(6)} order shortfall + ${icrc1Fee.toFixed(6)} transfer fee
                {balanceLoaded && currentBalance > 0 && (
                  <>
                    <span className="block mt-1">You already have: ${currentBalance.toFixed(6)} ckUSDC</span>
                    <span className="block mt-1 font-semibold">Need from ETH swap: AT LEAST ${remaining.toFixed(6)}</span>
                  </>
                )}
                {balanceLoaded && currentBalance === 0 && (
                  <span className="block mt-1 font-semibold">Need from ETH swap: AT LEAST ${remaining.toFixed(6)}</span>
                )}
              </p>
            </div>          {/* Requirements Box */}
          <div className={`p-4 rounded-lg border ${
            theme === 'dark'
              ? 'bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500/30'
              : 'bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-300'
          }`}>
            <h4 className={`font-semibold mb-3 flex items-center gap-2 ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-700'}`}>
              <AlertCircle size={16} />
              What You Need to Deposit on Ethereum
            </h4>
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>USDC Required (minimum):</span>
                  <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>${remaining.toFixed(6)}</span>
                </div>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  ERC-20 USDC on Ethereum network (you can deposit more if you want)
                </p>
              </div>
              
              <div className={`border-t pt-2 ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>ETH for Gas:</span>
                  <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>~0.002 ETH</span>
                </div>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  Needed for approval + swap transaction fees
                </p>
              </div>

              <div className={`border-t pt-2 ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="flex items-start gap-2">
                  <span className={`text-xs mt-0.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>📍</span>
                  <div className="flex-1">
                    <p className={`text-xs mb-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Deposit to your ETH wallet address:</p>
                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
                      theme === 'dark'
                        ? 'bg-black/30 border-white/10'
                        : 'bg-white border-gray-300'
                    }`}>
                      <code className={`text-xs font-mono flex-1 break-all ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>
                        {eoaAddress}
                      </code>
                      <button
                        onClick={() => {
                          sendCommand({
                            type: "write-clipboard",
                            text: eoaAddress
                          });
                          toast.success('Address copied!');
                        }}
                        className={`transition-colors ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Current Balance Display */}
          <div className={`p-4 rounded-lg border ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/20'
              : 'bg-blue-50 border-blue-200'
          }`}>
            <h4 className={`font-semibold mb-2 flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              <Wallet size={16} />
              Your Current Ethereum Balance
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>USDC Balance:</span>
                <span className={`font-semibold ${parseFloat(ethUsdcBalance) >= remaining ? 'text-green-400' : 'text-red-400'}`}>
                  ${ethUsdcBalance}
                </span>
              </div>
              <div className="flex justify-between">
                <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>ETH Balance:</span>
                <span className={`font-semibold ${parseFloat(ethBalance) >= 0.002 ? 'text-green-400' : 'text-red-400'}`}>
                  {parseFloat(ethBalance).toFixed(4)} ETH
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className={`block text-sm mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-700'}`}>
              Amount to Swap (minimum required: ${remaining.toFixed(6)})
            </label>
            <input
              type="number"
              step="0.000001"
              min={remaining}
              max={ethUsdcBalance}
              value={fundingAmount}
              onChange={(e) => setFundingAmount(e.target.value)}
              placeholder={remaining.toFixed(6)}
              className={`w-full px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border ${
                theme === 'dark'
                  ? 'bg-white/5 border-white/10 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
            <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>
              {currentBalance > 0 
                ? `You have $${currentBalance.toFixed(6)} ckUSDC already, so you only need $${remaining.toFixed(6)} more`
                : `This will give you the ${amountNeededWithFee.toFixed(6)} ckUSDC needed to activate`
              }
            </p>
          </div>

          <Button
            variant="primary"
            size="lg"
            onClick={handleSwapAndFund}
            loading={loading}
            disabled={!fundingAmount || parseFloat(fundingAmount) < remaining || parseFloat(fundingAmount) > parseFloat(ethUsdcBalance)}
            className={`w-full ${
              theme === 'dark'
                ? 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
                : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
            }`}
          >
            <ArrowDownUp size={20} />
            Swap ${fundingAmount || remaining.toFixed(6)} to ckUSDC
          </Button>
        </div>
      )}

      {currentStep === 1 && (
        <div className="space-y-3">
          <div className={`rounded-lg p-4 text-center border ${
            theme === 'dark'
              ? 'bg-black/20 border-blue-500/30'
              : 'bg-blue-50 border-blue-200'
          }`}>
            <RefreshCw size={20} className={`animate-spin mx-auto mb-2 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Submitting swap transaction...</p>
          </div>
          
          <button
            onClick={() => {
              setCurrentStep(0);
              setLoading(false);
            }}
            className={`w-full text-xs transition-colors py-2 ${
              theme === 'dark'
                ? 'text-gray-400 hover:text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            ← Cancel
          </button>
        </div>
      )}

      {currentStep === 2 && (
        <div className="space-y-3">
          <div className={`rounded-lg p-5 text-center border ${
            theme === 'dark'
              ? 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/30'
              : 'bg-gradient-to-br from-blue-50 to-purple-50 border-blue-300'
          }`}>
            <ArrowDownUp size={32} className={`mx-auto mb-2 animate-pulse ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />
            <h3 className={`text-base font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Swap Initiated!</h3>
            <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Your ckUSDC will arrive in ~20 minutes
            </p>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>
              {t('funding.waitOrComeBack')}
            </div>
          </div>
          
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleTransferToOrder()}
            className="w-full text-sm"
          >
            Continue to Transfer (if ckUSDC arrived)
          </Button>
          
          <button
            onClick={() => {
              setSelectedPath(null);
              setCurrentStep(0);
            }}
            className={`w-full text-xs transition-colors py-2 ${
              theme === 'dark'
                ? 'text-blue-400 hover:text-blue-300'
                : 'text-blue-600 hover:text-blue-700'
            }`}
          >
            ← Back to Funding Options
          </button>
        </div>
      )}

      {currentStep === 3 && (
        <div className="space-y-3">
          <div className={`rounded-lg p-4 text-center border ${
            theme === 'dark'
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-green-50 border-green-300'
          }`}>
            <CheckCircle size={32} className={`mx-auto mb-2 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`} />
            <p className={`text-sm ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>ckUSDC received!</p>
          </div>

          <Button
            variant="primary"
            onClick={handleTransferToOrder}
            loading={loading}
            className={`w-full ${
              theme === 'dark'
                ? 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600'
                : 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600'
            }`}
          >
            Transfer ${fundingAmount || orderAmount.toFixed(6)} to Order
          </Button>
          
          <button
            onClick={() => setCurrentStep(2)}
            disabled={loading}
            className={`w-full text-xs transition-colors py-2 disabled:opacity-50 ${
              theme === 'dark'
                ? 'text-gray-400 hover:text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            ← Back
          </button>
        </div>
      )}

      {currentStep === 4 && (
        <div className={`rounded-lg p-6 text-center border ${
          theme === 'dark'
            ? 'bg-gradient-to-br from-green-500/10 to-blue-500/10 border-green-500/30'
            : 'bg-gradient-to-br from-green-50 to-blue-50 border-green-300'
        }`}>
          <CheckCircle size={48} className={`mx-auto mb-3 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`} />
          <h3 className={`text-lg font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Order Funded Successfully!</h3>
          <p className={`text-xs mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Your order is now active in the orderbook</p>
          <Button
            variant="primary"
            onClick={onRefresh}
            className={`${
              theme === 'dark'
                ? 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600'
                : 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600'
            }`}
          >
            View Order Status
          </Button>
        </div>
      )}
    </div>
    );
  };

  const StepIndicator = ({ step, current, label }) => {
    const isComplete = current > step;
    const isCurrent = current === step;
    const isUpcoming = current < step;

    return (
      <div className="flex flex-col items-center gap-2">
        <div className={`
          w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all
          ${isComplete ? 'bg-green-500 text-white' : ''}
          ${isCurrent ? (theme === 'dark' ? 'bg-purple-500 text-white' : 'bg-purple-600 text-white') + ' animate-pulse' : ''}
          ${isUpcoming ? (theme === 'dark' ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-500') : ''}
        `}>
          {isComplete ? <CheckCircle size={20} /> : step}
        </div>
        <div className={`text-xs text-center ${
          isCurrent 
            ? (theme === 'dark' ? 'text-white' : 'text-gray-900') + ' font-semibold'
            : theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
        }`}>
          {label}
        </div>
      </div>
    );
  };

  // Don't show if order is already funded
  if (order.funded_at && order.funded_at.length > 0) {
    return null;
  }

  return (
    <Card className="mb-6">
      <div className="space-y-6">
        <div className={`flex items-center gap-3 pb-4 border-b ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
          <div className={`p-3 rounded-lg ${
            theme === 'dark'
              ? 'bg-purple-500/20'
              : 'bg-purple-100'
          }`}>
            <Wallet className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={24} />
          </div>
          <div>
            <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              {alreadyDeposited > 0 ? t('funding.completeFunding') : t('funding.title')}
            </h3>
            {alreadyDeposited > 0 ? (
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                ${alreadyDeposited.toFixed(6)} already deposited. 
                Need ${shortfall.toFixed(6)} more to activate.
              </p>
            ) : (
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Choose your preferred funding method to activate your order
              </p>
            )}
          </div>
        </div>

        {!selectedPath && <PathSelectionView />}
        {selectedPath === 'metanet' && <MetanetFundingFlow />}
        {selectedPath === 'swap' && <SwapFundingFlow />}
      </div>
    </Card>
  );
};

export default OrderFundingStepper;
