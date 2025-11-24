import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Copy } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '../common';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';

const FundingInstructions = ({ order }) => {
  const { t } = useTranslation(['maker', 'common']);
  const { theme } = useTheme();
  const { sendCommand } = useSDK();
  
  const depositAddress = order.eth_deposit_address;
  // Backend stores amounts as f64 dollars
  // Use total_deposited_usd (order + 3.9% fee) for funding amount
  const totalToDeposit = Number(order.total_deposited_usd || order.amount_usd);
  // Format with up to 8 decimals, removing trailing zeros
  const amountUsd = totalToDeposit.toFixed(8).replace(/\.?0+$/, '');
  
  const copyToClipboard = (text, label) => {
    sendCommand({
      type: "write-clipboard",
      text: text
    });
    toast.success(t('common:copied') + ` ${label}`);
  };
  
  return (
    <div className={`rounded-xl p-6 space-y-4 border ${
      theme === 'dark'
        ? 'bg-yellow-500/10 border-yellow-500/30'
        : 'bg-yellow-50 border-yellow-200'
    }`}>
      <div className="flex items-start gap-3">
        <AlertCircle size={24} className="text-yellow-400 flex-shrink-0 mt-1" />
        <div className="flex-1">
          <h3 className="text-yellow-300 font-semibold text-lg mb-2">
            {t('funding.title')}
          </h3>
          <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            {t('funding.description')}
          </p>
          
          <div className="space-y-4">
            <div>
              <label className={`text-sm block mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('funding.step1')}
              </label>
              <div className={`rounded-lg p-3 flex items-center justify-between gap-2 ${
                theme === 'dark' ? 'bg-white/5' : 'bg-white/80'
              }`}>
                <span className={`font-mono text-sm break-all ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {depositAddress}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyToClipboard(depositAddress, t('common:address'))}
                >
                  <Copy size={16} />
                </Button>
              </div>
            </div>
            
            <div>
              <label className={`text-sm block mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('funding.step2')}
              </label>
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-white/5' : 'bg-white/80'}`}>
                <p className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {amountUsd} USDC
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  {t('funding.sendOnEthereum')}
                </p>
              </div>
            </div>
            
            <div className="pt-4 border-t border-white/10">
              <a
                href={`https://etherscan.io/address/${depositAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-sm underline"
              >
                {t('funding.viewExplorer')} →
              </a>
            </div>
            
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-blue-300 text-sm">
                {t('funding.autoConvertInfo')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FundingInstructions;
