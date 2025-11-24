import React from 'react';
import { useTranslation } from 'react-i18next';

const StatusBadge = ({ status, type = 'order' }) => {
  const { t } = useTranslation(['maker', 'orderbook', 'filler']);
  
  const statusConfig = {
    order: {
      AwaitingDeposit: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/50' },
      WaitingForMint: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/50' },
      PendingFunding: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/50' },
      Active: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/50' },
      Idle: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/50' },
      PartiallyFilled: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/50' },
      Filled: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/50' },
      Cancelled: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/50' },
      Refunded: { bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/50' },
    },
    chunk: {
      Available: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/50' },
      Locked: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/50' },
      Filled: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/50' },
      Idle: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/50' },
      Cancelled: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/50' },
    },
    trade: {
      ChunksLocked: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/50' },
      TxSubmitted: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/50' },
      ReadyForRelease: { bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/50' },
      WithdrawalConfirmed: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/50' },
      Cancelled: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/50' },
      PenaltyApplied: { bg: 'bg-red-600/20', text: 'text-red-400', border: 'border-red-600/50' },
      // Legacy statuses for backwards compatibility
      Locked: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/50' },
      AwaitingRelease: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/50' },
      Completed: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/50' },
    },
  };
  
  const config = statusConfig[type]?.[status] || { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/50' };
  
  const getTranslationKey = () => {
    // Use colon syntax for cross-namespace access since 'maker' is default namespace
    if (type === 'order') return `status.${status.toLowerCase()}`;
    if (type === 'chunk') return `orderbook:status.${status.toLowerCase()}`;
    if (type === 'trade') return `filler:status.${status.toLowerCase()}`;
    return status;
  };
  
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${config.bg} ${config.text} ${config.border}`}>
      {t(getTranslationKey())}
    </span>
  );
};

export { StatusBadge };
export default StatusBadge;
