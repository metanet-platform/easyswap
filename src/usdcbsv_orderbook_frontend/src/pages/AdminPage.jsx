import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, User, Key, Download, Activity, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSDK } from '../contexts/SDKProvider';
import { useTheme } from '../contexts/ThemeContext';
import { Card, Button } from '../components/common';
import TreasuryCard from '../components/TreasuryCard';
import { ADMIN_PRINCIPAL } from '../config';

const AdminPage = () => {
  const { t } = useTranslation(['common']);
  const { theme } = useTheme();
  const { userPrincipal, rootPrincipal, isAuthenticated, sendCommand, actor } = useSDK();
  const [copied, setCopied] = useState({});
  const [withdrawing, setWithdrawing] = useState(false);
  const [adminEvents, setAdminEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [totalEvents, setTotalEvents] = useState(0);
  const [newOrdersEnabled, setNewOrdersEnabled] = useState(true);
  const [loadingOrderStatus, setLoadingOrderStatus] = useState(false);
  const [togglingOrders, setTogglingOrders] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const isAdmin = userPrincipal === ADMIN_PRINCIPAL;

  // Fetch new orders status
  useEffect(() => {
    const fetchOrderStatus = async () => {
      if (!actor || !isAdmin) return;
      
      setLoadingOrderStatus(true);
      try {
        const enabled = await actor.are_new_orders_enabled();
        setNewOrdersEnabled(enabled);
      } catch (error) {
        console.error('Error fetching order status:', error);
      } finally {
        setLoadingOrderStatus(false);
      }
    };

    fetchOrderStatus();
    const interval = setInterval(fetchOrderStatus, 15000); // Refresh every 15 seconds
    
    return () => clearInterval(interval);
  }, [actor, isAdmin]);

  // Fetch admin events
  useEffect(() => {
    const fetchAdminEvents = async () => {
      if (!actor || !isAdmin) return;
      
      setLoadingEvents(true);
      try {
        // Fetch total count and paginated events for current page
        const count = await actor.get_admin_events_count();
        setTotalEvents(Number(count || 0n));

        const offset = BigInt(page * PAGE_SIZE);
        const limit = BigInt(PAGE_SIZE);
        const events = await actor.get_admin_events_paginated(offset, limit);
        setAdminEvents(events);
      } catch (error) {
        console.error('Error fetching admin events:', error);
      } finally {
        setLoadingEvents(false);
      }
    };

    fetchAdminEvents();
    const interval = setInterval(fetchAdminEvents, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [actor, isAdmin]);

  // Refetch when page changes
  useEffect(() => {
    if (!actor || !isAdmin) return;
    const fetchPage = async () => {
      setLoadingEvents(true);
      try {
        const offset = BigInt(page * PAGE_SIZE);
        const limit = BigInt(PAGE_SIZE);
        const events = await actor.get_admin_events_paginated(offset, limit);
        setAdminEvents(events);
      } catch (e) {
        console.error('Failed to fetch page', e);
      } finally {
        setLoadingEvents(false);
      }
    };
    fetchPage();
  }, [page, actor, isAdmin]);

  const handleCopy = async (text, key) => {
    try {
      sendCommand({
        type: "write-clipboard",
        text: text
      });
      setCopied({ ...copied, [key]: true });
      toast.success(t('common.copied'));
      setTimeout(() => {
        setCopied({ ...copied, [key]: false });
      }, 2000);
    } catch (error) {
      toast.error(t('common.copyFailed'));
    }
  };

  const handleWithdrawTreasury = async () => {
    if (!actor) {
      toast.error('Not authenticated');
      return;
    }

    setWithdrawing(true);
    try {
      const result = await actor.admin_withdraw_ckusdc_treasury();
      
      if ('Ok' in result) {
        toast.success(`Treasury withdrawn! Block index: ${result.Ok.toString()}`);
      } else {
        toast.error(result.Err || 'Withdrawal failed');
      }
    } catch (error) {
      console.error('Withdraw error:', error);
      toast.error(error.message || 'Failed to withdraw from treasury');
    } finally {
      setWithdrawing(false);
    }
  };

  const handleToggleNewOrders = async (enable) => {
    if (!actor) {
      toast.error('Not authenticated');
      return;
    }

    setTogglingOrders(true);
    try {
      const result = await actor.admin_toggle_new_orders(enable);
      
      if ('Ok' in result) {
        setNewOrdersEnabled(enable);
        toast.success(result.Ok);
        setShowConfirmDialog(false);
        setConfirmAction(null);
      } else {
        toast.error(result.Err || 'Toggle failed');
      }
    } catch (error) {
      console.error('Toggle error:', error);
      toast.error(error.message || 'Failed to toggle new orders');
    } finally {
      setTogglingOrders(false);
    }
  };

  const requestToggle = (enable) => {
    setConfirmAction(enable);
    setShowConfirmDialog(true);
  };

  // Show access denied if not admin
  if (!isAdmin) {
    return (
      <div className="mx-auto py-4">
        <Card className={`border-red-500/30 ${theme === 'dark' ? 'bg-red-500/5' : 'bg-red-50'}`}>
          <div className="flex items-center gap-3 p-6 text-center">
            <AlertTriangle className={theme === 'dark' ? 'text-red-400' : 'text-red-600'} size={48} />
            <div>
              <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
                Access Denied
              </h2>
              <p className={`mt-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                This page is only accessible to administrators.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const identityInfo = [
    {
      key: 'delegated',
      icon: User,
      label: 'Admin Principal',
      value: userPrincipal || 'Not authenticated',
      description: 'Administrator identity principal',
      color: 'blue'
    },
    {
      key: 'root',
      icon: Key,
      label: 'Root Principal',
      value: rootPrincipal || 'Not available',
      description: 'Wallet root principal',
      color: 'purple'
    }
  ];

  const formatEventType = (eventType) => {
    if ('PenaltyApplied' in eventType) {
      const { trade_id, order_id, filler, order_maker, penalty_amount, bsv_tx_hex, reason } = eventType.PenaltyApplied;
      const details = [
        `Trade #${trade_id.toString()}`,
      ];
      if (order_id && order_id.length > 0) {
        details.push(`Order #${order_id[0].toString()}`);
      }
      details.push(`Filler: ${filler.toString()}`);
      if (order_maker && order_maker.length > 0) {
        details.push(`Maker: ${order_maker[0].toString()}`);
      }
      if (bsv_tx_hex && bsv_tx_hex.length > 0) {
        details.push(`BSV TX: ${bsv_tx_hex[0].substring(0, 16)}...`);
      }
      details.push(`Amount: $${penalty_amount.toFixed(2)}`);
      details.push(`Reason: ${reason}`);
      
      return {
        title: '⚠️ Penalty Applied',
        details
      };
    } else if ('TradeExpiredToTreasury' in eventType) {
      const { trade_id, filler, order_id, amount_sent, block_index } = eventType.TradeExpiredToTreasury;
      return {
        title: '💰 Trade Expired → Treasury',
        details: [
          `Trade #${trade_id.toString()}`,
          `Order #${order_id.toString()}`,
          `Filler: ${filler.toString()}`,
          `Amount: $${amount_sent.toFixed(2)}`,
          `Block: ${block_index.toString()}`
        ]
      };
    } else if ('BlockInsertionError' in eventType) {
      const { block_height, error_message } = eventType.BlockInsertionError;
      return {
        title: '🚫 Block Insertion Failed',
        details: [
          `Block Height: ${block_height.toString()}`,
          `Error: ${error_message}`
        ]
      };
    } else if ('HeartbeatExecution' in eventType) {
      const { operation, cycles_consumed, timestamp } = eventType.HeartbeatExecution;
      const cyclesInTC = (Number(cycles_consumed) / 1_000_000_000_000).toFixed(4);
      return {
        title: `⏱️ ${operation}`,
        details: [
          `Cycles: ${cyclesInTC} TC`,
          `Timestamp: ${new Date(Number(timestamp) / 1_000_000).toLocaleString()}`
        ]
      };
    } else if ('NewOrdersEnabled' in eventType) {
      return {
        title: '✅ New Orders Enabled',
        details: ['System is now accepting new order submissions']
      };
    } else if ('NewOrdersDisabled' in eventType) {
      return {
        title: '🚨 New Orders Disabled',
        details: ['System is NOT accepting new orders', 'Existing orders and trades continue normally']
      };
    }
    return { title: 'Unknown Event', details: [] };
  };

  return (
    <div className="mx-auto py-4">
      <div className="mb-3">
        <h1 className={`text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          Admin Dashboard
        </h1>
        <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          Administrative functions and system monitoring
        </p>
      </div>

      {/* Identity Section */}
      <div className="space-y-2.5 mb-4">
        {identityInfo.map((item) => {
          const Icon = item.icon;
          const isCopied = copied[item.key];
          
          return (
            <Card key={item.key} className={`border-${item.color}-500/30 ${theme === 'dark' ? `bg-${item.color}-500/5` : `bg-${item.color}-50`}`}>
              <div className="flex flex-col sm:flex-row items-start gap-3">
                <div className={`p-2 rounded-lg flex-shrink-0 ${theme === 'dark' ? `bg-${item.color}-500/20` : `bg-${item.color}-100`}`}>
                  <Icon className={theme === 'dark' ? `text-${item.color}-400` : `text-${item.color}-600`} size={20} />
                </div>
                
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className={`text-base font-semibold ${theme === 'dark' ? `text-${item.color}-300` : `text-${item.color}-700`}`}>
                        {item.label}
                      </h3>
                      <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                        {item.description}
                      </p>
                    </div>
                    
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleCopy(item.value, item.key)}
                      disabled={item.value === 'Not authenticated' || item.value === 'Not available'}
                      className="flex-shrink-0 px-2 py-1"
                    >
                      {isCopied ? <Check size={14} /> : <Copy size={14} />}
                    </Button>
                  </div>
                  
                  <div className={`rounded p-2 border ${
                    theme === 'dark' 
                      ? 'bg-black/40 border-gray-700' 
                      : 'bg-gray-100 border-gray-300'
                  }`}>
                    <code className={`text-xs font-mono break-all block ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                      {item.value}
                    </code>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* App Treasury - Admin View */}
      <div className="mb-4">
        <TreasuryCard />
      </div>

      {/* Audit Report Link */}
      <div className="mb-4">
        <Card className={`border-purple-500/30 ${theme === 'dark' ? 'bg-purple-500/5' : 'bg-purple-50'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-purple-500/20' : 'bg-purple-100'}`}>
                <Activity className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={20} />
              </div>
              <div>
                <h3 className={`text-base font-semibold ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>
                  Audit Report
                </h3>
                <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  View and export comprehensive audit data for orders and trades
                </p>
              </div>
            </div>
            <Button
              onClick={() => window.location.href = '/audit'}
              className={`${theme === 'dark' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-purple-600 hover:bg-purple-700'} text-white`}
            >
              View Report
            </Button>
          </div>
        </Card>
      </div>

      {/* Admin Actions */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        {/* Emergency: Toggle New Orders */}
        <Card className={`border-red-500/30 ${theme === 'dark' ? 'bg-red-500/5' : 'bg-red-50'}`}>
          <div className="flex flex-col items-start gap-3">
            <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-red-500/20' : 'bg-red-100'}`}>
              <AlertTriangle className={theme === 'dark' ? 'text-red-400' : 'text-red-600'} size={20} />
            </div>
            
            <div className="w-full">
              <h3 className={`text-base font-semibold ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
                Emergency: New Orders Control
              </h3>
              <p className={`text-xs mt-1 mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Enable/disable accepting new orders (existing orders & trades continue)
              </p>
              
              <div className={`rounded p-3 mb-3 ${theme === 'dark' ? 'bg-black/40' : 'bg-white/60'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    Current Status:
                  </span>
                  {loadingOrderStatus ? (
                    <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      Loading...
                    </span>
                  ) : (
                    <span className={`text-sm font-bold ${newOrdersEnabled ? 'text-green-500' : 'text-red-500'}`}>
                      {newOrdersEnabled ? '✅ ENABLED' : '🚫 DISABLED'}
                    </span>
                  )}
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => requestToggle(true)}
                  disabled={togglingOrders || newOrdersEnabled}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  Enable Orders
                </Button>
                <Button
                  variant="primary"
                  onClick={() => requestToggle(false)}
                  disabled={togglingOrders || !newOrdersEnabled}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  Disable Orders
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Treasury Withdrawal */}
        <Card className={`border-yellow-500/30 ${theme === 'dark' ? 'bg-yellow-500/5' : 'bg-yellow-50'}`}>
          <div className="flex flex-col items-start gap-3">
            <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-yellow-500/20' : 'bg-yellow-100'}`}>
              <Download className={theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'} size={20} />
            </div>
            
            <div className="w-full">
              <h3 className={`text-base font-semibold ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>
                Treasury Withdrawal
              </h3>
              <p className={`text-xs mt-1 mb-3 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Withdraw all ckUSDC from treasury to admin principal
              </p>
              
              <Button
                variant="primary"
                onClick={handleWithdrawTreasury}
                disabled={withdrawing}
                className="w-full bg-yellow-600 hover:bg-yellow-700"
              >
                {withdrawing ? 'Withdrawing...' : 'Withdraw Treasury'}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Admin Events Log */}
      <Card className={`border-purple-500/30 ${theme === 'dark' ? 'bg-purple-500/5' : 'bg-purple-50'}`}>
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2 rounded-lg flex-shrink-0 ${theme === 'dark' ? 'bg-purple-500/20' : 'bg-purple-100'}`}>
            <Activity className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={20} />
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className={`text-base font-semibold ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>
              Admin Events
            </h3>
            <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              System events requiring admin attention
            </p>
          </div>
        </div>

        {loadingEvents ? (
          <div className={`text-center py-8 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-2"></div>
            <p>Loading events...</p>
          </div>
        ) : adminEvents.length === 0 ? (
          <div className={`text-center py-8 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            <Activity className="mx-auto mb-2" size={32} />
            <p>No admin events yet</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {adminEvents
              .filter(event => !('HeartbeatExecution' in event.event_type)) // Filter out heartbeat noise
              .map((event) => {
              const formattedEvent = formatEventType(event.event_type);
              
              return (
                <div 
                  key={event.id.toString()} 
                  className={`rounded-lg p-4 border transition-colors ${
                    theme === 'dark'
                      ? 'bg-black/40 border-purple-500/20 hover:border-purple-500/40'
                      : 'bg-white/60 border-purple-200 hover:border-purple-300'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                    <h4 className={`font-semibold text-base ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>
                      {formattedEvent.title}
                    </h4>
                    <span className={`text-xs whitespace-nowrap ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      {new Date(Number(event.timestamp) / 1_000_000).toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="space-y-2">
                    {formattedEvent.details.map((detail, index) => (
                      <p key={index} className={`text-sm font-mono break-all ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                        {detail}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
            
            {/* Pagination controls */}
            <div className="flex items-center justify-between mt-4">
              <div className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                {`Showing ${(page * PAGE_SIZE) + 1} - ${Math.min((page + 1) * PAGE_SIZE, totalEvents)} of ${totalEvents}`}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                  Previous
                </Button>
                <Button variant="secondary" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= totalEvents}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className={`max-w-md w-full border-red-500/30 ${theme === 'dark' ? 'bg-red-500/10' : 'bg-red-50'}`}>
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-red-500/20' : 'bg-red-100'}`}>
                  <AlertTriangle className={theme === 'dark' ? 'text-red-400' : 'text-red-600'} size={24} />
                </div>
                <div>
                  <h3 className={`text-lg font-bold ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
                    Confirm {confirmAction ? 'Enable' : 'Disable'} New Orders
                  </h3>
                  <p className={`text-sm mt-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    {confirmAction 
                      ? 'Are you sure you want to ENABLE new order creation? Users will be able to create new orders.'
                      : 'Are you sure you want to DISABLE new order creation? This is an emergency measure. No new orders will be accepted, but existing orders and trades will continue normally.'
                    }
                  </p>
                </div>
              </div>

              <div className={`rounded p-3 mb-4 ${theme === 'dark' ? 'bg-black/40 border border-yellow-500/30' : 'bg-yellow-50 border border-yellow-300'}`}>
                <p className={`text-xs font-semibold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-700'}`}>
                  ⚠️ Important:
                </p>
                <ul className={`text-xs mt-2 space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <li>• This action will be logged in admin events</li>
                  <li>• {confirmAction ? 'New orders will be accepted immediately' : 'Existing orders and trades continue normally'}</li>
                  <li>• {confirmAction ? 'Users can create new orders again' : 'Only existing operations will work'}</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowConfirmDialog(false);
                    setConfirmAction(null);
                  }}
                  disabled={togglingOrders}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleToggleNewOrders(confirmAction)}
                  disabled={togglingOrders}
                  className={`flex-1 ${confirmAction ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  {togglingOrders ? 'Processing...' : `Yes, ${confirmAction ? 'Enable' : 'Disable'}`}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
