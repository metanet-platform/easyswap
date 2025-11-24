import React from 'react';
import { useTranslation } from 'react-i18next';
import { EasySwapWallet } from '../components/maker';
import { useTheme } from '../contexts/ThemeContext';

const WalletPage = () => {
  const { t } = useTranslation(['common']);
  const { theme } = useTheme();
  
  return (
    <div className="container mx-auto py-4">
      <div className="mb-3">
        <h1 className={`text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          {t('common:wallet')}
        </h1>
        <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          {t('common:walletManage')}
        </p>
      </div>
      
      <EasySwapWallet showCompact={false} />
    </div>
  );
};

export default WalletPage;
