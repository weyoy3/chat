import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera, CameraOff, Image as ImageIcon, Zap, ZapOff, SwitchCamera, ZoomIn,
  Repeat, ScanLine, ChevronLeft, ExternalLink, Copy, Share2, Heart, X, Cpu, Loader2, ClipboardList,
  Plus, Minus, Maximize2, Check, Scan,
} from 'lucide-react';
import { useApp } from '../store';
import { detectQRType, getActionUrl, getQRTitle, TYPE_ICONS } from '../lib/qr';
import { playBeep, vibrate, copyToClipboard, shareText } from '../lib/qrRender';
import { showToast } from '../components/ui';
import * as Icons from 'lucide-react';
import type { DetectedQR } from '../lib/qr';
import type { ProductData } from '../types';

/* ---------- Native BarcodeDetector ---------- */

interface DetectedCode { rawValue: string }
interface DetectorInstance {
  detect: (source: Blob | ImageBitmap | HTMLVideoElement | HTMLCanvasElement) => Promise<DetectedCode[]>;
}

function createDetector(): DetectorInstance | null {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  try {
    const Ctor = (window as unknown as {
      BarcodeDetector: new (opts?: { formats: string[] }) => DetectorInstance;
    }).BarcodeDetector;
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

const detector = createDetector();
const engineLabel = detector ? 'scanEngineNative' : 'scanEngineJs';

/* ---------- Lazy jsQR loader (bundlable, no @vite-ignore) ---------- */

type JsQRFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { inversionAttempts: string },
) => { data: string } | null;

let jsQRPromise: Promise<JsQRFn | null> | null = null;

function loadJsQR(): Promise<JsQRFn | null> {
  if (jsQRPromise) return jsQRPromise;
  jsQRPromise = import('jsqr')
    .then((m) => {
      const fn = (m as { default?: JsQRFn }).default ?? (m as unknown as JsQRFn);
      return typeof fn === 'function' ? fn : null;
    })
    .catch(() => null);
  return jsQRPromise;
}

/* ---------- Diagnostic report (real strings, never raw keys) ---------- */

type Report = string[];

/* ---------- Preprocessing: grayscale + contrast stretch ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function preprocess(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new ImageData(1, 1);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = clamp(((d[i] - lo) / span) * 255, 0, 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/* ---------- Decode attempts ---------- */

const tryNative = async (source: HTMLCanvasElement | ImageBitmap | HTMLVideoElement): Promise<string | null> => {
  if (!detector) return null;
  try {
    const codes = await detector.detect(source);
    return codes?.[0]?.rawValue ?? null;
  } catch {
    return null;
  }
};

const tryJsQR = async (d: ImageData): Promise<string | null> => {
  const fn = await loadJsQR();
  if (typeof fn !== 'function') return null;
  const result = fn(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
  return result ? result.data : null;
};

/* ---------- Decode MATRIX: first non-null wins ---------- */

async function decodeCanvas(canvas: HTMLCanvasElement, r: Report): Promise<string | null> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const raw = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let v = await tryNative(canvas);
  r.push(`native(canvas) → ${v ? 'HIT' : '0'}`);
  if (v) return v;

  const bmp = await createImageBitmap(canvas).catch(() => null);
  if (bmp) {
    v = await tryNative(bmp);
    r.push(`native(bitmap) → ${v ? 'HIT' : '0'}`);
    bmp.close?.();
    if (v) return v;
  }

  v = await tryJsQR(raw);
  r.push(`jsQR(raw) → ${v ? 'HIT' : 'null'}`);
  if (v) return v;

  const pre = preprocess(canvas);
  r.push(`preprocess: grayscale+contrast @ ${canvas.width}×${canvas.height}`);
  v = await tryJsQR(pre);
  r.push(`jsQR(preprocessed) → ${v ? 'HIT' : 'null'}`);
  return v;
}

/* ---------- Camera frame decoder (native first, jsQR fallback) ---------- */

async function decodeVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const maxSide = 1000;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (detector) {
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0 && codes[0].rawValue) return codes[0].rawValue;
    } catch { /* fall through */ }
  }

  const jsQR = await loadJsQR();
  if (!jsQR) return null;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return result?.data ?? null;
}

/* ---------- Whole-file decoder (matrix applied) ---------- */

