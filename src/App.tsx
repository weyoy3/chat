import { useState, useEffect } from 'react';
import { Home, ScanLine, QrCode, History as HistoryIcon, Settings, QrCode as Logo } from 'lucide-react';
import { AppProvider, useApp } from './store';
import { ToastHost } from './components/ui';
import { HomeScreen } from './screens/HomeScreen';
import { ScannerScreen } from './screens/ScannerScreen';
import { GeneratorScreen } from './screens/GeneratorScreen';
import { ProductScreen, ProductDetailsScreen } from './screens/ProductScreen';
import { HistoryScreen, FavoritesScreen, StatsScreen } from './screens/HistoryScreens';
import { SettingsScreen } from './screens/SettingsScreen';
import { detectQRType } from './lib/qr';
import type { ProductData } from './types';

export type Screen = 'home' | 'scanner' | 'generator' | 'product' | 'history' | 'favorites' | 'stats' | 'settings' | 'product-details';

interface NavState {
  screen: Screen;
  productData?: ProductData;
  rawValue?: string;
}

function AppContent() {
  const { t, dir, settings, setSettings } = useApp();
  const [nav, setNav] = useState<NavState>({ screen: 'home' });

  const navigate = (screen: string) => {
    setNav({ screen: screen as Screen });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openProductDetails = (productData: ProductData, rawValue: string) => {
    setNav({ screen: 'product-details', productData, rawValue });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Check if a scanned result is a product QR and route to details
  useEffect(() => {
    if (nav.screen === 'product-details' && nav.productData && nav.rawValue) {
      // already set
    }
  }, [nav]);

  const renderScreen = () => {
    switch (nav.screen) {
      case 'home':
        return <HomeScreen navigate={navigate} />;
      case 'scanner':
        return <ScannerScreen navigate={navigate} openProductDetails={openProductDetails} />;
      case 'generator':
        return <GeneratorScreen navigate={navigate} />;
      case 'product':
        return <ProductScreen navigate={navigate} />;
      case 'history':
        return <HistoryScreen navigate={navigate} />;
      case 'favorites':
        return <FavoritesScreen navigate={navigate} />;
      case 'stats':
        return <StatsScreen navigate={navigate} />;
      case 'settings':
        return <SettingsScreen navigate={navigate} />;
      case 'product-details':
        if (nav.productData && nav.rawValue) {
          return <ProductDetailsScreen productData={nav.productData} rawValue={nav.rawValue} navigate={navigate} />;
        }
        return <HomeScreen navigate={navigate} />;
      default:
        return <HomeScreen navigate={navigate} />;
    }
  };

  const navItems = [
    { screen: 'home' as Screen, icon: Home, label: t('navHome') },
    { screen: 'scanner' as Screen, icon: ScanLine, label: t('navScan') },
    { screen: 'generator' as Screen, icon: QrCode, label: t('navGenerate') },
    { screen: 'history' as Screen, icon: HistoryIcon, label: t('navHistory') },
    { screen: 'settings' as Screen, icon: Settings, label: t('navSettings') },
  ];

  const showNav = !['product-details'].includes(nav.screen);

  return (
    <div className="min-h-screen bg-surface text-on-surface" dir={dir}>
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-lg border-b border-outline-variant/30">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => navigate('home')} className="flex items-center gap-2 md-ripple rounded-full px-2 py-1">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <Logo className="w-5 h-5 text-on-primary" />
            </div>
            <span className="font-extrabold text-on-surface text-base">{t('appName')}</span>
          </button>
          <button
            onClick={() => setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
            className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-on-surface md-ripple"
            aria-label="Toggle theme"
          >
            {settings.theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="min-h-[calc(100vh-3.5rem)]">
        {renderScreen()}
      </main>

      {/* Bottom nav */}
      {showNav && (
        <nav className="fixed bottom-0 inset-x-0 z-30 bg-surface/90 backdrop-blur-lg border-t border-outline-variant/30">
          <div className="max-w-3xl mx-auto px-2 flex items-center justify-around h-16">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = nav.screen === item.screen;
              return (
                <button
                  key={item.screen}
                  onClick={() => navigate(item.screen)}
                  className="flex flex-col items-center gap-1 px-3 py-1.5 md-ripple rounded-2xl transition-all"
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${active ? 'bg-secondary-container' : ''}`}>
                    <Icon className={`w-5 h-5 transition-colors ${active ? 'text-on-secondary-container' : 'text-outline'}`} />
                  </div>
                  <span className={`text-[10px] font-medium transition-colors ${active ? 'text-on-surface' : 'text-outline'}`}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <ToastHost />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
