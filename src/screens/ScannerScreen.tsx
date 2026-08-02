import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  Camera, CameraOff, Image as ImageIcon, Zap, ZapOff, SwitchCamera, ZoomIn,
  Repeat, ScanLine, ChevronLeft, ExternalLink, Copy, Share2, Heart, X,
} from 'lucide-react';
import { useApp } from '../store';
import { detectQRType, getActionUrl, getQRTitle, TYPE_ICONS } from '../lib/qr';
import { playBeep, vibrate, copyToClipboard, shareText } from '../lib/qrRender';
import { EmptyState, showToast } from '../components/ui';
import * as Icons from 'lucide-react';
import type { DetectedQR } from '../lib/qr';

const READER_ID = 'qr-reader';

export function ScannerScreen({ navigate, openProductDetails }: { navigate: (s: string) => void; openProductDetails?: (productData: import('../types').ProductData, rawValue: string) => void }) {
  const { t, settings, addHistory, toggleFavorite, history } = useApp();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectedQR | null>(null);
  const [continuous, setContinuous] = useState(true);
  const [flashOn, setFlashOn] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>(settings.defaultCamera);
  const [zoom, setZoom] = useState(1);
  const [lastScanTime, setLastScanTime] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<DetectedQR | null>(null);

  resultRef.current = result;

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch { /* ignore */ }
      try {
        await scannerRef.current.clear();
      } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setScanning(false);
    setLoading(false);
  }, []);

  const onScanSuccess = useCallback(
    (decodedText: string) => {
      const now = Date.now();
      if (now - lastScanTime < 1500) return;
      setLastScanTime(now);

      const detected = detectQRType(decodedText);
      setResult(detected);

      if (settings.sound) playBeep();
      if (settings.vibration) vibrate(80);

      addHistory({
        type: detected.type,
        title: getQRTitle(detected.type, detected.data, detected.rawValue),
        rawValue: detected.rawValue,
        data: detected.data,
        productData: detected.productData,
        source: 'scan',
      });

      if (!continuous) {
        stopScanner();
      } else if (settings.autoOpenLinks) {
        const url = getActionUrl(detected.type, detected.data, detected.rawValue);
        if (detected.type === 'url' && url) {
          window.open(url, '_blank');
        }
      }
    },
    [lastScanTime, settings, continuous, addHistory, stopScanner],
  );

  const startScanner = useCallback(async () => {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const scanner = new Html5Qrcode(READER_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: cameraFacing },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1,
        },
        onScanSuccess,
        () => { /* per-frame error, ignore */ },
      );
      setScanning(true);
      setLoading(false);
    } catch {
      setError(t('scanCameraError'));
      setLoading(false);
    }
  }, [cameraFacing, onScanSuccess, t]);

  useEffect(() => {
    return () => { stopScanner(); };
  }, [stopScanner]);

  const flipCamera = useCallback(async () => {
    await stopScanner();
    setCameraFacing((prev) => (prev === 'environment' ? 'user' : 'environment'));
    setTimeout(() => startScanner(), 100);
  }, [stopScanner, startScanner]);

  const toggleFlash = useCallback(async () => {
    if (!scannerRef.current) return;
    try {
      const settings2 = scannerRef.current.getRunningTrackCameraCapabilities();
      if (!settings2) return;
      const torch = settings2.torchFeature();
      if (torch?.isSupported()) {
        await torch.apply(!flashOn);
        setFlashOn(!flashOn);
      }
    } catch { /* ignore */ }
  }, [flashOn]);

  const applyZoom = useCallback(async (z: number) => {
    setZoom(z);
    if (!scannerRef.current) return;
    try {
      const caps = scannerRef.current.getRunningTrackCameraCapabilities();
      if (!caps) return;
      const zoomFeat = caps.zoomFeature();
      if (zoomFeat?.isSupported()) {
        await zoomFeat.apply(z);
      }
    } catch { /* ignore */ }
  }, []);

  const handleGalleryScan = useCallback(async (file: File) => {
    setError(null);
    try {
      const scanner = new Html5Qrcode(`gallery-reader-${Date.now()}`, { verbose: false });
      const text = await scanner.scanFile(file, true);
      const detected = detectQRType(text);
      setResult(detected);
      if (settings.sound) playBeep();
      if (settings.vibration) vibrate(80);
      addHistory({
        type: detected.type,
        title: getQRTitle(detected.type, detected.data, detected.rawValue),
        rawValue: detected.rawValue,
        data: detected.data,
        productData: detected.productData,
        source: 'scan',
      });
      scanner.clear();
    } catch {
      setError(t('scanNoResult'));
    }
  }, [settings, addHistory, t]);

  const isFavorite = result ? history.find((h) => h.rawValue === result.rawValue && h.source === 'scan')?.isFavorite : false;

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className={`w-6 h-6 ${document.dir === 'rtl' ? 'rotate-180' : ''}`} />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('scanTitle')}</h1>
      </div>

      {/* Scanner viewport */}
      <div className="relative rounded-3xl overflow-hidden bg-surface-container md-elevated aspect-square mb-4">
        <div id={READER_ID} className="w-full h-full" />

        {!scanning && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center animate-pulse-ring">
              <ScanLine className="w-10 h-10 text-on-primary" />
            </div>
            <button onClick={startScanner} className="md-filled-btn flex items-center gap-2">
              <Camera className="w-5 h-5" />
              {t('scanStartCamera')}
            </button>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container">
            <div className="w-10 h-10 border-4 border-outline-variant border-t-primary rounded-full animate-spin-slow" />
            <p className="text-on-surface-variant text-sm">{t('scanLoading')}</p>
          </div>
        )}

        {scanning && (
          <>
            {/* Scan overlay frame */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-8 rounded-2xl border-2 border-white/70" />
              <div className="absolute left-8 right-8 h-0.5 bg-primary scan-line-anim" style={{ boxShadow: '0 0 12px var(--md-primary)' }} />
            </div>

            {/* Controls */}
            <div className="absolute top-3 start-3 flex gap-2">
              <button
                onClick={() => setContinuous(!continuous)}
                className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white"
              >
                {continuous ? <Repeat className="w-5 h-5" /> : <ScanLine className="w-5 h-5" />}
              </button>
            </div>
            <div className="absolute top-3 end-3">
              <button
                onClick={stopScanner}
                className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white"
              >
                <CameraOff className="w-5 h-5" />
              </button>
            </div>
            <div className="absolute bottom-3 inset-x-3 flex items-center justify-center gap-2">
              <button onClick={toggleFlash} className="w-11 h-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white">
                {flashOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
              </button>
              <button onClick={flipCamera} className="w-11 h-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white">
                <SwitchCamera className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 bg-black/50 backdrop-blur rounded-full px-3 py-1.5">
                <ZoomIn className="w-4 h-4 text-white" />
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={zoom}
                  onChange={(e) => applyZoom(parseFloat(e.target.value))}
                  className="w-20"
                />
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="w-12 h-12 text-error" />
            <p className="text-error text-sm font-medium">{error}</p>
            <button onClick={startScanner} className="md-tonal-btn">{t('actionRetry')}</button>
          </div>
        )}
      </div>

      {/* Gallery scan button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleGalleryScan(file);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="md-outlined-btn w-full flex items-center justify-center gap-2 mb-4"
      >
        <ImageIcon className="w-5 h-5" />
        {t('scanFromGallery')}
      </button>

      {/* Result */}
      {result && (
        <ScanResult
          result={result}
          isFavorite={!!isFavorite}
          onCopy={() => {
            copyToClipboard(result.rawValue);
            showToast(t('copied'));
          }}
          onShare={() => shareText(result.rawValue, t('actionShare'))}
          onFavorite={() => {
            const item = history.find((h) => h.rawValue === result.rawValue && h.source === 'scan');
            if (item) {
              toggleFavorite(item.id);
              showToast(isFavorite ? t('removedFromFav') : t('addedToFav'));
            }
          }}
          onClose={() => { setResult(null); if (continuous && !scanning) startScanner(); }}
          t={t}
          onViewDetails={openProductDetails}
        />
      )}
    </div>
  );
}