async function decodeFile(file: File, r: Report): Promise<string | null> {
  r.push(`📄 ${file.type || 'unknown'} · ${(file.size / 1024).toFixed(0)} KB`);

  return new Promise<string | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      r.push(`whole image → ${canvas.width}×${canvas.height}`);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      decodeCanvas(canvas, r).then(resolve);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/* ---------- Crop + upscale ---------- */

interface WRect { x: number; y: number; w: number; h: number }

function cropUpscale(img: HTMLImageElement, src: WRect): HTMLCanvasElement {
  const MIN = 700, MAXL = 2000;
  let ow = src.w, oh = src.h;
  const m = Math.min(ow, oh);
  if (m < MIN) { const f = MIN / m; ow *= f; oh *= f; }
  const L = Math.max(ow, oh);
  if (L > MAXL) { const f = MAXL / L; ow *= f; oh *= f; }
  ow = Math.round(Math.max(1, ow));
  oh = Math.round(Math.max(1, oh));
  const c = document.createElement('canvas');
  c.width = ow;
  c.height = oh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, ow, oh);
  }
  return c;
}

/* ---------- Types ---------- */

type Phase = 'idle' | 'loading' | 'cropping' | 'processing' | 'scanning' | 'success' | 'not-found' | 'error';

/* ---------- Component ---------- */

