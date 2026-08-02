import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  Camera, CameraOff, Image as ImageIcon, Zap, ZapOff, SwitchCamera, ZoomIn,
  Repeat, ScanLine, ChevronLeft, ExternalLink, Copy, Share2, Heart, X, Check,
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
  
  // --- تعديل: إضافة حالات للصورة المختارة من المعرض ---
  const [selectedImageSrc, setSelectedImageSrc] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  // --------------------------------------------------

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
    // --- تعديل: مسح الصورة عند بدء الكاميرا ---
    setSelectedImageSrc(null);
    setImageFile(null);
    // -----------------------------------------
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

  // --- تعديل: دالة جديدة لاختيار الصورة وعرضها فقط ---
  const handleGallerySelect = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    // تخزين الملف للعرض والفحص لاحقاً
    setImageFile(file);
    // إنشاء URL لعرض الصورة فوراً
    const imageUrl = URL.createObjectURL(file);
    setSelectedImageSrc(imageUrl);
    // إيقاف الكاميرا الحية
    await stopScanner();
  }, [stopScanner]);
  // --------------------------------------------------

  // --- تعديل: دالة جديدة لفحص الصورة المختارة فعلياً عند الضغط على الزر ---
  const executeImageScan = async () => {
    if (!imageFile || !imageRef.current) return;
    setLoading(true);
    setError(null);
    try {
      // استخدام الطريقة الساكنة للمكتبة لفحص الملف
      const text = await Html5Qrcode.scanFile(imageFile, false);
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
      setLoading(false);
    } catch {
      setLoading(false);
      setError(t('scanNoResult'));
      showToast(t('scanNoResult'));
    }
  };
  // ---------------------------------------------------------------------

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

        {/* --- تعديل: عرض الصورة المختارة من المعرض داخل الإطار مع زر الفحص وزر الإغلاق --- */}
        {selectedImageSrc && (
          <div className="absolute inset-
