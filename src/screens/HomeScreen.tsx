import { QrCode, ScanLine, History as HistoryIcon, Settings, Package, Heart, BarChart3, ArrowRight } from 'lucide-react';
import { useApp } from '../store';
import type { Screen } from '../App';

export function HomeScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const { t, dir } = useApp();

  const mainCards = [
    { screen: 'scanner' as Screen, icon: ScanLine, title: t('homeScan'), desc: t('homeScanDesc'), color: 'var(--md-primary)', container: 'var(--md-primary-container)' },
    { screen: 'generator' as Screen, icon: QrCode, title: t('homeGenerate'), desc: t('homeGenerateDesc'), color: '#00695c', container: 'var(--md-tertiary-container)' },
    { screen: 'history' as Screen, icon: HistoryIcon, title: t('homeHistory'), desc: t('homeHistoryDesc'), color: '#0288d1', container: '#d0e8f7' },
    { screen: 'settings' as Screen, icon: Settings, title: t('homeSettings'), desc: t('homeSettingsDesc'), color: '#7b1fa2', container: '#f3e5f5' },
  ];

  const quickCards = [
    { screen: 'product' as Screen, icon: Package, title: t('homeProduct'), desc: t('homeProductDesc') },
    { screen: 'favorites' as Screen, icon: Heart, title: t('homeFavorites'), desc: t('homeFavoritesDesc') },
    { screen: 'stats' as Screen, icon: BarChart3, title: t('homeStats'), desc: t('homeStatsDesc') },
  ];

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-3xl mx-auto">
      <div className="text-center mb-8 mt-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-primary mb-3 animate-scale-in">
          <QrCode className="w-9 h-9 text-on-primary" />
        </div>
        <h1 className="text-2xl font-extrabold text-on-surface">{t('homeTitle')}</h1>
        <p className="text-on-surface-variant text-sm mt-1">{t('homeSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {mainCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <button
              key={card.screen}
              onClick={() => navigate(card.screen)}
              className="md-card md-elevated p-5 text-start animate-slide-up hover:md-elevated-2 transition-all"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: card.container }}
                >
                  <Icon className="w-7 h-7" style={{ color: card.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-on-surface text-base">{card.title}</h3>
                  <p className="text-on-surface-variant text-xs mt-0.5 truncate">{card.desc}</p>
                </div>
                <ArrowRight className={`w-5 h-5 text-outline shrink-0 ${dir === 'rtl' ? 'rotate-180' : ''}`} />
              </div>
            </button>
          );
        })}
      </div>

      <h2 className="text-sm font-semibold text-on-surface-variant px-1 mb-3 uppercase tracking-wide">{t('navSettings')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {quickCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <button
              key={card.screen}
              onClick={() => navigate(card.screen)}
              className="md-card md-elevated p-4 text-center animate-slide-up hover:md-elevated-2 transition-all"
              style={{ animationDelay: `${(i + 4) * 60}ms` }}
            >
              <div className="w-11 h-11 rounded-2xl bg-secondary-container flex items-center justify-center mx-auto mb-2">
                <Icon className="w-6 h-6 text-on-secondary-container" />
              </div>
              <h3 className="font-semibold text-on-surface text-sm">{card.title}</h3>
              <p className="text-on-surface-variant text-xs mt-0.5">{card.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
