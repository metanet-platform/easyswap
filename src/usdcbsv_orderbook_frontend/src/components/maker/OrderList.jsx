import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Card, Loader, StatusBadge } from '../common';
import { toast } from 'react-hot-toast';
import { MIN_CHUNK_SIZE_CENTS } from '../../config';

const ITEMS_PER_PAGE = 20;

const OrderList = ({ onOrderSelect }) => {
  const { t } = useTranslation(['topup', 'common']);
  const { theme } = useTheme();
  const { actor, isAuthenticated } = useSDK();
  
  const [currentOrders, setCurrentOrders] = useState([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  
  const fetchOrders = async (page = 1) => {
    if (!isAuthenticated || !actor) return;
    
    setLoading(true);
    try {
      const offset = BigInt((page - 1) * ITEMS_PER_PAGE);
      const limit = BigInt(ITEMS_PER_PAGE);
      // Use get_my_active_orders_paginated - shows orders with Available, Idle, or Locked chunks
      const result = await actor.get_my_active_orders_paginated(offset, limit);
      
      setCurrentOrders(result.orders);
      setTotalOrders(Number(result.total));
      setCurrentPage(page);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error(t('errors.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchOrders(1);
  }, [isAuthenticated, actor]);
  
  const totalPages = Math.ceil(totalOrders / ITEMS_PER_PAGE);
  
  const formatUsd = (amount) => `$${Number(amount).toFixed(2)}`;
  const formatPrice = (price) => `$${Number(price).toFixed(2)}`;
  
  if (loading) {
    return (
      <Card>
        <div className="flex justify-center py-8">
          <Loader size="lg" text={t('common:loading')} />
        </div>
      </Card>
    );
  }
  
  return (
    <Card>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h2 className={`text-base sm:text-lg font-bold truncate ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {t('common:myRequests')}
          </h2>
          <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('list.subtitle')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => fetchOrders(currentPage)} disabled={loading} className="self-start sm:self-auto">
          <RefreshCw size={14} />
        </Button>
      </div>
      
      {/* All Orders Link */}
      <Link 
        to="/past-orders"
        className={`flex items-center gap-2 text-xs mb-3 px-3 py-1.5 rounded transition-colors ${
          theme === 'dark' 
            ? 'text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20' 
            : 'text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100'
        }`}
      >
        <History size={14} className="flex-shrink-0" />
        <span className="truncate">{t('list.viewAllOrders')}</span>
      </Link>
      
      {currentOrders.length === 0 ? (
        <div className={`text-center py-8 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          <p>{t('list.noOrders')}</p>
        </div>
      ) : (
        <>
          {/* Compact Order List */}
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
                  onClick={() => onOrderSelect?.(order.id)}
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
                    
                    {/* Right: Stats + Arrow */}
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <div className="hidden sm:flex items-center gap-2 lg:gap-3 text-xs">
                        <div className={`whitespace-nowrap ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="font-medium">{availableChunks}</span>
                          <span className="opacity-60">/{totalChunks}</span>
                        </div>
                        <div className={`font-mono whitespace-nowrap ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                          {formatPrice(order.max_bsv_price)}
                        </div>
                      </div>
                      <Eye 
                        size={14} 
                        className={`transition-transform group-hover:translate-x-0.5 flex-shrink-0 ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                        }`} 
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col xs:flex-row items-start xs:items-center justify-between gap-2 mt-4 pt-3 border-t border-white/10">
              <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => fetchOrders(Math.max(1, currentPage - 1))}
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
                  onClick={() => fetchOrders(Math.min(totalPages, currentPage + 1))}
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
  );
};

export default OrderList;
