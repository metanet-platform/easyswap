import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Card, Loader, StatusBadge } from '../common';
import { toast } from 'react-hot-toast';

const ITEMS_PER_PAGE = 20;

const TradeList = ({ onTradeSelect }) => {
  const { t } = useTranslation(['filler', 'common']);
  const { theme } = useTheme();
  const { actor, isAuthenticated } = useSDK();
  const [currentTrades, setCurrentTrades] = useState([]);
  const [totalTrades, setTotalTrades] = useState(0);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  
  const fetchTrades = async (page = 1) => {
    if (!isAuthenticated || !actor) return;
    
    setLoading(true);
    try {
      const offset = (page - 1) * ITEMS_PER_PAGE;
      const limit = ITEMS_PER_PAGE;
      // Exclude concluded trades - only show trades that need action
      // Exclude: WithdrawalConfirmed, Cancelled, PenaltyApplied
      const result = await actor.get_my_trades_paginated(BigInt(offset), BigInt(limit), []);
      
      // Filter out concluded trades on the frontend
      const activeTrades = result.trades.filter(trade => {
        const statusKey = Object.keys(trade.status)[0];
        const concludedStates = ['WithdrawalConfirmed', 'Cancelled', 'PenaltyApplied'];
        return !concludedStates.includes(statusKey);
      });
      
      setCurrentTrades(activeTrades);
      setTotalTrades(activeTrades.length); // Update total to reflect filtered count
      setCurrentPage(page);
    } catch (error) {
      console.error('Error fetching trades:', error);
      toast.error(t('errors.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchTrades(1);
  }, [isAuthenticated, actor]);
  
  const totalPages = Math.ceil(totalTrades / ITEMS_PER_PAGE);
  
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
            {t('common:myTrades')}
          </h2>
          <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('trades.subtitle')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => fetchTrades(currentPage)} disabled={loading} className="self-start sm:self-auto">
          <RefreshCw size={14} />
        </Button>
      </div>
      
      {/* Past Trades Link */}
      <Link 
        to="/trader/past-trades"
        className={`flex items-center gap-2 text-xs mb-3 px-3 py-1.5 rounded transition-colors ${
          theme === 'dark' 
            ? 'text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20' 
            : 'text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100'
        }`}
      >
        <History size={14} className="flex-shrink-0" />
        <span className="truncate">{t('trades.viewPastTrades')}</span>
      </Link>
      
      {currentTrades.length === 0 ? (
        <div className={`text-center py-8 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          <p>{t('trades.noTrades')}</p>
        </div>
      ) : (
        <>
          {/* Compact Trade List */}
          <div className="space-y-1.5">
            {currentTrades.map((trade) => {
              const status = Object.keys(trade.status)[0];
              
              return (
                <div
                  key={trade.id.toString()}
                  onClick={() => onTradeSelect?.(Number(trade.id))}
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
                        {formatUsd(trade.amount_usd)}
                      </span>
                      <div className="min-w-0">
                        <StatusBadge status={status} type="trade" />
                      </div>
                    </div>
                    
                    {/* Right: Stats + Arrow */}
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <div className="hidden sm:flex items-center gap-2 lg:gap-3 text-xs">
                        <div className={`whitespace-nowrap ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="font-medium">{trade.locked_chunks?.length || 0}</span>
                          <span className="opacity-60"> chunks</span>
                        </div>
                        {trade.agreed_bsv_price && (
                          <div className={`font-mono whitespace-nowrap ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                            {formatPrice(trade.agreed_bsv_price)}
                          </div>
                        )}
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
                  onClick={() => fetchTrades(Math.max(1, currentPage - 1))}
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
                  onClick={() => fetchTrades(Math.min(totalPages, currentPage + 1))}
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

export default TradeList;
