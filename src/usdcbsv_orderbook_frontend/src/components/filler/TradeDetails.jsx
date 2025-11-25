import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Clock } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSDK } from '../../contexts/SDKProvider';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Card, Loader, StatusBadge, Modal, Input } from '../common';
import { broadcastTransaction } from '../../services/broadcastService';
import { 
  SECURITY_DEPOSIT_PERCENT, 
  RESUBMISSION_PENALTY_PERCENT, 
  CONFIRMATION_DEPTH,
  USDC_RELEASE_WAIT_HOURS,
  TRADE_CLAIM_EXPIRY_HOURS,
  RESUBMISSION_WINDOW_HOURS
} from '../../config';

const TradeDetails = ({ tradeId, onClose }) => {
  const { t } = useTranslation(['filler', 'common']);
  const { theme } = useTheme();
  const { actor, sendCommand, onCommand, offCommand, genericUseSeed } = useSDK();
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSubmitTx, setShowSubmitTx] = useState(false);
  const [txHex, setTxHex] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [paymentRef, setPaymentRef] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [fillerIncentive, setFillerIncentive] = useState(2.0); // Default 2%
  const [claimRef, setClaimRef] = useState(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [showManualClaim, setShowManualClaim] = useState(false);
  const [manualTxHex, setManualTxHex] = useState('');
  const [manualBumpHex, setManualBumpHex] = useState('');
  const [submittedTxid, setSubmittedTxid] = useState(null);
  const [orderDepositAccount, setOrderDepositAccount] = useState(null);
  
  useEffect(() => {
    fetchTradeDetails();
    fetchFillerIncentive();
  }, [tradeId]);
  
  const fetchFillerIncentive = async () => {
    try {
      const percent = await actor.get_filler_incentive_percent();
      setFillerIncentive(Number(percent));
    } catch (error) {
      console.error('Error fetching filler incentive:', error);
      // Keep default 2%
    }
  };
  
  // Update current time every second for countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // Listen for BSV payment responses
  useEffect(() => {
    const handlePaymentResponse = (data) => {
      if (data.type === 'pay-response' && data.payload?.ref === paymentRef) {
        const payload = data.payload;
        setSubmitting(false);
        
        if (payload.success && payload.rawTxHex) {
          // Broadcast and submit the transaction
          broadcastAndSubmitTx(payload.rawTxHex);
        } else {
          const errorMessage = payload.message || t('errors.paymentFailed');
          toast.error(errorMessage);
          setPaymentRef(null);
        }
      }
    };
    
    if (paymentRef) {
      onCommand(handlePaymentResponse);
      return () => offCommand(handlePaymentResponse);
    }
  }, [paymentRef, onCommand, offCommand]);

  // Listen for full transaction responses (for claim flow)
  useEffect(() => {
    const handleFullTxResponse = (data) => {
      console.log('Full transaction response received:', data);
      
      // Extract payload - could be in data directly or in data.payload
      const payload = data.payload || data;
      const ref = payload.ref || data.ref;
      
      console.log('Extracted ref:', ref, 'Expected:', claimRef);
      
      if (ref === claimRef) {
        console.log('Ref matches! Processing response...');
        console.log('Payload:', payload);
        
        // Check if we have tx_hex and bump_hex
        if (payload.success && payload.tx_hex && payload.bump_hex) {
          console.log('✅ Got tx_hex and bump_hex, submitting claim');
          // Got transaction and BUMP proof, proceed with claim
          submitClaim(payload.tx_hex, payload.bump_hex);
        } else {
          console.log('❌ Missing tx_hex or bump_hex');
          console.log('tx_hex:', payload.tx_hex);
          console.log('bump_hex:', payload.bump_hex);
          
          setClaiming(false);
          
          // If transaction not found or no BUMP available
          if (payload.tx_hex === null || payload.bump_hex === null) {
            toast.error(t('errors.txOrBumpNotFound'));
          } else {
            const errorMessage = payload.error || data.error || t('errors.failedToRetrieveTxDetails');
            toast.error(errorMessage);
          }
          
          setClaimRef(null);
        }
      }
    };
    
    if (claimRef) {
      onCommand(handleFullTxResponse);
      return () => offCommand(handleFullTxResponse);
    }
  }, [claimRef, onCommand, offCommand]);
  
  const fetchTradeDetails = async () => {
    try {
      const result = await actor.get_trade(tradeId);
      if (result.length > 0) {
        const tradeData = result[0];
        setTrade(tradeData);
        
        // Log trade details for debugging
        console.log('=== TRADE DETAILS ===');
        console.log('Trade ID:', tradeId);
        console.log('Trade Status:', Object.keys(tradeData.status)[0]);
        console.log('BSV TX Hex:', tradeData.bsv_tx_hex);
        console.log('BSV TX Hex Type:', typeof tradeData.bsv_tx_hex);
        console.log('BSV TX Hex Length:', tradeData.bsv_tx_hex ? String(tradeData.bsv_tx_hex).length : 0);
        
        // Calculate and log txid
        if (tradeData.bsv_tx_hex) {
          const calculatedTxid = await computeTxid(tradeData.bsv_tx_hex);
          console.log('Calculated TXID:', calculatedTxid);
          setSubmittedTxid(calculatedTxid);
        }
        
        // Fetch order details to get deposit account
        if (tradeData.order_id) {
          try {
            const orderResult = await actor.get_order(tradeData.order_id);
            if (orderResult.length > 0) {
              const orderData = orderResult[0];
              const depositAccount = `${orderData.deposit_principal}.${orderData.deposit_subaccount}`;
              setOrderDepositAccount(depositAccount);
              console.log('Order Deposit Account:', depositAccount);
            }
          } catch (err) {
            console.error('Error fetching order details:', err);
          }
        }
        
        console.log('===================');
      }
    } catch (error) {
      console.error('Error fetching trade:', error);
      toast.error(t('errors.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };
  
  const handleCopy = (text) => {
    sendCommand({
      type: "write-clipboard",
      text: text
    });
    toast.success(t('common:copied'));
  };
  
  const broadcastAndSubmitTx = async (rawTxHex) => {
    try {
      console.log('=== BROADCAST AND SUBMIT ===');
      console.log('Raw TX Hex length:', rawTxHex.length);
      
      if (!genericUseSeed) {
        throw new Error('Not authenticated. Please login to broadcast transactions.');
      }
      
      // Step 1: Broadcast the transaction to BSV network
      setBroadcasting(true);
      toast.loading('Broadcasting transaction to BSV network...', { id: 'broadcast' });
      
      const broadcastResult = await broadcastTransaction(rawTxHex, genericUseSeed);
      
      if (!broadcastResult.success) {
        toast.error('Failed to broadcast transaction', { id: 'broadcast' });
        throw new Error(broadcastResult.error || 'Broadcast failed');
      }
      
      console.log('✅ Transaction broadcast successful. TXID:', broadcastResult.txid);
      toast.success(`Transaction broadcast! TXID: ${broadcastResult.txid.substring(0, 8)}...`, { id: 'broadcast' });
      
      setBroadcasting(false);
      
      // Step 2: Submit to canister
      const result = await actor.submit_bsv_transaction(tradeId, rawTxHex);
      if ('Ok' in result) {
        toast.success(t('messages.txSubmitted'));
        setShowSubmitTx(false);
        setTxHex('');
        setPaymentRef(null);
        fetchTradeDetails();
      } else {
        toast.error(result.Err || t('errors.txFailed'));
      }
      
      console.log('===========================');
    } catch (error) {
      console.error('Error broadcasting/submitting transaction:', error);
      setBroadcasting(false);
      toast.error(error.message || t('errors.txFailed'), { id: 'broadcast' });
    }
  };
  
  const handleSendBsvPayment = () => {
    if (!trade || !trade.locked_chunks || trade.locked_chunks.length === 0) {
      toast.error(t('errors.noPaymentAddresses'));
      return;
    }
    
    // Build recipients array from locked chunks
    const recipients = trade.locked_chunks.map(chunk => ({
      address: chunk.bsv_address,
      value: Number(chunk.sats_amount)
    }));
    
    // Generate unique reference
    const ref = `trade_${tradeId}_${Date.now()}`;
    setPaymentRef(ref);
    setSubmitting(true);
    
    // Send BSV payment command
    sendCommand({
      type: 'pay',
      ref,
      recipients
    });
  };
  
  const handleSubmitTx = async () => {
    if (!txHex) {
      toast.error(t('errors.txRequired'));
      return;
    }
    
    setSubmitting(true);
    try {
      console.log('=== MANUAL TX SUBMISSION ===');
      console.log('Raw TX Hex length:', txHex.length);
      console.log('Skipping broadcast - user already sent transaction');
      
      // Submit directly to canister without broadcasting
      const result = await actor.submit_bsv_transaction(tradeId, txHex);
      if ('Ok' in result) {
        toast.success(t('messages.txSubmitted'));
        setShowSubmitTx(false);
        setTxHex('');
        fetchTradeDetails();
      } else {
        toast.error(result.Err || t('errors.txFailed'));
      }
      
      console.log('===========================');
    } catch (error) {
      console.error('Error submitting transaction:', error);
      toast.error(error.message || t('errors.txFailed'));
    }
    setSubmitting(false);
  };
  
  const handleResubmitTx = async () => {
    if (!txHex) {
      toast.error(t('errors.txRequired'));
      return;
    }
    
    setSubmitting(true);
    try {
      console.log('=== RESUBMITTING BSV TRANSACTION ===');
      console.log('Raw TX Hex length:', txHex.length);
      
      const result = await actor.resubmit_bsv_transaction(tradeId, txHex);
      if ('Ok' in result) {
        toast.success(t('messages.txResubmitted'));
        setShowSubmitTx(false);
        setTxHex('');
        fetchTradeDetails();
      } else {
        toast.error(result.Err || t('errors.txFailed'));
      }
      
      console.log('===========================');
    } catch (error) {
      console.error('Error resubmitting transaction:', error);
      toast.error(error.message || t('errors.txFailed'));
    }
    setSubmitting(false);
  };
  
  const handleClaim = async () => {
    // Check if manual hex is provided
    if (manualTxHex && manualBumpHex) {
      console.log('=== MANUAL CLAIM USDC ===');
      console.log('Using manually provided hex values');
      
      // Trim whitespace from inputs
      const trimmedTxHex = manualTxHex.trim();
      const trimmedBumpHex = manualBumpHex.trim();
      
      console.log('Manual TX Hex length:', trimmedTxHex.length);
      console.log('Manual BUMP Hex length:', trimmedBumpHex.length);
      
      // Set claiming state before submitting
      setClaiming(true);
      
      // Submit directly without wallet request
      await submitClaim(trimmedTxHex, trimmedBumpHex);
      return;
    }

    // Original flow: request from wallet
    if (!trade?.bsv_tx_hex) {
      console.error('No transaction hex found in trade');
      toast.error(t('errors.noTransactionFound'));
      return;
    }

    console.log('=== CLAIM USDC INITIATED (WALLET) ===');
    console.log('Trade ID:', tradeId);
    console.log('BSV TX Hex:', trade.bsv_tx_hex);
    console.log('BSV TX Hex Type:', typeof trade.bsv_tx_hex);
    console.log('BSV TX Hex Length:', String(trade.bsv_tx_hex).length);

    // Extract txid from the raw transaction hex
    // For BSV, txid is the double SHA256 hash of the raw transaction, reversed
    // We'll ask the wallet to provide the full transaction details including BUMP
    const txid = await computeTxid(trade.bsv_tx_hex);
    
    console.log('Calculated TXID:', txid);
    
    if (!txid) {
      console.error('Failed to compute TXID');
      toast.error(t('errors.failedToComputeTxid'));
      return;
    }

    setClaiming(true);
    const ref = `claim_${tradeId}_${Date.now()}`;
    setClaimRef(ref);

    console.log('Requesting full transaction from wallet with TXID:', txid);
    console.log('Reference:', ref);

    // Request full transaction details from wallet
    sendCommand({
      type: 'full-transaction',
      txid: txid,
      ref: ref
    });
    
    // Set timeout to reset claiming state if no response after 30 seconds
    setTimeout(() => {
      if (claimRef === ref) {
        console.log('⏱️ Wallet request timeout - resetting claiming state');
        setClaiming(false);
        setClaimRef(null);
        toast.error(t('errors.walletTimeout'));
      }
    }, 30000);
    
    console.log('=================================');
  };

  const computeTxid = async (txHex) => {
    try {
      console.log('computeTxid input:', txHex);
      console.log('computeTxid input type:', typeof txHex);
      
      // Ensure txHex is a string
      const hexString = String(txHex || '');
      console.log('Converted to string:', hexString.substring(0, 100) + '...');
      console.log('String length:', hexString.length);
      
      if (!hexString || hexString.length === 0) {
        throw new Error('Invalid transaction hex');
      }
      
      // Convert hex to bytes
      const hexPairs = hexString.match(/.{1,2}/g);
      console.log('Hex pairs count:', hexPairs ? hexPairs.length : 0);
      
      const txBytes = new Uint8Array(hexPairs.map(byte => parseInt(byte, 16)));
      console.log('Transaction bytes length:', txBytes.length);
      
      // Double SHA256
      const hash1 = await crypto.subtle.digest('SHA-256', txBytes);
      console.log('First SHA256 hash:', Array.from(new Uint8Array(hash1)).map(b => b.toString(16).padStart(2, '0')).join(''));
      
      const hash2 = await crypto.subtle.digest('SHA-256', hash1);
      console.log('Second SHA256 hash:', Array.from(new Uint8Array(hash2)).map(b => b.toString(16).padStart(2, '0')).join(''));
      
      // Reverse bytes and convert to hex
      const hashArray = Array.from(new Uint8Array(hash2));
      const txid = hashArray.reverse().map(b => b.toString(16).padStart(2, '0')).join('');
      console.log('Final TXID (reversed):', txid);
      
      return txid;
    } catch (error) {
      console.error('Error computing txid:', error);
      console.error('Error stack:', error.stack);
      return null;
    }
  };

  const submitClaim = async (txHex, bumpHex) => {
    try {
      const result = await actor.claim_usdc(tradeId, txHex, bumpHex);
      if ('Ok' in result) {
        toast.success(t('messages.claimSuccess'));
        setClaimRef(null);
        fetchTradeDetails();
      } else {
        toast.error(result.Err || t('errors.claimFailed'));
      }
    } catch (error) {
      console.error('Error claiming USDC:', error);
      toast.error(t('errors.claimFailed'));
    } finally {
      setClaiming(false);
      setClaimRef(null);
    }
  };
  
  const formatTime = (timestamp) => {
    return new Date(Number(timestamp) / 1_000_000).toLocaleString();
  };
  
  const getTimeRemaining = (expiresAt) => {
    const now = Date.now() * 1_000_000;
    const remaining = Number(expiresAt) - now;
    if (remaining <= 0) return t('trade.expired');
    
    const minutes = Math.floor(remaining / (60 * 1_000_000_000));
    const seconds = Math.floor((remaining % (60 * 1_000_000_000)) / 1_000_000_000);
    return t('trade.timeFormat', { minutes, seconds });
  };
  
  const isLockExpired = (expiresAt) => {
    const now = Date.now() * 1_000_000;
    return Number(expiresAt) <= now;
  };
  
  const getClaimCountdown = (releaseAt) => {
    const now = currentTime * 1_000_000;
    const releaseTime = Number(releaseAt);
    const remaining = releaseTime - now;
    
    if (remaining <= 0) {
      return { canClaim: true, text: t('trade.readyToClaim') };
    }
    
    const totalSeconds = Math.floor(remaining / 1_000_000_000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return { 
        canClaim: false, 
        text: t('trade.timeFormatWithHours', { hours, minutes, seconds })
      };
    } else if (minutes > 0) {
      return { 
        canClaim: false, 
        text: t('trade.timeFormat', { minutes, seconds })
      };
    } else {
      return { 
        canClaim: false, 
        text: t('trade.timeFormatSeconds', { seconds })
      };
    }
  };
  
  if (loading) {
    return (
      <Modal isOpen={true} onClose={onClose} title={t('trade.detailsTitle')}>
        <div className="flex justify-center py-12">
          <Loader size="lg" />
        </div>
      </Modal>
    );
  }
  
  if (!trade) {
    return (
      <Modal isOpen={true} onClose={onClose} title={t('trade.detailsTitle')}>
        <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('errors.tradeNotFound')}</p>
      </Modal>
    );
  }
  
  const status = Object.keys(trade.status)[0];
  const isLocked = status === 'ChunksLocked';
  const isAwaitingRelease = status === 'TxSubmitted';
  const hasLockExpired = isLocked && trade.lock_expires_at && isLockExpired(trade.lock_expires_at);
  
  // Calculate claim status with countdown
  let claimStatus = { canClaim: false, text: '' };
  if (trade.release_available_at) {
    claimStatus = getClaimCountdown(trade.release_available_at);
  }
  
  // Can claim if status is TxSubmitted or ReadyForRelease AND countdown is complete
  const canClaim = (status === 'TxSubmitted' || status === 'ReadyForRelease') && claimStatus.canClaim;
  
  return (
    <>
      <Modal isOpen={true} onClose={onClose} title={t('trade.detailsTitle')} size="lg">
        <div className="space-y-6">
          <Card>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('trade.info')}</h4>
                <StatusBadge status={status} type="trade" />
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('trade.tradeId')}:</span>
                  <p className={`font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{tradeId.toString()}</p>
                </div>
                <div>
                  <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('common:amount')}:</span>
                  <p className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>${Number(trade.amount_usd).toLocaleString()}</p>
                </div>
                
                {/* Show BSV TXID if transaction has been submitted */}
                {submittedTxid && (
                  <div className="col-span-2">
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>BSV Transaction ID:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <p className={`font-mono text-xs break-all ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>{submittedTxid}</p>
                      <button
                        onClick={() => {
                          sendCommand({
                            type: "write-clipboard",
                            text: submittedTxid
                          });
                          toast.success('TXID copied!');
                        }}
                        className={`flex-shrink-0 p-1 rounded ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                        title="Copy TXID"
                      >
                        <Copy size={14} className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} />
                      </button>
                    </div>
                  </div>
                )}
                
                {/* Show Order Deposit Account for transparency */}
                {orderDepositAccount && (
                  <div className="col-span-2">
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>Order Deposit Account:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <p className={`font-mono text-xs break-all ${theme === 'dark' ? 'text-green-300' : 'text-green-600'}`}>
                        {orderDepositAccount}
                      </p>
                      <button
                        onClick={() => {
                          sendCommand({
                            type: "write-clipboard",
                            text: orderDepositAccount
                          });
                          toast.success('Deposit account copied!');
                        }}
                        className={`flex-shrink-0 p-1 rounded ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                        title="Copy Deposit Account"
                      >
                        <Copy size={14} className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} />
                      </button>
                    </div>
                  </div>
                )}
                
                <div>
                  <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('common:bsvPrice')}:</span>
                  <p className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>${Number(trade.agreed_bsv_price).toFixed(8).replace(/\.?0+$/, '')}</p>
                </div>
                <div>
                  <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('common:chunks')}:</span>
                  <p className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>{trade.locked_chunks?.length || 0}</p>
                </div>
                {trade.lock_expires_at && isLocked && (
                  <div className="col-span-2">
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('trade.lockExpires')}:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock size={16} className={hasLockExpired ? (theme === 'dark' ? "text-red-400" : "text-red-500") : (theme === 'dark' ? "text-yellow-400" : "text-yellow-600")} />
                      <span className={hasLockExpired ? (theme === 'dark' ? "text-red-300 font-semibold" : "text-red-600 font-semibold") : (theme === 'dark' ? "text-yellow-300" : "text-yellow-700")}>
                        {getTimeRemaining(trade.lock_expires_at)}
                      </span>
                    </div>
                    {hasLockExpired && (
                      <p className={`text-xs mt-2 font-semibold ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>
                        {t('trade.expiredWarning')}
                      </p>
                    )}
                  </div>
                )}
                {trade.release_available_at && (isAwaitingRelease || status === 'ReadyForRelease') && (
                  <div className="col-span-2">
                    <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{t('trade.claimStatus')}:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock size={16} className={claimStatus.canClaim ? (theme === 'dark' ? "text-green-400" : "text-green-600") : (theme === 'dark' ? "text-blue-400" : "text-blue-600")} />
                      <span className={claimStatus.canClaim ? (theme === 'dark' ? "text-green-300 font-semibold" : "text-green-700 font-semibold") : (theme === 'dark' ? "text-blue-300" : "text-blue-700")}>
                        {claimStatus.text}
                      </span>
                    </div>
                    {!claimStatus.canClaim && (
                      <p className={`text-xs mt-2 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>
                        {t('trade.availableAt')}: {formatTime(trade.release_available_at)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
          
          {/* Show payment instructions for both locked and submitted states */}
          {((isLocked && !hasLockExpired) || isAwaitingRelease) && trade.locked_chunks && trade.locked_chunks.length > 0 && (
            <Card className={theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'}>
              <h4 className={`text-lg font-semibold mb-2 ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                {isAwaitingRelease ? t('trade.submittedPaymentDetails') : t('trade.paymentInstructions')}
              </h4>
              <div className="space-y-3">
                {trade.locked_chunks.map((chunk, idx) => (
                  <div key={idx} className={theme === 'dark' ? 'bg-black/30 p-4 rounded-lg' : 'bg-white/80 p-4 rounded-lg border border-gray-200'}>
                    <div className="flex justify-between items-start mb-2">
                      <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('trade.output')} {idx + 1}</span>
                      <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{Number(chunk.sats_amount).toLocaleString()} sats</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className={`font-mono text-xs break-all flex-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{chunk.bsv_address}</code>
                      <button onClick={() => handleCopy(chunk.bsv_address)} className={theme === 'dark' ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"}>
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className={`text-xs mb-3 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('trade.resubmitExactInstructions')}
              </p>
              {isLocked && !hasLockExpired && (
                <div className="flex gap-3 mt-4">
                  <Button 
                    variant="primary" 
                    onClick={handleSendBsvPayment} 
                    disabled={submitting}
                    className="flex-1"
                  >
                    {submitting ? t('trade.sending') : t('trade.payWithWallet')}
                  </Button>
                  <Button 
                    variant="secondary" 
                    onClick={() => setShowSubmitTx(true)} 
                    className="flex-1"
                  >
                    {t('trade.manualSubmit')}
                  </Button>
                </div>
              )}
            </Card>
          )}
          
          {hasLockExpired && (
            <Card className={theme === 'dark' ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-red-500/20' : 'bg-red-100'}`}>
                  <Clock className={theme === 'dark' ? "text-red-400" : "text-red-500"} size={24} />
                </div>
                <div className="flex-1">
                  <h4 className={`font-semibold mb-2 ${theme === 'dark' ? 'text-red-300' : 'text-red-600'}`}>{t('trade.tradeExpired')}</h4>
                  <p className={`text-sm mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('trade.expiredPenalty', { 
                      penalty: (Number(trade.amount_usd) * (SECURITY_DEPOSIT_PERCENT / 100)).toFixed(2),
                      percent: SECURITY_DEPOSIT_PERCENT 
                    })}
                  </p>
                  <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t('trade.expiredMessage')}
                  </p>
                </div>
              </div>
            </Card>
          )}
          
          {isAwaitingRelease && !claimStatus.canClaim && (
            <Card className={theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                  <Clock className={theme === 'dark' ? "text-blue-400" : "text-blue-600"} size={24} />
                </div>
                <div className="flex-1">
                  <h4 className={`font-semibold mb-2 ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>{t('trade.paymentSubmitted')}</h4>
                  <p className={`text-sm mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('trade.paymentSubmittedMessage', { bonus: fillerIncentive, confirmDepth: CONFIRMATION_DEPTH })}
                  </p>
                  <div className={`rounded-lg p-3 border ${theme === 'dark' ? 'bg-black/40 border-blue-500/30' : 'bg-white/80 border-blue-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('trade.timeUntilClaim')}:</span>
                      <span className={`font-mono font-semibold text-lg ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>{claimStatus.text}</span>
                    </div>
                  </div>
                  <div className={`mt-3 rounded-lg p-3 border ${theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'}`}>
                    <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-green-300' : 'text-green-600'}`}>
                      {t('trade.claimAmount')}: ${(Number(trade.amount_usd) * (1 + fillerIncentive / 100)).toFixed(8).replace(/\.?0+$/, '')} USDC
                      <span className={`ml-2 text-xs font-normal ${theme === 'dark' ? 'text-green-400' : 'text-green-500'}`}>({t('trade.includesBonus', { bonus: fillerIncentive })})</span>
                    </p>
                  </div>

                  {/* Compact resubmit option */}
                  <div className={`mt-3 pt-3 border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-300'}`}>
                    <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      {t('trade.resubmitDesc', { 
                        penalty: RESUBMISSION_PENALTY_PERCENT,
                        resubmitWindow: RESUBMISSION_WINDOW_HOURS,
                        releaseWait: USDC_RELEASE_WAIT_HOURS,
                        claimExpiry: TRADE_CLAIM_EXPIRY_HOURS
                      })}
                    </p>
                    <button
                      onClick={() => setShowSubmitTx(true)}
                      className={`text-xs ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} underline`}
                    >
                      {t('trade.resubmitTx')}
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          )}
          
          {canClaim && (
            <>
              {/* Manual Claim Inputs - Expandable */}
              <Card className={theme === 'dark' ? 'bg-gray-800/50' : 'bg-gray-100'}>
                <button
                  onClick={() => setShowManualClaim(!showManualClaim)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div>
                    <h4 className={`text-sm font-semibold ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t('trade.manualClaim')}</h4>
                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'}`}>
                      {t('trade.manualClaimDesc')}
                    </p>
                  </div>
                  <span className={`text-xl ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    {showManualClaim ? '−' : '+'}
                  </span>
                </button>
                
                {showManualClaim && (
                  <div className={`mt-4 space-y-3 pt-3 border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-300'}`}>
                    <Input
                      label={t('trade.txHexLabel')}
                      value={manualTxHex}
                      onChange={(e) => setManualTxHex(e.target.value)}
                      placeholder="0100000001..."
                      helperText={t('trade.txHexHelper')}
                      multiline
                      rows={3}
                    />
                    <Input
                      label={t('trade.bumpHexLabel')}
                      value={manualBumpHex}
                      onChange={(e) => setManualBumpHex(e.target.value)}
                      placeholder="fe..."
                      helperText={t('trade.bumpHexHelper')}
                      multiline
                      rows={3}
                    />
                    {manualTxHex && manualBumpHex && (
                      <div className={`rounded-lg p-2 border ${theme === 'dark' ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'}`}>
                        <p className={`text-xs ${theme === 'dark' ? 'text-green-300' : 'text-green-600'}`}>
                          {t('trade.manualHexReady')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
              
              <Button 
                variant="success" 
                size="lg" 
                onClick={handleClaim} 
                loading={claiming} 
                className="w-full"
                disabled={claiming || (showManualClaim && (!manualTxHex.trim() || !manualBumpHex.trim()))}
              >
                {claiming ? t('trade.claiming') : t('trade.claimButton')}
              </Button>
            </>
          )}
          
          <Button variant="secondary" onClick={onClose} className="w-full">
            {t('common:close')}
          </Button>
        </div>
      </Modal>
      
      {showSubmitTx && (
        <Modal isOpen={true} onClose={() => setShowSubmitTx(false)} title={isAwaitingRelease ? t('trade.resubmitTxTitle') : t('trade.submitTxTitle')}>
          <div className="space-y-4">
            <div className={`rounded-lg p-3 border ${theme === 'dark' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'}`}>
              <p className={`text-sm font-semibold mb-2 ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>
                📡 {isAwaitingRelease ? t('trade.resubmitTxTitle') : t('trade.manualTxSubmission')}
              </p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                {isAwaitingRelease ? t('trade.resubmitDescription', {
                  penalty: RESUBMISSION_PENALTY_PERCENT,
                  resubmitWindow: RESUBMISSION_WINDOW_HOURS,
                  releaseWait: USDC_RELEASE_WAIT_HOURS,
                  claimExpiry: TRADE_CLAIM_EXPIRY_HOURS
                }) : t('trade.manualTxDescription')}
              </p>
            </div>
            
            <Input
              label={t('trade.txHex')}
              value={txHex}
              onChange={(e) => setTxHex(e.target.value)}
              placeholder="0100000001..."
              helperText={t('trade.rawTxHelper')}
              multiline
              rows={4}
            />
            
            {broadcasting && (
              <div className={`rounded-lg p-3 border ${theme === 'dark' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-yellow-50 border-yellow-200'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>
                  {t('trade.broadcasting')}
                </p>
              </div>
            )}
            
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setShowSubmitTx(false)} className="flex-1" disabled={submitting || broadcasting}>
                {t('common:cancel')}
              </Button>
              <Button 
                variant="primary" 
                onClick={isAwaitingRelease ? handleResubmitTx : handleSubmitTx} 
                loading={submitting || broadcasting} 
                disabled={!txHex} 
                className="flex-1"
              >
                {broadcasting ? t('trade.broadcasting') : (isAwaitingRelease ? t('trade.resubmitButton') : t('trade.broadcastAndSubmit'))}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default TradeDetails;
