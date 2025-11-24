import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CreateOrderForm, OrderList, EasySwapWallet } from '../components/maker';
import { useTheme } from '../contexts/ThemeContext';

const MakerDashboard = () => {
  const { t } = useTranslation(['maker', 'common']);
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const handleOrderCreated = (orderId) => {
    setRefreshTrigger(prev => prev + 1);
    // Navigate to order details page
    navigate(`/maker/order/${orderId}`);
  };
  
  const handleOrderSelect = (orderId) => {
    // Navigate to order details page
    navigate(`/maker/order/${orderId}`);
  };
  
  return (
    <div className="container mx-auto py-4">
      {/* Header */}
      <div className="mb-4">
        <h1 className={`text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('dashboard.title', 'Maker Dashboard')}</h1>
        <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('dashboard.subtitle', 'Create and manage your BSV sell orders')}</p>
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
};

export default MakerDashboard;
