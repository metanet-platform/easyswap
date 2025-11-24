import React from 'react';

const NetworkBadge = ({ network }) => {
  const networkConfig = {
    Arbitrum: {
      bg: 'bg-blue-500/20',
      text: 'text-blue-300',
      border: 'border-blue-500/50',
      icon: '◈',
    },
    Optimism: {
      bg: 'bg-red-500/20',
      text: 'text-red-300',
      border: 'border-red-500/50',
      icon: '◉',
    },
  };
  
  const config = networkConfig[network] || networkConfig.Arbitrum;
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${config.bg} ${config.text} ${config.border}`}>
      <span className="text-base">{config.icon}</span>
      {network}
    </span>
  );
};

export { NetworkBadge };
export default NetworkBadge;

