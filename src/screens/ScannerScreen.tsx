import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft, Camera, ImageIcon, RotateCcw, Copy, ExternalLink, ScanLine,
  AlertTriangle, CheckCircle2, Flashlight, ZoomIn, ClipboardPaste, Loader2,
} from 'lucide-react';
import { useApp } from '../store';
import { showToast } from '../components/ui';

type Phase = 'idle' | 'processing' | 'scanning' | 'success' | 'not-found' | 'error';

/* ──────────────── المحرّك الأصلي (لا يحتاج أي باكيدج) ──────────────── */
const hasNative = typeof window !== 'undefined' && 'BarcodeDetector' in window;
const NativeDetector = hasNative
  ? new (window as any).BarcodeDetector({ formats: ['qr_code'] })
  : null;

/* ──────────────── jsQR كـ fallback اختياري ────────────────
   dynamic import + @vite-ignore ⇒ Rollup يتجاهله وقت الـ build (مفيش فشل)،
   ولو الباكيدج مش موجود runtime الـ catch يمسكه ونكمل بدونه. */
let jsQRPromise: Promise<any> | null = null;
function loadJsQR() {
  if (!jsQRPromise) {
    jsQRPromise = import(/* @vite-ignore */ 'jsqr')
      .then((m: any) => m?.default ?? m)
      .catch(() => null); // الباكيدج مش مركّب → null بهدوء
  }
  return jsQRPromise;
}

/** محاولة فكّ بـ jsQR من ImageData (لو اتحمّل) */
async function tryJsQR(data: ImageData): Promise<string | null> {
  const jsQR = await loadJsQR();
  if (typeof jsQR !== 'function') return null;
  const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
  return code ? code.data : null;
}

/** صورة مرفوعة: المحرّك الأصلي ياخد الـ File مباشرة (مفيش canvas يتلوّث/يتقري بدري) */
async function decodeFile(file: File): Promise<string | null> {
  if (NativeDetector) {
    try {
      const codes = await NativeDetector.detect(file);
      if (codes?.[0]?.rawValue) return codes[0].rawValue;
    } catch { /* fallthrough لـ jsQR */ }
  }
  // fallback: canvas بعد onload بأبعاد صحيحة
  return await new Promise<string | null>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      try {
        const MAX = 1800;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);                 // بعد onload → مفيش كانفاس فاضي
        const d = ctx.getImageData(0, 0, w, h);          // أبعاد الرسم الفعلية
        resolve(await tryJsQR(d));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image-load')); };
    img.src = url;
  });
}

/** مصدر حيّ (الكاميرا): canvas واحد ثابت معاد استخدامه */
const workCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : (null as any);
async function decodeSource(src: CanvasImageSource, w: number, h: number): Promise<string | null> {
  if (NativeDetector) {
    try {
      const codes = await NativeDetector.detect(src as any);
      if (codes?.[0]?.rawValue) return codes[0].rawValue;
    } catch { /* fallthrough */ }
  }
  workCanvas.width = w; workCanvas.height = h;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src as any, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return await tryJsQR(d);
}

function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1200; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.13);
  } catch { /* صامت */ }
}

// خلفية شبكية ثابتة (inline — مفيش keyframe، مفيش CSS مضاف)
const GRID_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
  backgroundSize: '22px 22px',
};

