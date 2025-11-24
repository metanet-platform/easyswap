import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingUp, RefreshCw } from 'lucide-react';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Card, Loader } from '../common';
import { toast } from 'react-hot-toast';
import { SECURITY_DEPOSIT_PERCENT } from '../../config';

const AccountOverview = ({ onDeposit, onWithdraw, subaccountAddress, balance, loadingBalance }) => {
  const { t } = useTranslation(['filler', 'common']);
  const { theme } = useTheme();
  const { actor, isAuthenticated, userPrincipal } = useSDK();
  const [account, setAccount] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const fetchAccount = async () => {
    if (!isAuthenticated || !actor) return;
    
    setLoading(true);
    try {
      // Fetch account info and trades (fast, no inter-canister calls)
      const [accountResult, tradesResult] = await Promise.all([
        actor.get_my_filler_account(),
        actor.get_my_trades()
      ]);
      
      console.log('Filler account result:', accountResult);
      if (accountResult.length > 0) {
        setAccount(accountResult[0]);
        console.log('Account data:', accountResult[0]);
        console.log('📊 pending_trades_total:', accountResult[0].pending_trades_total);
        console.log('🔒 Locked amount (5%):', accountResult[0].pending_trades_total * 0.05);
      } else {
        setAccount(null); // No account yet, that's fine
        console.log('No account found');
      }
      
      console.log('My trades:', tradesResult);
      setTrades(tradesResult || []);
    } catch (error) {
      console.error('Error fetching account:', error);
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchAccount();
  }, [isAuthenticated, actor]);
  
  const formatCkUSDC = (amountE6s) => {
    // Convert from e6s to ckUSDC (1 ckUSDC = 1e6 e6s, ckUSDC has 6 decimals)
    return (Number(amountE6s) / 1e6).toFixed(2);
  };
  
  const formatUsd = (amount) => {
    // Amount already in dollars
    return Number(amount).toFixed(2);
  };
  
  const calculateLockCapacity = () => {
    return 100 / SECURITY_DEPOSIT_PERCENT; // If 10% security, can lock up to 10x
  };
  
  const calculateAvailableLockAmount = () => {
    if (balance === null) return 0;
    const securityBalance = Number(balance) / 1e6; // Convert e6s to ckUSDC
    const pendingTrades = account ? Number(account.pending_trades_total) : 0; // Already in USD
    const maxLockCapacity = securityBalance * (100 / SECURITY_DEPOSIT_PERCENT); // 10% security allows locking 10x
    const available = maxLockCapacity - pendingTrades;
    return Math.max(0, available).toFixed(2);
  };
  
  const calculateActiveTrades = () => {
    // Active trades are those not in final states
    const finalStates = ['WithdrawalConfirmed', 'Cancelled', 'PenaltyApplied'];
    return trades.filter(trade => {
      const statusKey = Object.keys(trade.status)[0];
      return !finalStates.includes(statusKey);
    }).length;
  };
  
  const getTotalTrades = () => {
    return trades.length;
  };
  
  if (loading) {
    return (
      <Card>
        <div className="flex justify-center py-12">
          <Loader size="lg" />
        </div>
      </Card>
    );
  }
  
  return (
    <Card>
      <div className="space-y-3">
        {/* Header with title and refresh */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('account.title')}</h3>
            <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('account.subtitle')}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchAccount} className="h-7 px-2">
            <RefreshCw size={14} />
          </Button>
        </div>
        
        {/* Compact balance cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className={`rounded-lg p-3 border ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} size={14} />
              <span className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('account.securityBalance')}</span>
            </div>
            {loadingBalance ? (
              <div className="flex items-center gap-1">
                <Loader size="sm" />
              </div>
            ) : (
              <>
                <p className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatCkUSDC(balance || 0n)}</p>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Locked: ${formatUsd((account?.pending_trades_total || 0) * (SECURITY_DEPOSIT_PERCENT / 100))}</p>
              </>
            )}
          </div>
          
          <div className={`rounded-lg p-3 border ${
            theme === 'dark'
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-green-50 border-green-200'
          }`}>
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} size={14} />
              <span className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('account.availableTrade')}</span>
            </div>
            {loadingBalance ? (
              <div className="flex items-center gap-1">
                <Loader size="sm" />
              </div>
            ) : (
              <>
                <p className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>${calculateAvailableLockAmount()}</p>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Capacity: {calculateLockCapacity()}x</p>
              </>
            )}
          </div>
        </div>
        
        {/* Compact stats */}
        <div className={`rounded-lg p-2 border ${
          theme === 'dark'
            ? 'bg-white/5 border-white/10'
            : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('account.activeTrades')}:</span>
              <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{calculateActiveTrades()}</span>
            </div>
            <div className="flex justify-between">
              <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('account.totalTrades')}:</span>
              <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{getTotalTrades()}</span>
            </div>
          </div>
        </div>
        
        {/* Compact buttons */}
        <div className="flex gap-2">
          <Button variant="primary" onClick={onDeposit} className="flex-1 h-8 text-xs">
            {t('account.depositButton')}
          </Button>
          <Button variant="secondary" onClick={onWithdraw} className="flex-1 h-8 text-xs">
            {t('account.withdrawButton')}
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default AccountOverview;