export function ScannerScreen({
  navigate,
  openProductDetails,
}: {
  navigate: (s: string) => void;
  openProductDetails?: (p: ProductData, r: string) => void;
}) {
  const { t, dir, settings, addHistory, toggleFavorite, history } = useApp();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const busyRef = useRef(false);
  const lastValueRef = useRef('');
  const lastTimeRef = useRef(0);
  const thumbUrlRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const continuousRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  settingsRef.current = settings;

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<DetectedQR | null>(null);
  const [continuous, setContinuous] = useState(true);
  const [flashOn, setFlashOn] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>(settings.defaultCamera);
  const [zoom, setZoom] = useState(1);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [diagReport, setDiagReport] = useState<Report | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cropImg, setCropImg] = useState<HTMLImageElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  continuousRef.current = continuous;

  /* ----- Camera control ----- */

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    busyRef.current = false;
  }, []);

  const commitResult = useCallback(
    (rawValue: string) => {
      stopCamera();
      const detected = detectQRType(rawValue);
      setResult(detected);
      setPhase('success');

      const s = settingsRef.current;
      if (s.sound) playBeep();
      if (s.vibration) vibrate(60);

      addHistory({
        type: detected.type,
        title: getQRTitle(detected.type, detected.data, detected.rawValue),
        rawValue: detected.rawValue,
        data: detected.data,
        productData: detected.productData,
        source: 'scan',
      });

      if (s.autoOpenLinks) {
        const url = getActionUrl(detected.type, detected.data, detected.rawValue);
        if (detected.type === 'url' && url) {
          if (autoOpenTimerRef.current) clearTimeout(autoOpenTimerRef.current);
          autoOpenTimerRef.current = setTimeout(() => window.open(url, '_blank', 'noopener'), 350);
        }
      }
    },
    [addHistory, stopCamera],
  );

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const now = performance.now();
    if (now - lastFrameRef.current < 150) return;
    if (busyRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    lastFrameRef.current = now;
    busyRef.current = true;
    decodeVideoFrame(video, canvas)
      .then((text) => {
        busyRef.current = false;
        if (text) {
          const ts = Date.now();
          if (ts - lastTimeRef.current < 2000 && text === lastValueRef.current) return;
          lastTimeRef.current = ts;
          lastValueRef.current = text;
          commitResult(text);
          if (!continuousRef.current) stopCamera();
        }
      })
      .catch(() => { busyRef.current = false; });
  }, [commitResult, stopCamera]);

  const startCamera = useCallback(
    async (face?: 'environment' | 'user') => {
      const f = face ?? facing;
      setPhase('loading');
      setResult(null);
      setDiagReport(null);
      stopCamera();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: f },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase('scanning');
        setFlashOn(false);
        setZoom(1);
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        setPhase('error');
      }
    },
    [facing, stopCamera, loop],
  );

  const handleStop = useCallback(() => {
    stopCamera();
    setPhase('idle');
  }, [stopCamera]);

  const flipCamera = useCallback(() => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    startCamera(next);
  }, [facing, startCamera]);

  const toggleFlash = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities() as unknown as { torch?: boolean };
      if (caps.torch) {
        const next = !flashOn;
        await track.applyConstraints({
          advanced: [{ torch: next }] as unknown as MediaTrackConstraintSet[],
        });
        setFlashOn(next);
      }
    } catch { /* ignore */ }
  }, [flashOn]);

  const applyZoom = useCallback(async (z: number) => {
    setZoom(z);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities() as unknown as { zoom?: { min: number; max: number } };
      if (caps.zoom) {
        await track.applyConstraints({
          advanced: [{ zoom: z }] as unknown as MediaTrackConstraintSet[],
        });
      }
    } catch { /* ignore */ }
  }, []);

  /* ----- File scan → enter cropping ----- */

  const handleFileScan = useCallback(
    (file: File) => {
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
      const url = URL.createObjectURL(file);
      thumbUrlRef.current = url;
      setThumbUrl(url);
      setResult(null);
      setDiagReport(null);
      setCropFile(file);

      const im = new Image();
      im.onload = () => {
        setCropImg(im);
        setPhase('cropping');
      };
      im.onerror = () => {
        URL.revokeObjectURL(url);
        thumbUrlRef.current = null;
        setThumbUrl(null);
        setPhase('error');
        showToast(t('error'));
      };
      im.src = url;
    },
    [t],
  );

  /* ----- Crop confirm → matrix decode ----- */

  const onCropConfirm = useCallback(
    async (src: WRect) => {
      if (!cropImg) return;
      setPhase('processing');
      const canvas = cropUpscale(cropImg, src);
      const r: Report = [
        `crop → natural ${src.x | 0},${src.y | 0} ${src.w | 0}×${src.h | 0} → upscaled ${canvas.width}×${canvas.height}`,
      ];
      try {
        const data = await decodeCanvas(canvas, r);
        if (data) {
          r.push(`✅ ${data.length > 80 ? data.slice(0, 80) + '…' : data}`);
          setDiagReport(r);
          commitResult(data);
        } else {
          setDiagReport(r);
          setPhase('cropping');
          showToast(t('scanCropEnlarge'));
        }
      } catch {
        setDiagReport(r);
        setPhase('cropping');
        showToast(t('scanCropEnlarge'));
      }
    },
    [cropImg, commitResult, t],
  );

  /* ----- Whole image fallback ----- */

  const onCropWhole = useCallback(async () => {
    if (!cropFile) return;
    setPhase('processing');
    const r: Report = [];
    const text = await decodeFile(cropFile, r);
    if (text) {
      r.push(`✅ ${text.length > 80 ? text.slice(0, 80) + '…' : text}`);
      setDiagReport(r);
      commitResult(text);
    } else {
      setDiagReport(r);
      setPhase('not-found');
    }
  }, [cropFile, commitResult]);

  const resetToIdle = useCallback(() => {
    if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    thumbUrlRef.current = null;
    setThumbUrl(null);
    setCropImg(null);
    setCropFile(null);
    setResult(null);
    setDiagReport(null);
    setPhase('idle');
  }, []);

  /* ----- Paste support ----- */

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            handleFileScan(file);
            e.preventDefault();
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFileScan]);

  /* ----- Cleanup on unmount ----- */

  useEffect(() => {
    return () => {
      stopCamera();
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
      if (autoOpenTimerRef.current) clearTimeout(autoOpenTimerRef.current);
    };
  }, [stopCamera]);

  const isFavorite = result
    ? history.find((h) => h.rawValue === result.rawValue && h.source === 'scan')?.isFavorite
    : false;

  const closeResult = () => {
    setResult(null);
    setDiagReport(null);
    if (phase === 'success' && continuous) startCamera();
  };

  /* ----- Drag and drop ----- */

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) handleFileScan(file);
    },
    [handleFileScan],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const copyReport = useCallback(() => {
    if (!diagReport) return;
    copyToClipboard(diagReport.join('\n'));
    showToast(t('copied'));
  }, [diagReport, t]);

  /* ===== Render ===== */

  // Cropping = full-screen overlay; normal UI hidden entirely
  if (phase === 'cropping' && thumbUrl && cropImg) {
    return (
      <CropOverlay
        previewUrl={thumbUrl}
        imgEl={cropImg}
        t={t}
        onConfirm={onCropConfirm}
        onWhole={onCropWhole}
        onCancel={resetToIdle}
      />
    );
  }

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className={`w-6 h-6 ${dir === 'rtl' ? 'rotate-180' : ''}`} />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('scanTitle')}</h1>
        <span className="ms-auto flex items-center gap-1.5 text-xs text-on-surface-variant bg-surface-container px-2.5 py-1 rounded-full">
          <Cpu className="w-3.5 h-3.5" />
          {t(engineLabel)}
        </span>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileScan(file);
          e.target.value = '';
        }}
      />

      {/* Persistent offscreen canvas for camera decoding */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Viewfinder card */}
      <div
        className={`relative rounded-3xl overflow-hidden bg-surface-container md-elevated aspect-square mb-4 ${dragOver ? 'ring-4 ring-primary' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Video (always mounted so ref is stable) */}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className={`w-full h-full object-cover ${phase === 'scanning' ? '' : 'hidden'}`}
        />

        {/* Scanning overlay */}
        {phase === 'scanning' && (
          <>
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-8 rounded-2xl border-2 border-white/70" />
              <div
                className="absolute left-8 right-8 h-0.5 bg-primary"
                style={{ boxShadow: '0 0 12px var(--md-primary)', animation: 'scan-line 2s ease-in-out infinite' }}
              />
            </div>
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
                onClick={handleStop}
                className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white"
              >
                <CameraOff className="w-5 h-5" />
              </button>
            </div>
            <div className="absolute bottom-3 inset-x-3 flex items-center justify-center gap-2">
              <button
                onClick={toggleFlash}
                className="w-11 h-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white"
              >
                {flashOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
              </button>
              <button
                onClick={flipCamera}
                className="w-11 h-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white"
              >
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

        {/* Idle — neutral prompt, never failure copy */}
        {phase === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center animate-pulse">
              <ScanLine className="w-10 h-10 text-on-primary" />
            </div>
            <p className="text-on-surface-variant text-sm">{t('scanIdlePrompt')}</p>
          </div>
        )}

        {/* Loading */}
        {phase === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-on-surface-variant text-sm">{t('scanLoading')}</p>
          </div>
        )}

        {/* Processing */}
        {phase === 'processing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            {thumbUrl && (
              <img src={thumbUrl} alt="processing" className="absolute inset-0 w-full h-full object-cover opacity-50" />
            )}
            <div className="relative z-10 flex flex-col items-center gap-3 bg-black/30 backdrop-blur-sm rounded-2xl px-6 py-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-white text-sm font-medium">{t('scanProcessing')}</p>
            </div>
          </div>
        )}

        {/* Success */}
        {phase === 'success' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container/80">
            <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center animate-scale-in">
              <ScanLine className="w-8 h-8 text-on-primary" />
            </div>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="w-12 h-12 text-error" />
            <p className="text-error text-sm font-medium">{t('scanCameraDenied')}</p>
          </div>
        )}

        {/* Not found — only after a real finished attempt */}
        {phase === 'not-found' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <ScanLine className="w-12 h-12 text-outline" />
            <p className="text-on-surface-variant text-sm font-medium">{t('scanNotFound')}</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 mb-3">
        {phase === 'idle' && (
          <>
            <button onClick={() => startCamera()} className="md-filled-btn flex items-center justify-center gap-2">
              <Camera className="w-5 h-5" />
              {t('scanCamera')}
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="md-outlined-btn flex items-center justify-center gap-2">
              <ImageIcon className="w-5 h-5" />
              {t('scanFromImage')}
            </button>
          </>
        )}

        {phase === 'scanning' && (
          <>
            <button onClick={handleStop} className="md-tonal-btn flex items-center justify-center gap-2">
              <CameraOff className="w-5 h-5" />
              {t('scanStop')}
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="md-outlined-btn flex items-center justify-center gap-2">
              <ImageIcon className="w-5 h-5" />
              {t('scanFromImage')}
            </button>
          </>
        )}

        {phase === 'processing' && (
          <p className="text-center text-on-surface-variant text-sm py-2">{t('scanProcessing')}</p>
        )}

        {phase === 'success' && (
          <button onClick={closeResult} className="md-filled-btn flex items-center justify-center gap-2">
            <ScanLine className="w-5 h-5" />
            {t('scanCamera')}
          </button>
        )}

        {(phase === 'error' || phase === 'not-found') && (
          <>
            <button onClick={() => startCamera()} className="md-filled-btn flex items-center justify-center gap-2">
              <Camera className="w-5 h-5" />
              {t('scanRetry')}
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="md-outlined-btn flex items-center justify-center gap-2">
              <ImageIcon className="w-5 h-5" />
              {t('scanFromImage')}
            </button>
          </>
        )}
      </div>

      {/* Paste hint */}
      {phase === 'idle' && (
        <p className="text-center text-outline text-xs mb-4">{t('scanPasteHint')}</p>
      )}

      {/* Diagnostic report — real lines, never raw keys */}
      {diagReport && (
        <div className="animate-slide-up md-card md-elevated p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-on-surface flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" />
              {t('scanReportTitle')}
            </span>
            <button onClick={copyReport} className="md-tonal-btn flex items-center gap-1.5 text-xs px-3 py-1.5">
              <Copy className="w-3.5 h-3.5" />
              {t('scanReportCopy')}
            </button>
          </div>
          <div className="space-y-1">
            {diagReport.map((line, i) => (
              <p key={i} className="text-xs text-on-surface-variant font-mono break-all leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Result card */}
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
          onClose={closeResult}
          t={t}
          onViewDetails={openProductDetails}
        />
      )}
    </div>
  );
}

/* ---------- Scan result card ---------- */

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
  onViewDetails?: (p: ProductData, r: string) => void;
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
            <p className="text-xs text-primary font-semibold uppercase tracking-wide">
              {t(`type${result.type.charAt(0).toUpperCase() + result.type.slice(1)}`)}
            </p>
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

      {result.productData && <ProductPreview result={result} t={t} onViewDetails={onViewDetails} />}

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

/* ---------- Product preview ---------- */

function ProductPreview({
  result, t, onViewDetails,
}: {
  result: DetectedQR;
  t: (k: string) => string;
  onViewDetails?: (p: ProductData, r: string) => void;
}) {
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

/* ================================================================
   PART B — CINEMATIC CROP-TO-SCAN OVERLAY
   Full-screen, zoom/pan world, pinch-zoom, magnifier loupe,
   44px handles, L-corners, thin primary outline + glow.
   ================================================================ */

interface View { z: number; px: number; py: number }

function fit(CW: number, CH: number, iw: number, ih: number) {
  const s0 = Math.min(CW / iw, CH / ih);
  const RW = iw * s0, RH = ih * s0;
  return { s0, RW, RH, OX: (CW - RW) / 2, OY: (CH - RH) / 2 };
}

const s2w = (sx: number, sy: number, v: View) => ({ x: (sx - v.px) / v.z, y: (sy - v.py) / v.z });
const w2s = (wx: number, wy: number, v: View) => ({ x: wx * v.z + v.px, y: wy * v.z + v.py });

function w2n(b: WRect, CW: number, CH: number, iw: number, ih: number): WRect {
  const { s0, OX, OY } = fit(CW, CH, iw, ih);
  return { x: (b.x - OX) / s0, y: (b.y - OY) / s0, w: b.w / s0, h: b.h / s0 };
}

function clampBox(b: WRect, CW: number, CH: number, iw: number, ih: number, min = 48): WRect {
  const { OX, OY, RW, RH } = fit(CW, CH, iw, ih);
  let { x, y, w, h } = b;
  w = clamp(w, min, RW);
  h = clamp(h, min, RH);
  x = clamp(x, OX, OX + RW - w);
  y = clamp(y, OY, OY + RH - h);
  return { x, y, w, h };
}

function clampPan(v: View, CW: number, CH: number, iw: number, ih: number): View {
  if (v.z <= 1.001) return { z: 1, px: 0, py: 0 };
  const { OX, OY, RW, RH } = fit(CW, CH, iw, ih);
  const minPx = CW - (OX + RW) * v.z, maxPx = -OX * v.z;
  const minPy = CH - (OY + RH) * v.z, maxPy = -OY * v.z;
  return {
    z: v.z,
    px: clamp(v.px, Math.min(minPx, maxPx), Math.max(minPx, maxPx)),
    py: clamp(v.py, Math.min(minPy, maxPy), Math.max(minPy, maxPy)),
  };
}

function CropOverlay({
  previewUrl, imgEl, t, onConfirm, onWhole, onCancel,
}: {
  previewUrl: string;
  imgEl: HTMLImageElement;
  t: (k: string) => string;
  onConfirm: (n: WRect) => void;
  onWhole: () => void;
  onCancel: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const iw = imgEl.naturalWidth;
  const ih = imgEl.naturalHeight;

  const [dims, setDims] = useState({ CW: 0, CH: 0 });
  const [box, setBox] = useState<WRect | null>(null);
  const [view, setView] = useState<View>({ z: 1, px: 0, py: 0 });
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);

  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const drag = useRef<null | {
    mode: string;
    p0: { x: number; y: number };
    box0: WRect;
    view0: View;
    dist0: number;
    wMid0: { x: number; y: number };
  }>(null);

  const rect = () => stageRef.current!.getBoundingClientRect();
  const rel = (e: { clientX: number; clientY: number }) => {
    const r = rect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Measure stage with ResizeObserver
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setDims({ CW: el.clientWidth, CH: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initialize box to 76% of image
  useEffect(() => {
    if (!dims.CW) return;
    const { OX, OY, RW, RH } = fit(dims.CW, dims.CH, iw, ih);
    const p = 0.12;
    setBox({ x: OX + RW * p, y: OY + RH * p, w: RW * (1 - 2 * p), h: RH * (1 - 2 * p) });
  }, [dims.CW, dims.CH, iw, ih]);

  // Magnifier loupe drawing
  const drawLoupe = useCallback(
    (pt: { x: number; y: number }) => {
      const cv = loupeRef.current;
      if (!cv || !dims.CW) return;
      const w = s2w(pt.x, pt.y, view);
      const n = w2n({ x: w.x, y: w.y, w: 0, h: 0 }, dims.CW, dims.CH, iw, ih);
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const S = cv.width, Z = 2.8;
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, S, S);
      const src = S / Z;
      ctx.drawImage(imgEl, n.x - src / 2, n.y - src / 2, src, src, 0, 0, S, S);
      ctx.restore();
      // crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(S / 2 - 9, S / 2);
      ctx.lineTo(S / 2 + 9, S / 2);
      ctx.moveTo(S / 2, S / 2 - 9);
      ctx.lineTo(S / 2, S / 2 + 9);
      ctx.stroke();
    },
    [view, dims, iw, ih, imgEl],
  );

  const startDrag = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, rel(e));
    if (!box) return;
    if (mode !== 'pan') navigator.vibrate?.(8);
    drag.current = { mode, p0: rel(e), box0: { ...box }, view0: { ...view }, dist0: 0, wMid0: { x: 0, y: 0 } };
    if (mode !== 'pan' && mode !== 'move') setLoupe(rel(e));
  };

  const onBgDown = (e: React.PointerEvent) => {
    ptrs.current.set(e.pointerId, rel(e));
    if (ptrs.current.size === 1 && box) {
      drag.current = { mode: 'pan', p0: rel(e), box0: { ...box }, view0: { ...view }, dist0: 0, wMid0: { x: 0, y: 0 } };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dims.CW || !box) return;
    ptrs.current.set(e.pointerId, rel(e));
    const pts = [...ptrs.current.values()];

    // Pinch zoom with 2 pointers
    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = drag.current;
      if (d?.mode !== 'pinch') {
        drag.current = { mode: 'pinch', p0: mid, box0: box, view0: { ...view }, dist0: dist, wMid0: s2w(mid.x, mid.y, view) };
        return;
      }
      const z = clamp(d.view0.z * (dist / d.dist0), 1, 6);
      setView(clampPan({ z, px: mid.x - d.wMid0.x * z, py: mid.y - d.wMid0.y * z }, dims.CW, dims.CH, iw, ih));
      return;
    }

    const d = drag.current;
    if (!d || d.mode === 'pinch') return;
    const cur = rel(e), dx = cur.x - d.p0.x, dy = cur.y - d.p0.y;

    if (d.mode === 'pan') {
      setView(clampPan({ z: d.view0.z, px: d.view0.px + dx, py: d.view0.py + dy }, dims.CW, dims.CH, iw, ih));
      return;
    }

    if (d.mode === 'move') {
      setBox(clampBox({ x: d.box0.x + dx / view.z, y: d.box0.y + dy / view.z, w: d.box0.w, h: d.box0.h }, dims.CW, dims.CH, iw, ih));
      setLoupe(cur);
      return;
    }

    // Resize handles
    const ddx = dx / view.z, ddy = dy / view.z;
    let { x, y, w, h } = d.box0;
    if (d.mode.includes('e')) w = d.box0.w + ddx;
    if (d.mode.includes('s')) h = d.box0.h + ddy;
    if (d.mode.includes('w')) { x = d.box0.x + ddx; w = d.box0.w - ddx; }
    if (d.mode.includes('n')) { y = d.box0.y + ddy; h = d.box0.h - ddy; }
    setBox(clampBox({ x, y, w, h }, dims.CW, dims.CH, iw, ih, 48));
    setLoupe(cur);
  };

  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2 && drag.current?.mode === 'pinch') drag.current = null;
    if (ptrs.current.size === 0) {
      drag.current = null;
      setLoupe(null);
    }
  };

  const zoomBy = (f: number) => {
    if (!dims.CW) return;
    const mid = { x: dims.CW / 2, y: dims.CH / 2 };
    const wm = s2w(mid.x, mid.y, view);
    const z = clamp(view.z * f, 1, 6);
    setView(clampPan({ z, px: mid.x - wm.x * z, py: mid.y - wm.y * z }, dims.CW, dims.CH, iw, ih));
  };

  const resetView = () => setView({ z: 1, px: 0, py: 0 });

  const confirm = () => {
    if (!box || !dims.CW) return;
    navigator.vibrate?.(12);
    onConfirm(w2n(box, dims.CW, dims.CH, iw, ih));
  };

  // Screen-space box coords
  const sb = box ? w2s(box.x, box.y, view) : null;
  const sw = box ? box.w * view.z : 0;
  const sh = box ? box.h * view.z : 0;

  const handles: { h: string; x: number; y: number; cur: string }[] = sb ? [
    { h: 'nw', x: sb.x, y: sb.y, cur: 'nwse-resize' },
    { h: 'ne', x: sb.x + sw, y: sb.y, cur: 'nesw-resize' },
    { h: 'sw', x: sb.x, y: sb.y + sh, cur: 'nesw-resize' },
    { h: 'se', x: sb.x + sw, y: sb.y + sh, cur: 'nwse-resize' },
    { h: 'n', x: sb.x + sw / 2, y: sb.y, cur: 'ns-resize' },
    { h: 's', x: sb.x + sw / 2, y: sb.y + sh, cur: 'ns-resize' },
    { h: 'w', x: sb.x, y: sb.y + sh / 2, cur: 'ew-resize' },
    { h: 'e', x: sb.x + sw, y: sb.y + sh / 2, cur: 'ew-resize' },
  ] : [];

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-[100] bg-black/95 overflow-hidden select-none animate-fade-in"
      style={{ touchAction: 'none' }}
      onPointerDown={onBgDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* Image — world layer with zoom/pan transform */}
      <img
        src={previewUrl}
        alt=""
        draggable={false}
        className="absolute pointer-events-none"
        style={{
          left: 0,
          top: 0,
          width: dims.CW,
          height: dims.CH,
          objectFit: 'contain',
          transform: `translate(${view.px}px, ${view.py}px) scale(${view.z})`,
          transformOrigin: '0 0',
        }}
      />

      {/* Top-center hint pill */}
      <div className="absolute top-0 inset-x-0 flex justify-center pt-4 px-4 pointer-events-none">
        <div className="flex items-center gap-2 text-white/90 text-[13px] font-semibold bg-black/45 rounded-full px-4 py-2 backdrop-blur animate-fade-in">
          {t('scanCropHint')}
        </div>
      </div>

      {/* Zoom controls — top-end vertical stack */}
      <div className="absolute top-4 end-4 flex flex-col gap-2 z-20">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => zoomBy(1.4)}
          className="md-ripple grid place-items-center w-11 h-11 rounded-full bg-black/50 text-white backdrop-blur active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => zoomBy(1 / 1.4)}
          className="md-ripple grid place-items-center w-11 h-11 rounded-full bg-black/50 text-white backdrop-blur active:scale-95 transition-transform"
        >
          <Minus className="w-5 h-5" />
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={resetView}
          className="md-ripple grid place-items-center w-11 h-11 rounded-full bg-black/50 text-white backdrop-blur active:scale-95 transition-transform"
        >
          <Maximize2 className="w-5 h-5" />
        </button>
        <span className="text-center text-[10px] font-bold text-white/80 tabular-nums">
          {Math.round(view.z * 100)}%
        </span>
      </div>

      {/* Selection box — dim outside + thin primary outline + glow + rule-of-thirds grid */}
      {sb && (
        <div
          onPointerDown={startDrag('move')}
          className="absolute rounded-[3px] animate-scale-in"
          style={{
            left: sb.x,
            top: sb.y,
            width: sw,
            height: sh,
            cursor: 'move',
            touchAction: 'none',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.70), 0 0 0 2px var(--md-primary, #00805a), 0 0 22px rgba(0,128,90,0.55)',
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.32) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.32) 1px, transparent 1px)',
            backgroundSize: '33.33% 33.33%',
          }}
        >
          {/* L-corner brackets — physical left/right, not affected by RTL */}
          <span className="absolute pointer-events-none animate-pulse" style={{ left: -4, top: -4, width: 22, height: 22, borderLeft: '3px solid #fff', borderTop: '3px solid #fff', borderRadius: '3px 0 0 0' }} />
          <span className="absolute pointer-events-none animate-pulse" style={{ right: -4, top: -4, width: 22, height: 22, borderRight: '3px solid #fff', borderTop: '3px solid #fff', borderRadius: '0 3px 0 0' }} />
          <span className="absolute pointer-events-none animate-pulse" style={{ left: -4, bottom: -4, width: 22, height: 22, borderLeft: '3px solid #fff', borderBottom: '3px solid #fff', borderRadius: '0 0 0 3px' }} />
          <span className="absolute pointer-events-none animate-pulse" style={{ right: -4, bottom: -4, width: 22, height: 22, borderRight: '3px solid #fff', borderBottom: '3px solid #fff', borderRadius: '0 0 3px 0' }} />
        </div>
      )}

      {/* 8 handles — 44px hit area, 12px white dot + primary ring, constant screen size */}
      {handles.map(({ h, x, y, cur }) => (
        <div
          key={h}
          onPointerDown={startDrag(h)}
          className="absolute grid place-items-center rounded-full active:scale-150 transition-transform"
          style={{ left: x - 22, top: y - 22, width: 44, height: 44, cursor: cur, touchAction: 'none' }}
        >
          <span
            className="w-3 h-3 rounded-full bg-white"
            style={{ boxShadow: '0 0 0 2px var(--md-primary, #00805a), 0 2px 8px rgba(0,0,0,0.6)' }}
          />
        </div>
      ))}

      {/* Magnifier loupe — circular, above finger */}
      {loupe && (
        <canvas
          ref={loupeRef}
          width={132}
          height={132}
          className="absolute rounded-full border-2 border-white/85 shadow-2xl pointer-events-none z-30 animate-fade-in"
          style={{ left: loupe.x - 66, top: loupe.y - 172 }}
        />
      )}

      {/* Bottom toolbar — floating glass, three actions */}
      <div
        className="absolute bottom-0 inset-x-0 p-4 pb-7 animate-slide-up"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="rounded-3xl bg-black/55 backdrop-blur-xl p-2.5 flex flex-col gap-2 shadow-2xl ring-1 ring-white/10">
          <button
            onClick={confirm}
            disabled={!box}
            className="md-filled-btn w-full flex items-center justify-center gap-2 py-3.5 text-base font-bold active:scale-[0.98] transition-transform"
          >
            <Check className="w-5 h-5" />
            {t('scanCropConfirm')}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onWhole}
              className="md-tonal-btn flex items-center justify-center gap-2 py-3 active:scale-[0.98] transition-transform"
            >
              <Scan className="w-4 h-4" />
              {t('scanCropWhole')}
            </button>
            <button
              onClick={onCancel}
              className="md-outlined-btn flex items-center justify-center gap-2 py-3 active:scale-[0.98] transition-transform"
            >
              <X className="w-4 h-4" />
              {t('scanCropCancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
