import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { RefreshCw, Eye, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { useSDK } from '../contexts/SDKProvider';
import { useTheme } from '../contexts/ThemeContext';
import { Button, Card, Loader, StatusBadge } from '../components/common';
import { toast } from 'react-hot-toast';
import { MIN_CHUNK_SIZE_CENTS } from '../config';

const ITEMS_PER_PAGE = 20;
const STORAGE_KEY = 'pastOrdersState';

const PastOrdersPage = () => {
  const { t } = useTranslation(['maker', 'common']);
  const { theme } = useTheme();
  const { actor, isAuthenticated } = useSDK();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [currentOrders, setCurrentOrders] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [currentPage, setCurrentPage] = useState(1);
  const [initialized, setInitialized] = useState(false);
  
  const statusTabs = [
    { key: 'active', label: t('pastOrders.tabActive') },
    { key: 'completed', label: t('pastOrders.tabCompleted') },
  ];
  
  // Initialize from localStorage or defaults on mount
  useEffect(() => {
    // Check if coming from order details page (back button)
    const fromDetails = location.state?.fromOrderDetails;
    
    if (fromDetails) {
      // Restore from localStorage
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const { tab, page } = JSON.parse(saved);
          setActiveTab(tab || 'active');
          setCurrentPage(page || 1);
        } catch (e) {
          console.error('Failed to parse saved state:', e);
        }
      }
    } else {
      // New visit - clear localStorage and use defaults
      localStorage.removeItem(STORAGE_KEY);
      setActiveTab('active');
      setCurrentPage(1);
    }
    
    setInitialized(true);
  }, [location.state]);
  
  // Save state to localStorage whenever tab or page changes
  useEffect(() => {
    if (initialized) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tab: activeTab,
        page: currentPage
      }));
    }
  }, [activeTab, currentPage, initialized]);
  
  // Fetch orders for current tab and page
  const fetchOrders = async () => {
    if (!isAuthenticated || !actor) return;
    
    setLoading(true);
    try {
      const offset = BigInt((currentPage - 1) * ITEMS_PER_PAGE);
      const limit = BigInt(ITEMS_PER_PAGE);
      
      // Determine status filter based on active tab
      let statusFilter;
      if (activeTab === 'active') {
        // Active = Active and Idle states
        statusFilter = [[
          { Active: null },
          { Idle: null },
        ]];
      } else {
        // Completed = PartiallyFilled, Filled, Cancelled, Refunded
        statusFilter = [[
          { PartiallyFilled: null },
          { Filled: null },
          { Cancelled: null },
          { Refunded: null },
        ]];
      }
      
      const result = await actor.get_my_orders_paginated(offset, limit, statusFilter);
      setCurrentOrders(result.orders);
      setTotalCount(Number(result.total));
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error(t('errors.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch orders when initialized or when dependencies change
  useEffect(() => {
    if (initialized && isAuthenticated && actor) {
      fetchOrders();
    }
  }, [initialized, isAuthenticated, actor, activeTab, currentPage]);
  
  // Reset to page 1 when changing tabs
  const handleTabChange = (tabKey) => {
    setActiveTab(tabKey);
    setCurrentPage(1);
  };
  
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  
  const formatUsd = (amount) => `$${Number(amount).toFixed(2)}`;
  const formatPrice = (price) => `$${Number(price).toFixed(2)}`;
  const formatDate = (timestamp) => {
    return new Date(Number(timestamp) / 1_000_000).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  return (
    <div className="container mx-auto py-3 sm:py-4 px-2 sm:px-0">
      {/* Header */}
      <div className="mb-3 sm:mb-4">
        <button
          onClick={() => navigate('/top-up')}
          className={`flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3 text-xs sm:text-sm transition-colors ${
            theme === 'dark' 
              ? 'text-gray-400 hover:text-white' 
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <ArrowLeft size={14} />
          <span>{t('pastOrders.backToDashboard')}</span>
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="min-w-0">
            <h1 className={`text-xl sm:text-2xl font-bold truncate ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              {t('pastOrders.title')}
            </h1>
            <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('pastOrders.subtitle')}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { fetchOrders(); }} disabled={loading} className="self-start sm:self-auto">
            <RefreshCw size={14} />
            <span className="hidden sm:inline ml-1.5">{t('common:refresh')}</span>
          </Button>
        </div>
      </div>
      
      <Card>
        {/* Simplified Status Tabs - Active, Completed */}
        <div className="flex gap-1.5 sm:gap-2 mb-3 sm:mb-4">
          {statusTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex-1 px-2 sm:px-4 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? theme === 'dark'
                    ? 'bg-blue-500/20 text-blue-400 border-2 border-blue-500/50'
                    : 'bg-blue-50 text-blue-600 border-2 border-blue-200'
                  : theme === 'dark'
                    ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border-2 border-white/10'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900 border-2 border-gray-200'
              }`}
            >
              <span className="hidden xs:inline">{tab.label}</span>
              <span className="xs:hidden">
                {tab.key === 'active' ? t('pastOrders.tabActiveShort') : t('pastOrders.tabCompletedShort')}
              </span>
            </button>
          ))}
        </div>
        
        {/* Loading State */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size="lg" text={t('common:loading')} />
          </div>
        ) : currentOrders.length === 0 ? (
          <div className={`text-center py-12 text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            <p>
              {activeTab === 'active' && t('pastOrders.noActiveOrders')}
              {activeTab === 'completed' && t('pastOrders.noCompletedOrders')}
              {activeTab === 'completed' && t('pastOrders.noCompletedOrders')}
            </p>
          </div>
        ) : (
          <>
            {/* Order List */}
            <div className="space-y-1.5">
              {currentOrders.map((order) => {
                const status = order.status ? Object.keys(order.status)[0] : 'AwaitingDeposit';
                const totalChunks = order.chunks?.length || 0;
                const filledChunks = Math.floor(Number(order.total_filled_usd || 0) / MIN_CHUNK_SIZE_CENTS);
                const lockedChunks = Math.floor(Number(order.total_locked_usd || 0) / MIN_CHUNK_SIZE_CENTS);
                const availableChunks = totalChunks - filledChunks - lockedChunks;
                
                return (
                  <div
                    key={order.id.toString()}
                    onClick={() => navigate(`/order/${order.id}`, { state: { fromOrderDetails: true } })}
                    className={`group cursor-pointer rounded px-2.5 sm:px-3 py-2 transition-all border ${
                      theme === 'dark'
                        ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                        : 'bg-white/60 border-gray-200 hover:bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 sm:gap-3">
                      {/* Left: Amount + Status */}
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                        <span className={`font-semibold text-sm sm:text-base whitespace-nowrap ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                          {formatUsd(order.amount_usd)}
                        </span>
                        <div className="min-w-0">
                          <StatusBadge status={status} type="order" />
                        </div>
                      </div>
                      
                      {/* Center: Stats */}
                      <div className="hidden md:flex items-center gap-2 lg:gap-4 text-xs flex-shrink-0">
                        <div className={`whitespace-nowrap ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="font-medium">{availableChunks}</span>
                          <span className="opacity-60">/{totalChunks}</span>
                        </div>
                        <div className={`font-mono whitespace-nowrap ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                          {formatPrice(order.max_bsv_price)}
                        </div>
                        <div className={`text-xs whitespace-nowrap ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
                          {formatDate(order.created_at)}
                        </div>
                      </div>
                      
                      {/* Right: Arrow */}
                      <Eye 
                        size={14} 
                        className={`transition-transform group-hover:translate-x-0.5 flex-shrink-0 ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                        }`} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-col xs:flex-row items-start xs:items-center justify-between gap-2 mt-4 pt-3 border-t border-white/10">
                <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  Page {currentPage} of {totalPages} ({totalCount} orders)
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className={`p-1.5 rounded transition-colors ${
                      currentPage === 1
                        ? theme === 'dark' ? 'text-gray-600' : 'text-gray-400'
                        : theme === 'dark' 
                          ? 'text-gray-400 hover:text-white hover:bg-white/10' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className={`p-1.5 rounded transition-colors ${
                      currentPage === totalPages
                        ? theme === 'dark' ? 'text-gray-600' : 'text-gray-400'
                        : theme === 'dark' 
                          ? 'text-gray-400 hover:text-white hover:bg-white/10' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default PastOrdersPage;