/* ──────────────── المكوّن ──────────────── */
export function ScannerScreen({ navigate }: { navigate: (s: string) => void }) {
  const { t, settings, addHistory } = useApp();

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [canTorch, setCanTorch] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef(0);
  const lastDecodedRef = useRef('');

  const revokePreview = () => { if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); } };

  /* ───── نتيجة موحّدة (تحترم الإعدادات) ───── */
  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null; busyRef.current = false;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null; setCameraOn(false);
    setTorch(false); setZoom(null); setZoomRange(null); setCanTorch(false);
  }, []);

  const commitResult = useCallback((value: string) => {
    stopCamera();
    setResult(value);
    setPhase('success');
    addHistory({
      type: /^https?:\/\//i.test(value) ? 'url' : 'text',
      title: value.length > 40 ? value.slice(0, 40) + '…' : value,
      rawValue: value,
      data: {},
      source: 'scan',
    });
    if (settings.vibration && navigator.vibrate) navigator.vibrate(60);
    if (settings.sound) beep();
    if (settings.autoOpenLinks && /^https?:\/\//i.test(value)) {
      setTimeout(() => window.open(value, '_blank', 'noopener'), 350);
    }
  }, [settings, addHistory, stopCamera]);

  /* ───── مسح صورة (ملف / لصق / إفلات) ───── */
  const handleImageFile = useCallback(async (file: File) => {
    revokePreview();
    setPreviewUrl(URL.createObjectURL(file));
    setPhase('processing');
    setResult(null);
    try {
      const data = await decodeFile(file);
      if (data) commitResult(data);
      else setPhase('not-found');
    } catch (err) {
      console.error('[scan] image failed', err);
      setPhase('error');
      showToast(t('error'));
    }
  }, [commitResult, previewUrl, t]);

  /* ───── الكاميرا ───── */
  const tick = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || busyRef.current) {
      rafRef.current = requestAnimationFrame(tick); return;
    }
    const now = performance.now();
    if (now - lastScanRef.current > 140) {
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        busyRef.current = true; lastScanRef.current = now;
        try {
          const data = await decodeSource(video, w, h);
          if (data && data !== lastDecodedRef.current) {
            lastDecodedRef.current = data; busyRef.current = false;
            commitResult(data); return;
          }
        } catch { /* تجاهل frame */ }
        busyRef.current = false;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [commitResult]);

  const reflectTrackCaps = (track: MediaStreamTrack) => {
    const caps = (track as any).getCapabilities?.() ?? {};
    setCanTorch(!!caps.torch);
    if (caps.zoom) { setZoomRange({ min: caps.zoom.min, max: caps.zoom.max }); setZoom(caps.zoom.min); }
  };

  const startCamera = useCallback(async () => {
    setCameraOn(true); setPhase('scanning'); revokePreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: settings.defaultCamera === 'user' ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      reflectTrackCaps(stream.getVideoTracks()[0]);
      const video = videoRef.current!;
      video.srcObject = stream; await video.play();
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error('[scan] camera failed', err);
      setCameraOn(false); setPhase('error'); showToast(t('scanCameraDenied'));
    }
  }, [settings.defaultCamera, tick, t]);

  const toggleTorch = async () => {
    const tr = streamRef.current?.getVideoTracks()[0]; if (!tr) return;
    const next = !torch;
    try { await (tr as any).applyConstraints({ advanced: [{ torch: next }] }); setTorch(next); } catch { /* */ }
  };
  const applyZoom = async (v: number) => {
    const tr = streamRef.current?.getVideoTracks()[0]; if (!tr) return;
    setZoom(v);
    try { await (tr as any).applyConstraints({ advanced: [{ zoom: v }] }); } catch { /* */ }
  };

  useEffect(() => () => { stopCamera(); revokePreview(); }, [stopCamera]);

  /* ───── لصق من الحافظة ───── */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items; if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); handleImageFile(f); return; } }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleImageFile]);

  const reset = () => { stopCamera(); setResult(null); revokePreview(); lastDecodedRef.current = ''; setPhase('idle'); };
  const openLink = () => result && window.open(result, '_blank', 'noopener');
  const copyValue = () => { if (result) { navigator.clipboard?.writeText(result); showToast(t('copied')); } };

  const live = phase === 'scanning' || phase === 'processing';
  const engineLabel = hasNative ? t('scanEngineNative') : t('scanEngineJs');

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
        </button>
        <h1 className="text-xl font-bold text-on-surface tracking-tight">{t('scanTitle')}</h1>
        <span className="ms-auto text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/70">
          {engineLabel}
        </span>
      </div>

      {/* Viewfinder */}
      <div
        className="md-card md-elevated-2 relative overflow-hidden mb-4 aspect-square select-none"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith('image/')) handleImageFile(f); }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-tertiary/5 animate-pulse" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.06] text-on-surface" style={GRID_STYLE} />

        {cameraOn ? (
          <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        ) : previewUrl ? (
          <img src={previewUrl} alt="" className="absolute inset-0 w-full h-full object-contain bg-black/90" />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-surface-container">
            <ScanLine className="w-16 h-16 text-outline/30" />
          </div>
        )}

        {/* إطار المسح: زوايا نابضة + حلقة ping + خط bounce (Tailwind core) */}
        {live && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="relative w-2/3 h-2/3">
              <span className="absolute inset-0 rounded-2xl border-2 border-primary/25 animate-ping" />
              <Corner className="top-0 start-0 border-t-4 border-s-4" />
              <Corner className="top-0 end-0 border-t-4 border-e-4" />
              <Corner className="bottom-0 start-0 border-b-4 border-s-4" />
              <Corner className="bottom-0 end-0 border-b-4 border-e-4" />
              <span className="absolute start-0 end-0 top-1/2 h-0.5 bg-primary shadow-[0_0_14px_var(--md-primary)] animate-bounce" />
            </div>
          </div>
        )}

        {phase === 'processing' && (
          <div className="absolute inset-0 grid place-items-center bg-black/35 backdrop-blur-[2px] animate-fade-in">
            <div className="flex items-center gap-2 text-white text-sm font-semibold">
              <Loader2 className="w-5 h-5 animate-spin" /> {t('scanProcessing')}
            </div>
          </div>
        )}

        {cameraOn && canTorch && (
          <div className="absolute top-3 inset-x-0 flex justify-center gap-2 z-10">
            <button onClick={toggleTorch} aria-label="torch"
              className={`md-ripple grid place-items-center w-10 h-10 rounded-full transition-colors ${torch ? 'bg-primary text-on-primary' : 'bg-black/45 text-white backdrop-blur'}`}>
              <Flashlight className="w-5 h-5" />
            </button>
          </div>
        )}

        {phase === 'not-found' && (
          <StateOverlay tone="error" icon={<AlertTriangle className="w-9 h-9" />}>
            <p className="text-error font-semibold text-center px-6">{t('scanNotFound')}</p>
          </StateOverlay>
        )}
        {phase === 'success' && result && (
          <StateOverlay tone="success" icon={<CheckCircle2 className="w-9 h-9" />}>
            <p className="text-on-surface font-semibold text-sm text-center break-all px-4 line-clamp-3">{result}</p>
            <div className="flex flex-wrap gap-2 justify-center mt-3">
              {/^https?:\/\//i.test(result) && (
                <button onClick={openLink} className="md-filled-btn flex items-center gap-2 text-sm">
                  <ExternalLink className="w-4 h-4" /> {t('scanOpen')}
                </button>
              )}
              <button onClick={copyValue} className="md-tonal-btn flex items-center gap-2 text-sm">
                <Copy className="w-4 h-4" /> {t('actionCopy')}
              </button>
            </div>
          </StateOverlay>
        )}
      </div>

      {cameraOn && zoomRange && (
        <div className="flex items-center gap-3 mb-3 px-1 animate-slide-up">
          <ZoomIn className="w-4 h-4 text-on-surface-variant shrink-0" />
          <input type="range" min={zoomRange.min} max={zoomRange.max} step={(zoomRange.max - zoomRange.min) / 100 || 0.1}
            value={zoom ?? zoomRange.min} onChange={(e) => applyZoom(parseFloat(e.target.value))} className="w-full accent-[var(--md-primary)]" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <button onClick={() => (cameraOn ? stopCamera() : startCamera())}
          className="md-filled-btn flex items-center justify-center gap-2 py-3.5">
          {cameraOn ? (<><span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" /> {t('scanStop')}</>)
                    : (<><Camera className="w-5 h-5" /> {t('scanCamera')}</>)}
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="md-tonal-btn flex items-center justify-center gap-2 py-3.5">
          <ImageIcon className="w-5 h-5" /> {t('scanFromImage')}
        </button>
      </div>

      {(phase === 'not-found' || phase === 'error') && (
        <button onClick={reset} className="md-outlined-btn w-full flex items-center justify-center gap-2 animate-slide-up">
          <RotateCcw className="w-4 h-4" /> {t('scanRetry')}
        </button>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />

      <p className="text-center text-xs text-on-surface-variant mt-4 flex items-center justify-center gap-1.5">
        <ClipboardPaste className="w-3.5 h-3.5" /> {t('scanPasteHint')}
      </p>
    </div>
  );
}

/* ─── مساعدات بصرية ─── */
function Corner({ className }: { className: string }) {
  return <span className={`absolute w-7 h-7 rounded-md border-primary animate-pulse ${className}`} />;
}
function StateOverlay({ tone, icon, children }: {
  tone: 'error' | 'success'; icon: React.ReactNode; children: React.ReactNode;
}) {
  const ring = tone === 'error' ? 'bg-error-container/30 text-error' : 'bg-success-container/30 text-success';
  const motion = tone === 'error' ? 'animate-pulse' : 'animate-bounce';
  return (
    <div className="absolute inset-0 grid place-items-center bg-surface/80 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col items-center gap-3 max-w-[85%]">
        <div className={`w-20 h-20 rounded-full grid place-items-center ${ring} ${motion}`}>{icon}</div>
        {children}
      </div>
    </div>
  );
}
