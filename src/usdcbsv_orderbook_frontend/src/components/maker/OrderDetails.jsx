import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Package, 
  AlertCircle,
  DollarSign,
  TrendingUp,
  Zap,
  Copy,
  Key,
  Edit2,
  Save,
  X as CloseIcon,
  Loader2
} from 'lucide-react';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Card, Loader, StatusBadge, Modal } from '../common';
import { toast } from 'react-hot-toast';
import RefundModal from './RefundModal';
import OrderFundingStepper from './OrderFundingStepper';
import { MAKER_FEE_PERCENT, ACTIVATION_FEE_PERCENT, FILLER_INCENTIVE_PERCENT } from '../../config';

/**
 * CRITICAL: TWO SEPARATE BALANCES
 * 
 * This component manages TWO completely different ckUSDC balances:
 * 
 * 1. ORDER DEPOSIT BALANCE (orderDepositBalance)
 *    - Location: order.deposit_principal + order.deposit_subaccount (IN CANISTER)
 *    - Purpose: Funds already transferred to the canister to activate this specific order
 *    - Fetched via: getBalance(order.deposit_subaccount)
 *    - Used for: Checking if order can be activated, refund calculations
 *    - Displayed as: "Order Deposit Balance" in UI
 * 
 * 2. USER WALLET BALANCE (userWalletBalance)
 *    - Location: icIdentity.getPrincipal() + default subaccount (IN USER'S CONTROL)
 *    - Purpose: User's personal ckUSDC funds that can be used to fund orders
 *    - Fetched via: getBalance() // no subaccount parameter
 *    - Used for: Showing available funds for depositing to orders
 *    - Displayed as: "Your Wallet Balance" in UI
 * 
 * ORDER LIFECYCLE STATES (Backend OrderStatus enum):
 * 
 * 1. AwaitingDeposit
 *    - Order created, waiting for user to fund it
 *    - isFunded = false
 *    - Shows funding options (Instant Activate, Fund from Metanet, Swap ETH USDC)
 *    - confirm_deposit() checks subaccount balance and updates total_deposited_usd
 *    - If balance sufficient: → Active/Idle (sets isFunded = true)
 *    - If balance insufficient: stays in AwaitingDeposit, shows shortfall
 *    - Can cancel (simple removal)
 * 
 * 2. Active
 *    - Order funded and activated (isFunded = true)
 *    - Chunks "Available" for takers
 *    - BSV price ≤ max_bsv_price
 *    - Can cancel (refund minus 1.5% activation fee)
 *    - Can edit max_bsv_price
 * 
 * 4. Idle
 *    - Order funded (isFunded = true)
 *    - BSV price > max_bsv_price
 *    - Chunks "Idle" (not available)
 *    - Can cancel (refund minus 1.5% fee)
 *    - Can edit max_bsv_price
 * 
 * 5. PartiallyFilled → Some chunks filled
 * 6. Filled → All chunks filled, order complete
 * 7. Cancelled → Refund in progress
 * 8. Refunded → Refund confirmed, order closed
 */

