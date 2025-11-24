import React from 'react';
import { AlertTriangle, Shield, Code, DollarSign, Clock, Percent, Database, Lock, XCircle, Users, ExternalLink } from 'lucide-react';
import { Card } from '../components/common';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { 
  MIN_CHUNK_SIZE_USD, 
  MAX_CHUNKS_ALLOWED,
  MAKER_FEE_PERCENT,
  ACTIVATION_FEE_PERCENT,
  FILLER_INCENTIVE_PERCENT,
  SECURITY_DEPOSIT_PERCENT,
  BSV_PRICE_BUFFER_PERCENT,
  TRADE_TIMEOUT_MINUTES,
  USDC_RELEASE_WAIT_HOURS,
  TRADE_CLAIM_EXPIRY_HOURS,
  CONFIRMATION_DEPTH,
  RESUBMISSION_PENALTY_PERCENT,
  RESUBMISSION_WINDOW_HOURS,
  GIT_OPEN_SOURCE_URL
} from '../config';
import { useSDK } from '../contexts/SDKProvider';

const DisclaimerPage = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('disclaimer');
  const { sendCommand } = useSDK();

  // Unified styling classes
  const cardBase = "mb-4 sm:mb-6";
  const sectionTitle = `text-lg sm:text-xl font-bold mb-3 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`;
  const bodyText = `text-sm leading-relaxed ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`;
  const strongText = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const listItem = "flex items-start gap-2 text-xs sm:text-sm";
  const subCard = "rounded-lg p-3 sm:p-4 border";

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      {/* Terms Acceptance Notice */}
      <Card className={`${cardBase} border-2 ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/50'
          : 'bg-gradient-to-br from-blue-50 to-purple-50 border-blue-400'
      }`}>
        <div className="flex items-start gap-3">
          <Shield className={`flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} size={24} />
          <p className={`text-sm sm:text-base font-bold leading-relaxed ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
            {t('termsAcceptanceNotice')}
          </p>
        </div>
      </Card>

      {/* Header */}
      <div className="mb-6 sm:mb-8 flex items-center gap-3 sm:gap-4">
        <div className={`p-3 sm:p-4 rounded-xl ${theme === 'dark' ? 'bg-amber-500/20' : 'bg-amber-100'}`}>
          <AlertTriangle className={theme === 'dark' ? 'text-amber-400' : 'text-amber-600'} size={28} />
        </div>
        <div>
          <h1 className={`text-2xl sm:text-3xl lg:text-4xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Terms of Use</h1>
          <p className={`text-sm sm:text-base ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Autonomous BSV-USDC Exchange Protocol</p>
        </div>
      </div>

      {/* Language Disclaimer */}
      <Card className={`${cardBase} border ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border-indigo-500/40'
          : 'bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-300'
      }`}>
        <div className="flex items-start gap-3">
          <svg className={`flex-shrink-0 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
            <path d="M2 12h20"></path>
          </svg>
          <div>
            <h2 className={`${sectionTitle} ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-700'}`}>🌐 Language & Translation Notice</h2>
            <p className={`${bodyText} mb-2`}>
              <strong className={strongText}>English is the official language</strong> of this platform and all legal terms. 
              Translations into other languages are provided <strong className={strongText}>as a courtesy</strong> to help users 
              understand the functionality and features of the application.
            </p>
            <p className={`text-sm leading-relaxed font-semibold ${theme === 'dark' ? 'text-indigo-200' : 'text-indigo-800'}`}>
              ⚠️ In case of any discrepancies, ambiguities, or questions about functionality, the <strong>English version</strong> shall prevail 
              and serve as the authoritative reference.
            </p>
          </div>
        </div>
      </Card>

      {/* Critical Agreement */}
      <Card className={`${cardBase} border ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-red-500/10 to-amber-500/10 border-amber-500/40'
          : 'bg-gradient-to-br from-red-50 to-amber-50 border-amber-300'
      }`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className={`flex-shrink-0 ${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'}`} size={24} />
          <div>
            <h2 className={`${sectionTitle} ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>Agreement to Terms</h2>
            <p className={`${bodyText} mb-3`}>
              By accessing or using this platform, you acknowledge that you have read, understood, and agree to be bound by these terms. 
              This is <strong className={strongText}>proprietary open-source software</strong> licensed for use as an autonomous exchange tool. 
              P2P parties agree to use this software and pay a small royalty fee for each transaction. All actions are final and irreversible.
            </p>
            <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
              If you do not agree, you must exit immediately and not use this platform.
            </p>
          </div>
        </div>
      </Card>

      {/* Proprietary Software License */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Lock className={`flex-shrink-0 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} size={24} />
          <h2 className={sectionTitle}>Proprietary Open-Source License</h2>
        </div>
        <div className="space-y-3">
          <p className={bodyText}>
            This software is <strong className={strongText}>NOT free software</strong>. It is open-source proprietary software provided under a commercial use license. The source code is publicly available for inspection and audit, but usage requires accepting these terms and paying royalty fees.
          </p>
          
          <div className={`${subCard} ${
            theme === 'dark' 
              ? 'bg-purple-500/10 border-purple-500/30' 
              : 'bg-purple-50 border-purple-200'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>Software Royalty Model:</p>
            <ul className={`space-y-1.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>•</span>
                <span>By creating orders or filling trades, you agree to pay software usage royalties (activation fees and filler incentives)</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>•</span>
                <span>These fees compensate developers for software creation and maintenance</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>•</span>
                <span>The software facilitates P2P trades—you are not purchasing services from developers</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>•</span>
                <span>Royalty rates are hardcoded and cannot be changed or waived</span>
              </li>
            </ul>
          </div>

          <div className={`${subCard} ${
            theme === 'dark' 
              ? 'bg-red-500/10 border-red-500/30' 
              : 'bg-red-50 border-red-200'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>⚠️ "AS IS" Software - No Warranty or Liability:</p>
            <div className="space-y-2">
              <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                This software is provided <strong className={strongText}>"AS IS"</strong> without warranty of any kind, 
                express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.
              </p>
              <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <strong className={theme === 'dark' ? 'text-red-200' : 'text-red-800'}>No Claims for Damages:</strong> In no event shall the developers, 
                authors, or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, 
                arising from, out of, or in connection with the software or the use or other dealings in the software.
              </p>
              <div className="mt-2 space-y-2">
                <div className="flex items-start gap-2">
                  <Code size={14} className={`flex-shrink-0 ${theme === 'dark' ? 'text-blue-400 mt-0.5' : 'text-blue-600 mt-0.5'}`} />
                  <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    <strong className={strongText}>Review Before Use:</strong> The complete source code is available 
                    for inspection. Users are strongly encouraged to review the code, understand the logic, and assess risks before depositing any funds or executing trades.
                  </p>
                </div>
                <button
                  onClick={() => sendCommand({
                    type: 'open-link',
                    url: GIT_OPEN_SOURCE_URL
                  })}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-colors ${
                    theme === 'dark'
                      ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40'
                      : 'bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300'
                  }`}
                >
                  <ExternalLink size={14} />
                  <span className="hidden sm:inline">View Source Code on GitHub</span>
                  <span className="sm:hidden">View on GitHub</span>
                </button>
              </div>
              <p className={`mt-2 font-semibold text-xs sm:text-sm ${theme === 'dark' ? 'text-red-200' : 'text-red-800'}`}>
                By using this software, you acknowledge that you have reviewed (or had the opportunity to review) the source code and accept all risks associated with its use.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Autonomous System */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Code className={`flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} size={24} />
          <h2 className={sectionTitle}>Fully Autonomous Protocol</h2>
        </div>
        <div className="space-y-3">
          <p className={bodyText}>
            This platform operates as <strong className={strongText}>smart contract code</strong> deployed on the Internet Computer Protocol (ICP) blockchain. 
            The system functions through pre-programmed algorithms without any intermediary, custodian, or economic operator. The canister has an admin principal for bug fixes only.
          </p>
          
          <div className={`${subCard} ${
            theme === 'dark' 
              ? 'bg-blue-500/10 border-blue-500/30' 
              : 'bg-blue-50 border-blue-200'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>Protocol Characteristics:</p>
            <ul className={`space-y-1.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong className={strongText}>Autonomous Operation:</strong> All trades execute via deterministic smart contract logic</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong className={strongText}>Non-Custodial:</strong> Direct peer-to-peer atomic swaps with no intermediary custody</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong className={strongText}>Hardcoded Rules:</strong> Exchange fees, timeouts, and trading logic are hardcoded and not modifiable by admin</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong className={strongText}>Public Auditability:</strong> Smart contract code is deployed on ICP public blockchain</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong className={strongText}>No Economic Operator:</strong> No entity controls funds, sets prices, or modifies execution</span>
              </li>
            </ul>
          </div>

          <div className={`${subCard} ${
            theme === 'dark' 
              ? 'bg-amber-500/10 border-amber-500/30' 
              : 'bg-amber-50 border-amber-200'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>⚠️ Developer Authority & Limitations</p>
            <p className={`text-xs sm:text-sm mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              The canister has an admin principal. The developer has <strong className={strongText}>ZERO AUTHORITY</strong> to:
            </p>
            <ul className={`space-y-1 ml-3 sm:ml-4 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li>• Change fees, timeouts, or any trading rules (hardcoded in smart contract logic)</li>
              <li>• Access, freeze, or move user funds</li>
              <li>• Intervene in trade execution or modify orders</li>
              <li>• Reverse transactions or provide refunds</li>
              <li>• Reactivate the system for new orders after emergency stop</li>
            </ul>
            <p className={`text-xs sm:text-sm mt-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Developer can <strong className={strongText}>ONLY</strong>:
            </p>
            <ul className={`space-y-1 ml-3 sm:ml-4 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li>• Upgrade canister to fix critical bugs or vulnerabilities (code only, not fees/rules)</li>
              <li>• Execute emergency stop to prevent new orders during technical crisis</li>
            </ul>
            <p className={`text-xs mt-2 font-semibold ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
              ⚠️ Emergency Stop: If activated, system stops accepting new orders permanently. Existing orders must be filled by traders or cancelled/refunded by makers. This is NOT an immutable/black-hole canister—admin can deploy fixes but cannot modify trading logic, fees, or timeouts.
            </p>
          </div>
        </div>
      </Card>

      {/* Platform Overview */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <DollarSign className={`flex-shrink-0 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`} size={24} />
          <h2 className={sectionTitle}>How It Works</h2>
        </div>
        <div className="space-y-3">
          <p className={bodyText}>
            This protocol facilitates atomic swaps between <strong className={strongText}>Bitcoin SV (BSV)</strong> and 
            <strong className={strongText}> Chain-Key USDC (ckUSDC)</strong> through an orderbook matching system with two roles:
          </p>
          
          <div className="grid sm:grid-cols-2 gap-3">
            <div className={`${subCard} ${
              theme === 'dark'
                ? 'bg-cyan-500/10 border-cyan-500/30'
                : 'bg-cyan-50 border-cyan-200'
            }`}>
              <p className={`font-semibold mb-2 flex items-center gap-2 text-sm ${theme === 'dark' ? 'text-cyan-300' : 'text-cyan-700'}`}>
                <span className="text-lg">💰</span> MAKERS (Order Creators)
              </p>
              <ul className={`space-y-1.5 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <li>• Deposit ckUSDC to create sell orders for BSV</li>
                <li>• <strong className={theme === 'dark' ? 'text-cyan-200' : 'text-cyan-700'}>Your ckUSDC is held in a unique order deposit address</strong> derived from your Principal ID + Order ID (auditable and recoverable)</li>
                <li>• Orders chunked at ${MIN_CHUNK_SIZE_USD} minimum per chunk</li>
                <li>• Receive BSV <strong className={theme === 'dark' ? 'text-cyan-200' : 'text-cyan-700'}>directly from fillers on-chain</strong></li>
                <li>• Pay {MAKER_FEE_PERCENT}% total fee ({ACTIVATION_FEE_PERCENT}% activation + {FILLER_INCENTIVE_PERCENT}% filler incentive)</li>
                <li>• No waiting period—BSV is yours immediately</li>
              </ul>
            </div>

            <div className={`${subCard} ${
              theme === 'dark'
                ? 'bg-purple-500/10 border-purple-500/30'
                : 'bg-purple-50 border-purple-200'
            }`}>
              <p className={`font-semibold mb-2 flex items-center gap-2 text-sm ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>
                <span className="text-lg">⚡</span> FILLERS (Order Fulfillers)
              </p>
              <ul className={`space-y-1.5 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <li>• Deposit {SECURITY_DEPOSIT_PERCENT}% ckUSDC security (enables trades up to {100/SECURITY_DEPOSIT_PERCENT}x deposit value)</li>
                <li>• Fill orders by sending BSV directly to maker addresses on-chain</li>
                <li>• <strong className={theme === 'dark' ? 'text-purple-200' : 'text-purple-700'}>ckUSDC is held safe in the order's deposit address</strong> (bound to maker Principal + Order ID) until you claim it with valid proof</li>
                <li>• Submit BSV tx hex within {TRADE_TIMEOUT_MINUTES} minutes or lose {SECURITY_DEPOSIT_PERCENT}% security deposit</li>
                <li>• Earn {FILLER_INCENTIVE_PERCENT}% incentive fee per filled order</li>
                <li>• Wait {CONFIRMATION_DEPTH} BSV block confirmations (~{Math.floor(CONFIRMATION_DEPTH / 6)} hours) before claiming ckUSDC</li>
                <li>• Must claim within {TRADE_CLAIM_EXPIRY_HOURS} hours of initial submission or forfeit ckUSDC to treasury</li>
                <li>• Must provide BUMP proof at claim time for SPV verification (otherwise claim rejected)</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>

      {/* Fund Safety & Auditability */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Database className={`flex-shrink-0 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`} size={24} />
          <h2 className={sectionTitle}>Fund Safety & Auditability</h2>
        </div>
        <div className="space-y-3">
          
          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-green-50 border-green-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>🔐 Order Deposit Addresses: How Your Funds Are Managed</p>
            <div className="space-y-2">
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                Each order has a <strong className={strongText}>unique deposit address</strong> that is deterministically derived from:
              </p>
              <ul className={`ml-3 sm:ml-4 space-y-1 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <li className="flex items-start gap-2">
                  <span className={theme === 'dark' ? 'text-green-400' : 'text-green-600'}>•</span>
                  <span><strong>Maker's Principal ID</strong> (your Internet Computer identity)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className={theme === 'dark' ? 'text-green-400' : 'text-green-600'}>•</span>
                  <span><strong>Order ID</strong> (sequential order number)</span>
                </li>
              </ul>
              
              <p className={`mt-2 font-semibold text-xs ${theme === 'dark' ? 'text-green-200' : 'text-green-800'}`}>
                This design ensures:
              </p>
              <ul className={`ml-3 sm:ml-4 space-y-1 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <li className="flex items-start gap-2">
                  <span className={theme === 'dark' ? 'text-green-400' : 'text-green-600'}>✓</span>
                  <span><strong>Auditability:</strong> Every deposit address is traceable to its owner and order</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className={theme === 'dark' ? 'text-green-400' : 'text-green-600'}>✓</span>
                  <span><strong>Recoverability:</strong> In case of system disaster, funds can be recovered by scanning Principal IDs with incremental Order IDs</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className={theme === 'dark' ? 'text-green-400' : 'text-green-600'}>✓</span>
                  <span><strong>Automated Distribution:</strong> Smart contract logic automatically distributes funds (refunds to makers, payouts to fillers, penalties to treasury)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className={theme === 'dark' ? 'text-green-400' : 'text-green-600'}>✓</span>
                  <span><strong>Transparency:</strong> All deposit addresses follow the same derivation formula—no hidden accounts</span>
                </li>
              </ul>
            </div>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-blue-50 border-blue-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>💰 What Happens to Your ckUSDC</p>
            <div className={`space-y-1.5 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <p className="flex items-start gap-2">
                <span className={`font-bold flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>1.</span>
                <span><strong>Maker deposits ckUSDC:</strong> Funds are transferred to the order's unique deposit address and held securely until filled or cancelled</span>
              </p>
              <p className="flex items-start gap-2">
                <span className={`font-bold flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>2.</span>
                <span><strong>Filler submits BSV payment proof:</strong> After {CONFIRMATION_DEPTH} block confirmations + valid BUMP proof, filler can claim ckUSDC from deposit address</span>
              </p>
              <p className="flex items-start gap-2">
                <span className={`font-bold flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>3.</span>
                <span><strong>Automated payout:</strong> Smart contract verifies proof, sends order amount to filler, returns security deposit, pays filler incentive</span>
              </p>
              <p className="flex items-start gap-2">
                <span className={`font-bold flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>4.</span>
                <span><strong>Timeout/expiry scenarios:</strong> If filler doesn't submit (timeout) or doesn't claim (expiry), funds are automatically handled per penalty rules</span>
              </p>
            </div>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-purple-500/10 border-purple-500/30'
              : 'bg-purple-50 border-purple-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>⚖️ Who Controls the Deposit Addresses?</p>
            <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              The smart contract code (deployed on Internet Computer) <strong className={strongText}>autonomously manages all deposit addresses</strong>. 
              No human, admin, or developer can manually transfer funds from these addresses. 
              All transfers are executed by hardcoded logic based on:
            </p>
            <ul className={`ml-3 sm:ml-4 space-y-1 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className="flex items-start gap-2">
                <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>•</span>
                <span>Valid BSV payment proofs (BUMP verified)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>•</span>
                <span>Time-based rules (timeouts, claim expiry)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}>•</span>
                <span>Order cancellation requests (by maker before filling)</span>
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Fees and Economics */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Percent className={`flex-shrink-0 ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`} size={24} />
          <h2 className={sectionTitle}>Fees & Economics</h2>
        </div>
        <div className="space-y-3">
          <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>
            All fees are hardcoded in the smart contract and execute automatically. No waivers or exceptions.
          </p>
          
          <div className={`rounded-lg overflow-x-auto border ${
            theme === 'dark'
              ? 'bg-slate-800/50 border-slate-700'
              : 'bg-gray-50 border-gray-300'
          }`}>
            <table className="w-full text-xs">
              <thead className={theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200'}>
                <tr>
                  <th className={`text-left p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Fee Type</th>
                  <th className={`text-left p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Amount</th>
                  <th className={`text-left p-2 sm:p-3 font-semibold hidden sm:table-cell ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Description</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-700/50' : 'divide-gray-300'}`}>
                <tr>
                  <td className={`p-2 sm:p-3 font-medium ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>
                    <div>Activation Fee</div>
                    <div className="sm:hidden text-[10px] font-normal opacity-75">Charged to makers upfront (non-refundable)</div>
                  </td>
                  <td className={`p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{ACTIVATION_FEE_PERCENT}%</td>
                  <td className={`p-2 sm:p-3 hidden sm:table-cell ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Charged to makers upfront, transferred to treasury (non-refundable)</td>
                </tr>
                <tr>
                  <td className={`p-2 sm:p-3 font-medium ${theme === 'dark' ? 'text-cyan-300' : 'text-cyan-700'}`}>
                    <div>Filler Incentive</div>
                    <div className="sm:hidden text-[10px] font-normal opacity-75">Paid to fillers upon completion</div>
                  </td>
                  <td className={`p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{FILLER_INCENTIVE_PERCENT}%</td>
                  <td className={`p-2 sm:p-3 hidden sm:table-cell ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Reserved from maker order, paid to fillers upon completion</td>
                </tr>
                <tr>
                  <td className={`p-2 sm:p-3 font-medium ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>
                    <div>Security Deposit</div>
                    <div className="sm:hidden text-[10px] font-normal opacity-75">Required from fillers, refundable</div>
                  </td>
                  <td className={`p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{SECURITY_DEPOSIT_PERCENT}%</td>
                  <td className={`p-2 sm:p-3 hidden sm:table-cell ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Required from fillers, refundable (subject to penalties)</td>
                </tr>
                <tr>
                  <td className={`p-2 sm:p-3 font-medium ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
                    <div>Timeout Penalty</div>
                    <div className="sm:hidden text-[10px] font-normal opacity-75">Miss {TRADE_TIMEOUT_MINUTES}-min deadline</div>
                  </td>
                  <td className={`p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{SECURITY_DEPOSIT_PERCENT}%</td>
                  <td className={`p-2 sm:p-3 hidden sm:table-cell ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Deducted from filler security if {TRADE_TIMEOUT_MINUTES}-min deadline missed (sent to maker)</td>
                </tr>
                <tr>
                  <td className={`p-2 sm:p-3 font-medium ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                    <div>ckUSDC Transfer</div>
                    <div className="sm:hidden text-[10px] font-normal opacity-75">ICP network fee</div>
                  </td>
                  <td className={`p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>0.01</td>
                  <td className={`p-2 sm:p-3 hidden sm:table-cell ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>ICRC-1 ledger fee per transaction (ICP network, not controlled by platform)</td>
                </tr>
                <tr>
                  <td className={`p-2 sm:p-3 font-medium ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
                    <div>Resubmission</div>
                    <div className="sm:hidden text-[10px] font-normal opacity-75">Edit BSV tx (paid to maker)</div>
                  </td>
                  <td className={`p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{RESUBMISSION_PENALTY_PERCENT}%</td>
                  <td className={`p-2 sm:p-3 hidden sm:table-cell ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Charged if filler edits BSV tx within first 2 hours of initial submission (prevents gaming volatility, paid to maker)</td>
                </tr>
                <tr>
                  <td className={`p-2 sm:p-3 font-medium ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
                    <div>Claim Expiry</div>
                    <div className="sm:hidden text-[10px] font-normal opacity-75">Fail to claim within {TRADE_CLAIM_EXPIRY_HOURS}h</div>
                  </td>
                  <td className={`p-2 sm:p-3 font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{SECURITY_DEPOSIT_PERCENT}%</td>
                  <td className={`p-2 sm:p-3 hidden sm:table-cell ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>If filler fails to claim ckUSDC within {TRADE_CLAIM_EXPIRY_HOURS} hours of initial submission, security deposit sent to treasury and full trade amount forfeited</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* Critical Time Constraints */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Clock className={`flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`} size={24} />
          <h2 className={sectionTitle}>Time Constraints</h2>
        </div>
        <div className="space-y-3">
          <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
            These deadlines are enforced automatically by smart contract. Missing deadlines triggers penalties or forfeits.
          </p>
          
          <div className="space-y-2">
            <div className={`border-l-4 p-3 rounded ${
              theme === 'dark'
                ? 'bg-red-500/10 border-red-500'
                : 'bg-red-50 border-red-500'
            }`}>
              <p className={`font-semibold mb-1 text-xs sm:text-sm ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>⏰ Filler Tx Submission: {TRADE_TIMEOUT_MINUTES} minutes</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Submit BSV transaction hex within {TRADE_TIMEOUT_MINUTES} minutes or face automatic {SECURITY_DEPOSIT_PERCENT}% penalty deducted from security deposit and sent to maker.</p>
            </div>
            
            <div className={`border-l-4 p-3 rounded ${
              theme === 'dark'
                ? 'bg-blue-500/10 border-blue-500'
                : 'bg-blue-50 border-blue-500'
            }`}>
              <p className={`font-semibold mb-1 text-xs sm:text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>⏳ Confirmation Depth: {CONFIRMATION_DEPTH} blocks (~{Math.floor(CONFIRMATION_DEPTH / 6)} hours)</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>After submitting BSV tx hex, filler must wait {CONFIRMATION_DEPTH} BSV block confirmations (~{Math.floor(CONFIRMATION_DEPTH / 6)} hours) before claiming ckUSDC. Protects against double-spend and chain reorganization attacks.</p>
            </div>
            
            <div className={`border-l-4 p-3 rounded ${
              theme === 'dark'
                ? 'bg-cyan-500/10 border-cyan-500'
                : 'bg-cyan-50 border-cyan-500'
            }`}>
              <p className={`font-semibold mb-1 text-xs sm:text-sm ${theme === 'dark' ? 'text-cyan-300' : 'text-cyan-700'}`}>🔒 BSV Confirmations: {CONFIRMATION_DEPTH} blocks (~{Math.floor(CONFIRMATION_DEPTH / 6)} hours)</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}><strong className={theme === 'dark' ? 'text-cyan-300' : 'text-cyan-700'}>Fillers only:</strong> Must wait {CONFIRMATION_DEPTH} BSV block confirmations + provide BUMP proof before claiming ckUSDC. <strong className={theme === 'dark' ? 'text-cyan-300' : 'text-cyan-700'}>Makers receive BSV instantly</strong> with no waiting.</p>
            </div>
            
            <div className={`border-l-4 p-3 rounded ${
              theme === 'dark'
                ? 'bg-amber-500/10 border-amber-500'
                : 'bg-amber-50 border-amber-500'
            }`}>
              <p className={`font-semibold mb-1 text-xs sm:text-sm ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>🔄 Resubmission Window: {RESUBMISSION_WINDOW_HOURS} hours (from initial submission)</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Fillers can edit/resubmit BSV tx within first {RESUBMISSION_WINDOW_HOURS} hours of initial submission. Costs {RESUBMISSION_PENALTY_PERCENT}% penalty (paid to maker) and requires waiting another {CONFIRMATION_DEPTH} block confirmations. <strong className={theme === 'dark' ? 'text-amber-200' : 'text-amber-800'}>Important:</strong> Resubmission does NOT extend the {TRADE_CLAIM_EXPIRY_HOURS}-hour claim deadline, which is fixed from initial submission.</p>
            </div>
            
            <div className={`border-l-4 p-3 rounded ${
              theme === 'dark'
                ? 'bg-purple-500/10 border-purple-500'
                : 'bg-purple-50 border-purple-500'
            }`}>
              <p className={`font-semibold mb-1 text-xs sm:text-sm ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>⚠️ Claim Expiry: {TRADE_CLAIM_EXPIRY_HOURS} hours (from initial submission)</p>
              <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Filler must claim ckUSDC within {TRADE_CLAIM_EXPIRY_HOURS} hours of initial tx submission. After {TRADE_CLAIM_EXPIRY_HOURS}h, if not claimed:</p>
              <ul className={`text-xs ml-3 sm:ml-4 space-y-0.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <li>• Filler's {SECURITY_DEPOSIT_PERCENT}% security deposit is sent to treasury (permanent loss)</li>
                <li>• Full trade amount (100%) is sent to treasury (filler cannot claim)</li>
                <li>• Maker's ckUSDC is NOT refunded (maker received BSV on-chain)</li>
                <li>• System captures funds to prevent locked capital</li>
                <li>• Penalty and reclamation logged for admin transparency</li>
              </ul>
              <p className={`text-xs mt-2 font-semibold ${theme === 'dark' ? 'text-purple-200' : 'text-purple-800'}`}>This penalty applies to ALL unclaimed trades after {TRADE_CLAIM_EXPIRY_HOURS} hours with no exceptions.</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Risks */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Shield className={`flex-shrink-0 ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`} size={24} />
          <h2 className={sectionTitle}>Comprehensive Risk Disclosure</h2>
        </div>
        <div className="space-y-3">
          
          {/* Regulatory Framework Notice */}
          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-blue-50 border-blue-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>📋 Software Tool, Not Financial Service</p>
            <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              This is <strong className={strongText}>autonomous software infrastructure</strong> for peer-to-peer cryptocurrency trading. 
              The developers provide software only—NOT custody, exchange services, or financial intermediation.
            </p>
            <ul className={`space-y-1 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong>Non-Custodial:</strong> Developers never hold or control user funds</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong>Direct P2P Trading:</strong> Users trade directly with each other via atomic swaps</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong>Software Royalties:</strong> Fees are software license payments, not transaction service fees</span>
              </li>
              <li className={listItem}>
                <span className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}>•</span>
                <span><strong>User Responsibility:</strong> You are responsible for regulatory compliance, tax reporting, and KYC/AML in your jurisdiction</span>
              </li>
            </ul>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-red-50 border-red-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>⚠️ INTENDED FOR SMALL TRANSACTIONS ONLY</p>
            <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              This software is designed and intended for <strong className={strongText}>very small orders only</strong>. 
              By creating an order, you acknowledge the substantial risks involved and accept full responsibility without expectation of recompense in the event of disaster, loss, or technical failure.
            </p>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-orange-500/10 border-orange-500/30'
              : 'bg-orange-50 border-orange-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-orange-300' : 'text-orange-700'}`}>Technical Risks:</p>
            <ul className={`space-y-1.5 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>•</span>
                <span><strong>Smart Contract Bugs:</strong> Code may contain undiscovered vulnerabilities leading to fund loss or system failure</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>•</span>
                <span><strong>ICP Network Failures:</strong> Internet Computer outages, consensus failures, or subnet crashes could freeze funds</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>•</span>
                <span><strong>Canister Exhaustion:</strong> Running out of cycles could halt all operations until topped up</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>•</span>
                <span><strong>Storage Overflow:</strong> Memory limits could prevent new orders or cause data corruption</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>•</span>
                <span><strong>HTTP Outcall Failures:</strong> BSV block sync depends on external APIs which may fail or provide incorrect data</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>•</span>
                <span><strong>Upgrade Risks:</strong> Canister upgrades could introduce bugs or incompatibilities</span>
              </li>
            </ul>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-yellow-500/10 border-yellow-500/30'
              : 'bg-yellow-50 border-yellow-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>Bitcoin SV Blockchain Risks:</p>
            <ul className={`space-y-1.5 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>Transaction Inclusion Delays:</strong> BSV tx may take longer than expected to be mined, delaying claims</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>Blockchain Reorgs:</strong> BSV chain reorganizations can invalidate confirmed transactions, causing SPV verification failures</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>SPV Verification Failures:</strong> BUMP proofs may fail validation due to reorgs, missing blocks, or invalid merkle paths</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>Double-Spend Risk:</strong> Malicious fillers could attempt double-spends during confirmation period</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>51% Attacks:</strong> Network majority attack could invalidate transactions or enable double-spends</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>Network Splits:</strong> BSV network forks could create conflicting transaction histories</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>Fee Market Changes:</strong> Rising BSV tx fees could make small transactions uneconomical</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`}>•</span>
                <span><strong>Miner Censorship:</strong> Miners could refuse to include specific transactions</span>
              </li>
            </ul>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-blue-50 border-blue-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>Economic & Market Risks:</p>
            <ul className={`space-y-1.5 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong>Extreme Price Volatility:</strong> BSV price can change dramatically (±20%+) within minutes or hours</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong>Slippage Risk:</strong> Executed price may differ significantly from expected price due to market movements</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong>Liquidity Risk:</strong> Orders may remain unfilled for extended periods if no fillers available</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong>ckUSDC Depeg Risk:</strong> ckUSDC may lose 1:1 peg with USDC due to ICP chain-key or Circle USDC issues</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong>Circle USDC Risks:</strong> USDC issuer could freeze assets, alter terms, or experience insolvency</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong>Market Manipulation:</strong> Low liquidity enables price manipulation by large traders</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong>Oracle Price Failures:</strong> Price feeds could provide stale or incorrect BSV prices</span>
              </li>
            </ul>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-purple-500/10 border-purple-500/30'
              : 'bg-purple-50 border-purple-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>Operational & Legal Risks:</p>
            <ul className={`space-y-1.5 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>•</span>
                <span><strong>Regulatory Changes:</strong> Cryptocurrency regulations could ban or restrict platform usage in your jurisdiction</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>•</span>
                <span><strong>Tax Obligations:</strong> You are responsible for all tax reporting and compliance</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>•</span>
                <span><strong>No Customer Support:</strong> Zero assistance available for technical issues, lost funds, or user errors</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>•</span>
                <span><strong>Key Loss:</strong> Losing Internet Identity or private keys results in permanent fund loss</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>•</span>
                <span><strong>Phishing Attacks:</strong> Malicious websites could impersonate this platform to steal credentials</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>•</span>
                <span><strong>Emergency Stop Risk:</strong> Critical bugs may trigger permanent halt of new order acceptance</span>
              </li>
            </ul>
          </div>

          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-red-50 border-red-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>⚠️ CRITICAL: Total Loss Scenarios</p>
            <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              You may lose <strong className={strongText}>100% of all deposited funds</strong> due to: smart contract exploits, 
              blockchain failures, reorg attacks, canister deletion, extreme volatility, ckUSDC depeg, regulatory seizure, or any combination of the above risks.
            </p>
            <p className={`text-xs mt-2 font-semibold ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
              NO RECOMPENSE, REFUND, OR RECOVERY IS POSSIBLE. USE ONLY AMOUNTS YOU CAN AFFORD TO LOSE COMPLETELY.
            </p>
          </div>
        </div>
      </Card>

      {/* No Guarantees */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <XCircle className={`flex-shrink-0 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`} size={24} />
          <h2 className={sectionTitle}>No Warranties or Guarantees</h2>
        </div>
        <div className="space-y-3">
          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-red-50 border-red-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>🚫 THE SERVICE IS PROVIDED "AS IS":</p>
            <ul className={`space-y-1.5 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>•</span>
                <span>No guarantee orders will be filled or filled at expected prices</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>•</span>
                <span>No guarantee of platform availability or uptime</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>•</span>
                <span>No liability for financial losses or missed opportunities</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>•</span>
                <span>No responsibility for errors, delays, or technical failures</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>•</span>
                <span>No compensation for BSV transactions that become invalid due to reorgs</span>
              </li>
            </ul>
          </div>
          <p className={`${bodyText} pt-1`}>
            <strong className={strongText}>You understand</strong> that this platform is experimental software running on decentralized infrastructure, and{' '}
            <strong className={theme === 'dark' ? 'text-red-300' : 'text-red-700'}>you use it entirely at your own risk</strong>.
          </p>
        </div>
      </Card>

      {/* User Responsibilities */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Users className={`flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} size={24} />
          <h2 className={sectionTitle}>Compliance & User Responsibilities</h2>
        </div>
        <div className="space-y-2">
          <p className={bodyText}><strong className={strongText}>By using this service, you confirm that:</strong></p>
          <ul className={`space-y-1.5 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
              <span>You are of legal age in your jurisdiction to engage in cryptocurrency transactions</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
              <span>You are not a citizen or resident of a jurisdiction where this service is prohibited</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
              <span>You are solely responsible for complying with your local laws and tax obligations</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
              <span>You will not use this service for any illegal or fraudulent purposes</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
              <span>You are solely responsible for the security of your private keys and Internet Identity</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
              <span>You understand how ckUSDC, BSV, and the order matching system work</span>
            </li>
          </ul>
        </div>
      </Card>

      {/* Treasury & Operational Assets */}
      <Card className={cardBase}>
        <div className="flex items-start gap-3 mb-3">
          <Database className={`flex-shrink-0 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} size={24} />
          <h2 className={sectionTitle}>Treasury & Operational Assets</h2>
        </div>
        <div className="space-y-3">
          <div className={`${subCard} ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-blue-50 border-blue-300'
          }`}>
            <p className={`font-semibold mb-2 text-sm ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>💎 Treasury & Operational Assets</p>
            <p className={`text-xs mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              All operational assets held in canister treasury, including <strong className={strongText}>cycles, ckETH gas reserves, activation fees (ckUSDC), resubmission penalties, and unclaimed expired trades</strong>, are the exclusive property of software developers.
            </p>
            <p className={`text-xs font-semibold mb-2 ${strongText}`}>Wind-Down Priority:</p>
            <ul className={`space-y-1.5 text-xs ml-3 sm:ml-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong className={theme === 'dark' ? 'text-blue-200' : 'text-blue-800'}>User funds have absolute priority:</strong> All maker orders must be filled or refunded, and all filler claims settled before any treasury withdrawal</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong className={theme === 'dark' ? 'text-blue-200' : 'text-blue-800'}>No user claim to treasury:</strong> Users have zero ownership or entitlement to operational funds (cycles, gas, fees)</span>
              </li>
              <li className={listItem}>
                <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>•</span>
                <span><strong className={theme === 'dark' ? 'text-blue-200' : 'text-blue-800'}>Operational purpose:</strong> Treasury funds ensure platform functionality and compensate developers for software creation</span>
              </li>
            </ul>
            <p className={`mt-2 text-[10px] sm:text-xs opacity-75 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Community donations of ckETH or cycles are voluntary contributions supporting operations. Donations confer no ownership rights.
            </p>
          </div>
        </div>
      </Card>

      {/* Limitation of Liability */}
      <Card className={`${cardBase} border ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700'
          : 'bg-gradient-to-br from-gray-100 to-gray-200 border-gray-300'
      }`}>
        <div className="space-y-3">
          <h2 className={sectionTitle}>Limitation of Liability</h2>
          <p className={bodyText}>
            To the maximum extent permitted by law, neither the software creators, deployers, nor any affiliated parties shall be liable for:
          </p>
          <ul className={`space-y-1 ml-3 sm:ml-4 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>•</span>
              <span>Direct, indirect, incidental, special, consequential, or exemplary damages</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>•</span>
              <span>Loss of profits, revenue, data, or business opportunities</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>•</span>
              <span>Loss of cryptocurrency, tokens, or digital assets</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>•</span>
              <span>Damages resulting from smart contract bugs, exploits, or vulnerabilities</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>•</span>
              <span>Damages caused by blockchain network failures or congestion</span>
            </li>
            <li className={listItem}>
              <span className={`flex-shrink-0 font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>•</span>
              <span>Any other damages arising from use or inability to use this platform</span>
            </li>
          </ul>
          <p className={`font-semibold mt-3 text-sm ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
            USE AT YOUR OWN RISK. YOU ARE SOLELY RESPONSIBLE FOR ALL CONSEQUENCES OF USING THIS PLATFORM.
          </p>
        </div>
      </Card>

      {/* Final Statement */}
      <Card className={`border ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-slate-900 to-black border-slate-700'
          : 'bg-gradient-to-br from-gray-50 to-gray-100 border-gray-300'
      }`}>
        <div className="text-center space-y-2 sm:space-y-3">
          <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            Last Updated: November 2025
          </p>
          <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            By clicking "I Accept" or using this platform, you confirm that you have read, understood, and agree to these terms.
          </p>
          <p className={`font-semibold text-xs sm:text-sm ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
            This is autonomous software. All actions are final. No customer support, refunds, or dispute resolution.
          </p>
        </div>
      </Card>
    </div>
  );
};

export default DisclaimerPage;
