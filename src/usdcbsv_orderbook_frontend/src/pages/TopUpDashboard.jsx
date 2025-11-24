import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Coins, Wallet as WalletIcon } from 'lucide-react';
import { CreateOrderForm, OrderList } from '../components/maker';
import { useTheme } from '../contexts/ThemeContext';
import { Button } from '../components/common';

const TopUpDashboard = () => {
  const { t } = useTranslation(['topup', 'common']);
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedTopUp, setSelectedTopUp] = useState(null); // null, 'bsv', or 'ckusdc'
  
  const handleOrderCreated = (orderId) => {
    setRefreshTrigger(prev => prev + 1);
    // Navigate to order details page
    navigate(`/order/${orderId}`);
  };
  
  const handleOrderSelect = (orderId) => {
    // Navigate to order details page
    navigate(`/order/${orderId}`);
  };
  
  const handleBackToSelection = () => {
    setSelectedTopUp(null);
  };

  // Selection Screen
  if (!selectedTopUp) {
    return (
      <div className="container mx-auto py-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className={`text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {t('dashboard.title')}
          </h1>
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('dashboard.subtitle')}
          </p>
        </div>

        {/* Top Up Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
          {/* BSV Top Up Option */}
          <button
            onClick={() => setSelectedTopUp('bsv')}
            className={`p-6 rounded-xl border-2 transition-all text-left hover:scale-105 ${
              theme === 'dark'
                ? 'bg-gray-800/50 border-blue-500/30 hover:border-blue-500/60 hover:bg-gray-800/70'
                : 'bg-white border-blue-300 hover:border-blue-500 hover:bg-blue-50/50'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                <Coins size={24} className="text-blue-500" />
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('options.bsv.title')}
                </h3>
                <p className={`text-sm mb-3 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('options.bsv.description')}
                </p>
                <ul className={`text-xs space-y-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
                  <li>• {t('options.bsv.point1')}</li>
                  <li>• {t('options.bsv.point2')}</li>
                  <li>• {t('options.bsv.point3')}</li>
                </ul>
              </div>
            </div>
          </button>

          {/* ckUSDC Top Up Option */}
          <button
            onClick={() => setSelectedTopUp('ckusdc')}
            className={`p-6 rounded-xl border-2 transition-all text-left hover:scale-105 ${
              theme === 'dark'
                ? 'bg-gray-800/50 border-purple-500/30 hover:border-purple-500/60 hover:bg-gray-800/70'
                : 'bg-white border-purple-300 hover:border-purple-500 hover:bg-purple-50/50'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-purple-500/20' : 'bg-purple-100'}`}>
                <WalletIcon size={24} className="text-purple-500" />
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('options.ckusdc.title')}
                </h3>
                <p className={`text-sm mb-3 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('options.ckusdc.description')}
                </p>
                <ul className={`text-xs space-y-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
                  <li>• {t('options.ckusdc.point1')}</li>
                  <li>• {t('options.ckusdc.point2')}</li>
                  <li>• {t('options.ckusdc.point3')}</li>
                </ul>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // BSV Top Up - Show Create Order Form
  if (selectedTopUp === 'bsv') {
    return (
      <div className="container mx-auto py-4">
        {/* Header with Back Button */}
        <div className="mb-4">
          <Button
            variant="ghost"
            onClick={handleBackToSelection}
            className="mb-3 flex items-center gap-2"
          >
            <ArrowLeft size={16} />
            {t('common:back')}
          </Button>
          <h1 className={`text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {t('bsvTopUp.title')}
          </h1>
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('bsvTopUp.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <CreateOrderForm onOrderCreated={handleOrderCreated} />
          </div>
          <div>
            <OrderList key={refreshTrigger} onOrderSelect={handleOrderSelect} />
          </div>
        </div>
      </div>
    );
  }

  // ckUSDC Top Up - Show Instructions
  if (selectedTopUp === 'ckusdc') {
    return (
      <div className="container mx-auto py-4">
        {/* Header with Back Button */}
        <div className="mb-4">
          <Button
            variant="ghost"
            onClick={handleBackToSelection}
            className="mb-3 flex items-center gap-2"
          >
            <ArrowLeft size={16} />
            {t('common:back')}
          </Button>
          <h1 className={`text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {t('ckusdcTopUp.title')}
          </h1>
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('ckusdcTopUp.subtitle')}
          </p>
        </div>

        {/* Instructions Card */}
        <div className={`max-w-3xl rounded-xl p-6 ${
          theme === 'dark' ? 'bg-gray-800/50 border border-white/10' : 'bg-white border border-gray-200'
        }`}>
          <h2 className={`text-lg font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {t('ckusdcTopUp.instructionsTitle')}
          </h2>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-4">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                theme === 'dark' ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'
              }`}>
                1
              </div>
              <div>
                <h3 className={`font-semibold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('ckusdcTopUp.step1Title')}
                </h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('ckusdcTopUp.step1Desc')}
                </p>
                <Button
                  onClick={() => navigate('/wallet')}
                  className="mt-2"
                  size="sm"
                >
                  {t('ckusdcTopUp.goToWallet')}
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                theme === 'dark' ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'
              }`}>
                2
              </div>
              <div>
                <h3 className={`font-semibold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('ckusdcTopUp.step2Title')}
                </h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('ckusdcTopUp.step2Desc')}
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                theme === 'dark' ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'
              }`}>
                3
              </div>
              <div>
                <h3 className={`font-semibold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('ckusdcTopUp.step3Title')}
                </h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('ckusdcTopUp.step3Desc')}
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-4">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                theme === 'dark' ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'
              }`}>
                4
              </div>
              <div>
                <h3 className={`font-semibold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('ckusdcTopUp.step4Title')}
                </h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('ckusdcTopUp.step4Desc')}
                </p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="flex gap-4">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                theme === 'dark' ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'
              }`}>
                5
              </div>
              <div>
                <h3 className={`font-semibold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('ckusdcTopUp.step5Title')}
                </h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('ckusdcTopUp.step5Desc')}
                </p>
              </div>
            </div>

            {/* Step 6 */}
            <div className="flex gap-4">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                theme === 'dark' ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'
              }`}>
                6
              </div>
              <div>
                <h3 className={`font-semibold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('ckusdcTopUp.step6Title')}
                </h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('ckusdcTopUp.step6Desc')}
                </p>
              </div>
            </div>
          </div>

          {/* Info Boxes */}
          <div className="space-y-3 mt-6">
            <div className={`p-4 rounded-lg ${
              theme === 'dark' ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-blue-50 border border-blue-200'
            }`}>
              <p className={`text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                {t('ckusdcTopUp.infoNote')}
              </p>
            </div>
            <div className={`p-4 rounded-lg ${
              theme === 'dark' ? 'bg-green-500/10 border border-green-500/20' : 'bg-green-50 border border-green-200'
            }`}>
              <p className={`text-sm ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>
                {t('ckusdcTopUp.feesNote')}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default TopUpDashboard;
