import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import {
  ChevronLeft, Download, Share2, Printer, Heart, Image as ImageIcon, X,
  Globe, Type, Phone, Mail, MessageSquare, Contact, Wifi, MapPin,
  MessageCircle, Send, Facebook, Instagram, Twitter, Youtube, QrCode as QrIcon,
} from 'lucide-react';
import { useApp } from '../store';
import { buildQRString, getQRTitle, defaultStyle, QR_TYPES, TYPE_ICONS } from '../lib/qr';
import { renderQRToCanvas, exportPNG, exportSVG, exportPDF, shareQR, printQR, copyToClipboard, shareText } from '../lib/qrRender';
import { showToast } from '../components/ui';
import type { QRType, QRStyleOptions } from '../types';
import * as Icons from 'lucide-react';

const TYPE_LABELS: Record<QRType, string> = {
  url: 'typeUrl', text: 'typeText', phone: 'typePhone', email: 'typeEmail',
  sms: 'typeSms', vcard: 'typeVcard', wifi: 'typeWifi', location: 'typeLocation',
  whatsapp: 'typeWhatsapp', telegram: 'typeTelegram', facebook: 'typeFacebook',
  instagram: 'typeInstagram', twitter: 'typeTwitter', youtube: 'typeYoutube',
  custom: 'typeCustom', product: 'typeProduct',
};

const SCROLL_TYPES: QRType[] = ['url', 'text', 'phone', 'email', 'sms', 'vcard', 'wifi', 'location', 'whatsapp', 'telegram', 'facebook', 'instagram', 'twitter', 'youtube', 'custom'];

export function GeneratorScreen({ navigate }: { navigate: (s: string) => void }) {
  const { t, addHistory, toggleFavorite, history, settings } = useApp();
  const [type, setType] = useState<QRType>('url');
  const [data, setData] = useState<Record<string, string>>({});
  const [style, setStyle] = useState<QRStyleOptions>(defaultStyle());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  const qrString = buildQRString(type, data);
  const title = getQRTitle(type, data, qrString);

  useEffect(() => {
    if (canvasRef.current && qrString) {
      renderQRToCanvas(canvasRef.current, qrString, style);
    }
  }, [qrString, style]);

  const handleGenerate = useCallback(() => {
    if (!qrString) return;
    const item = addHistory({
      type,
      title,
      rawValue: qrString,
      data: data as Record<string, unknown>,
      source: 'generate',
    });
    setSavedItemId(item.id);
    showToast(t('genSavedToHistory'));
  }, [qrString, type, title, addHistory, data, t]);

  const isFavorite = savedItemId ? history.find((h) => h.id === savedItemId)?.isFavorite : false;

  const filename = `qr-${type}-${Date.now()}`;

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('genTitle')}</h1>
      </div>

      {/* Type selector */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-4 -mx-4 px-4">
        {SCROLL_TYPES.map((qt) => {
          const iconName = TYPE_ICONS[qt];
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[iconName] ?? QrIcon;
          return (
            <button
              key={qt}
              onClick={() => { setType(qt); setData({}); setSavedItemId(null); }}
              className={`md-chip shrink-0 ${type === qt ? 'md-chip-selected' : 'md-chip-unselected'}`}
            >
              <Icon className="w-4 h-4" />
              {t(TYPE_LABELS[qt])}
            </button>
          );
        })}
      </div>

      {/* Form fields */}
      <div className="md-card md-elevated p-4 mb-4">
        <TypeForm type={type} data={data} setData={setData} t={t} />
      </div>

      {/* Preview */}
      <div className="md-card md-elevated-2 p-5 mb-4 flex flex-col items-center">
        <p className="text-sm font-semibold text-on-surface-variant mb-3">{t('genPreview')}</p>
        <div className="rounded-2xl overflow-hidden bg-white p-2">
          <canvas ref={canvasRef} width={style.size} height={style.size} className="max-w-full" />
        </div>
        <p className="text-xs text-on-surface-variant mt-3 max-w-xs text-center truncate">{title}</p>
      </div>

      {/* Customize toggle */}
      <button
        onClick={() => setShowCustomize(!showCustomize)}
        className="md-outlined-btn w-full flex items-center justify-center gap-2 mb-4"
      >
        {showCustomize ? <X className="w-4 h-4" /> : <QrIcon className="w-4 h-4" />}
        {t('genCustomize')}
      </button>

      {showCustomize && (
        <div className="md-card md-elevated p-4 mb-4 animate-slide-up">
          <CustomizePanel style={style} setStyle={setStyle} t={t} />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={handleGenerate} className="md-filled-btn flex items-center gap-2">
          <QrIcon className="w-4 h-4" />
          {t('actionSave')}
        </button>
        <ExportMenu qrString={qrString} style={style} filename={filename} label={title} t={t} />
        <button onClick={() => printQR(qrString, style, title)} className="md-tonal-btn flex items-center gap-2">
          <Printer className="w-4 h-4" />
          {t('actionPrint')}
        </button>
        <button onClick={() => shareQR(qrString, style, filename)} className="md-tonal-btn flex items-center gap-2">
          <Share2 className="w-4 h-4" />
          {t('actionShareQr')}
        </button>
        {savedItemId && (
          <button
            onClick={() => { toggleFavorite(savedItemId); showToast(isFavorite ? t('removedFromFav') : t('addedToFav')); }}
            className="md-tonal-btn flex items-center gap-2"
          >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current text-error' : ''}`} />
            {isFavorite ? t('actionRemoveFavorite') : t('actionSaveFavorite')}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', t }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; t: (k: string) => string;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t('fieldPlaceholder')}
          rows={3}
          className="md-field resize-none"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t('fieldPlaceholder')}
          className="md-field"
        />
      )}
    </div>
  );
}

