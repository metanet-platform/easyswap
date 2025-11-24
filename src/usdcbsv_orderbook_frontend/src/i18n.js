import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English (default)
import commonEn from './locales/en/common.json';
import makerEn from './locales/en/maker.json';
import topupEn from './locales/en/topup.json';
import fillerEn from './locales/en/filler.json';
import orderbookEn from './locales/en/orderbook.json';
import walletEn from './locales/en/wallet.json';
import disclaimerEn from './locales/en/disclaimer.json';

// Spanish
import commonEs from './locales/es/common.json';
import makerEs from './locales/es/maker.json';
import topupEs from './locales/es/topup.json';
import fillerEs from './locales/es/filler.json';
import orderbookEs from './locales/es/orderbook.json';
import walletEs from './locales/es/wallet.json';
import disclaimerEs from './locales/es/disclaimer.json';

// French
import commonFr from './locales/fr/common.json';
import makerFr from './locales/fr/maker.json';
import topupFr from './locales/fr/topup.json';
import fillerFr from './locales/fr/filler.json';
import orderbookFr from './locales/fr/orderbook.json';
import walletFr from './locales/fr/wallet.json';
import disclaimerFr from './locales/fr/disclaimer.json';

// German
import commonDe from './locales/de/common.json';
import makerDe from './locales/de/maker.json';
import topupDe from './locales/de/topup.json';
import fillerDe from './locales/de/filler.json';
import orderbookDe from './locales/de/orderbook.json';
import walletDe from './locales/de/wallet.json';
import disclaimerDe from './locales/de/disclaimer.json';

// Italian
import commonIt from './locales/it/common.json';
import makerIt from './locales/it/maker.json';
import topupIt from './locales/it/topup.json';
import fillerIt from './locales/it/filler.json';
import orderbookIt from './locales/it/orderbook.json';
import walletIt from './locales/it/wallet.json';
import disclaimerIt from './locales/it/disclaimer.json';

// Portuguese
import commonPt from './locales/pt/common.json';
import makerPt from './locales/pt/maker.json';
import topupPt from './locales/pt/topup.json';
import fillerPt from './locales/pt/filler.json';
import orderbookPt from './locales/pt/orderbook.json';
import walletPt from './locales/pt/wallet.json';
import disclaimerPt from './locales/pt/disclaimer.json';

// Russian
import commonRu from './locales/ru/common.json';
import makerRu from './locales/ru/maker.json';
import topupRu from './locales/ru/topup.json';
import fillerRu from './locales/ru/filler.json';
import orderbookRu from './locales/ru/orderbook.json';
import walletRu from './locales/ru/wallet.json';
import disclaimerRu from './locales/ru/disclaimer.json';

// Chinese
import commonZh from './locales/zh/common.json';
import makerZh from './locales/zh/maker.json';
import topupZh from './locales/zh/topup.json';
import fillerZh from './locales/zh/filler.json';
import orderbookZh from './locales/zh/orderbook.json';
import walletZh from './locales/zh/wallet.json';
import disclaimerZh from './locales/zh/disclaimer.json';

// Japanese
import commonJa from './locales/ja/common.json';
import makerJa from './locales/ja/maker.json';
import topupJa from './locales/ja/topup.json';
import fillerJa from './locales/ja/filler.json';
import orderbookJa from './locales/ja/orderbook.json';
import walletJa from './locales/ja/wallet.json';
import disclaimerJa from './locales/ja/disclaimer.json';

// Arabic
import commonAr from './locales/ar/common.json';
import makerAr from './locales/ar/maker.json';
import topupAr from './locales/ar/topup.json';
import fillerAr from './locales/ar/filler.json';
import orderbookAr from './locales/ar/orderbook.json';
import walletAr from './locales/ar/wallet.json';
import disclaimerAr from './locales/ar/disclaimer.json'; 

// Greek
import commonEl from './locales/el/common.json';
import makerEl from './locales/el/maker.json';
import topupEl from './locales/el/topup.json';
import fillerEl from './locales/el/filler.json';
import orderbookEl from './locales/el/orderbook.json';
import walletEl from './locales/el/wallet.json';
import disclaimerEl from './locales/el/disclaimer.json';

