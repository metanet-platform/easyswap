import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, TrendingUp, DollarSign, Activity, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSDK } from '../contexts/SDKProvider';
import { useTheme } from '../contexts/ThemeContext';
import { Button, Loader } from '../components/common';
import { toast } from 'react-hot-toast';
import { MIN_CHUNK_SIZE_USD, MAX_ORDERBOOK_USD_LIMIT } from '../config';

const CHUNKS_PER_PAGE = 100;

const OrderbookView = () => {
  const { t } = useTranslation(['orderbook', 'common']);
  const { theme } = useTheme();
  const { actor, isAuthenticated } = useSDK();
  const [chunks, setChunks] = useState([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [stats, setStats] = useState(null);
  const [bsvPrice, setBsvPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  useEffect(() => {
    fetchOrderbook(1);
  }, [isAuthenticated, actor]);
  
  const fetchOrderbook = async (page = 1) => {
    if (!isAuthenticated || !actor) return;
    
    setLoading(true);
    try {
      const offset = (page - 1) * CHUNKS_PER_PAGE;
      const limit = CHUNKS_PER_PAGE;
      
      const [chunksResult, statsResult, priceResult] = await Promise.all([
        actor.get_active_chunks_paginated(BigInt(offset), BigInt(limit)),
        actor.get_orderbook_stats(),
        actor.get_bsv_price()
      ]);
      
      setChunks(chunksResult.chunks);
      setTotalChunks(Number(chunksResult.total));
      setCurrentPage(page);
      setStats(statsResult);
      
      if ('Ok' in priceResult) {
        setBsvPrice(priceResult.Ok);
      }
    } catch (error) {
      console.error('Error fetching orderbook:', error);
      toast.error(t('errors.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };
  
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchOrderbook(currentPage);
      toast.success(t('orderbookRefreshed'));
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setRefreshing(false);
    }
  };
  
  const totalPages = Math.ceil(totalChunks / CHUNKS_PER_PAGE);
  
  const formatPrice = (priceInCents) => {
    return (Number(priceInCents) / 100).toFixed(2);
  };
  
  const formatUSD = (amount) => {
    return Number(amount).toFixed(2);
  };
  
  if (loading) {
    return (
      <div className="container mx-auto py-4">
        <div className={`rounded-lg p-8 border ${
          theme === 'dark' 
            ? 'bg-black/40 border-white/10' 
            : 'bg-white/80 border-gray-200'
        }`}>
          <div className="flex justify-center">
            <Loader size="md" text={t('loadingOrderbook')} />
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-4">
      {/* BSV Price Display */}
      {bsvPrice > 0 && (
        <div className={`rounded-lg p-3 mb-3 border ${
          theme === 'dark'
            ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500/30'
            : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
        }`}>
          <div className="flex items-center justify-center gap-2">
            <TrendingUp size={18} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
            <span className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('currentBsvPrice')}</span>
            <span className={`font-bold text-lg ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>${bsvPrice}</span>
          </div>
        </div>
      )}

      {/* Orderbook Capacity Display */}
      {stats && (
        <div className={`rounded-lg p-3 mb-3 border ${
          theme === 'dark'
            ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-500/30'
            : 'bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200'
        }`}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} />
              <span className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('orderbookCapacity')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-bold text-lg ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>${stats.total_available_usd || 0}</span>
              <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>/</span>
              <span className={`font-semibold text-lg ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>${MAX_ORDERBOOK_USD_LIMIT.toLocaleString()}</span>
            </div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              ({((stats.total_available_usd / MAX_ORDERBOOK_USD_LIMIT) * 100)}% {t('filled')})
            </div>
          </div>
        </div>
      )}
      
      {/* Header with Stats */}
      <div className={`rounded-lg p-3 mb-3 border ${
        theme === 'dark' 
          ? 'bg-black/40 border-white/10' 
          : 'bg-white/80 border-gray-200'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <h2 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('title')}</h2>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`p-1.5 rounded transition-colors sm:hidden ${
                theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
              title={t('refresh')}
            >
              <RefreshCw size={14} className={theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} />
            </button>
          </div>
          
          {stats && (
            <div className="flex items-center gap-2 sm:gap-3 text-xs flex-wrap">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={12} className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('available')}</span>
                <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>${Number(stats.total_available_usd || 0)}</span>
              </div>
              <div className={`h-3 w-px hidden sm:block ${theme === 'dark' ? 'bg-white/20' : 'bg-gray-300'}`} />
              <div className="flex items-center gap-1.5">
                <Activity size={12} className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} />
                <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('chunks')}</span>
                <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{Number(stats.total_active_chunks || 0)}</span>
              </div>
              <div className={`h-3 w-px hidden sm:block ${theme === 'dark' ? 'bg-white/20' : 'bg-gray-300'}`} />
              <div className="flex items-center gap-1.5">
                <DollarSign size={12} className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} />
                <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('orders')}</span>
                <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{Number(stats.total_orders || 0)}</span>
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className={`p-1.5 rounded transition-colors hidden sm:block ml-auto ${
                  theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                }`}
                title={t('refresh')}
              >
                <RefreshCw size={14} className={theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Orderbook Table */}
      <div className={`rounded-lg overflow-hidden border ${
        theme === 'dark' 
          ? 'bg-black/40 border-white/10' 
          : 'bg-white/80 border-gray-200'
      }`}>
        {chunks.length === 0 ? (
          <div className={`text-center py-12 text-sm ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>
            {t('noOrdersAvailable')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className={`border-b ${
                  theme === 'dark' 
                    ? 'border-white/10 bg-white/5' 
                    : 'border-gray-200 bg-gray-50'
                }`}>
                  <th className={`text-left px-2 sm:px-3 py-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>{t('amount')}</th>
                  <th className={`text-right px-2 sm:px-3 py-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>{t('maxPrice')}</th>
                  <th className={`text-right px-2 sm:px-3 py-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>{t('bsvApprox')}</th>
                  <th className={`text-right px-2 sm:px-3 py-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>{t('orderId')}</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${theme === 'dark' ? 'divide-white/5' : 'divide-gray-200'}`}>
                {chunks.map((chunk, idx) => {
                  const chunkAmount = Number(chunk.amount_usd || 0);
                  const maxPriceCents = Number(chunk.max_price_per_bsv_in_cents || 0);
                  const maxPrice = maxPriceCents / 100;
                  // Calculate BSV amount based on current BSV price, not max price
                  const estimatedBSV = bsvPrice > 0 ? chunkAmount / bsvPrice : 0;
                  
                  return (
                    <tr 
                      key={idx}
                      className={`transition-colors cursor-pointer ${
                        theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-2 sm:px-3 py-1.5">
                        <span className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>${chunkAmount}</span>
                      </td>
                      <td className="px-2 sm:px-3 py-1.5 text-right">
                        <span className={`font-mono text-sm ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>${maxPrice}</span>
                      </td>
                      <td className="px-2 sm:px-3 py-1.5 text-right">
                        <span className={`font-mono text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{estimatedBSV}</span>
                      </td>
                      <td className="px-2 sm:px-3 py-1.5 text-right">
                        <span className={`font-mono text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>#{chunk.order_id?.toString() || 'N/A'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className={`mt-3 rounded-lg p-2 border ${
          theme === 'dark' 
            ? 'bg-black/40 border-white/10' 
            : 'bg-white/80 border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Page {currentPage} of {totalPages} • {totalChunks} total chunks
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => fetchOrderbook(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1 || refreshing}
                className={`p-1.5 rounded transition-colors ${
                  currentPage === 1 || refreshing
                    ? theme === 'dark' ? 'text-gray-600' : 'text-gray-400'
                    : theme === 'dark' 
                      ? 'text-gray-400 hover:text-white hover:bg-white/10' 
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => fetchOrderbook(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages || refreshing}
                className={`p-1.5 rounded transition-colors ${
                  currentPage === totalPages || refreshing
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
        </div>
      )}
      
      {/* Footer Info */}
      <div className={`mt-2 text-center text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>
        {chunks.length} {chunks.length !== 1 ? t('orderPlural') : t('orderSingular')} {t('availableSuffix')} • {t('updated')} {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
};

export default OrderbookView;