function ScanResult({
  result, isFavorite, onCopy, onShare, onFavorite, onClose, t, onViewDetails,
}: {
  result: DetectedQR;
  isFavorite: boolean;
  onCopy: () => void;
  onShare: () => void;
  onFavorite: () => void;
  onClose: () => void;
  t: (k: string) => string;
  onViewDetails?: (productData: import('../types').ProductData, rawValue: string) => void;
}) {
  const actionUrl = getActionUrl(result.type, result.data, result.rawValue);
  const iconName = TYPE_ICONS[result.type];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[iconName] ?? Icons.QrCode;

  const actionLabel = (() => {
    switch (result.type) {
      case 'url': return t('actionOpenUrl');
      case 'phone': return t('actionCall');
      case 'email': return t('actionEmail');
      case 'sms': return t('actionSms');
      case 'location': return t('actionOpenMaps');
      case 'whatsapp': return t('actionOpenWhatsapp');
      case 'telegram': return t('actionOpenTelegram');
      case 'facebook': return t('actionOpenFacebook');
      case 'instagram': return t('actionOpenInstagram');
      case 'twitter': return t('actionOpenTwitter');
      case 'youtube': return t('actionOpenYoutube');
      default: return null;
    }
  })();

  return (
    <div className="animate-slide-up md-card md-elevated-2 p-5 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-container flex items-center justify-center">
            <Icon className="w-6 h-6 text-on-primary-container" />
          </div>
          <div>
            <p className="text-xs text-primary font-semibold uppercase tracking-wide">{t(`type${result.type.charAt(0).toUpperCase() + result.type.slice(1)}`)}</p>
            <p className="text-sm text-on-surface-variant">{t('scanAutoDetected')}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-outline p-1 md-ripple rounded-full">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-surface-container rounded-2xl p-4 mb-4">
        <p className="text-on-surface text-sm font-medium break-all leading-relaxed">{result.rawValue}</p>
      </div>

      {result.productData && (
        <ProductPreview result={result} t={t} onViewDetails={onViewDetails} />
      )}

      <div className="flex flex-wrap gap-2">
        {actionUrl && actionLabel && (
          <a href={actionUrl} target="_blank" rel="noopener noreferrer" className="md-filled-btn flex items-center gap-2 no-underline">
            <ExternalLink className="w-4 h-4" />
            {actionLabel}
          </a>
        )}
        <button onClick={onCopy} className="md-tonal-btn flex items-center gap-2">
          <Copy className="w-4 h-4" />
          {t('actionCopy')}
        </button>
        <button onClick={onShare} className="md-tonal-btn flex items-center gap-2">
          <Share2 className="w-4 h-4" />
          {t('actionShare')}
        </button>
        <button onClick={onFavorite} className="md-tonal-btn flex items-center gap-2">
          <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current text-error' : ''}`} />
          {isFavorite ? t('actionRemoveFavorite') : t('actionSaveFavorite')}
        </button>
      </div>
    </div>
  );
}

