import { useState, useRef } from 'react';
import {
  ChevronLeft, Languages, Sun, Moon, Link2, Volume2, Vibrate, Camera,
  Trash2, Download, Upload, Shield, Info, Check,
} from 'lucide-react';
import { useApp } from '../store';
import { showToast, ConfirmDialog } from '../components/ui';
import type { HistoryItem } from '../types';

export function SettingsScreen({ navigate }: { navigate: (s: string) => void }) {
  const { t, settings, setSettings, history, clearHistory, importHistory } = useApp();
  const [confirmClear, setConfirmClear] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const exportBackup = () => {
    const data = JSON.stringify({ settings, history, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qr-studio-backup-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(t('saved'));
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as { history?: HistoryItem[]; settings?: typeof settings };
        if (parsed.history) importHistory(parsed.history);
        if (parsed.settings) setSettings(parsed.settings);
        showToast(t('saved'));
      } catch {
        showToast(t('error'));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('settingsTitle')}</h1>
      </div>

      {/* Language */}
      <Section label={t('settingsLanguage')}>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSettings({ lang: 'en' })}
            className={`md-card p-4 flex items-center justify-between ${settings.lang === 'en' ? 'ring-2 ring-[var(--md-primary)]' : ''}`}
          >
            <div className="flex items-center gap-3">
              <Languages className="w-5 h-5 text-primary" />
              <span className="font-semibold text-on-surface text-sm">English</span>
            </div>
            {settings.lang === 'en' && <Check className="w-5 h-5 text-primary" />}
          </button>
          <button
            onClick={() => setSettings({ lang: 'ar' })}
            className={`md-card p-4 flex items-center justify-between ${settings.lang === 'ar' ? 'ring-2 ring-[var(--md-primary)]' : ''}`}
          >
            <div className="flex items-center gap-3">
              <Languages className="w-5 h-5 text-primary" />
              <span className="font-semibold text-on-surface text-sm">العربية</span>
            </div>
            {settings.lang === 'ar' && <Check className="w-5 h-5 text-primary" />}
          </button>
        </div>
      </Section>

      {/* Theme */}
      <Section label={t('settingsTheme')}>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSettings({ theme: 'light' })}
            className={`md-card p-4 flex items-center justify-between ${settings.theme === 'light' ? 'ring-2 ring-[var(--md-primary)]' : ''}`}
          >
            <div className="flex items-center gap-3">
              <Sun className="w-5 h-5 text-warning" />
              <span className="font-semibold text-on-surface text-sm">{t('settingsLight')}</span>
            </div>
            {settings.theme === 'light' && <Check className="w-5 h-5 text-primary" />}
          </button>
          <button
            onClick={() => setSettings({ theme: 'dark' })}
            className={`md-card p-4 flex items-center justify-between ${settings.theme === 'dark' ? 'ring-2 ring-[var(--md-primary)]' : ''}`}
          >
            <div className="flex items-center gap-3">
              <Moon className="w-5 h-5 text-info" />
              <span className="font-semibold text-on-surface text-sm">{t('settingsDark')}</span>
            </div>
            {settings.theme === 'dark' && <Check className="w-5 h-5 text-primary" />}
          </button>
        </div>
      </Section>

      {/* Toggles */}
      <Section label={t('navSettings')}>
        <ToggleRow
          icon={<Link2 className="w-5 h-5" />}
          title={t('settingsAutoOpen')}
          desc={t('settingsAutoOpenDesc')}
          checked={settings.autoOpenLinks}
          onChange={(v) => setSettings({ autoOpenLinks: v })}
        />
        <ToggleRow
          icon={<Volume2 className="w-5 h-5" />}
          title={t('settingsSound')}
          desc={t('settingsSoundDesc')}
          checked={settings.sound}
          onChange={(v) => setSettings({ sound: v })}
        />
        <ToggleRow
          icon={<Vibrate className="w-5 h-5" />}
          title={t('settingsVibration')}
          desc={t('settingsVibrationDesc')}
          checked={settings.vibration}
          onChange={(v) => setSettings({ vibration: v })}
        />
      </Section>

      {/* Camera */}
      <Section label={t('settingsCamera')}>
        <div className="md-card p-2">
          <div className="flex items-center gap-3 px-2 py-2">
            <Camera className="w-5 h-5 text-primary" />
            <span className="text-sm text-on-surface-variant flex-1">{t('settingsCameraDesc')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => setSettings({ defaultCamera: 'environment' })}
              className={`rounded-xl py-2.5 text-sm font-medium transition-all ${settings.defaultCamera === 'environment' ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant'}`}
            >
              {t('settingsCameraRear')}
            </button>
            <button
              onClick={() => setSettings({ defaultCamera: 'user' })}
              className={`rounded-xl py-2.5 text-sm font-medium transition-all ${settings.defaultCamera === 'user' ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant'}`}
            >
              {t('settingsCameraFront')}
            </button>
          </div>
        </div>
      </Section>

      {/* Data management */}
      <Section label={t('settingsData')}>
        <ActionRow
          icon={<Trash2 className="w-5 h-5 text-error" />}
          title={t('settingsClearHistory')}
          desc={t('settingsClearHistoryDesc')}
          onClick={() => setConfirmClear(true)}
          danger
        />
        <ActionRow
          icon={<Download className="w-5 h-5" />}
          title={t('settingsExportHistory')}
          desc={t('settingsExportHistoryDesc')}
          onClick={exportBackup}
        />
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importBackup(file);
            e.target.value = '';
          }}
        />
        <ActionRow
          icon={<Upload className="w-5 h-5" />}
          title={t('settingsImportBackup')}
          desc={t('settingsImportBackupDesc')}
          onClick={() => importRef.current?.click()}
        />
      </Section>

      {/* About */}
      <Section label={t('settingsAbout')}>
        <div className="md-card p-4">
          <div className="flex items-center gap-3 mb-3">
            <Shield className="w-5 h-5 text-success" />
            <div>
              <p className="text-sm font-semibold text-on-surface">{t('settingsPrivacy')}</p>
              <p className="text-xs text-on-surface-variant">{t('settingsPrivacyDesc')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Info className="w-5 h-5 text-outline" />
            <div>
              <p className="text-sm font-semibold text-on-surface">{t('settingsVersion')}</p>
              <p className="text-xs text-on-surface-variant">1.0.0</p>
            </div>
          </div>
        </div>
      </Section>

      <ConfirmDialog
        open={confirmClear}
        title={t('settingsClearHistory')}
        message={t('confirmDeleteAll')}
        confirmLabel={t('actionConfirm')}
        cancelLabel={t('actionCancel')}
        onConfirm={() => { clearHistory(); setConfirmClear(false); showToast(t('deleted')); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide px-1 mb-2">{label}</h2>
      {children}
    </div>
  );
}

function ToggleRow({ icon, title, desc, checked, onChange }: {
  icon: React.ReactNode; title: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="md-card p-4 flex items-center gap-3 mb-2">
      <div className="text-primary">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-on-surface">{title}</p>
        <p className="text-xs text-on-surface-variant truncate">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full transition-all relative shrink-0 ${checked ? 'bg-primary' : 'bg-surface-container-highest'}`}
      >
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'start-6' : 'start-1'}`} />
      </button>
    </div>
  );
}

function ActionRow({ icon, title, desc, onClick, danger }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button onClick={onClick} className="md-card p-4 flex items-center gap-3 mb-2 w-full text-start md-ripple">
      <div className={danger ? 'text-error' : 'text-primary'}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${danger ? 'text-error' : 'text-on-surface'}`}>{title}</p>
        <p className="text-xs text-on-surface-variant truncate">{desc}</p>
      </div>
    </button>
  );
}