function TypeForm({ type, data, setData, t }: { type: QRType; data: Record<string, string>; setData: (d: Record<string, string>) => void; t: (k: string) => string }) {
  const set = (key: string, val: string) => setData({ ...data, [key]: val });

  switch (type) {
    case 'url':
      return <Field label={t('fieldUrl')} value={data.url ?? ''} onChange={(v) => set('url', v)} placeholder="https://example.com" t={t} />;
    case 'text':
      return <Field label={t('fieldText')} value={data.text ?? ''} onChange={(v) => set('text', v)} type="textarea" t={t} />;
    case 'phone':
      return <Field label={t('fieldPhone')} value={data.phone ?? ''} onChange={(v) => set('phone', v)} placeholder="+1234567890" t={t} />;
    case 'email':
      return (
        <>
          <Field label={t('fieldEmail')} value={data.email ?? ''} onChange={(v) => set('email', v)} t={t} />
          <Field label={t('fieldEmailSubject')} value={data.subject ?? ''} onChange={(v) => set('subject', v)} t={t} />
          <Field label={t('fieldEmailBody')} value={data.body ?? ''} onChange={(v) => set('body', v)} type="textarea" t={t} />
        </>
      );
    case 'sms':
      return (
        <>
          <Field label={t('fieldSmsPhone')} value={data.phone ?? ''} onChange={(v) => set('phone', v)} t={t} />
          <Field label={t('fieldSmsMessage')} value={data.message ?? ''} onChange={(v) => set('message', v)} type="textarea" t={t} />
        </>
      );
    case 'vcard':
      return (
        <>
          <Field label={t('fieldVcardName')} value={data.name ?? ''} onChange={(v) => set('name', v)} t={t} />
          <Field label={t('fieldVcardPhone')} value={data.phone ?? ''} onChange={(v) => set('phone', v)} t={t} />
          <Field label={t('fieldVcardEmail')} value={data.email ?? ''} onChange={(v) => set('email', v)} t={t} />
          <Field label={t('fieldVcardOrg')} value={data.org ?? ''} onChange={(v) => set('org', v)} t={t} />
          <Field label={t('fieldVcardTitle')} value={data.title ?? ''} onChange={(v) => set('title', v)} t={t} />
          <Field label={t('fieldVcardAddress')} value={data.address ?? ''} onChange={(v) => set('address', v)} t={t} />
          <Field label={t('fieldVcardUrl')} value={data.url ?? ''} onChange={(v) => set('url', v)} t={t} />
        </>
      );
    case 'wifi':
      return (
        <>
          <Field label={t('fieldWifiSsid')} value={data.ssid ?? ''} onChange={(v) => set('ssid', v)} t={t} />
          <Field label={t('fieldWifiPassword')} value={data.password ?? ''} onChange={(v) => set('password', v)} t={t} />
          <div className="mb-3">
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{t('fieldWifiEncryption')}</label>
            <select value={data.encryption ?? 'WPA'} onChange={(e) => set('encryption', e.target.value)} className="md-field">
              <option value="WPA">WPA/WPA2</option>
              <option value="WEP">WEP</option>
              <option value="nopass">None</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
            <input type="checkbox" checked={data.hidden === 'true'} onChange={(e) => set('hidden', e.target.checked ? 'true' : '')} className="w-4 h-4 accent-[var(--md-primary)]" />
            {t('fieldWifiHidden')}
          </label>
        </>
      );
    case 'location':
      return (
        <>
          <Field label={t('fieldLat')} value={data.lat ?? ''} onChange={(v) => set('lat', v)} placeholder="24.7136" t={t} />
          <Field label={t('fieldLng')} value={data.lng ?? ''} onChange={(v) => set('lng', v)} placeholder="46.6753" t={t} />
          <Field label={t('fieldQuery')} value={data.query ?? ''} onChange={(v) => set('query', v)} t={t} />
        </>
      );
    case 'whatsapp':
      return (
        <>
          <Field label={t('fieldWhatsappPhone')} value={data.phone ?? ''} onChange={(v) => set('phone', v)} placeholder="966512345678" t={t} />
          <Field label={t('fieldWhatsappMessage')} value={data.message ?? ''} onChange={(v) => set('message', v)} type="textarea" t={t} />
        </>
      );
    case 'telegram':
      return <Field label={t('fieldTelegramUsername')} value={data.username ?? ''} onChange={(v) => set('username', v)} placeholder="username" t={t} />;
    case 'facebook':
      return <Field label={t('fieldFacebookUrl')} value={data.url ?? ''} onChange={(v) => set('url', v)} placeholder="https://facebook.com/page" t={t} />;
    case 'instagram':
      return <Field label={t('fieldInstagramUsername')} value={data.username ?? ''} onChange={(v) => set('username', v)} placeholder="username" t={t} />;
    case 'twitter':
      return <Field label={t('fieldTwitterUsername')} value={data.username ?? ''} onChange={(v) => set('username', v)} placeholder="username" t={t} />;
    case 'youtube':
      return <Field label={t('fieldYoutubeUrl')} value={data.url ?? ''} onChange={(v) => set('url', v)} placeholder="https://youtube.com/..." t={t} />;
    case 'custom':
      return <Field label={t('typeCustom')} value={data.custom ?? ''} onChange={(v) => set('custom', v)} type="textarea" t={t} />;
    default:
      return null;
  }
}