function ProductPreview({ result, t, onViewDetails }: { result: DetectedQR; t: (k: string) => string; onViewDetails?: (productData: import('../types').ProductData, rawValue: string) => void }) {
  const p = result.productData!;
  return (
    <div className="bg-tertiary-container rounded-2xl p-4 mb-4">
      <p className="font-bold text-on-tertiary-container mb-2">{p.productName}</p>
      <div className="flex items-baseline gap-1 mb-3">
        <span className="text-xl font-bold text-on-tertiary-container">{p.price}</span>
        <span className="text-sm text-on-tertiary-container opacity-70">{p.currency}</span>
      </div>
      {p.customFields.length > 0 && (
        <div className="space-y-1">
          {p.customFields.slice(0, 4).map((f) => (
            <div key={f.id} className="flex justify-between text-xs text-on-tertiary-container">
              <span className="opacity-70">{f.name}</span>
              <span className="font-medium">{f.value}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-on-tertiary-container opacity-60 mt-2">{t('typeProduct')}</p>
      {onViewDetails && (
        <button
          onClick={() => onViewDetails(p, result.rawValue)}
          className="mt-3 w-full bg-on-tertiary-container text-tertiary-container rounded-full py-2.5 text-sm font-semibold md-ripple"
        >
          {t('productDetailsTitle')}
        </button>
      )}
    </div>
  );
}
