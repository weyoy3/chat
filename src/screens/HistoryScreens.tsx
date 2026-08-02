import { useState, useMemo, useRef } from 'react';
import {
  ChevronLeft, Search, Heart, Trash2, Copy, Share2, RefreshCw, X, Filter,
  History as HistoryIcon, QrCode as QrIcon, Package,
} from 'lucide-react';
import { useApp } from '../store';
import { detectQRType, TYPE_ICONS, buildQRString } from '../lib/qr';
import { renderQRToCanvas, copyToClipboard, shareText, shareQR, printQR } from '../lib/qrRender';
import { defaultStyle } from '../lib/qr';
import { EmptyState, ConfirmDialog, formatDate, showToast } from '../components/ui';
import * as Icons from 'lucide-react';
import type { HistoryItem } from '../types';
import type { Screen } from '../App';

export function HistoryScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const { t, history, deleteHistory, clearHistory, toggleFavorite, settings } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'scan' | 'generate'>('all');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let items = history;
    if (filter !== 'all') items = items.filter((h) => h.source === filter);
    if (query) {
      const q = query.toLowerCase();
      items = items.filter((h) => h.title.toLowerCase().includes(q) || h.rawValue.toLowerCase().includes(q));
    }
    items = [...items].sort((a, b) => sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
    return items;
  }, [history, filter, query, sort]);

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4 mt-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
            <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
          </button>
          <h1 className="text-xl font-bold text-on-surface">{t('historyTitle')}</h1>
        </div>
        {history.length > 0 && (
          <button onClick={() => setConfirmDeleteAll(true)} className="text-error p-2 md-ripple rounded-full">
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-5 h-5 text-outline" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('historySearch')}
          className="md-field ps-10"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute top-1/2 -translate-y-1/2 end-3 text-outline">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {(['all', 'scan', 'generate'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`md-chip shrink-0 ${filter === f ? 'md-chip-selected' : 'md-chip-unselected'}`}>
            {f === 'all' ? t('historyAll') : f === 'scan' ? t('historyScans') : t('historyGenerated')}
          </button>
        ))}
        <button
          onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
          className="md-chip shrink-0 md-chip-unselected flex items-center gap-1.5"
        >
          <Filter className="w-3.5 h-3.5" />
          {sort === 'newest' ? t('historySortNewest') : t('historySortOldest')}
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState icon={<HistoryIcon className="w-10 h-10" />} title={t('historyEmpty')} desc={t('historyEmptyDesc')} />
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <HistoryCard
              key={item.id}
              item={item}
              lang={settings.lang}
              t={t}
              onDelete={() => setConfirmDelete(item.id)}
              onFavorite={() => { toggleFavorite(item.id); showToast(item.isFavorite ? t('removedFromFav') : t('addedToFav')); }}
              onCopy={() => { copyToClipboard(item.rawValue); showToast(t('copied')); }}
              onShare={() => shareText(item.rawValue, t('actionShare'))}
              onRegenerate={() => navigate('generator')}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteAll}
        title={t('actionDeleteAll')}
        message={t('confirmDeleteAll')}
        confirmLabel={t('actionDelete')}
        cancelLabel={t('actionCancel')}
        onConfirm={() => { clearHistory(); setConfirmDeleteAll(false); showToast(t('deleted')); }}
        onCancel={() => setConfirmDeleteAll(false)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('actionDelete')}
        message={t('confirmDelete')}
        confirmLabel={t('actionDelete')}
        cancelLabel={t('actionCancel')}
        onConfirm={() => { if (confirmDelete) { deleteHistory(confirmDelete); setConfirmDelete(null); showToast(t('deleted')); } }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function HistoryCard({ item, lang, t, onDelete, onFavorite, onCopy, onShare, onRegenerate }: {
  item: HistoryItem; lang: string; t: (k: string) => string;
  onDelete: () => void; onFavorite: () => void; onCopy: () => void; onShare: () => void; onRegenerate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const iconName = TYPE_ICONS[item.type];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[iconName] ?? QrIcon;
  const isProduct = item.type === 'product' || !!item.productData;

  return (
    <div className="md-card md-elevated p-4 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${isProduct ? 'bg-tertiary-container' : 'bg-secondary-container'}`}>
          {isProduct ? <Package className="w-5 h-5 text-on-tertiary-container" /> : <Icon className="w-5 h-5 text-on-secondary-container" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-primary font-semibold uppercase tracking-wide">
              {t(`type${item.type.charAt(0).toUpperCase() + item.type.slice(1)}`)}
            </span>
            <span className="text-xs text-outline">·</span>
            <span className="text-xs text-outline">{item.source === 'scan' ? t('historyScans') : t('historyGenerated')}</span>
          </div>
          <p className="text-sm font-semibold text-on-surface truncate">{item.title}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">{formatDate(item.createdAt, lang)}</p>
        </div>
        <button onClick={onFavorite} className="p-2 md-ripple rounded-full shrink-0">
          <Heart className={`w-5 h-5 ${item.isFavorite ? 'fill-current text-error' : 'text-outline'}`} />
        </button>
      </div>

      {expanded && (
        <div className="mt-3 bg-surface-container rounded-xl p-3 animate-fade-in">
          <p className="text-xs text-on-surface-variant break-all leading-relaxed">{item.rawValue}</p>
        </div>
      )}

      <div className="flex gap-1 mt-3">
        <button onClick={() => setExpanded(!expanded)} className="md-text-btn text-xs px-2 py-1.5">
          {expanded ? t('actionClose') : t('actionOpen')}
        </button>
        <button onClick={onCopy} className="md-text-btn text-xs px-2 py-1.5 flex items-center gap-1">
          <Copy className="w-3.5 h-3.5" /> {t('actionCopy')}
        </button>
        <button onClick={onShare} className="md-text-btn text-xs px-2 py-1.5 flex items-center gap-1">
          <Share2 className="w-3.5 h-3.5" /> {t('actionShare')}
        </button>
        {item.source === 'generate' && (
          <button onClick={onRegenerate} className="md-text-btn text-xs px-2 py-1.5 flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> {t('actionRegenerate')}
          </button>
        )}
        <button onClick={onDelete} className="md-text-btn text-xs px-2 py-1.5 text-error flex items-center gap-1 ms-auto">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function FavoritesScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const { t, history, toggleFavorite, settings } = useApp();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'product' | 'qr'>('all');

  const favorites = useMemo(() => {
    let items = history.filter((h) => h.isFavorite);
    if (tab === 'product') items = items.filter((h) => h.type === 'product' || !!h.productData);
    if (tab === 'qr') items = items.filter((h) => h.type !== 'product' && !h.productData);
    if (query) {
      const q = query.toLowerCase();
      items = items.filter((h) => h.title.toLowerCase().includes(q));
    }
    return items;
  }, [history, tab, query]);

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('favoritesTitle')}</h1>
      </div>

      <div className="relative mb-3">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-5 h-5 text-outline" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('favoritesSearch')}
          className="md-field ps-10"
        />
      </div>

      <div className="flex gap-2 mb-4">
        {(['all', 'product', 'qr'] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} className={`md-chip ${tab === tb ? 'md-chip-selected' : 'md-chip-unselected'}`}>
            {tb === 'all' ? t('historyAll') : tb === 'product' ? t('favProducts') : t('favQrCodes')}
          </button>
        ))}
      </div>

      {favorites.length === 0 ? (
        <EmptyState icon={<Heart className="w-10 h-10" />} title={t('favoritesEmpty')} desc={t('favoritesEmptyDesc')} />
      ) : (
        <div className="space-y-2">
          {favorites.map((item) => (
            <HistoryCard
              key={item.id}
              item={item}
              lang={settings.lang}
              t={t}
              onDelete={() => { toggleFavorite(item.id); showToast(t('removedFromFav')); }}
              onFavorite={() => { toggleFavorite(item.id); showToast(item.isFavorite ? t('removedFromFav') : t('addedToFav')); }}
              onCopy={() => { copyToClipboard(item.rawValue); showToast(t('copied')); }}
              onShare={() => shareText(item.rawValue, t('actionShare'))}
              onRegenerate={() => navigate('generator')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function StatsScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const { t, history, settings } = useApp();

  const stats = useMemo(() => {
    const scans = history.filter((h) => h.source === 'scan').length;
    const generated = history.filter((h) => h.source === 'generate').length;
    const products = history.filter((h) => h.type === 'product' || h.productData).length;
    const favorites = history.filter((h) => h.isFavorite).length;

    const typeCount: Record<string, number> = {};
    history.forEach((h) => { typeCount[h.type] = (typeCount[h.type] ?? 0) + 1; });
    const mostUsed = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];

    // Activity last 7 days
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const count = history.filter((h) => h.createdAt >= d.getTime() && h.createdAt < next.getTime()).length;
      days.push({
        label: d.toLocaleDateString(settings.lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short' }),
        count,
      });
    }
    const maxDay = Math.max(...days.map((d) => d.count), 1);

    return { scans, generated, products, favorites, mostUsed, days, maxDay };
  }, [history, settings.lang]);

  const statCards = [
    { label: t('statsTotalScans'), value: stats.scans, icon: 'ScanLine', color: 'var(--md-primary)' },
    { label: t('statsTotalGenerated'), value: stats.generated, icon: 'QrCode', color: '#00695c' },
    { label: t('statsTotalProducts'), value: stats.products, icon: 'Package', color: '#0288d1' },
    { label: t('statsFavorites'), value: stats.favorites, icon: 'Heart', color: '#e91e63' },
  ];

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('statsTitle')}</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {statCards.map((s, i) => {
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[s.icon];
          return (
            <div key={s.label} className="md-card md-elevated p-4 animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-2" style={{ backgroundColor: `${s.color}22` }}>
                <Icon className="w-5 h-5" style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-extrabold text-on-surface">{s.value}</p>
              <p className="text-xs text-on-surface-variant">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Most used type */}
      <div className="md-card md-elevated p-4 mb-4">
        <h3 className="text-sm font-semibold text-on-surface-variant mb-2">{t('statsMostUsed')}</h3>
        {stats.mostUsed ? (
          <div className="flex items-center gap-3">
            {(() => {
              const iconName = TYPE_ICONS[stats.mostUsed[0] as keyof typeof TYPE_ICONS] ?? 'QrCode';
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[iconName];
              return (
                <>
                  <div className="w-12 h-12 rounded-2xl bg-secondary-container flex items-center justify-center">
                    <Icon className="w-6 h-6 text-on-secondary-container" />
                  </div>
                  <div>
                    <p className="font-bold text-on-surface">{t(`type${stats.mostUsed[0].charAt(0).toUpperCase() + stats.mostUsed[0].slice(1)}`)}</p>
                    <p className="text-xs text-on-surface-variant">{stats.mostUsed[1]} {t('statsTotalScans').toLowerCase()}</p>
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <p className="text-sm text-outline">{t('statsNoData')}</p>
        )}
      </div>

      {/* Activity chart */}
      <div className="md-card md-elevated p-4 mb-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-on-surface-variant">{t('statsActivity')}</h3>
          <span className="text-xs text-outline">{t('statsActivityDesc')}</span>
        </div>
        {stats.days.some((d) => d.count > 0) ? (
          <div className="flex items-end justify-between gap-2 h-32">
            {stats.days.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-t-lg bg-primary transition-all duration-500"
                    style={{ height: `${(d.count / stats.maxDay) * 100}%`, minHeight: d.count > 0 ? '8px' : '2px', opacity: d.count > 0 ? 1 : 0.3 }}
                  />
                </div>
                <span className="text-xs text-outline">{d.label}</span>
                {d.count > 0 && <span className="text-xs text-on-surface font-semibold">{d.count}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-outline text-center py-8">{t('statsNoData')}</p>
        )}
      </div>
    </div>
  );
}