const OrderDetails = ({ orderId, onBack, onClose }) => {
  const { t } = useTranslation(['maker', 'common']);
  const { theme } = useTheme();
  const { actor, isAuthenticated, sendCommand, onCommand, offCommand, initiatorAddress, getBalance } = useSDK();
  const navigate = useNavigate();
  
  const [order, setOrder] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // TWO SEPARATE BALANCES - CLEARLY DEFINED:
  // 1. Order's deposit subaccount balance (in canister) - funds already transferred to activate order
  const [orderDepositBalance, setOrderDepositBalance] = useState(null);
  // 2. User's personal wallet balance (UI) - funds still in user's control  
  const [userWalletBalance, setUserWalletBalance] = useState(null);
  
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [newMaxPrice, setNewMaxPrice] = useState('');
  
  const fetchOrderData = async (showLoader = true) => {
    if (!isAuthenticated || !actor) return;
    
    if (showLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    
    try {
      // STEP 1: FAST INITIAL LOAD - Just get order and chunks, display immediately
      const [orderResult, chunksResult] = await Promise.all([
        actor.get_order(orderId),
        actor.get_order_chunks(orderId)
      ]);
      
      if (orderResult.length > 0) {
        const fetchedOrder = orderResult[0];
        setOrder(fetchedOrder);
        setChunks(chunksResult);
        
        if (!showLoader) {
          toast.success('Order refreshed');
        }
        
        // STEP 2: BACKGROUND - Check subaccount balance for funded orders or awaiting deposit
        const status = fetchedOrder.status ? Object.keys(fetchedOrder.status)[0] : 'AwaitingDeposit';
        const isFunded = fetchedOrder.funded_at && fetchedOrder.funded_at.length > 0;
        
        // Check balance for any order that may have funds or need balance info
        // This includes AwaitingDeposit, Active, Idle, and PartiallyFilled orders
        if (isFunded || ['AwaitingDeposit', 'Active', 'Idle', 'PartiallyFilled'].includes(status)) {
          // Check balance in background (non-blocking)
          checkSubaccountBalance(fetchedOrder);
        }
      } else {
        toast.error(t('errors.orderNotFound'));
        if (onClose) {
          onClose();
        } else {
          onBack?.();
        }
      }
    } catch (error) {
      console.error('Error fetching order:', error);
      toast.error(t('errors.fetchFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Check order's deposit subaccount balance (what's in the canister for this specific order)
  const checkSubaccountBalance = async (orderData) => {
    if (checkingBalance) return;
    
    setCheckingBalance(true);
    try {
      // Get the order's deposit subaccount balance from the canister
      // Must query: order.deposit_principal (canister) + order.deposit_subaccount
      const depositPrincipal = orderData.deposit_principal;
      const depositSubaccount = orderData.deposit_subaccount;
      const depositBalance = await getBalance(depositPrincipal, depositSubaccount);
      setOrderDepositBalance(depositBalance);
      console.log('💰 Order deposit balance (canister principal + order subaccount):', depositBalance);
      
      // Also get user's personal wallet balance for comparison
      const walletBalance = await getBalance(); // No params = user's principal + default subaccount
      setUserWalletBalance(walletBalance);
      console.log('💳 User wallet balance (personal, in UI):', walletBalance);
      
      // Try auto-activation ONLY if order is not yet funded and has sufficient balance
      const isFunded = orderData.funded_at && orderData.funded_at.length > 0;
      const totalCost = Number(orderData.amount_usd) * (1 + MAKER_FEE_PERCENT / 100);
      if (!isFunded && depositBalance >= totalCost) {
        console.log('✅ Order deposit has sufficient balance, attempting auto-activation...');
        await handleAutoActivate();
      }
    } catch (error) {
      console.error('Error checking balances:', error);
    } finally {
      setCheckingBalance(false);
    }
  };

  // NEW: Auto-activate order when balance is sufficient
  const handleAutoActivate = async () => {
    setActionLoading(true);
    try {
      const result = await actor.confirm_deposit(orderId);
      
      if ('Ok' in result) {
        toast.success(t('maker.orderDetails.depositConfirmed'));
        // Refresh to get updated order status
        await fetchOrderData(false);
      } else {
        const error = result.Err;
        console.error('Auto-activation failed:', error);
        toast.error(error);
      }
    } catch (error) {
      console.error('Error auto-activating order:', error);
      toast.error(t('errors.activationFailed'));
    } finally {
      setActionLoading(false);
    }
  };
  
  useEffect(() => {
    fetchOrderData();
  }, [orderId, isAuthenticated, actor]);
  
  const handleFundingComplete = () => {
    fetchOrderData(false);
  };
  
  const handleConfirmFunding = async () => {
    setActionLoading(true);
    
    try {
      console.log('🔄 Manual activation attempt for order', orderId);
      const result = await actor.confirm_deposit(orderId);
      console.log('📋 Manual activation result:', result);
      
      if ('Ok' in result) {
        toast.success('Order activated successfully!');
        fetchOrderData(false);
      } else {
        const errorMsg = result.Err || 'Activation failed';
        console.error('❌ Activation error:', errorMsg);
        toast.error(errorMsg);
      }
    } catch (error) {
      console.error('❌ Error confirming funding:', error);
      toast.error(error.message || t('errors.activationFailed'));
    } finally {
      setActionLoading(false);
    }
  };
  
  const handleCancelOrder = async () => {
    setActionLoading(true);
    try {
      const result = await actor.cancel_order(orderId);
      if ('Ok' in result) {
        toast.success(t('messages.orderCancelled'));
        setShowRefundModal(false);
        // Navigate to top-up page after cancellation
        navigate('/top-up');
      } else {
        toast.error(result.Err || t('errors.cancelFailed'));
      }
    } catch (error) {
      console.error('Error cancelling order:', error);
      toast.error(t('errors.cancelFailed'));
    } finally {
      setActionLoading(false);
    }
  };
  
  const handleUpdateMaxPrice = async () => {
    const priceValue = parseFloat(newMaxPrice);
    
    if (!priceValue || priceValue <= 0) {
      toast.error(t('details.enterValidPrice'));
      return;
    }
    
    setActionLoading(true);
    try {
      const result = await actor.update_max_bsv_price(orderId, priceValue);
      if ('Ok' in result) {
        toast.success(t('details.updateMaxPriceSuccess'));
        setEditingPrice(false);
        setNewMaxPrice('');
        fetchOrderData(false);
      } else {
        toast.error(result.Err || t('details.updateMaxPriceFailed'));
      }
    } catch (error) {
      console.error('Error updating max price:', error);
      toast.error(t('details.updateMaxPriceFailed'));
    } finally {
      setActionLoading(false);
    }
  };
  
  const startEditingPrice = () => {
    setNewMaxPrice(order.max_bsv_price.toString());
    setEditingPrice(true);
  };
  
  const cancelEditingPrice = () => {
    setEditingPrice(false);
    setNewMaxPrice('');
  };
  
  return (
    <>
      {onClose ? (
        <Modal isOpen={true} onClose={onClose} title={t('details.title')} size="lg">
          <div className="space-y-4 sm:space-y-5">
            {renderOrderContent()}
          </div>
        </Modal>
      ) : (
        <div className="space-y-4 sm:space-y-5">
          {renderOrderContent()}
        </div>
      )}
    </>
  );
  
  function renderOrderContent() {
    if (loading || !order) {
      return (
        <Card>
          <div className="flex justify-center py-8">
            <Loader size="lg" text={t('common:loading')} />
          </div>
        </Card>
      );
    }
    
    // ===== FINANCIAL CALCULATIONS =====
    const orderAmount = Number(order.amount_usd || 0);
    const makerFee = orderAmount * (MAKER_FEE_PERCENT / 100);
    const totalCost = orderAmount + makerFee;
  
  // Backend stores activation_fee_usd (1.5%) and filler_incentive_reserved (2%) separately
  // Total maker fee = activation_fee_usd + filler_incentive_reserved = 3.5%
  const actualActivationFee = order.activation_fee_usd && order.activation_fee_usd.length > 0 
    ? Number(order.activation_fee_usd[0]) 
    : 0;
  const actualFillerIncentive = order.filler_incentive_reserved && order.filler_incentive_reserved.length > 0
    ? Number(order.filler_incentive_reserved[0])
    : 0;
  const actualMakerFee = actualActivationFee + actualFillerIncentive || makerFee;
  
  // USE REAL ICRC1 BALANCE FROM ORDER'S DEPOSIT SUBACCOUNT IN CANISTER, NOT BACKEND STATE!
  // Backend total_deposited_usd is stale until confirm_deposit() is called
  const actualTotalDeposited = orderDepositBalance !== null ? orderDepositBalance : 0;
  
  // ===== ORDER STATE DETECTION =====
  const status = order.status ? Object.keys(order.status)[0] : 'AwaitingDeposit';
  
  // Order is funded when backend confirms activation (sets funded_at)
  console.log(`🔍 DEBUG Order ${order.id}: `,order);
  const isFunded = order.funded_at && order.funded_at.length > 0;
  
  // State flags for UI rendering
  const isAwaitingDeposit = status === 'AwaitingDeposit';
  const isActive = status === 'Active';
  const isIdle = status === 'Idle';
  const isPartiallyFilled = status === 'PartiallyFilled';
  const isFilled = status === 'Filled';
  const isCancelled = status === 'Cancelled';
  const isRefunded = status === 'Refunded';
  
  // UI rendering decisions based on deposit status
  // Only show shortfall if we have a valid balance check (not null)
  const hasShortfall = orderDepositBalance !== null && actualTotalDeposited > 0 && actualTotalDeposited < totalCost;
  
  // Show funding stepper if awaiting deposit
  const showFundingStepper = isAwaitingDeposit && !isFunded;
  
  // ===== CHUNK STATISTICS =====
  const chunksByStatus = chunks.reduce((acc, chunk) => {
    const chunkStatus = chunk.status ? Object.keys(chunk.status)[0] : 'Available';
    if (!acc[chunkStatus]) acc[chunkStatus] = [];
    acc[chunkStatus].push(chunk);
    return acc;
  }, {});
  
  const filledCount = chunksByStatus.Filled?.length || 0;
  const lockedCount = chunksByStatus.Locked?.length || 0;
  const availableCount = chunksByStatus.Available?.length || 0;
  const idleCount = chunksByStatus.Idle?.length || 0;
  const refundingCount = chunksByStatus.Refunding?.length || 0;
  const refundedCount = chunksByStatus.Refunded?.length || 0;
  
  // ===== CANCELLATION LOGIC =====
  // Can cancel if not fully filled and in a cancellable state
  const refundableChunks = chunks.filter(chunk => {
    const chunkStatus = chunk.status ? Object.keys(chunk.status)[0] : 'Available';
    return ['Available', 'Idle'].includes(chunkStatus);
  });
  
  const canCancel = refundableChunks.length > 0 && 
    ['AwaitingDeposit', 'Active', 'Idle', 'PartiallyFilled'].includes(status);
  
  // Can edit max price only if there are Available or Idle chunks
  // Locked/Filled chunks keep their trade price, only Available/Idle can be updated
  const editableChunks = chunks.filter(chunk => {
    const chunkStatus = chunk.status ? Object.keys(chunk.status)[0] : 'Available';
    return ['Available', 'Idle'].includes(chunkStatus);
  });
  const canEditPrice = isFunded && editableChunks.length > 0;
  
  // ===== FORMATTING HELPERS =====
  const formatUsd = (amount, decimals = 6) => {
    const num = Number(amount);
    return `$${num.toFixed(decimals)}`;
  };
  
  const formatPrice = (price) => `$${Number(price).toFixed(8).replace(/\.?0+$/, '')}`;
  
  const getChunkStatusColor = (status) => {
    const colors = {
      Filled: 'text-green-400 bg-green-400/10',
      Locked: 'text-yellow-400 bg-yellow-400/10',
      Available: 'text-blue-400 bg-blue-400/10',
      Idle: 'text-orange-400 bg-orange-400/10',
      Refunding: 'text-purple-400 bg-purple-400/10',
      Refunded: 'text-gray-400 bg-gray-400/10',
    };
    return colors[status] || 'text-gray-400 bg-gray-400/10';
  };
  
    return (
      <>
        {/* Show shortfall warning if deposit detected but insufficient */}
        {hasShortfall && !isFunded && (
        <Card>
          <div className={`rounded-xl p-4 border ${
            theme === 'dark'
              ? 'bg-gradient-to-r from-red-500/10 to-orange-500/10 border-red-500/30'
              : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-300'
          }`}>
            <div className="flex items-start gap-3">
              <AlertCircle size={24} className={theme === 'dark' ? 'text-red-400' : 'text-red-600'} />
              <div className="flex-1">
                <h3 className={`font-semibold mb-2 ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
                  {t('details.partialDepositDetected')}
                </h3>
                <div className="space-y-1 text-sm mb-3">
                  <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('details.currentBalance')}</span>{' '}
                    <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatUsd(actualTotalDeposited)}</span>
                  </p>
                  <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('details.required')}</span>{' '}
                    <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatUsd(totalCost)}</span>
                  </p>
                  <p className={theme === 'dark' ? 'text-red-300' : 'text-red-700'}>
                    <span className={theme === 'dark' ? 'text-red-400' : 'text-red-600'}>{t('details.shortfall')}</span>{' '}
                    <span className={`font-bold ${theme === 'dark' ? 'text-red-400' : 'text-red-700'}`}>{formatUsd(totalCost - actualTotalDeposited)}</span>
                  </p>
                </div>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('details.sendRemainingAmount')}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}
      
      {/* Show funding stepper only for unfunded orders awaiting deposit */}
      {showFundingStepper && (
        <>
          {/* NEW: Dynamic UI based on order's deposit subaccount balance */}
          {orderDepositBalance !== null && orderDepositBalance >= totalCost ? (
            <Card>
              <div className={`rounded-xl p-3 sm:p-4 border ${theme === 'dark' ? 'bg-gradient-to-r from-green-500/10 to-blue-500/10 border-green-500/30' : 'bg-gradient-to-r from-green-50 to-blue-50 border-green-300'}`}>
                <div className="flex items-start gap-2 sm:gap-3">
                  <CheckCircle size={20} className={`flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`} />
                  <div className="flex-1">
                    <h3 className={`font-semibold mb-1.5 sm:mb-2 text-sm sm:text-base ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>
                      {t('details.orderFullyFunded')}
                    </h3>
                    <div className="space-y-0.5 sm:space-y-1 text-xs sm:text-sm mb-2 sm:mb-3">
                      <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                        <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('details.orderDepositBalance')}</span>{' '}
                        <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatUsd(orderDepositBalance)}</span>
                      </p>
                      <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                        <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('details.required')}</span>{' '}
                        <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatUsd(totalCost)}</span>
                      </p>
                    </div>
                    <Button
                      onClick={handleAutoActivate}
                      disabled={actionLoading}
                      className="w-full mt-1 sm:mt-2 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-sm py-2"
                    >
                      {actionLoading ? (
                        <>
                          <Loader2 className="animate-spin mr-1.5" size={14} />
                          {t('details.activatingOrder')}
                        </>
                      ) : (
                        <>
                          <CheckCircle className="mr-1.5" size={14} />
                          {t('details.activateOrderNow')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <OrderFundingStepper 
              order={order}
              onFundingComplete={handleFundingComplete}
              onRefresh={() => fetchOrderData(false)}
              orderDepositBalance={orderDepositBalance} // Order's deposit subaccount balance (in canister)
            />
          )}
        </>
      )}
      
      {/* Checking balance indicator */}
      {checkingBalance && showFundingStepper && (
        <div className="text-center py-1.5 sm:py-2">
          <Loader2 className={`animate-spin inline-block ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} size={18} />
          <span className={`ml-2 text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.checkingBalance')}</span>
        </div>
      )}
      
      {/* Order funding status */}
      
      <Card>
        <div className="space-y-3 sm:space-y-4">
          <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 pb-2.5 sm:pb-3 border-b ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
            {!onClose && (
              <Button variant="secondary" size="sm" onClick={() => navigate('/past-orders', { state: { fromOrderDetails: true } })} className="text-xs sm:text-sm py-1.5 sm:py-2">
                <ArrowLeft size={14} />
                <span className="hidden sm:inline">Back to Orders</span>
              </Button>
            )}
            <div className={`flex items-center gap-2 ${onClose ? 'w-full justify-end' : ''}`}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchOrderData(false)}
                disabled={refreshing}
                className="p-1.5 sm:p-2"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </Button>
              <StatusBadge status={status} type="order" />
            </div>
          </div>
          
          <div className={`rounded-xl p-2.5 sm:p-3 border ${
            theme === 'dark'
              ? 'bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/20'
              : 'bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200'
          }`}>
            <h3 className={`font-bold text-sm sm:text-base mb-2 sm:mb-3 flex items-center gap-1.5 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              <DollarSign size={16} className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} />
              {t('details.financialBreakdown')}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1.5 sm:space-y-2">
                <div className="flex justify-between items-center">
                  <span className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.orderAmount')}</span>
                  <span className={`font-semibold text-sm sm:text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatUsd(orderAmount)}</span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.makerFee', { fee: MAKER_FEE_PERCENT })}</span>
                  <span className={`font-semibold text-xs sm:text-sm ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>{formatUsd(actualMakerFee)}</span>
                </div>
                
                <div className={`h-px my-1 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-300'}`}></div>
                
                <div className="flex justify-between items-center">
                  <span className={`font-bold text-xs sm:text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('details.totalRequired')}</span>
                  <span className={`font-bold text-base sm:text-lg ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>{formatUsd(totalCost)}</span>
                </div>
                
                {/* Only show Deposited/Shortfall for AwaitingDeposit status AND not yet funded */}
                {status === 'AwaitingDeposit' && !isFunded && actualTotalDeposited > 0 && (
                  <>
                    <div className={`h-px my-1 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-300'}`}></div>
                    <div className="flex justify-between items-center">
                      <span className={`text-xs sm:text-sm flex items-center gap-1 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                        <CheckCircle size={14} />
                        {t('details.deposited')}
                      </span>
                      {checkingBalance ? (
                        <div className="flex items-center gap-2">
                          <RefreshCw size={14} className={`animate-spin ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`} />
                          <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('common:loading')}</span>
                        </div>
                      ) : (
                        <span className={`font-semibold text-sm sm:text-base ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>{formatUsd(actualTotalDeposited)}</span>
                      )}
                    </div>
                    
                    {actualTotalDeposited < totalCost && !checkingBalance && (
                      <div className="flex justify-between items-center">
                        <span className={`text-xs sm:text-sm flex items-center gap-1 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>
                          <AlertCircle size={14} />
                          {t('details.shortfall')}
                        </span>
                        <span className={`font-semibold text-sm sm:text-base ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>
                          {formatUsd(totalCost - actualTotalDeposited)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                
                {status === 'AwaitingDeposit' && !isFunded && actualTotalDeposited === 0 && checkingBalance && (
                  <>
                    <div className={`h-px my-1 sm:my-2 ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-300'}`}></div>
                    <div className="flex justify-between items-center">
                      <span className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.checkingBalance')}</span>
                      <RefreshCw size={16} className={`animate-spin ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`} />
                    </div>
                  </>
                )}
              </div>
              
              <div className="space-y-1.5 sm:space-y-2">
                <div className={`p-2 sm:p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-200'}`}>
                  <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                    {t('details.feeInfoMaker', {
                      totalFee: MAKER_FEE_PERCENT,
                      activationFee: ACTIVATION_FEE_PERCENT,
                      fillerIncentive: FILLER_INCENTIVE_PERCENT
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Order-Specific Deposit Address - Only show when awaiting deposit */}
          {isAwaitingDeposit && !isFunded && order.deposit_principal && order.deposit_subaccount && (
            <div className={`rounded-xl p-2.5 sm:p-3 border ${theme === 'dark' ? 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/20' : 'bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200'}`}>
              <h3 className={`font-bold text-sm sm:text-base mb-2 sm:mb-2.5 flex items-center gap-1.5 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                <Key size={16} className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} />
                {t('details.orderDepositAddress')}
              </h3>
              
              <div className="space-y-1.5 sm:space-y-2">
                {/* Complete Deposit Address (Primary Display) */}
                <div>
                  <label className={`text-xs block mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.completeDepositAddress')}</label>
                  <div className={`flex items-center gap-1.5 sm:gap-2 rounded-lg p-1.5 sm:p-2 border ${theme === 'dark' ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-400/30' : 'bg-gradient-to-r from-blue-100 to-purple-100 border-blue-300'}`}>
                    <code className={`font-mono text-xs flex-1 break-all ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                      {order.deposit_principal}.{order.deposit_subaccount}
                    </code>
                    <button
                      onClick={() => {
                        const fullAddress = `${order.deposit_principal}.${order.deposit_subaccount}`;
                        sendCommand({
                          type: "write-clipboard",
                          text: fullAddress
                        });
                        toast.success(t('details.depositAddressCopied'));
                      }}
                      className={`p-1 sm:p-1.5 rounded transition-colors flex-shrink-0 ${theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-200'}`}
                      title={t('common:copy')}
                    >
                      <Copy size={12} className={theme === 'dark' ? 'text-blue-400 hover:text-white' : 'text-blue-600 hover:text-gray-900'} />
                    </button>
                  </div>
                </div>
                
                {/* Breakdown (Secondary Info) */}
                <details className={`rounded-lg ${theme === 'dark' ? 'bg-black/20' : 'bg-gray-100'}`}>
                  <summary className={`text-xs p-2 cursor-pointer transition-colors ${theme === 'dark' ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-700'}`}>
                    {t('details.showAddressBreakdown')}
                  </summary>
                  <div className={`p-2 space-y-2 border-t ${theme === 'dark' ? 'border-white/5' : 'border-gray-200'}`}>
                    <div>
                      <label className={`text-[10px] block mb-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>{t('details.principalCanister')}</label>
                      <code className={`font-mono text-[10px] block break-all ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                        {order.deposit_principal}
                      </code>
                    </div>
                    <div>
                      <label className={`text-[10px] block mb-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>{t('details.subaccountOrderSpecific')}</label>
                      <code className={`font-mono text-[10px] block break-all ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>
                        {order.deposit_subaccount}
                      </code>
                    </div>
                  </div>
                </details>
                
                <div className={`mt-2 p-2 rounded-lg border ${theme === 'dark' ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-200'}`}>
                  <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                    {t('details.depositAddressInfo')}
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            <div className={`rounded-lg p-3 sm:p-4 border ${
              theme === 'dark'
                ? 'bg-white/5 border-white/10'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <h3 className={`text-xs flex items-center gap-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  <TrendingUp size={14} />
                  {t('details.maxBsvPrice')}
                </h3>
                {!editingPrice && canEditPrice && (
                  <button
                    onClick={startEditingPrice}
                    disabled={actionLoading}
                    className={`transition-colors disabled:opacity-50 ${
                      theme === 'dark'
                        ? 'text-blue-400 hover:text-blue-300'
                        : 'text-blue-600 hover:text-blue-700'
                    }`}
                    title={t('details.editMaxPrice')}
                  >
                    <Edit2 size={14} />
                  </button>
                )}
              </div>
              
              {editingPrice ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`flex-1 flex items-center gap-1 rounded px-2 py-1 ${
                      theme === 'dark' ? 'bg-white/10' : 'bg-white border border-gray-300'
                    }`}>
                      <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>$</span>
                      <input
                        type="number"
                        value={newMaxPrice}
                        onChange={(e) => setNewMaxPrice(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateMaxPrice();
                          if (e.key === 'Escape') cancelEditingPrice();
                        }}
                        className={`bg-transparent text-base font-bold outline-none w-full ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}
                        placeholder={t('details.enterNewPrice')}
                        autoFocus
                        disabled={actionLoading}
                      />
                    </div>
                    <button
                      onClick={handleUpdateMaxPrice}
                      disabled={actionLoading}
                      className={`transition-colors disabled:opacity-50 ${
                        theme === 'dark'
                          ? 'text-green-400 hover:text-green-300'
                          : 'text-green-600 hover:text-green-700'
                      }`}
                      title={t('details.save')}
                    >
                      <Save size={16} />
                    </button>
                    <button
                      onClick={cancelEditingPrice}
                      disabled={actionLoading}
                      className={`transition-colors disabled:opacity-50 ${
                        theme === 'dark'
                          ? 'text-red-400 hover:text-red-300'
                          : 'text-red-600 hover:text-red-700'
                      }`}
                      title={t('details.cancel')}
                    >
                      <CloseIcon size={16} />
                    </button>
                  </div>
                  {(lockedCount > 0) && (
                    <p className={`text-xs ${theme === 'dark' ? 'text-yellow-400/80' : 'text-yellow-600'}`}>
                      {t('details.chunksLockedWarning', { 
                        count: lockedCount,
                        s: (lockedCount) > 1 ? t('details.pluralS') : '',
                        possessive: (lockedCount) > 1 ? t('details.possessivePlural') : t('details.possessiveSingular')
                      })}
                    </p>
                  )}
                </div>
              ) : (
                <p className={`text-lg sm:text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatPrice(order.max_bsv_price)}</p>
              )}
            </div>
            
            <div className={`rounded-lg p-3 sm:p-4 border ${
              theme === 'dark'
                ? 'bg-white/5 border-white/10'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <h3 className={`text-xs mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.partialFill')}</h3>
              <p className={`text-lg sm:text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                {order.allow_partial_fill ? (
                  <span className={`flex items-center gap-2 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                    <CheckCircle size={18} sm:size={20} /> {t('details.yes')}
                  </span>
                ) : (
                  <span className={`flex items-center gap-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    <XCircle size={18} sm:size={20} /> {t('details.no')}
                  </span>
                )}
              </p>
            </div>
            
            <div className={`rounded-lg p-3 sm:p-4 border ${
              theme === 'dark'
                ? 'bg-white/5 border-white/10'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <h3 className={`text-xs mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.totalChunks')}</h3>
              <p className={`text-lg sm:text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{chunks.length}</p>
            </div>
          </div>

          <div className={`rounded-lg p-3 sm:p-4 border ${
            theme === 'dark'
              ? 'bg-white/5 border-white/10'
              : 'bg-gray-50 border-gray-200'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <Package className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={18} />
              <h3 className={`font-semibold text-sm sm:text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('details.chunksStatus')}</h3>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
              {filledCount > 0 && (
                <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg ${getChunkStatusColor('Filled')}`}>
                  <div className="text-xs opacity-75">{t('details.filled')}</div>
                  <div className="text-base sm:text-lg font-bold">{filledCount}</div>
                </div>
              )}
              {lockedCount > 0 && (
                <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg ${getChunkStatusColor('Locked')}`}>
                  <div className="text-xs opacity-75">{t('details.locked')}</div>
                  <div className="text-base sm:text-lg font-bold">{lockedCount}</div>
                </div>
              )}
              {availableCount > 0 && (
                <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg ${getChunkStatusColor('Available')}`}>
                  <div className="text-xs opacity-75">{t('details.available')}</div>
                  <div className="text-base sm:text-lg font-bold">{availableCount}</div>
                </div>
              )}
              {idleCount > 0 && (
                <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg ${getChunkStatusColor('Idle')}`}>
                  <div className="text-xs opacity-75">{t('details.idle')}</div>
                  <div className="text-base sm:text-lg font-bold">{idleCount}</div>
                </div>
              )}
              {refundingCount > 0 && (
                <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg ${getChunkStatusColor('Refunding')}`}>
                  <div className="text-xs opacity-75">{t('details.refunding')}</div>
                  <div className="text-base sm:text-lg font-bold">{refundingCount}</div>
                </div>
              )}
              {refundedCount > 0 && (
                <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg ${getChunkStatusColor('Refunded')}`}>
                  <div className="text-xs opacity-75">{t('details.refunded')}</div>
                  <div className="text-base sm:text-lg font-bold">{refundedCount}</div>
                </div>
              )}
            </div>
            
            {idleCount > 0 && (
              <div className={`mt-3 sm:mt-4 p-2.5 sm:p-3 rounded-lg border ${
                theme === 'dark'
                  ? 'bg-orange-500/10 border-orange-500/20'
                  : 'bg-orange-50 border-orange-300'
              }`}>
                <div className="flex items-start gap-2">
                  <AlertCircle className={`flex-shrink-0 mt-0.5 ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`} size={16} />
                  <div className="flex-1">
                    <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-orange-300' : 'text-orange-700'}`}>
                      {idleCount === 1 
                        ? t('details.idleChunkWarningSingular', { count: idleCount })
                        : t('details.idleChunksWarningPlural', { count: idleCount })}
                    </p>
                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-orange-200/70' : 'text-orange-600'}`}>
                      {t('details.idleChunksInfo', { price: formatPrice(order.max_bsv_price), target: idleCount > 1 ? t('details.theseChunks') : t('details.thisChunk') })}
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {availableCount > 0 && status === 'Active' && (
              <div className={`mt-4 p-3 rounded-lg border ${
                theme === 'dark'
                  ? 'bg-blue-500/10 border-blue-500/20'
                  : 'bg-blue-50 border-blue-200'
              }`}>
                <div className="flex items-start gap-2">
                  <Zap className={`flex-shrink-0 mt-0.5 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} size={16} />
                  <p className={`text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                    {availableCount === 1 
                      ? t('details.availableChunkInfoSingular', { count: availableCount })
                      : t('details.availableChunksInfoPlural', { count: availableCount })
                    }
                  </p>
                </div>
              </div>
            )}
          </div>
          
          <div>
            <h3 className={`text-sm mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('details.bsvReceivingAddress')}</h3>
            <div className={`rounded-lg p-3 border ${
              theme === 'dark'
                ? 'bg-white/5 border-white/10'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <p className={`text-sm font-mono break-all ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{order.bsv_address}</p>
            </div>
          </div>
          
          <div className={`flex gap-3 sm:gap-4 flex-col sm:flex-row pt-3 sm:pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
            {/* Activation button removed - orders activate automatically when balance is sufficient */}
            
            {canCancel && (
              <Button
                variant="danger"
                size="lg"
                onClick={() => setShowRefundModal(true)}
                disabled={actionLoading}
                className="flex-1 text-sm sm:text-base py-2 sm:py-2.5"
              >
                <XCircle size={18} />
                {isFunded ? t('details.cancelAndRefund') : t('details.cancelOrder')}
              </Button>
            )}
          </div>
        </div>
      </Card>
      
      <RefundModal
        isOpen={showRefundModal}
        onClose={() => setShowRefundModal(false)}
        onConfirm={handleCancelOrder}
        order={order}
        chunks={chunks}
        loading={actionLoading}
        isFunded={isFunded}
        orderDepositBalance={orderDepositBalance}
      />
      </>
    );
  }
};

export default OrderDetails;