function CustomizePanel({ style, setStyle, t }: { style: QRStyleOptions; setStyle: (s: QRStyleOptions) => void; t: (k: string) => string }) {
  const logoInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{t('genColor')}</label>
          <input
            type="color"
            value={style.fgColor}
            onChange={(e) => setStyle({ ...style, fgColor: e.target.value })}
            className="w-full h-12"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{t('genBgColor')}</label>
          <input
            type="color"
            value={style.bgColor}
            onChange={(e) => setStyle({ ...style, bgColor: e.target.value })}
            className="w-full h-12"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{t('genSize')}: {style.size}px</label>
        <input
          type="range"
          min={160}
          max={480}
          step={20}
          value={style.size}
          onChange={(e) => setStyle({ ...style, size: parseInt(e.target.value) })}
          className="w-full"
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{t('genMargin')}: {style.margin}</label>
        <input
          type="range"
          min={0}
          max={8}
          step={1}
          value={style.margin}
          onChange={(e) => setStyle({ ...style, margin: parseInt(e.target.value) })}
          className="w-full"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={style.rounded}
          onChange={(e) => setStyle({ ...style, rounded: e.target.checked })}
          className="w-4 h-4 accent-[var(--md-primary)]"
        />
        {t('genRounded')}
      </label>

      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => setStyle({ ...style, logoDataUrl: reader.result as string });
            reader.readAsDataURL(file);
          }
          e.target.value = '';
        }}
      />
      {style.logoDataUrl ? (
        <div className="flex items-center gap-3">
          <img src={style.logoDataUrl} alt="logo" className="w-12 h-12 rounded-xl object-cover" />
          <button onClick={() => setStyle({ ...style, logoDataUrl: undefined })} className="md-outlined-btn flex items-center gap-2">
            <X className="w-4 h-4" />
            {t('genRemoveLogo')}
          </button>
        </div>
      ) : (
        <button onClick={() => logoInputRef.current?.click()} className="md-outlined-btn flex items-center gap-2">
          <ImageIcon className="w-4 h-4" />
          {t('genLogo')}
        </button>
      )}
    </div>
  );
}

function ExportMenu({ qrString, style, filename, label, t }: { qrString: string; style: QRStyleOptions; filename: string; label: string; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="md-tonal-btn flex items-center gap-2">
        <Download className="w-4 h-4" />
        {t('genExport')}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 start-0 z-50 bg-surface-container-lowest rounded-2xl md-elevated-3 p-2 min-w-[180px] animate-scale-in">
            <button onClick={() => { exportPNG(qrString, style, filename); setOpen(false); }} className="w-full text-start px-4 py-2.5 rounded-xl text-sm text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2">
              <Download className="w-4 h-4" /> {t('genExportPng')}
            </button>
            <button onClick={() => { exportSVG(qrString, style, filename); setOpen(false); }} className="w-full text-start px-4 py-2.5 rounded-xl text-sm text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2">
              <Download className="w-4 h-4" /> {t('genExportSvg')}
            </button>
            <button onClick={() => { exportPDF(qrString, style, filename, label); setOpen(false); }} className="w-full text-start px-4 py-2.5 rounded-xl text-sm text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2">
              <Download className="w-4 h-4" /> {t('genExportPdf')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
