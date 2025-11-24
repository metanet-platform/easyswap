import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Modal, Input } from '../common';

const DepositModal = ({ isOpen, onClose, onDepositComplete, subaccountAddress }) => {
  const { t } = useTranslation(['filler', 'common']);
  const { theme } = useTheme();
  const { actor, requestCkUSDCPayment, onCommand, offCommand, sendCommand } = useSDK();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [paymentRef, setPaymentRef] = useState(null);
  
  useEffect(() => {
    if (!isOpen) {
      // Reset states when modal closes
      setAmount('');
      setLoading(false);
      setPaymentRef(null);
    }
  }, [isOpen]);
  
  // Listen for payment responses
  useEffect(() => {
    const handlePaymentResponse = (data) => {
      // The response has payload nested inside
      if (data.type === 'pay-response' && data.payload?.ref === paymentRef) {
        const payload = data.payload;
        setLoading(false);
        
        if (payload.success) {
          toast.success(t('messages.depositSuccess'));
          onDepositComplete?.();
          onClose();
          setPaymentRef(null);
        } else {
          // Handle error
          const errorMessage = payload.message || getErrorMessage(payload.responseCode);
          toast.error(errorMessage);
          setPaymentRef(null);
        }
      }
    };
    
    if (paymentRef) {
      onCommand(handlePaymentResponse);
      return () => offCommand(handlePaymentResponse);
    }
  }, [paymentRef, onCommand, offCommand]);
  
  const getErrorMessage = (responseCode) => {
    const errorMessages = {
      'ERR_UNSUPPORTED_TOKEN': 'Token not supported',
      'ERR_MULTIPLE_RECIPIENTS': 'Multiple recipients not supported',
      'ERR_MISSING_PARAMS': 'Missing payment parameters',
      'ERR_ICP_PREP_FAILED': 'Failed to prepare payment',
      'ERR_ICP_FAILED': 'Payment transaction failed',
    };
    return errorMessages[responseCode] || t('errors.paymentFailed');
  };
  
  const handleCopy = (text) => {
    sendCommand({
      type: "write-clipboard",
      text: text
    });
    toast.success(t('common:copied'));
  };
  
    const handleRequestPayment = async () => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error(t('errors.invalidAmount'));
      return;
    }
    
    if (!subaccountAddress) {
      toast.error(t('errors.invalidAddress'));
      return;
    }
    
    setLoading(true);
    
    try {
      const ref = requestCkUSDCPayment(
        parsedAmount,
        subaccountAddress,
        t('filler:deposit.fillerSecurityDeposit')
      );
      
      setPaymentRef(ref);
      // Response will be handled by the onCommand listener
      
    } catch (error) {
      console.error('Error requesting payment:', error);
      toast.error(t('errors.requestFailed'));
      setLoading(false);
    }
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('deposit.title')}>
      <div className="space-y-4">
        {/* External Wallet Deposit - Compact */}
        <div className={`rounded-lg p-3 border ${
          theme === 'dark'
            ? 'bg-blue-500/10 border-blue-500/30'
            : 'bg-blue-50 border-blue-200'
        }`}>
          <p className={`text-xs mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('deposit.instructions')}</p>
          <div>
            <p className={`text-xs mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('deposit.addressLabel')}</p>
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              theme === 'dark'
                ? 'bg-black/30'
                : 'bg-white border border-gray-200'
            }`}>
              <code className={`font-mono text-xs break-all flex-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{subaccountAddress}</code>
              <button 
                onClick={() => handleCopy(subaccountAddress)} 
                className={`transition-colors ${
                  theme === 'dark'
                    ? 'text-blue-400 hover:text-blue-300'
                    : 'text-blue-600 hover:text-blue-700'
                }`}
              >
                <Copy size={16} />
              </button>
            </div>
          </div>
          <p className={`text-xs mt-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('filler:deposit.sendFromWallet')}
          </p>
        </div>
        
        {/* OR Separator - Compact */}
        <div className="flex items-center gap-3">
          <div className={`flex-1 border-t ${theme === 'dark' ? 'border-white/20' : 'border-gray-300'}`}></div>
          <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('filler:deposit.orSeparator')}</span>
          <div className={`flex-1 border-t ${theme === 'dark' ? 'border-white/20' : 'border-gray-300'}`}></div>
        </div>
        
        {/* Metanet Wallet Payment - Compact */}
        <div className="space-y-3">
          <div>
            <h4 className={`text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('filler:deposit.depositFromMetanet')}</h4>
            <p className={`text-xs mt-0.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('filler:deposit.metanetWalletInstantly')}</p>
          </div>
          
          <Input
            label={t('deposit.amountLabel')}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            placeholder="100"
            min="0"
            step="0.01"
            helperText={t('deposit.amountHelper')}
          />
          
          <Button
            variant="primary"
            onClick={handleRequestPayment}
            loading={loading}
            disabled={!amount || parseFloat(amount) <= 0}
            className="w-full h-9 text-sm"
          >
            {t('deposit.requestButton')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DepositModal;
