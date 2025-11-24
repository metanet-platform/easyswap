import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Modal, Input } from '../common';

const CKUSDC_FEE = 10_000; // ckUSDC transfer fee is 10,000 e6s (0.01 ckUSDC)

const WithdrawModal = ({ isOpen, onClose, onWithdrawComplete, subaccountAddress, balance }) => {
  const { t } = useTranslation(['filler', 'common']);
  const { theme } = useTheme();
  const { actor, rootPrincipal } = useSDK();
  const [amount, setAmount] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Pre-fill the recipient address with rootPrincipal when modal opens
  useEffect(() => {
    if (isOpen && rootPrincipal) {
      setToAddress(rootPrincipal);
    }
  }, [isOpen, rootPrincipal]);
  
  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error(t('errors.invalidAmount'));
      return;
    }
    
    if (!toAddress) {
      toast.error(t('errors.addressRequired'));
      return;
    }
    
    const amountE6s = Math.floor(parseFloat(amount) * 1e6); // ckUSDC has 6 decimals
    const currentBalance = Number(balance || 0n);
    
    // Check if user has enough balance (including fee)
    if (amountE6s + CKUSDC_FEE > currentBalance) {
      toast.error(t('filler:withdraw.insufficientBalance', { balance: (currentBalance / 1e6).toFixed(6) }));
      return;
    }
    
    setLoading(true);
    try {
      const result = await actor.withdraw_security(amountE6s, toAddress);
      
      if ('Ok' in result) {
        toast.success(t('messages.withdrawSuccess'));
        onWithdrawComplete?.();
        onClose();
      } else {
        toast.error(result.Err || t('errors.withdrawFailed'));
      }
    } catch (error) {
      console.error('Error withdrawing:', error);
      toast.error(t('errors.withdrawFailed'));
    } finally {
      setLoading(false);
    }
  };
  
  const formatAvailable = () => {
    if (!balance) return '0.00';
    const balanceNum = Number(balance);
    const availableAfterFee = Math.max(0, balanceNum - CKUSDC_FEE);
    return (availableAfterFee / 1e6).toFixed(6); // Show 6 decimals for precision
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('withdraw.title')}>
      <div className="space-y-4">
        {/* Balance Info - Compact */}
        <div className={`rounded-lg p-3 border ${
          theme === 'dark'
            ? 'bg-blue-500/10 border-blue-500/30'
            : 'bg-blue-50 border-blue-200'
        }`}>
          <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            {t('filler:withdraw.securityProtected')}
          </p>
          <div className="mt-2">
            {balance === null ? (
              <div className={`flex items-center gap-2 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>
                <Loader2 className="animate-spin" size={14} />
                <span className="text-xs">{t('filler:withdraw.loadingBalance')}</span>
              </div>
            ) : (
              <>
                <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                  {t('filler:withdraw.availableBalance', { balance: formatAvailable() })}
                </p>
                <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('filler:withdraw.transferFee')}
                </p>
              </>
            )}
          </div>
        </div>
        
        {/* Inputs - Compact */}
        <Input
          label={t('withdraw.amountLabel')}
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          placeholder="100"
          min="0"
          step="0.01"
          helperText={t('withdraw.amountHelper')}
        />
        
        <Input
          label={t('filler:withdraw.addressLabel')}
          type="text"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          placeholder={t('filler:withdraw.addressPlaceholder')}
          helperText={t('filler:withdraw.addressHelper')}
        />
        
        {/* Buttons - Compact */}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1 h-9 text-sm">
            {t('common:cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={handleWithdraw}
            loading={loading}
            disabled={!amount || !toAddress || balance === null}
            className="flex-1 h-9 text-sm"
          >
            {t('withdraw.confirmButton')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default WithdrawModal;
