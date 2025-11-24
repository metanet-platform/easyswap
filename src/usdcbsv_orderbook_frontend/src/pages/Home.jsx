import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, Wallet, DollarSign, Shield, Zap, Clock, CheckCircle, Hash, Database } from 'lucide-react';
import { Button, Card } from '../components/common';
import TreasuryCard from '../components/TreasuryCard';
import { useTheme } from '../contexts/ThemeContext';
import { useSDK } from '../contexts/SDKProvider';
import { SECURITY_DEPOSIT_PERCENT, CONFIRMATION_DEPTH, MAKER_FEE_PERCENT, FILLER_INCENTIVE_PERCENT } from '../config';

const Home = () => {
  const { t } = useTranslation('common');
  const { theme } = useTheme();
  const { actor } = useSDK();
  const [recentBlocks, setRecentBlocks] = useState([]);
  const [blockMetadata, setBlockMetadata] = useState(null);
  const [loadingBlocks, setLoadingBlocks] = useState(false);

  // Fetch recent blocks
  useEffect(() => {
    const fetchBlockInfo = async () => {
      if (!actor) return;
      
      setLoadingBlocks(true);
      try {
        const response = await actor.get_recent_blocks(10n);
        setRecentBlocks(response.blocks);
        setBlockMetadata({
          oldest_height: response.oldest_height,
          newest_height: response.newest_height,
          total_count: response.total_count
        });
      } catch (error) {
        console.error('Error fetching blocks:', error);
      } finally {
        setLoadingBlocks(false);
      }
    };

    fetchBlockInfo();
    const interval = setInterval(fetchBlockInfo, 60000);
    
    return () => clearInterval(interval);
  }, [actor]);
  
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-8 sm:py-12">
        <div className="text-center max-w-3xl mx-auto">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 mb-4 border transition-colors duration-300 ${
            theme === 'dark'
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-blue-50 border-blue-200'
          }`}>
            <div className={`w-2 h-2 rounded-full animate-pulse ${theme === 'dark' ? 'bg-blue-400' : 'bg-blue-600'}`}></div>
            <span className={`text-xs sm:text-sm font-medium ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>{t('homePage.badge')}</span>
          </div>
          
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-3 sm:mb-4">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              {t('appName')}
            </span>
          </h1>
          
          <p className={`text-base sm:text-lg md:text-xl mb-3 sm:mb-4 px-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            {t('tagline')}
          </p>
          
        </div>

        {/* Two Path Cards */}
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto mb-12">
          {/* USDC Holders Path */}
          <Card className={`transition-colors duration-300 ${
            theme === 'dark'
              ? 'bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/30'
              : 'bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200'
          }`}>
            <div className="text-center mb-4">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-3 ${
                theme === 'dark' ? 'bg-blue-500/20' : 'bg-blue-100'
              }`}>
                <DollarSign className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} size={32} />
              </div>
              <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('homePage.haveUSDCTitle')}</h3>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('homePage.haveUSDCSubtitle')}</p>
            </div>
            
            <div className="space-y-3 mb-6">
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>→</span> {t('homePage.makerStep1')}
                </p>
              </div>
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>→</span> {t('homePage.makerStep2')}
                </p>
              </div>
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>→</span> {t('homePage.makerStep3')}
                </p>
              </div>
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>→</span> {t('homePage.makerStep4', { fee: MAKER_FEE_PERCENT })}
                </p>
              </div>
            </div>
            
            <Link to="/top-up" className="block">
              <Button variant="primary" className="w-full group">
                {t('homePage.startSwapping')}
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link to="/wallet" className="block mt-2">
              <Button variant="outline" className="w-full text-sm">
                <Wallet size={16} />
                {t('homePage.viewWalletFund')}
              </Button>
            </Link>
          </Card>

          {/* BSV Holders Path */}
          <Card className={`transition-colors duration-300 ${
            theme === 'dark'
              ? 'bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/30'
              : 'bg-gradient-to-br from-purple-50 to-purple-100/50 border-purple-200'
          }`}>
            <div className="text-center mb-4">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-3 ${
                theme === 'dark' ? 'bg-purple-500/20' : 'bg-purple-100'
              }`}>
                <Shield className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={32} />
              </div>
              <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('homePage.haveBSVTitle')}</h3>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('homePage.haveBSVSubtitle')}</p>
            </div>
            
            <div className="space-y-3 mb-6">
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>→</span> {t('homePage.fillerStep1', { deposit: SECURITY_DEPOSIT_PERCENT })}
                </p>
              </div>
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>→</span> {t('homePage.fillerStep2')}
                </p>
              </div>
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>→</span> {t('homePage.fillerStep3', { blocks: CONFIRMATION_DEPTH })}
                </p>
              </div>
              <div className={`rounded-lg p-3 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`font-semibold ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>→</span> {t('homePage.fillerStep4')}
                </p>
              </div>
            </div>
            
            <Link to="/trader" className="block">
              <Button variant="secondary" className="w-full group">
                {t('homePage.startFilling')}
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link to="/orderbook" className="block mt-2">
              <Button variant="outline" className="w-full text-sm">
                <Zap size={16} />
                {t('homePage.viewOrders')}
              </Button>
            </Link>
          </Card>
        </div>

      {/* How It Works Section */}
        {/* How It Works */}
        <div className="max-w-4xl mx-auto">
          <Card className={`transition-colors duration-300 ${
            theme === 'dark'
              ? 'bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/30'
              : 'bg-gradient-to-br from-green-50 to-green-100/50 border-green-200'
          }`}>
            <h3 className={`text-2xl font-bold text-center mb-6 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('homePage.securityTitle')}</h3>
            
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <div className={`rounded-lg p-4 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <h4 className={`text-lg font-semibold mb-2 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>✅ {t('homePage.fillerDeliversTitle')}</h4>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('homePage.fillerDeliversDesc', { fee: FILLER_INCENTIVE_PERCENT })}
                </p>
              </div>
              
              <div className={`rounded-lg p-4 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/60'}`}>
                <h4 className={`text-lg font-semibold mb-2 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>❌ {t('homePage.fillerFailsTitle')}</h4>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('homePage.fillerFailsDesc', { deposit: SECURITY_DEPOSIT_PERCENT })}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
      
      {/* Stats Section */}
      <div className="container mx-auto px-4 pb-8 sm:pb-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          <Card className="text-center hover:scale-105 transition-transform">
            <Clock className={`mx-auto mb-2 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} size={28} />
            <div className={`text-xl sm:text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('homePage.statsFast')}</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('homePage.statsFastDesc')}</div>
          </Card>
          <Card className="text-center hover:scale-105 transition-transform">
            <Shield className={`mx-auto mb-2 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`} size={28} />
            <div className={`text-xl sm:text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('homePage.statsSecure')}</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('homePage.statsSecureDesc')}</div>
          </Card>
          <Card className="text-center hover:scale-105 transition-transform">
            <CheckCircle className={`mx-auto mb-2 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} size={28} />
            <div className={`text-xl sm:text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('homePage.statsFair')}</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('homePage.statsFairDesc')}</div>
          </Card>
          <Card className="text-center hover:scale-105 transition-transform">
            <Zap className={`mx-auto mb-2 ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}`} size={28} />
            <div className={`text-xl sm:text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('homePage.statsEfficient')}</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{t('homePage.statsEfficientDesc')}</div>
          </Card>
        </div>

        {/* System Information Section */}
        <div className="max-w-5xl mx-auto">
          <h2 className={`text-xl font-bold mb-4 text-center ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {t('systemInfo.title')}
          </h2>

          {/* App Treasury */}
          <TreasuryCard />

          {/* BSV Blocks Section */}
          <Card className={`border-purple-500/30 ${theme === 'dark' ? 'bg-purple-500/5' : 'bg-purple-50'} mt-6`}>
            <div className="flex items-start gap-3 mb-3">
              <div className={`p-2 rounded-lg flex-shrink-0 ${theme === 'dark' ? 'bg-purple-500/20' : 'bg-purple-100'}`}>
                <Hash className={theme === 'dark' ? 'text-purple-400' : 'text-purple-600'} size={20} />
              </div>
              
              <div className="flex-1 min-w-0">
                <h3 className={`text-base font-semibold ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>
                  {t('systemInfo.bsvBlocks.title')}
                </h3>
                <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('systemInfo.bsvBlocks.subtitle')}
                </p>
              </div>
            </div>

            {loadingBlocks ? (
              <div className={`text-center py-8 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-2"></div>
                <p>{t('systemInfo.bsvBlocks.loading')}</p>
              </div>
            ) : recentBlocks.length === 0 ? (
              <div className={`text-center py-8 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                <Database className="mx-auto mb-2" size={32} />
                <p>{t('systemInfo.bsvBlocks.noBlocks')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {recentBlocks.map((block, index) => (
                  <div 
                    key={block.height.toString()} 
                    className={`rounded-lg p-3 border transition-colors ${
                      theme === 'dark'
                        ? 'bg-black/40 border-purple-500/20 hover:border-purple-500/40'
                        : 'bg-white/60 border-purple-200 hover:border-purple-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`}>
                          #{block.height.toString()}
                        </span>
                        {index === 0 && (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            theme === 'dark' 
                              ? 'bg-green-500/20 text-green-400' 
                              : 'bg-green-100 text-green-700'
                          }`}>
                            Latest
                          </span>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                        <Clock size={12} />
                        <span>
                          {new Date(Number(block.timestamp) * 1000).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      <div>
                        <p className={`text-xs mb-0.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Block Hash</p>
                        <code className={`text-xs font-mono break-all block p-1.5 rounded border ${
                          theme === 'dark'
                            ? 'text-white bg-black/40 border-gray-700'
                            : 'text-gray-900 bg-gray-100 border-gray-300'
                        }`}>
                          {block.hash}
                        </code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Block Storage Range Info */}
            {blockMetadata && blockMetadata.total_count > 0 && (
              <div className={`mt-3 pt-3 border-t ${theme === 'dark' ? 'border-purple-500/20' : 'border-purple-200'}`}>
                <div className={`flex items-center gap-2 text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  <Database size={14} />
                  <span>
                    {t('systemInfo.bsvBlocks.storageRange', {
                      oldest: blockMetadata.oldest_height.toString(),
                      newest: blockMetadata.newest_height.toString(),
                      total: blockMetadata.total_count.toString()
                    })}
                  </span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Home;