// Hindi
import commonHi from './locales/hi/common.json';
import makerHi from './locales/hi/maker.json';
import topupHi from './locales/hi/topup.json';
import fillerHi from './locales/hi/filler.json';
import orderbookHi from './locales/hi/orderbook.json';
import walletHi from './locales/hi/wallet.json';
import disclaimerHi from './locales/hi/disclaimer.json';

// Supported languages
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ar', 'el', 'hi'];
const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'easyswap_language';

// Get language from query params, localStorage, or default
const getInitialLanguage = () => {
  // Check query params first
  const urlParams = new URLSearchParams(window.location.search);
  const queryLang = urlParams.get('metanetLang');
  
  if (queryLang && SUPPORTED_LANGUAGES.includes(queryLang)) {
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, queryLang);
    return queryLang;
  }
  
  // Check localStorage
  const storedLang = localStorage.getItem(STORAGE_KEY);
  if (storedLang && SUPPORTED_LANGUAGES.includes(storedLang)) {
    return storedLang;
  }
  
  // Default to English
  return DEFAULT_LANGUAGE;
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        maker: makerEn,
        topup: topupEn,
        filler: fillerEn,
        orderbook: orderbookEn,
        wallet: walletEn,
        disclaimer: disclaimerEn
      },
      es: {
        common: commonEs,
        maker: makerEs,
        topup: topupEs,
        filler: fillerEs,
        orderbook: orderbookEs,
        wallet: walletEs,
        disclaimer: disclaimerEs
      },
      fr: {
        common: commonFr,
        maker: makerFr,
        topup: topupFr,
        filler: fillerFr,
        orderbook: orderbookFr,
        wallet: walletFr,
        disclaimer: disclaimerFr
      },
      de: {
        common: commonDe,
        maker: makerDe,
        topup: topupDe,
        filler: fillerDe,
        orderbook: orderbookDe,
        wallet: walletDe,
        disclaimer: disclaimerDe
      },
      it: {
        common: commonIt,
        maker: makerIt,
        topup: topupIt,
        filler: fillerIt,
        orderbook: orderbookIt,
        wallet: walletIt,
        disclaimer: disclaimerIt
      },
      pt: {
        common: commonPt,
        maker: makerPt,
        topup: topupPt,
        filler: fillerPt,
        orderbook: orderbookPt,
        wallet: walletPt,
        disclaimer: disclaimerPt
      },
      ru: {
        common: commonRu,
        maker: makerRu,
        topup: topupRu,
        filler: fillerRu,
        orderbook: orderbookRu,
        wallet: walletRu,
        disclaimer: disclaimerRu
      },
      zh: {
        common: commonZh,
        maker: makerZh,
        topup: topupZh,
        filler: fillerZh,
        orderbook: orderbookZh,
        wallet: walletZh,
        disclaimer: disclaimerZh
      },
      ja: {
        common: commonJa,
        maker: makerJa,
        topup: topupJa,
        filler: fillerJa,
        orderbook: orderbookJa,
        wallet: walletJa,
        disclaimer: disclaimerJa
      },
      ar: {
        common: commonAr,
        maker: makerAr,
        topup: topupAr,
        filler: fillerAr,
        orderbook: orderbookAr,
        wallet: walletAr,
        disclaimer: disclaimerAr
      },
      el: {
        common: commonEl,
        maker: makerEl,
        topup: topupEl,
        filler: fillerEl,
        orderbook: orderbookEl,
        wallet: walletEl,
        disclaimer: disclaimerEl
      },
      hi: {
        common: commonHi,
        maker: makerHi,
        topup: topupHi,
        filler: fillerHi,
        orderbook: orderbookHi,
        wallet: walletHi,
        disclaimer: disclaimerHi
      }
    },
    lng: getInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: {
      escapeValue: false
    },
    ns: ['common', 'maker', 'topup', 'filler', 'orderbook', 'wallet', 'disclaimer'],
    defaultNS: 'common'
  });

// Listen for language changes and save to localStorage
i18n.on('languageChanged', (lng) => {
  if (SUPPORTED_LANGUAGES.includes(lng)) {
    localStorage.setItem(STORAGE_KEY, lng);
  }
});

export default i18n;
