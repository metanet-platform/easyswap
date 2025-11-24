import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Home as HomeIcon, BookOpenCheck, Wallet, Shield, Sun, Moon, Coins } from 'lucide-react';
import { SDKProvider, useSDK } from './contexts/SDKProvider';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { canisterId, idlFactory } from '../../declarations/usdcbsv_orderbook_backend';
import { Button } from './components/common';
import { ADMIN_PRINCIPAL } from './config';
import Home from './pages/Home';
import TopUpDashboard from './pages/TopUpDashboard';
import OrderDetailsPage from './pages/OrderDetailsPage';
import PastOrdersPage from './pages/PastOrdersPage';
import FillerDashboard from './pages/FillerDashboard';
import PastTradesPage from './pages/PastTradesPage';
import OrderbookView from './pages/OrderbookView';
import AdminPage from './pages/AdminPage';
import AuditReportPage from './pages/AuditReportPage';
import DisclaimerPage from './pages/DisclaimerPage';
import WalletPage from './pages/WalletPage';
import './i18n';

const Navigation = () => {
  const { t } = useTranslation('common');
  const { userPrincipal, isAuthenticated, initiatorAddress} = useSDK();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  
  const isAdmin = userPrincipal === ADMIN_PRINCIPAL;
  
  const navItems = [
    { path: '/', label: t('home'), icon: HomeIcon },
    { path: '/top-up', label: t('topup'), icon: Coins },
    { path: '/trader', label: t('trader'), icon: BookOpenCheck },
    { path: '/wallet', label: t('wallet', 'Wallet'), icon: Wallet },
    ...(isAdmin ? [{ path: '/admin', label: 'Admin', icon: Shield }] : []),
  ];
  
  const isActive = (path) => location.pathname === path;
  
  return (
    <nav className={`backdrop-blur-xl border fixed bottom-6 left-4 right-4 z-40 rounded-2xl shadow-2xl max-w-[1000px] px-[10px] mx-auto transition-colors duration-300 ${
      theme === 'dark' 
        ? 'bg-black/40 border-white/10' 
        : 'bg-gray-900/90 border-gray-700/50'
    }`}>
      <div className="px-2">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all ${
                    isActive(item.path)
                      ? theme === 'dark' 
                        ? 'bg-white/20 text-white' 
                        : 'bg-white/20 text-white'
                      : theme === 'dark'
                        ? 'text-gray-400 hover:text-white hover:bg-white/10'
                        : 'text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon size={18} />
                  <span className="hidden md:inline text-xs">{item.label}</span>
                </Link>
              );
            })}
          </div>
          
          <div className="flex items-center gap-2">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-lg transition-all ${
                theme === 'dark' 
                  ? 'hover:bg-white/10 text-gray-400 hover:text-white' 
                  : 'hover:bg-white/10 text-gray-400 hover:text-white'
              }`}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            
            {/* Connection Status */}
            {isAuthenticated && initiatorAddress ? (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-green-400 rounded-full shadow-lg shadow-green-400/50" 
                     title="Connected"></div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" 
                     title="Connecting..."></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

const AppContent = () => {
  const { theme } = useTheme();
  
  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      theme === 'dark' 
        ? 'bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900' 
        : 'bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50'
    }`}>
      <Navigation />
      <main className="pt-[70px] pb-[100px] max-w-[1000px] px-[10px] mx-auto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/top-up" element={<TopUpDashboard />} />
          <Route path="/order/:orderId" element={<OrderDetailsPage />} />
          <Route path="/past-orders" element={<PastOrdersPage />} />
          <Route path="/trader" element={<FillerDashboard />} />
          <Route path="/trader/past-trades" element={<PastTradesPage />} />
          <Route path="/orderbook" element={<OrderbookView />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/audit" element={<AuditReportPage />} />
          <Route path="/disclaimer" element={<DisclaimerPage />} />
        </Routes>
      </main>
      <Toaster
        position="top-right"
        containerStyle={{
          top: 70,
        }}
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </div>
  );
};

function App() {
  return (
    <Router>
      <ThemeProvider>
        <SDKProvider canisterId={canisterId} idlFactory={idlFactory}>
          <AppContent />
        </SDKProvider>
      </ThemeProvider>
    </Router>
  );
}

export default App;
