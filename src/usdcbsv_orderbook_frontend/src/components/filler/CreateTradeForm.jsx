import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DollarSign, AlertCircle, Loader2, TrendingUp, Lock, Zap, CheckCircle, Clock, Award } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Input, Modal, Select } from '../common';
import { 
  MIN_CHUNK_SIZE_USD,
  MAX_CHUNKS_ALLOWED,
  SECURITY_DEPOSIT_PERCENT,
  FILLER_INCENTIVE_PERCENT,
  TRADE_TIMEOUT_MINUTES,
  CONFIRMATION_DEPTH,
  USDC_RELEASE_WAIT_HOURS,
  TRADE_CLAIM_EXPIRY_HOURS
} from '../../config';

const CreateTradeForm = ({ isOpen, onClose, onTradeCreated }) => {
  const { t } = useTranslation(['filler', 'common']);
  const { theme } = useTheme();
  const { actor } = useSDK();
  const [amount, setAmount] = useState(MIN_CHUNK_SIZE_USD);
  const [loading, setLoading] = useState(false);
  const [currentBsvPrice, setCurrentBsvPrice] = useState(null);
  const [calculatedMinPrice, setCalculatedMinPrice] = useState(null);
  const [availableOrderbook, setAvailableOrderbook] = useState(null);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  
  // Generate chunk options (1-MAX_CHUNKS_ALLOWED chunks)
  const chunkOptions = Array.from({ length: MAX_CHUNKS_ALLOWED }, (_, i) => {
    const chunks = i + 1;
    const value = chunks * MIN_CHUNK_SIZE_USD;
    return { 
      value: value.toString(), 
      label: `$${value}`
    };
  });
  
  // Calculate amounts using config values from imported constants
  const securityRequired = amount * (SECURITY_DEPOSIT_PERCENT / 100);
  const potentialEarnings = amount * (FILLER_INCENTIVE_PERCENT / 100);
  const totalPayout = amount + potentialEarnings;
  
  // Fetch BSV price and orderbook data
  useEffect(() => {
    const fetchData = async () => {
      if (!actor) return;
      
      setFetchingPrices(true);
      try {
        // Fetch BSV price
        const priceResult = await actor.get_bsv_price();
        
        if ('Ok' in priceResult) {
          const priceNum = Number(priceResult.Ok);
          setCurrentBsvPrice(priceNum);
          
          // Calculate min price to current price - 0.5%
          const minPrice = priceNum * 0.995;
          setCalculatedMinPrice(minPrice);
        }
        
        // Fetch available orderbook balance
        const orderbookBalance = await actor.get_available_orderbook();
        setAvailableOrderbook(Number(orderbookBalance));
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setFetchingPrices(false);
      }
    };
    
    fetchData();
  }, [actor]);
  
  const handleSubmit = async () => {
    if (!actor) {
      toast.error(t('createTrade.connectWalletFirst'));
      return;
    }
    
    const amountUsd = parseInt(amount, 10);
    if (amountUsd < MIN_CHUNK_SIZE_USD) {
      toast.error(t('createTrade.minimumAmount', { amount: MIN_CHUNK_SIZE_USD }));
      return;
    }
    
    if (amountUsd % MIN_CHUNK_SIZE_USD !== 0) {
      toast.error(t('createTrade.amountMultiple', { amount: MIN_CHUNK_SIZE_USD }));
      return;
    }
    
    if (!calculatedMinPrice || calculatedMinPrice <= 0) {
      toast.error(t('createTrade.unableToFetchPrice'));
      return;
    }
    
    // Info message if partial fill will occur
    if (availableOrderbook !== null && amountUsd > availableOrderbook) {
      toast(t('createTrade.partialOrderInfo', { available: availableOrderbook.toFixed(2) }), { 
        icon: 'ℹ️',
        duration: 4000 
      });
    }
    
    setLoading(true);
    try {
      const request = {
        requested_usd: amountUsd,
        allow_partial: true, // Always true now (backend ignores this)
        min_bsv_price: calculatedMinPrice,
      };
      
      const result = await actor.create_trades(request);
      
      if ('Ok' in result) {
        const tradeIds = result.Ok;
        const tradeCount = tradeIds.length;
        
        if (tradeCount === 0) {
          toast.error(t('createTrade.noTradesCreated'));
        } else if (tradeCount === 1) {
          toast.success(t('createTrade.singleTradeCreated'));
        } else {
          toast.success(t('createTrade.multipleTradesCreated', { count: tradeCount }));
        }
        
        setAmount(MIN_CHUNK_SIZE_USD);
        onTradeCreated?.(tradeIds);
        onClose();
      } else {
        toast.error(result.Err || t('createTrade.createFailed'));
      }
    } catch (error) {
      console.error('Error creating trades:', error);
      toast.error(t('createTrade.createFailed'));
    } finally {
      setLoading(false);
    }
  };
  
  const isDark = theme === 'dark';
  
  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Zap className="text-yellow-400" size={20} />
          <span>{t('createTrade.title')}</span>
        </div>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        {/* Disclaimer Link */}
        <Link 
          to="/disclaimer" 
          className="inline-flex items-center gap-1.5 text-yellow-400 hover:text-yellow-300 transition-colors text-sm"
          onClick={(e) => {
            onClose();
          }}
        >
          <AlertCircle size={16} />
          <span>{t('createTrade.disclaimerLink')}</span>
        </Link>

        {/* Amount Selection */}
        <div className="space-y-3">
          <label className={`block text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
            {t('createTrade.selectAmount')}
          </label>
          <Select
            value={amount.toString()}
            onChange={(e) => setAmount(Number(e.target.value))}
            options={chunkOptions}
            disabled={loading}
            className="w-full"
          />
          
          {/* Available Orderbook Info */}
          <div className={`text-sm rounded-lg p-3 border ${
            isDark ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
          }`}>
            {fetchingPrices ? (
              <div className="flex items-center gap-2 text-blue-400">
                <Loader2 className="animate-spin" size={16} />
                <span>{t('createTrade.loadingAvailability')}</span>
              </div>
            ) : availableOrderbook !== null ? (
              <div className="space-y-1">
                <p className={`font-medium ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                  💎 {t('createTrade.available')}: ${availableOrderbook.toFixed(2)} USDC
                </p>
                {currentBsvPrice && (
                  <p className={`text-xs ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                    {t('createTrade.currentBsv')}: ${currentBsvPrice.toFixed(2)} | {t('createTrade.minPrice')}: ${calculatedMinPrice?.toFixed(2)}
                  </p>
                )}
              </div>
            ) : (
              <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>
                💎 {t('createTrade.noOrdersAvailable')}
              </p>
            )}
          </div>
        </div>

        {/* Financial Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Security Required */}
          <div className={`rounded-lg p-3 border ${
            isDark ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <Lock size={14} className={isDark ? 'text-red-400' : 'text-red-600'} />
              <span className={`text-xs font-medium ${isDark ? 'text-red-300' : 'text-red-700'}`}>
                {t('createTrade.security')} ({SECURITY_DEPOSIT_PERCENT}%)
              </span>
            </div>
            <p className={`text-lg font-bold ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              ${securityRequired.toFixed(2)}
            </p>
          </div>

          {/* Liquidity Bonus */}
          <div className={`rounded-lg p-3 border ${
            isDark ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={14} className={isDark ? 'text-green-400' : 'text-green-600'} />
              <span className={`text-xs font-medium ${isDark ? 'text-green-300' : 'text-green-700'}`}>
                {t('createTrade.bonus')} ({FILLER_INCENTIVE_PERCENT}%)
              </span>
            </div>
            <p className={`text-lg font-bold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
              +${potentialEarnings.toFixed(2)}
            </p>
          </div>

          {/* Total Payout */}
          <div className={`rounded-lg p-3 border ${
            isDark ? 'bg-purple-500/10 border-purple-500/30' : 'bg-purple-50 border-purple-200'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={14} className={isDark ? 'text-purple-400' : 'text-purple-600'} />
              <span className={`text-xs font-medium ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
                {t('createTrade.totalPayout')}
              </span>
            </div>
            <p className={`text-lg font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
              ${totalPayout.toFixed(2)}
            </p>
          </div>
        </div>

        {/* How it Works */}
        <div className={`rounded-lg p-4 space-y-3 border ${
          isDark ? 'bg-purple-500/10 border-purple-500/30' : 'bg-purple-50 border-purple-200'
        }`}>
          <h4 className={`text-sm font-semibold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {t('createTrade.whatHappensNext')}
          </h4>
          <ol className={`space-y-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <li className="flex gap-2">
              <span className="text-purple-400 font-bold flex-shrink-0">1.</span>
              <span>{t('createTrade.step1Chunks', { amount })}</span>
            </li>
            <li className="flex gap-2 items-start">
              <span className="text-purple-400 font-bold flex-shrink-0">2.</span>
              <div>
                <div className="flex items-center gap-1">
                  <Clock size={14} className="text-orange-400" />
                  <span>{t('createTrade.step2Send', { minutes: TRADE_TIMEOUT_MINUTES })}</span>
                </div>
                <p className="text-xs text-orange-400 mt-1">
                  {t('createTrade.step2Penalty', { percent: SECURITY_DEPOSIT_PERCENT })}
                </p>
              </div>
            </li>
            <li className="flex gap-2 items-start">
              <span className="text-purple-400 font-bold flex-shrink-0">3.</span>
              <div>
                <div className="flex items-center gap-1">
                  <Award size={14} className="text-green-400" />
                  <span>{t('createTrade.step3Claim', { 
                    confirmations: CONFIRMATION_DEPTH,
                    hours: USDC_RELEASE_WAIT_HOURS,
                    amount: totalPayout.toFixed(2)
                  })}</span>
                </div>
                <p className="text-xs text-yellow-400 mt-1">
                  {t('createTrade.step3Timeout', { hours: TRADE_CLAIM_EXPIRY_HOURS })}
                </p>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="text-purple-400 font-bold flex-shrink-0">4.</span>
              <span>{t('createTrade.step4Return', { amount: securityRequired.toFixed(2) })}</span>
            </li>
          </ol>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-2">
          <Button 
            variant="secondary" 
            onClick={onClose} 
            className="w-full sm:flex-1 h-10"
            disabled={loading}
          >
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={!amount || !calculatedMinPrice || !actor || fetchingPrices}
            className="w-full sm:flex-1 h-10"
            onClick={handleSubmit}
          >
            {loading ? t('createTrade.creatingTrade') : t('createTrade.lockChunks', { amount })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateTradeForm;
