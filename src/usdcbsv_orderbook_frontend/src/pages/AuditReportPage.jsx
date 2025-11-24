import React, { useState, useEffect } from 'react';
import { useSDK } from '../contexts/SDKProvider';
import { toast } from 'react-hot-toast';

const AuditReportPage = () => {
  const { actor, isAuthenticated, sendCommand } = useSDK();
  
  // Tab state
  const [activeTab, setActiveTab] = useState('orders'); // 'orders' or 'trades'
  
  // Date filter state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  
  // Data state
  const [ordersData, setOrdersData] = useState(null);
  const [tradesData, setTradesData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Convert date string to nanoseconds timestamp
  const dateToNanos = (dateString) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return BigInt(date.getTime()) * BigInt(1_000_000); // Convert ms to ns
  };

  // Convert nanoseconds to readable date
  const nanosToDate = (nanos) => {
    if (!nanos) return 'N/A';
    const ms = Number(nanos) / 1_000_000;
    return new Date(ms).toLocaleString();
  };

  // Fetch orders audit data
  const fetchOrdersAudit = async () => {
    if (!actor || !isAuthenticated) {
      setError('Please authenticate first');
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const params = {
        start_time: startDate ? [dateToNanos(startDate)] : [],
        end_time: endDate ? [dateToNanos(endDate)] : [],
        page: BigInt(page),
        page_size: BigInt(pageSize),
      };
      
      const result = await actor.admin_get_orders_audit(params);
      
      if ('Ok' in result) {
        setOrdersData(result.Ok);
      } else {
        setError(result.Err);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch orders audit data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch trades audit data
  const fetchTradesAudit = async () => {
    if (!actor || !isAuthenticated) {
      setError('Please authenticate first');
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const params = {
        start_time: startDate ? [dateToNanos(startDate)] : [],
        end_time: endDate ? [dateToNanos(endDate)] : [],
        page: BigInt(page),
        page_size: BigInt(pageSize),
      };
      
      const result = await actor.admin_get_trades_audit(params);
      
      if ('Ok' in result) {
        setTradesData(result.Ok);
      } else {
        setError(result.Err);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch trades audit data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch data when filters or pagination changes
  useEffect(() => {
    if (!actor || !isAuthenticated) return;
    
    if (activeTab === 'orders') {
      fetchOrdersAudit();
    } else {
      fetchTradesAudit();
    }
  }, [activeTab, page, pageSize, actor, isAuthenticated]);

  // Export orders to clipboard as TSV for Excel
  const exportOrdersToXLSX = () => {
    if (!ordersData || !ordersData.records.length) {
      return;
    }

    try {
      // Create header row
      const headers = [
        'Order ID',
        'Maker',
        'Amount USD',
        'BSV Address',
        'Max BSV Price',
        'Status',
        'Chunks Count',
        'Total Filled USD',
        'Total Locked USD',
        'Total Idle USD',
        'Created At',
        'Funded At',
        'Allow Partial Fill',
        'Refund Count'
      ];

      // Create data rows
      const rows = ordersData.records.map(order => [
        Number(order.order_id),
        order.maker.toString(),
        order.amount_usd,
        order.bsv_address,
        order.max_bsv_price,
        Object.keys(order.status)[0],
        order.chunks.length,
        order.total_filled_usd,
        order.total_locked_usd,
        order.total_idle_usd,
        nanosToDate(order.created_at),
        order.funded_at.length ? nanosToDate(order.funded_at[0]) : 'N/A',
        order.allow_partial_fill ? 'Yes' : 'No',
        Number(order.refund_count)
      ]);

      // Convert to TSV (tab-separated values) - escape any cells containing tabs/newlines
      const escapeCell = (cell) => {
        const str = String(cell);
        // If cell contains tab, newline, or quote, wrap in quotes and escape quotes
        if (str.includes('\t') || str.includes('\n') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const tsvContent = [
        headers.join('\t'),
        ...rows.map(row => row.map(escapeCell).join('\t'))
      ].join('\r\n'); // Use \r\n for better Excel compatibility

      console.log('TSV Preview (first 500 chars):', tsvContent.substring(0, 500));
      console.log('Total rows:', rows.length + 1, 'Total length:', tsvContent.length);
      console.log('Line break check:', tsvContent.includes('\r\n') ? 'Has \\r\\n' : 'Missing \\r\\n');

      // Normalize any HTML <br> artifacts (some clipboard handlers convert newlines to <br>)
      let normalized = tsvContent.replace(/<br\s*\/?>/gi, '\\r\\n');
      normalized = normalized.replace(/&lt;br\s*\/?&gt;/gi, '\\r\\n');

      // Copy to clipboard (plain text)
      sendCommand({
        type: 'write-clipboard',
        text: normalized
      });

      toast.success(`${ordersData.records.length} orders copied to clipboard! You can now paste into Excel.`, {
        duration: 4000
      });
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  // Export trades to clipboard as TSV for Excel
  const exportTradesToXLSX = () => {
    if (!tradesData || !tradesData.records.length) {
      return;
    }

    try {
      // Create header row
      const headers = [
        'Trade ID',
        'Order ID',
        'Maker',
        'Filler',
        'Amount USD',
        'Chunks Count',
        'Agreed BSV Price',
        'Min BSV Price',
        'Status',
        'Maker BSV Address',
        'Created At',
        'TX Submitted At',
        'Withdrawal Confirmed At'
      ];

      // Create data rows
      const rows = tradesData.records.map(trade => [
        Number(trade.trade_id),
        Number(trade.order_id),
        trade.maker.toString(),
        trade.filler.toString(),
        trade.amount_usd,
        Number(trade.chunks_count),
        trade.agreed_bsv_price,
        trade.min_bsv_price,
        Object.keys(trade.status)[0],
        trade.maker_bsv_address,
        nanosToDate(trade.created_at),
        trade.tx_submitted_at.length ? nanosToDate(trade.tx_submitted_at[0]) : 'N/A',
        trade.withdrawal_confirmed_at.length ? nanosToDate(trade.withdrawal_confirmed_at[0]) : 'N/A'
      ]);

      // Convert to TSV (tab-separated values) - escape any cells containing tabs/newlines
      const escapeCell = (cell) => {
        const str = String(cell);
        // If cell contains tab, newline, or quote, wrap in quotes and escape quotes
        if (str.includes('\t') || str.includes('\n') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const tsvContent = [
        headers.join('\t'),
        ...rows.map(row => row.map(escapeCell).join('\t'))
      ].join('\r\n'); // Use \r\n for better Excel compatibility

      console.log('TSV Preview (first 500 chars):', tsvContent.substring(0, 500));
      console.log('Total rows:', rows.length + 1, 'Total length:', tsvContent.length);
      console.log('Line break check:', tsvContent.includes('\r\n') ? 'Has \\r\\n' : 'Missing \\r\\n');

      // Normalize any HTML <br> artifacts
      let normalized = tsvContent.replace(/<br\s*\/?>/gi, '\\r\\n');
      normalized = normalized.replace(/&lt;br\s*\/?&gt;/gi, '\\r\\n');

      // Copy to clipboard (plain text)
      sendCommand({
        type: 'write-clipboard',
        text: normalized
      });

      toast.success(`${tradesData.records.length} trades copied to clipboard! You can now paste into Excel.`, {
        duration: 4000
      });
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  // Calculate pagination info
  const getPaginationInfo = () => {
    const data = activeTab === 'orders' ? ordersData : tradesData;
    if (!data) return { start: 0, end: 0, total: 0 };
    
    const total = Number(data.total_count);
    const start = Number(data.page) * Number(data.page_size) + 1;
    const end = Math.min(start + Number(data.page_size) - 1, total);
    
    return { start, end, total };
  };

  const paginationInfo = getPaginationInfo();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Audit Report
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            View and export comprehensive audit data for orders and trades
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => { setActiveTab('orders'); setPage(0); }}
              className={`${
                activeTab === 'orders'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
            >
              "Orders"
            </button>
            <button
              onClick={() => { setActiveTab('trades'); setPage(0); }}
              className={`${
                activeTab === 'trades'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
            >
              "Trades"
            </button>
          </nav>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                "Start Date"
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                "End Date"
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
            </div>

            {/* Page Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                "Rows per page"
              </label>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
              </select>
            </div>

            {/* Apply Button */}
            <div className="flex items-end">
              <button
                onClick={() => {
                  setPage(0);
                  activeTab === 'orders' ? fetchOrdersAudit() : fetchTradesAudit();
                }}
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Loading..." : "Apply Filters"}
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Export and Pagination Controls */}
        {((activeTab === 'orders' && ordersData) || (activeTab === 'trades' && tradesData)) && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              {/* Pagination Info */}
              <div className="text-sm text-gray-600 dark:text-gray-400">
                "Showing" {paginationInfo.start}-{paginationInfo.end} "of" {paginationInfo.total}
              </div>

              {/* Pagination Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0 || loading}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  "Previous"
                </button>
                <span className="px-3 py-1 text-gray-700 dark:text-gray-300">
                  "Page" {page + 1}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={paginationInfo.end >= paginationInfo.total || loading}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  "Next"
                </button>
              </div>

              {/* Copy to Clipboard Button */}
              <button
                onClick={activeTab === 'orders' ? exportOrdersToXLSX : exportTradesToXLSX}
                disabled={loading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                "Copy Report to Clipboard"
              </button>
            </div>
          </div>
        )}

        {/* Data Tables */}
        {loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">"Loading data..."</p>
          </div>
        ) : activeTab === 'orders' && ordersData ? (
          <OrdersTable data={ordersData.records} nanosToDate={nanosToDate} />
        ) : activeTab === 'trades' && tradesData ? (
          <TradesTable data={tradesData.records} nanosToDate={nanosToDate} />
        ) : null}
      </div>
    </div>
  );
};

// Orders Table Component
const OrdersTable = ({ data, nanosToDate }) => {
  const [expandedRow, setExpandedRow] = useState(null);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Order ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Maker</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount USD</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Chunks</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {data.map((order) => (
              <React.Fragment key={Number(order.order_id)}>
                <tr className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    #{Number(order.order_id)}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    <div className="truncate max-w-[150px]" title={order.maker.toString()}>
                      {order.maker.toString()}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    ${order.amount_usd.toFixed(2)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getOrderStatusColor(order.status)}`}>
                      {Object.keys(order.status)[0]}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    {order.chunks.length}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    {nanosToDate(order.created_at)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm">
                    <button
                      onClick={() => setExpandedRow(expandedRow === Number(order.order_id) ? null : Number(order.order_id))}
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {expandedRow === Number(order.order_id) ? "Hide" : "Details"}
                    </button>
                  </td>
                </tr>
                {expandedRow === Number(order.order_id) && (
                  <tr>
                    <td colSpan="7" className="px-4 py-4 bg-gray-50 dark:bg-gray-900">
                      <OrderDetails order={order} nanosToDate={nanosToDate} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Order Details Component
const OrderDetails = ({ order, nanosToDate }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div>
      <h4 className="font-semibold text-gray-900 dark:text-white mb-3">"Order Information"</h4>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"BSV Address":</dt>
          <dd className="text-gray-900 dark:text-white font-mono text-xs">{order.bsv_address}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Max BSV Price":</dt>
          <dd className="text-gray-900 dark:text-white">${order.max_bsv_price.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Filled USD":</dt>
          <dd className="text-gray-900 dark:text-white">${order.total_filled_usd.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Locked USD":</dt>
          <dd className="text-gray-900 dark:text-white">${order.total_locked_usd.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Idle USD":</dt>
          <dd className="text-gray-900 dark:text-white">${order.total_idle_usd.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Funded At":</dt>
          <dd className="text-gray-900 dark:text-white">
            {order.funded_at.length ? nanosToDate(order.funded_at[0]) : 'N/A'}
          </dd>
        </div>
      </dl>
    </div>
    <div>
      <h4 className="font-semibold text-gray-900 dark:text-white mb-3">"Chunks"</h4>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {order.chunks.map((chunk) => (
          <div key={Number(chunk.chunk_id)} className="bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600 dark:text-gray-400">Chunk #{Number(chunk.chunk_id)}</span>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getChunkStatusColor(chunk.status)}`}>
                {Object.keys(chunk.status)[0]}
              </span>
            </div>
            <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
              ${chunk.amount_usd.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// Trades Table Component
const TradesTable = ({ data, nanosToDate }) => {
  const [expandedRow, setExpandedRow] = useState(null);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trade ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Order ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Filler</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount USD</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {data.map((trade) => (
              <React.Fragment key={Number(trade.trade_id)}>
                <tr className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    #{Number(trade.trade_id)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    #{Number(trade.order_id)}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    <div className="truncate max-w-[150px]" title={trade.filler.toString()}>
                      {trade.filler.toString()}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    ${trade.amount_usd.toFixed(2)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTradeStatusColor(trade.status)}`}>
                      {Object.keys(trade.status)[0]}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    {nanosToDate(trade.created_at)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm">
                    <button
                      onClick={() => setExpandedRow(expandedRow === Number(trade.trade_id) ? null : Number(trade.trade_id))}
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {expandedRow === Number(trade.trade_id) ? "Hide" : "Details"}
                    </button>
                  </td>
                </tr>
                {expandedRow === Number(trade.trade_id) && (
                  <tr>
                    <td colSpan="7" className="px-4 py-4 bg-gray-50 dark:bg-gray-900">
                      <TradeDetails trade={trade} nanosToDate={nanosToDate} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Trade Details Component
const TradeDetails = ({ trade, nanosToDate }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div>
      <h4 className="font-semibold text-gray-900 dark:text-white mb-3">"Trade Information"</h4>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Maker":</dt>
          <dd className="text-gray-900 dark:text-white font-mono text-xs truncate max-w-[200px]" title={trade.maker.toString()}>
            {trade.maker.toString()}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Chunks Count":</dt>
          <dd className="text-gray-900 dark:text-white">{Number(trade.chunks_count)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Agreed BSV Price":</dt>
          <dd className="text-gray-900 dark:text-white">${trade.agreed_bsv_price.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Min BSV Price":</dt>
          <dd className="text-gray-900 dark:text-white">${trade.min_bsv_price.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Maker BSV Address":</dt>
          <dd className="text-gray-900 dark:text-white font-mono text-xs">{trade.maker_bsv_address}</dd>
        </div>
      </dl>
    </div>
    <div>
      <h4 className="font-semibold text-gray-900 dark:text-white mb-3">"Timestamps"</h4>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"TX Submitted":</dt>
          <dd className="text-gray-900 dark:text-white">
            {trade.tx_submitted_at.length ? nanosToDate(trade.tx_submitted_at[0]) : 'N/A'}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Lock Expires":</dt>
          <dd className="text-gray-900 dark:text-white">{nanosToDate(trade.lock_expires_at)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">"Withdrawal Confirmed":</dt>
          <dd className="text-gray-900 dark:text-white">
            {trade.withdrawal_confirmed_at.length ? nanosToDate(trade.withdrawal_confirmed_at[0]) : 'N/A'}
          </dd>
        </div>
      </dl>
    </div>
  </div>
);

// Helper functions for status colors
const getOrderStatusColor = (status) => {
  const statusKey = Object.keys(status)[0];
  const colors = {
    Active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    Idle: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    PartiallyFilled: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    Filled: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    Refunded: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  };
  return colors[statusKey] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
};

const getChunkStatusColor = (status) => {
  const statusKey = Object.keys(status)[0];
  const colors = {
    Available: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    Locked: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    Filled: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    Idle: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    Refunding: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    Refunded: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  };
  return colors[statusKey] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
};

const getTradeStatusColor = (status) => {
  const statusKey = Object.keys(status)[0];
  const colors = {
    ChunksLocked: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    TxSubmitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    ReadyForRelease: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    WithdrawalConfirmed: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    PenaltyApplied: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  };
  return colors[statusKey] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
};

export default AuditReportPage;
