import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal, Button } from '../common';
import { useTheme } from '../../contexts/ThemeContext';
import { ACTIVATION_FEE_PERCENT, FILLER_INCENTIVE_PERCENT, CKUSDC_TRANSFER_FEE_USD } from '../../config';

const RefundModal = ({ isOpen, onClose, onConfirm, order, chunks, loading, isFunded, orderDepositBalance }) => {

  console.log('🛠️ { isOpen, onClose, onConfirm, order, chunks, loading, isFunded, orderDepositBalance }:',{ isOpen, onClose, onConfirm, order, chunks, loading, isFunded, orderDepositBalance })
  const { t } = useTranslation(['maker', 'common']);
  const { theme } = useTheme();
  
  if (!order) return null;
  
  const status = order.status ? Object.keys(order.status)[0] : 'AwaitingDeposit';
  const totalOrderUsd = Number(order.amount_usd || 0);
  const filledUsd = Number(order.total_filled_usd || 0);
  
  // Use actual order deposit subaccount balance (funds in canister)
  const actualDeposited = orderDepositBalance !== null ? orderDepositBalance : 0;
  const hasFundsDeposited = actualDeposited > 0;
  
  // Calculate locked chunks (that must stay in subaccount for takers to claim)
  const lockedChunks = chunks ? chunks.filter(chunk => {
    const chunkStatus = chunk.status ? Object.keys(chunk.status)[0] : 'Available';
    return chunkStatus === 'Locked';
  }) : [];
  
  const lockedAmount = lockedChunks.reduce((sum, chunk) => sum + Number(chunk.amount_usd || 0), 0);
  
  // Calculate what must stay for locked chunks (includes filler incentive)
  const lockedWithIncentive = lockedAmount * (1 + FILLER_INCENTIVE_PERCENT / 100);
  
  // Refundable amount = subaccount balance - locked chunks with incentive
  // For unfunded/unactivated orders: just the balance minus transfer fee (no locked chunks yet)
  // For funded/activated orders: balance minus what's reserved for locked chunks
  // Use hasFundsDeposited (actual balance check) not isFunded (backend activation flag)
  const refundableAmount = (isFunded && hasFundsDeposited)
    ? Math.max(0, actualDeposited - lockedWithIncentive)
    : (hasFundsDeposited ? actualDeposited : 0);
  
  // No additional filler incentive to add - the refundableAmount is what user gets back
  // (For funded orders, filler incentive was already included in deposited amount)
  const totalRefund = refundableAmount;
  
  // Activation fee (non-refundable, only applies to activated orders)
  const activationFee = isFunded ? totalOrderUsd * (ACTIVATION_FEE_PERCENT / 100) : 0;
  
  // Determine modal title and action based on actual deposited funds
  const modalTitle = hasFundsDeposited ? t('maker:refund.cancelOrderRefund') : t('maker:refund.cancelOrder');
  const actionButton = hasFundsDeposited ? t('maker:refund.confirmRefund') : t('maker:refund.confirmCancel');
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="md"
    >
      <div className="space-y-6">
        <div className={`flex items-start gap-4 rounded-xl p-4 border ${
          theme === 'dark'
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-red-50 border-red-200'
        }`}>
          <AlertTriangle size={24} className={theme === 'dark' ? 'text-red-400' : 'text-red-600'} />
          <div>
            <h3 className={`font-semibold mb-2 ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
              {hasFundsDeposited ? t('maker:refund.cancelFundedOrder') : t('maker:refund.cancelUnfundedOrder')}
            </h3>
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              {hasFundsDeposited 
                ? t('maker:refund.fundedOrderDesc')
                : t('maker:refund.unfundedOrderDesc')
              }
            </p>
          </div>
        </div>
        
        {!hasFundsDeposited ? (
          // UNFUNDED ORDER - Simple removal
          <div className={`rounded-xl p-4 border ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-start gap-3">
              <Info size={20} className={`flex-shrink-0 mt-0.5 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />
              <div className="space-y-2">
                <p className={`text-sm font-medium ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                  Order Not Activated Yet
                </p>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  {actualDeposited > 0 
                    ? t('refund.partialDepositInfo', { amount: actualDeposited.toFixed(6) })
                    : t('refund.noFundsTransferred')
                  }
                </p>
              </div>
            </div>
          </div>
        ) : (
          // FUNDED ORDER - Show refund breakdown
          <>
            <div className={`space-y-3 rounded-xl p-4 ${theme === 'dark' ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="flex justify-between text-sm">
                <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('refund.orderDepositBalance')}</span>
                <span className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>${actualDeposited.toFixed(6)}</span>
              </div>
              
              {!isFunded && (
                <div className="flex justify-between text-sm">
                  <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('refund.transferFee')}</span>
                  <span className={theme === 'dark' ? 'text-red-400' : 'text-red-600'}>-${CKUSDC_TRANSFER_FEE_USD.toFixed(2)}</span>
                </div>
              )}
              
              {isFunded && lockedAmount > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('refund.lockedChunks', { count: lockedChunks.length })}</span>
                    <span className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>${lockedAmount.toFixed(6)}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('refund.fillerIncentive', { percent: FILLER_INCENTIVE_PERCENT })}</span>
                    <span className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>${(lockedWithIncentive - lockedAmount).toFixed(6)}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('refund.reservedForLocked')}</span>
                    <span className={theme === 'dark' ? 'text-red-400' : 'text-red-600'}>-${lockedWithIncentive.toFixed(6)}</span>
                  </div>
                </>
              )}
              
              <div className={`flex justify-between text-lg font-semibold border-t pt-3 ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>{t('refund.totalRefund')}:</span>
                <span className={theme === 'dark' ? 'text-green-400' : 'text-green-600'}>${totalRefund.toFixed(6)}</span>
              </div>
            </div>
            
            {isFunded && activationFee > 0 && (
              <div className={`rounded-xl p-4 border ${
                theme === 'dark'
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-yellow-50 border-yellow-200'
              }`}>
                <div className="flex items-start gap-3">
                  <Info size={20} className={`flex-shrink-0 mt-0.5 ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`} />
                  <div className="space-y-2">
                    <p className={`text-sm font-medium ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>
                      {t('maker:refund.activationFeeNonRefundable')}
                    </p>
                    <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('maker:refund.activationFeeExplanation', { 
                        amount: activationFee.toFixed(6), 
                        percent: ACTIVATION_FEE_PERCENT 
                      })}
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {isFunded && refundableAmount <= 0 && (
              <div className={`rounded-xl p-4 border ${
                theme === 'dark'
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className={`flex-shrink-0 mt-0.5 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`} />
                  <div className="space-y-2">
                    <p className={`text-sm font-medium ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
                      {t('maker:refund.noRefundablePortions')}
                    </p>
                    <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                      All funds are reserved for locked chunks that traders are currently claiming.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        
        <div className="flex gap-4">
          <Button
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={loading}
            className="flex-1"
          >
            {t('common:cancel')}
          </Button>
          
          <Button
            variant="danger"
            size="lg"
            onClick={onConfirm}
            loading={loading}
            disabled={isFunded && refundableAmount <= 0}
            className="flex-1"
          >
            {actionButton}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default RefundModal;
