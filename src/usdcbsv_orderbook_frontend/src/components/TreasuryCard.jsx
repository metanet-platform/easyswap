import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Fuel, DollarSign, Cpu } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { useSDK } from '../contexts/SDKProvider';
import { useTheme } from '../contexts/ThemeContext';
import { Card } from './common';
import { CK_USDC_LEDGER, ADMIN_PRINCIPAL } from '../config';
import { canisterId as backendCanisterId, idlFactory as backendIdlFactory } from '../../../declarations/usdcbsv_orderbook_backend';

// ICRC1 Ledger IDL Factory (for direct balance queries)
const ledgerIdlFactory = ({ IDL }) => {
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  return IDL.Service({
    'icrc1_balance_of' : IDL.Func([Account], [IDL.Nat], ['query']),
  });
};

const TreasuryCard = () => {
  const { t } = useTranslation(['wallet']);
  const { theme } = useTheme();
  const { actor, userPrincipal, httpAgent, sendCommand } = useSDK();
  const [ckethTreasuryBalance, setCkethTreasuryBalance] = useState('0.000000');
  const [ckusdcTreasuryBalance, setCkusdcTreasuryBalance] = useState('0.00');
  const [cyclesTreasuryBalance, setCyclesTreasuryBalance] = useState('0.00');
  const [loadingBalances, setLoadingBalances] = useState(false);

  const isAdmin = userPrincipal === ADMIN_PRINCIPAL;

  // Fetch treasury balances
  useEffect(() => {
    const fetchBalances = async () => {
      // We can query ledgers and the backend canister with an anonymous agent
      // if the SDK actor/agent are not yet available. That lets the treasury
      // display work for public (read-only) queries without a wallet connection.
      const localAgent = httpAgent || new HttpAgent({ host: 'https://ic0.app' });

      console.log('=== TreasuryCard Debug ===');
      console.log('backendCanisterId:', backendCanisterId);
      console.log('actor available:', !!actor, 'httpAgent available:', !!httpAgent);

      if (!backendCanisterId) {
        console.error('ERROR: backendCanisterId is undefined!');
        setLoadingBalances(false);
        return;
      }

      setLoadingBalances(true);
      try {
        const backendPrincipal = Principal.fromText(backendCanisterId);
        console.log('Fetching treasury balances for:', backendPrincipal.toText());
        
        // Fetch ckETH balance from ledger
        try {
          const ckethLedgerPrincipal = Principal.fromText('ss2fx-dyaaa-aaaar-qacoq-cai');
          const ledgerActor = Actor.createActor(ledgerIdlFactory, {
            agent: localAgent,
            canisterId: ckethLedgerPrincipal,
          });
          
          const balance = await ledgerActor.icrc1_balance_of({
            owner: backendPrincipal,
            subaccount: [],
          });
          
          console.log('ckETH balance (raw):', balance.toString());
          const balanceEth = Number(balance) / 1e18;
          console.log('ckETH balance (ETH):', balanceEth);
          setCkethTreasuryBalance(balanceEth.toFixed(6));
        } catch (error) {
          console.error('Error fetching ckETH balance:', error);
        }

        // Fetch ckUSDC balance from ledger (only if admin)
        if (isAdmin) {
          try {
            const ckusdcLedgerPrincipal = Principal.fromText(CK_USDC_LEDGER);
            const ledgerActor = Actor.createActor(ledgerIdlFactory, {
              agent: localAgent,
              canisterId: ckusdcLedgerPrincipal,
            });
            
            const balance = await ledgerActor.icrc1_balance_of({
              owner: backendPrincipal,
              subaccount: [],
            });
            
            console.log('ckUSDC balance (raw):', balance.toString());
            const balanceUsdc = Number(balance) / 1e6;
            console.log('ckUSDC balance (USDC):', balanceUsdc);
            setCkusdcTreasuryBalance(balanceUsdc.toFixed(2));
          } catch (error) {
            console.error('Error fetching ckUSDC balance:', error);
          }
        }

        // Fetch cycles balance from backend
        try {
          // Use SDK actor if available, otherwise create a temporary backend actor
          const backendActor = actor || Actor.createActor(backendIdlFactory, { agent: localAgent, canisterId: backendCanisterId });
          const cycles = await backendActor.get_cycles_balance();
          console.log('Cycles balance (raw):', cycles.toString());
          const cyclesT = Number(cycles) / 1e12;
          console.log('Cycles balance (T):', cyclesT);
          setCyclesTreasuryBalance(cyclesT.toFixed(2));
        } catch (error) {
          console.error('Error fetching cycles balance:', error);
        }
      } catch (error) {
        console.error('Error fetching balances:', error);
      } finally {
        setLoadingBalances(false);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 30000);
    
    return () => clearInterval(interval);
  }, [actor, httpAgent, isAdmin]);

  const copyToClipboard = async (text, label = 'Text') => {
    try {
      await sendCommand({
      type: "write-clipboard",
      text: text
    });
      toast.success(`${label} copied to clipboard`);
    } catch (err) {
      toast.error(`Failed to copy ${label}`);
    }
  };

  return (
    <Card className={`border transition-colors duration-300 ${
      theme === 'dark' 
        ? 'bg-blue-500/10 border-blue-500/30' 
        : 'bg-blue-50 border-blue-200'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-semibold transition-colors duration-300 ${
          theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
        }`}>{t('treasury.title')}</span>
      </div>
      
      <div className={`grid ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-3`}>
        <div className={`rounded p-3 transition-colors duration-300 ${
          theme === 'dark' ? 'bg-black/20' : 'bg-white/80'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <Fuel className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} size={16} />
            <p className={`text-xs transition-colors duration-300 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>{t('treasury.gasBalance')}</p>
          </div>
          <p className={`text-base font-semibold transition-colors duration-300 ${
            theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
          }`}>
            {loadingBalances ? '...' : `${ckethTreasuryBalance} ETH`}
          </p>
        </div>
        
        {isAdmin && (
          <div className={`rounded p-3 transition-colors duration-300 ${
            theme === 'dark' ? 'bg-black/20' : 'bg-white/80'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} size={16} />
              <p className={`text-xs transition-colors duration-300 ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
              }`}>{t('treasury.softwareRoyalty')}</p>
            </div>
            <p className={`text-base font-semibold transition-colors duration-300 ${
              theme === 'dark' ? 'text-green-400' : 'text-green-600'
            }`}>
              {loadingBalances ? '...' : `$${ckusdcTreasuryBalance}`}
            </p>
          </div>
        )}
        
        <div className={`rounded p-3 transition-colors duration-300 ${
          theme === 'dark' ? 'bg-black/20' : 'bg-white/80'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <Cpu className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={16} />
            <p className={`text-xs transition-colors duration-300 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>{t('treasury.cycles')}</p>
          </div>
          <p className={`text-base font-semibold transition-colors duration-300 ${
            theme === 'dark' ? 'text-purple-400' : 'text-purple-600'
          }`}>
            {loadingBalances ? '...' : `${cyclesTreasuryBalance}T`}
          </p>
        </div>
      </div>
      
      <div className="space-y-2 mb-3">
        <p className={`text-xs transition-colors duration-300 ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
        }`}>
          {parseFloat(ckethTreasuryBalance) > 0.001 
            ? t('treasury.statusOk')
            : t('treasury.statusLow')}
        </p>
        <p className={`text-[10px] leading-relaxed transition-colors duration-300 ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
        }`}>
          {t('treasury.royaltyExplanation')}
        </p>
      </div>

      {/* Canister Principal for Community Donations */}
      <div className={`border rounded-lg p-3 transition-colors duration-300 ${
        theme === 'dark' 
          ? 'bg-black/30 border-blue-500/20' 
          : 'bg-white/80 border-blue-300'
      }`}>
        <p className={`text-xs font-semibold mb-2 transition-colors duration-300 ${
          theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
        }`}>💝 Support the Community</p>
        <p className={`text-xs mb-2 transition-colors duration-300 ${
          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
        }`}>
          Help keep the app running by donating ckETH (for gas fees) or cycles to the treasury:
        </p>
        <div className={`flex items-center gap-2 rounded p-2 transition-colors duration-300 ${
          theme === 'dark' ? 'bg-black/40' : 'bg-gray-100'
        }`}>
          <code className={`text-xs flex-1 break-all font-mono transition-colors duration-300 ${
            theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
          }`}>
            {backendCanisterId}
          </code>
          <button
            onClick={() => copyToClipboard(backendCanisterId, 'Treasury Principal')}
            className={`flex-shrink-0 p-1.5 rounded transition-colors ${
              theme === 'dark' 
                ? 'hover:bg-blue-500/20' 
                : 'hover:bg-blue-200'
            }`}
            title="Copy Treasury Principal"
          >
            <Copy size={14} className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} />
          </button>
        </div>
        <p className={`text-[10px] mt-2 transition-colors duration-300 ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
        }`}>
          Send ckETH via ICRC-1 transfer or deposit cycles via NNS/dfx to this treasury principal
        </p>
      </div>
    </Card>
  );
};

export default TreasuryCard;
