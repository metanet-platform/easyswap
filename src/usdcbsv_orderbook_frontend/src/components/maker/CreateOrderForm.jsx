import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { DollarSign, AlertCircle, Loader2 } from 'lucide-react';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Input, Select, Card } from '../common';
import { MIN_CHUNK_SIZE_USD, MAX_CHUNKS_ALLOWED, MAX_ORDER_SIZE_USD, MAX_MAKER_TOTAL_ORDERS_USD, MAKER_FEE_PERCENT, ACTIVATION_FEE_PERCENT, FILLER_INCENTIVE_PERCENT, BSV_PRICE_BUFFER_PERCENT, CKUSDC_TRANSFER_FEE_USD } from '../../config';

const CreateOrderForm = ({ onOrderCreated }) => {
  const { t } = useTranslation(['topup', 'common', 'wallet']);
  const { theme } = useTheme();
  const { actor, isAuthenticated, initiatorAddress, getBalance, transferCkUSDC } = useSDK();
  
  const [formData, setFormData] = useState({
    amountUsd: MIN_CHUNK_SIZE_USD,
    maxPricePerBsv: '',
    bsvAddress: '',
  });
  
  const [loading, setLoading] = useState(false);
  const [currentBsvPrice, setCurrentBsvPrice] = useState(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [ckusdcBalance, setCkusdcBalance] = useState(0);
  const [fetchingBalance, setFetchingBalance] = useState(false);
  const [activeOrdersTotal, setActiveOrdersTotal] = useState(0);
  const [fetchingOrders, setFetchingOrders] = useState(false);
  
  // Generate amount options - no balance limit, users can see in stepper how to fund
  const getAmountOptions = () => {
    return Array.from({ length: MAX_CHUNKS_ALLOWED }, (_, i) => {
      const chunks = i + 1;
      const value = chunks * MIN_CHUNK_SIZE_USD;
      return { 
        value: value.toString(), 
        label: `$${value}`
      };
    });
  };
  
  const chunkOptions = getAmountOptions();

  // Fetch ckUSDC balance
  useEffect(() => {
    const fetchCkUsdcBalance = async () => {
      if (!isAuthenticated || !getBalance) return;
      
      setFetchingBalance(true);
      try {
        const balance = await getBalance();
        setCkusdcBalance(parseFloat(balance) || 0);
      } catch (error) {
        console.error('Error fetching ckUSDC balance:', error);
        setCkusdcBalance(0);
      } finally {
        setFetchingBalance(false);
      }
    };
    
    fetchCkUsdcBalance();
  }, [isAuthenticated, getBalance]);

  // Fetch active orders total
  useEffect(() => {
    const fetchActiveOrders = async () => {
      if (!isAuthenticated || !actor) return;
      
      setFetchingOrders(true);
      try {
        const orders = await actor.get_my_orders();
        
        // Calculate total active order value (unfilled amount only)
        const activeTotal = orders.reduce((sum, order) => {
          const status = order.status ? Object.keys(order.status)[0] : 'AwaitingDeposit';
          
          // Count only active statuses (AwaitingDeposit, Active, Idle)
          if (['AwaitingDeposit', 'Active', 'Idle'].includes(status)) {
            const orderAmount = Number(order.amount_usd || 0);
            const filledAmount = Number(order.total_filled_usd || 0);
            const remainingAmount = orderAmount - filledAmount;
            return sum + remainingAmount;
          }
          
          return sum;
        }, 0);
        
        setActiveOrdersTotal(activeTotal);
      } catch (error) {
        console.error('Error fetching active orders:', error);
        setActiveOrdersTotal(0);
      } finally {
        setFetchingOrders(false);
      }
    };
    
    fetchActiveOrders();
  }, [isAuthenticated, actor]);

  // Fetch current BSV price and prefill max price
  useEffect(() => {
    const fetchBsvPrice = async () => {
      if (!actor) return;
      
      setFetchingPrice(true);
      try {
        const priceResult = await actor.get_bsv_price();
        
        if ('Ok' in priceResult) {
          const priceNum = Number(priceResult.Ok);
          setCurrentBsvPrice(priceNum);
          
          // Set max price to current price + buffer (e.g., +2%)
          const bufferMultiplier = 1 + (BSV_PRICE_BUFFER_PERCENT / 100);
          const maxPrice = (priceNum * bufferMultiplier).toFixed(8).replace(/\.?0+$/, '');
          setFormData(prev => ({
            ...prev,
            maxPricePerBsv: maxPrice
          }));
        }
      } catch (error) {
        console.error('Error fetching BSV price:', error);
      } finally {
        setFetchingPrice(false);
      }
    };
    
    fetchBsvPrice();
  }, [actor]);

  // Prefill BSV address when user connects
  useEffect(() => {
    if (initiatorAddress && !formData.bsvAddress) {
      setFormData(prev => ({
        ...prev,
        bsvAddress: initiatorAddress
      }));
    }
  }, [initiatorAddress]);
  
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };
  
  const handleSubmit = async () => {
    if (!isAuthenticated || !actor) {
      toast.error(t('topup:form.connectWalletFirst'));
      return;
    }
    
    // Validation
    const amountUsd = parseInt(formData.amountUsd, 10);
    
    if (isNaN(amountUsd) || amountUsd <= 0) {
      toast.error(t('topup:form.enterValidAmount'));
      return;
    }
    
    if (amountUsd < MIN_CHUNK_SIZE_USD) {
      toast.error(t('topup:form.minimumAmount', { min: MIN_CHUNK_SIZE_USD }));
      return;
    }
    
    if (amountUsd > MAX_ORDER_SIZE_USD) {
      toast.error(t('topup:form.maximumAmount', { max: MAX_ORDER_SIZE_USD }));
      return;
    }
    
    if (amountUsd % MIN_CHUNK_SIZE_USD !== 0) {
      toast.error(t('topup:form.multipleAmount', { chunk: MIN_CHUNK_SIZE_USD }));
      return;
    }
    
    // Note: No balance check here - users can create orders and fund them later
    // The order details page will show funding options
    
    const maxPrice = parseFloat(formData.maxPricePerBsv);
    if (!maxPrice || maxPrice <= 0) {
      toast.error(t('topup:form.enterValidBsvPrice'));
      return;
    }
    
    if (!formData.bsvAddress || formData.bsvAddress.length < 26) {
      toast.error(t('topup:form.enterValidBsvAddress'));
      return;
    }
    
    // Check maker limit before submitting
      const newTotal = activeOrdersTotal + amountUsd;
      if (newTotal > MAX_MAKER_TOTAL_ORDERS_USD) {
        toast.error(
        t('topup:form.orderLimitExceeded', {
          activeTotal: activeOrdersTotal.toFixed(6),
          newAmount: amountUsd.toFixed(6),
          total: newTotal.toFixed(6),
          limit: MAX_MAKER_TOTAL_ORDERS_USD
        }),
        { duration: 6000 }
      );
      return;
    }    setLoading(true);
    
    try {
      // Step 1: Calculate total amount needed (order amount + maker fee + 2x transfer fees)
      // 2x transfer fees: one for wallet→canister, one for canister internal transfer
      const makerFee = amountUsd * (MAKER_FEE_PERCENT / 100);
      const transferFees = CKUSDC_TRANSFER_FEE_USD * 2;
      const totalRequired = amountUsd + makerFee + transferFees;
      
      console.log('Order creation:', {
        orderAmount: amountUsd,
        makerFee: makerFee,
        transferFees: transferFees,
        totalRequired: totalRequired,
        currentBalance: ckusdcBalance
      });
      
      // Step 2: Check if user has enough balance
      if (totalRequired > ckusdcBalance) {
        toast.error(
          t('topup:form.insufficientBalance', {
            required: totalRequired.toFixed(6),
            balance: ckusdcBalance.toFixed(6),
            shortfall: (totalRequired - ckusdcBalance).toFixed(6)
          }),
          { duration: 6000 }
        );
        return;
      }
      
      // Step 3: Transfer ckUSDC to canister user subaccount
      toast.loading(t('topup:form.transferringFunds'));
      const blockIndex = await transferCkUSDC(totalRequired);
      console.log('Transfer successful, block index:', blockIndex);
      toast.dismiss();
      
      // Step 4: Create order (backend will pull from user subaccount and activate)
      toast.loading(t('topup:form.creatingOrder'));
      const result = await actor.create_order(
        amountUsd,
        maxPrice,
        formData.bsvAddress
      );
      toast.dismiss();
      
      if ('Ok' in result) {
        const orderId = result.Ok;
        toast.success(t('topup:form.orderCreated'));
        
        // Reset form to default
        setFormData({
          amountUsd: MIN_CHUNK_SIZE_USD,
          maxPricePerBsv: '',
          bsvAddress: initiatorAddress || '',
        });
        
        // Refresh balance
        setTimeout(() => {
          const fetchCkUsdcBalance = async () => {
            try {
              const balance = await getBalance();
              setCkusdcBalance(balance);
            } catch (error) {
              console.error('Error refreshing balance:', error);
            }
          };
          fetchCkUsdcBalance();
        }, 1000);
        
        if (onOrderCreated) {
          onOrderCreated(orderId);
        }
      } else {
        // Order creation failed after transfer
        // Funds are safe in user's canister subaccount
        toast.error(
          `${t('topup:form.createFailed')}: ${result.Err}\n\n` +
          `Your ${totalRequired.toFixed(6)} ckUSDC has been transferred to your canister account and is safe. ` +
          `You can see it in the Trader page balance.`,
          { duration: 8000 }
        );
      }
    } catch (error) {
      console.error('Error creating order:', error);
      
      // Determine if transfer succeeded or not
      const errorMessage = error.message || error.toString();
      if (errorMessage.includes('Transfer failed') || errorMessage.includes('Insufficient')) {
        // Transfer failed - funds still in user's wallet
        toast.error(`${t('topup:form.transferFailed')}: ${errorMessage}`);
      } else {
        // Unknown error - could be anywhere in the flow
        toast.error(`${t('topup:form.createFailed')}: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Card className="p-2.5 sm:p-4">
      <div className="space-y-2.5 sm:space-y-3">
        {/* Conversational Header */}
        <div className={`text-center pb-2 border-b ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
          <h3 className={`text-base sm:text-lg font-bold mb-0.5 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('topup:form.swapTitle')}</h3>
          <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('topup:form.swapSubtitle')}</p>
          
          {/* Disclaimer Link */}
          <Link 
            to="/disclaimer" 
            className="inline-flex items-center gap-1 mt-1.5 text-yellow-400 hover:text-yellow-300 transition-colors text-xs"
          >
            <AlertCircle size={14} />
            <span>{t('topup:form.disclaimerLink')}</span>
          </Link>
        </div>

        {/* Amount Selection */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <label className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('topup:form.amountLabel')}</label>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              {fetchingOrders ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="animate-spin" size={10} />
                  {t('common:loading')}
                </span>
              ) : (
                <span>
                  {t('topup:form.activeOrders')}: <span className={`font-semibold ${activeOrdersTotal > MAX_MAKER_TOTAL_ORDERS_USD * 0.8 ? 'text-yellow-400' : theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    ${activeOrdersTotal.toFixed(2)}
                  </span>
                  <span className="text-gray-500"> / ${MAX_MAKER_TOTAL_ORDERS_USD}</span>
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 flex-wrap text-xs sm:text-sm">
            <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>{t('topup:form.wantToGet')}</span>
              <Select
                name="amountUsd"
                value={formData.amountUsd}
                onChange={handleChange}
                options={chunkOptions}
                className="inline-block min-w-[100px] sm:min-w-[120px]"
                disabled={fetchingBalance}
              />
            <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>{t('topup:form.dollarValueSent')}</span>
          </div>
        </div>

        {/* BSV Address */}
        <div className="space-y-1.5">
          <label className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('topup:form.toBsvAddress')}</label>
          <Input
            name="bsvAddress"
            type="text"
            value={formData.bsvAddress}
            onChange={handleChange}
            placeholder={t('topup:form.bsvAddressPlaceholder')}
            className="font-mono text-xs sm:text-sm"
          />
        </div>

        {/* Max BSV Price */}
        <div className="space-y-1.5">
          <label className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('topup:form.atMaxBsvPrice')}</label>
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>$</span>
            <input
              name="maxPricePerBsv"
              type="number"
              value={formData.maxPricePerBsv}
              onChange={handleChange}
              placeholder="50.00"
              min="0"
              step="0.01"
              disabled={fetchingPrice}
              className={`w-full pl-7 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed border ${
                theme === 'dark'
                  ? 'bg-white/5 border-white/20 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>
          {fetchingPrice ? (
            <div className="flex items-center gap-1.5 text-blue-400">
              <Loader2 className="animate-spin" size={12} />
              <span className="text-xs">{t('topup:form.fetchingPrice')}</span>
            </div>
          ) : (
            currentBsvPrice && (
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('topup:form.currentBsvPrice', { 
                  price: currentBsvPrice.toFixed(2), 
                  buffer: BSV_PRICE_BUFFER_PERCENT 
                })}
              </p>
            )
          )}
        </div>

        {/* Fee Breakdown */}
        {formData.amountUsd && (
          <div className={`rounded-lg p-3 space-y-2 text-xs ${
            theme === 'dark' 
              ? 'bg-yellow-500/10 border border-yellow-500/30' 
              : 'bg-yellow-50 border border-yellow-200'
          }`}>
            <p className={`leading-relaxed ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>
              {t('wallet:swap.feeExplanation', {
                totalFee: MAKER_FEE_PERCENT,
                activationFee: ACTIVATION_FEE_PERCENT,
                fillerIncentive: FILLER_INCENTIVE_PERCENT,
                transferFee: (CKUSDC_TRANSFER_FEE_USD * 2).toFixed(2)
              })}
              {' '}
              {t('wallet:swap.feeTotal', { 
                amount: (parseFloat(formData.amountUsd) + (parseFloat(formData.amountUsd) * (MAKER_FEE_PERCENT / 100)) + (CKUSDC_TRANSFER_FEE_USD * 2)).toFixed(6) 
              })}
            </p>
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="button"
          variant="primary"
          size="md"
          loading={loading}
          disabled={!isAuthenticated || !actor || !formData.maxPricePerBsv || !formData.bsvAddress || fetchingPrice}
          className="w-full py-2 sm:py-2.5"
          onClick={handleSubmit}
        >
          {loading ? t('topup:form.creating') : t('topup:form.createButton')}
        </Button>
        
        {/* Helper text */}
        <p className={`text-center text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          {t('topup:form.afterCreating')}
        </p>
      </div>
    </Card>
  );
};

export default CreateOrderForm;
