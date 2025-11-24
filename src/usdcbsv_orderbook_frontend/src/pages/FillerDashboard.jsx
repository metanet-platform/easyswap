import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PlusCircle, BookOpen } from 'lucide-react';
import { AccountOverview, DepositModal, WithdrawModal, CreateTradeForm, TradeList, TradeDetails } from '../components/filler';
import { Button } from '../components/common';
import { useSDK } from '../contexts/SDKProvider';
import { useTheme } from '../contexts/ThemeContext';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory as ckUSDCIdl } from '../utils/ckusdc.did.js';
import { CK_USDC_LEDGER } from '../config';

const FillerDashboard = () => {
  const { t } = useTranslation(['filler', 'common']);
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { actor, isAuthenticated } = useSDK();
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showCreateTrade, setShowCreateTrade] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Check for tradeId in URL params on mount
  useEffect(() => {
    const tradeIdParam = searchParams.get('tradeId');
    if (tradeIdParam) {
      setSelectedTradeId(Number(tradeIdParam));
    }
  }, [searchParams]);
  
  // Shared account data
  const [subaccountAddress, setSubaccountAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loadingAccountData, setLoadingAccountData] = useState(true);
  
  // Fetch account data once
  useEffect(() => {
    if (isAuthenticated && actor) {
      fetchAccountData();
    }
  }, [isAuthenticated, actor, refreshTrigger]);
  
  const fetchAccountData = async () => {
    setLoadingAccountData(true);
    try {
      // Get subaccount address (returns string directly, not Result)
      const subaccountAddr = await actor.get_filler_subaccount_address();
      setSubaccountAddress(subaccountAddr);
      
      // Fetch balance from ledger
      await fetchBalanceFromLedger(subaccountAddr);
    } catch (error) {
      console.error('Error fetching account data:', error);
    } finally {
      setLoadingAccountData(false);
    }
  };
  
  const fetchBalanceFromLedger = async (subaccountAddr) => {
    try {
      const [ownerId, subaccountHex] = subaccountAddr.split('.');
      const owner = Principal.fromText(ownerId);
      const subaccount = subaccountHex ? Array.from(Buffer.from(subaccountHex, 'hex')) : null;
      
      const agent = new HttpAgent({ host: 'https://ic0.app' });
      const ckusdcActor = Actor.createActor(ckUSDCIdl, {
        agent,
        canisterId: CK_USDC_LEDGER,
      });
      
      const account = { owner, subaccount: subaccount ? [subaccount] : [] };
      const balanceResult = await ckusdcActor.icrc1_balance_of(account);
      setBalance(balanceResult);
    } catch (error) {
      console.error('Error fetching balance from ledger:', error);
      setBalance(0n);
    }
  };
  
  const handleDepositComplete = () => {
    setRefreshTrigger(prev => prev + 1);
  };
  
  const handleWithdrawComplete = () => {
    setRefreshTrigger(prev => prev + 1);
  };
  
  const handleTradeCreated = (tradeIds) => {
    setRefreshTrigger(prev => prev + 1);
    // Auto-open the first created trade details
    if (tradeIds && tradeIds.length > 0) {
      setSelectedTradeId(tradeIds[0]);
    }
  };
  
  const handleTradeSelect = (tradeId) => {
    console.log('Trade selected:', tradeId, typeof tradeId);
    setSelectedTradeId(tradeId);
  };
  
  const handleCloseTradeDetails = () => {
    setSelectedTradeId(null);
    setRefreshTrigger(prev => prev + 1);
  };
  
  return (
    <div className="container mx-auto py-4">
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('dashboard.fillerDashboard')}</h1>
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('dashboard.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="secondary" 
              size="md" 
              onClick={() => navigate('/orderbook')}
              className="flex-1 sm:flex-initial"
            >
              <BookOpen size={18} />
              <span className="hidden sm:inline">{t('dashboard.orderbookButton')}</span>
              <span className="sm:hidden">{t('dashboard.ordersButton')}</span>
            </Button>
            <Button 
              variant="primary" 
              size="md" 
              onClick={() => setShowCreateTrade(true)}
              className="flex-1 sm:flex-initial"
            >
              <PlusCircle size={18} />
              <span className="hidden sm:inline">{t('dashboard.createTradeButton')}</span>
              <span className="sm:hidden">{t('dashboard.createButton')}</span>
            </Button>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <AccountOverview 
            key={refreshTrigger}
            onDeposit={() => setShowDeposit(true)}
            onWithdraw={() => setShowWithdraw(true)}
            subaccountAddress={subaccountAddress}
            balance={balance}
            loadingBalance={loadingAccountData}
          />
        </div>
        <div>
          <TradeList key={refreshTrigger} onTradeSelect={handleTradeSelect} />
        </div>
      </div>
      
      <DepositModal
        isOpen={showDeposit}
        onClose={() => setShowDeposit(false)}
        onDepositComplete={handleDepositComplete}
        subaccountAddress={subaccountAddress}
      />
      
      <WithdrawModal
        isOpen={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        onWithdrawComplete={handleWithdrawComplete}
        subaccountAddress={subaccountAddress}
        balance={balance}
      />
      
      <CreateTradeForm
        isOpen={showCreateTrade}
        onClose={() => setShowCreateTrade(false)}
        onTradeCreated={handleTradeCreated}
      />
      
      {selectedTradeId !== null && (
        <TradeDetails tradeId={selectedTradeId} onClose={handleCloseTradeDetails} />
      )}
      
      {/* Debug */}
      {console.log('Selected Trade ID:', selectedTradeId)}
    </div>
  );
};

export default FillerDashboard;
