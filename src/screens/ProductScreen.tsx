import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft, Plus, Trash2, QrCode as QrIcon, Download, Share2, Printer, Heart,
  Copy, Package, X, Save,
} from 'lucide-react';
import { useApp } from '../store';
import { encodeProductQR, defaultStyle } from '../lib/qr';
import { renderQRToCanvas, exportPNG, exportSVG, exportPDF, shareQR, printQR, copyToClipboard, shareText } from '../lib/qrRender';
import { showToast } from '../components/ui';
import type { CustomField, ProductData, QRStyleOptions } from '../types';

const CURRENCIES = ['USD', 'EUR', 'SAR', 'AED', 'EGP', 'GBP', 'JPY', 'CNY', 'TRY', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'MAD', 'DZD', 'TND', 'LYD'];

export function ProductScreen({ navigate }: { navigate: (s: string) => void }) {
  const { t, addHistory, toggleFavorite, history } = useApp();
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [style, setStyle] = useState<QRStyleOptions>(defaultStyle());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  const productData: ProductData = {
    productName,
    price,
    currency,
    customFields,
    createdAt: new Date().toISOString(),
  };

  const qrString = productName || price ? encodeProductQR(productData) : '';

  useEffect(() => {
    if (canvasRef.current && qrString) {
      renderQRToCanvas(canvasRef.current, qrString, style);
    }
  }, [qrString, style, customFields, productName, price, currency]);

  const addCustomField = () => {
    setCustomFields([...customFields, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: '', value: '' }]);
  };

  const updateField = (id: string, key: 'name' | 'value', val: string) => {
    setCustomFields(customFields.map((f) => (f.id === id ? { ...f, [key]: val } : f)));
  };

  const removeField = (id: string) => {
    setCustomFields(customFields.filter((f) => f.id !== id));
  };

  const handleGenerate = useCallback(() => {
    if (!qrString) return;
    const item = addHistory({
      type: 'product',
      title: productName || 'Product',
      rawValue: qrString,
      data: { productName, productString: qrString },
      productData,
      source: 'generate',
    });
    setSavedItemId(item.id);
    showToast(t('productSaved'));
  }, [qrString, productName, addHistory, productData, t]);

  const isFavorite = savedItemId ? history.find((h) => h.id === savedItemId)?.isFavorite : false;
  const filename = `product-qr-${Date.now()}`;

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('productTitle')}</h1>
      </div>

      {/* Required fields */}
      <div className="md-card md-elevated p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-on-surface">{t('fieldProductName')}</h2>
        </div>
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder={t('fieldProductName')}
          className="md-field mb-3"
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{t('fieldPrice')}</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              type="text"
              inputMode="decimal"
              className="md-field"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">{t('fieldCurrency')}</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="md-field">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Custom fields */}
      <div className="md-card md-elevated p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-on-surface text-sm">{t('addCustomField')}</h2>
          <button onClick={addCustomField} className="md-tonal-btn flex items-center gap-1.5 py-2 px-3 text-sm">
            <Plus className="w-4 h-4" />
            {t('actionAdd')}
          </button>
        </div>

        {customFields.length === 0 ? (
          <p className="text-on-surface-variant text-xs text-center py-4">{t('noCustomFields')}</p>
        ) : (
          <div className="space-y-3">
            {customFields.map((field, idx) => (
              <div key={field.id} className="flex gap-2 items-start animate-slide-up">
                <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold shrink-0 mt-1">
                  {idx + 1}
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <input
                    value={field.name}
                    onChange={(e) => updateField(field.id, 'name', e.target.value)}
                    placeholder={t('customFieldName')}
                    className="md-field py-2.5 text-sm"
                  />
                  <input
                    value={field.value}
                    onChange={(e) => updateField(field.id, 'value', e.target.value)}
                    placeholder={t('customFieldValue')}
                    className="md-field py-2.5 text-sm"
                  />
                </div>
                <button onClick={() => removeField(field.id)} className="text-error p-2 md-ripple rounded-full shrink-0 mt-0.5">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      {qrString ? (
        <div className="md-card md-elevated-2 p-5 mb-4 flex flex-col items-center animate-scale-in">
          <p className="text-sm font-semibold text-on-surface-variant mb-3">{t('qrPreview')}</p>
          <div className="rounded-2xl overflow-hidden bg-white p-2">
            <canvas ref={canvasRef} width={style.size} height={style.size} className="max-w-full" />
          </div>
          <p className="font-semibold text-on-surface mt-3">{productName}</p>
          <p className="text-lg font-bold text-primary">{price} {currency}</p>
        </div>
      ) : (
        <div className="md-card p-6 mb-4 text-center text-on-surface-variant text-sm">
          {t('productEmpty')}
        </div>
      )}

      {/* Actions */}
      {qrString && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={handleGenerate} className="md-filled-btn flex items-center gap-2">
            <Save className="w-4 h-4" />
            {t('actionSave')}
          </button>
          <button onClick={() => exportPNG(qrString, style, filename)} className="md-tonal-btn flex items-center gap-2">
            <Download className="w-4 h-4" />
            {t('genExportPng')}
          </button>
          <button onClick={() => exportSVG(qrString, style, filename)} className="md-tonal-btn flex items-center gap-2">
            <Download className="w-4 h-4" />
            {t('genExportSvg')}
          </button>
          <button onClick={() => exportPDF(qrString, style, filename, productName)} className="md-tonal-btn flex items-center gap-2">
            <Download className="w-4 h-4" />
            {t('genExportPdf')}
          </button>
          <button onClick={() => printQR(qrString, style, productName)} className="md-tonal-btn flex items-center gap-2">
            <Printer className="w-4 h-4" />
            {t('actionPrintQr')}
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
      )}
    </div>
  );
}

export function ProductDetailsScreen({ productData, rawValue, navigate }: { productData: ProductData; rawValue: string; navigate: (s: string) => void }) {
  const { t, toggleFavorite, history } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [style] = useState<QRStyleOptions>(defaultStyle());

  useEffect(() => {
    if (canvasRef.current && rawValue) {
      renderQRToCanvas(canvasRef.current, rawValue, style);
    }
  }, [rawValue, style]);

  const historyItem = history.find((h) => h.rawValue === rawValue);
  const isFavorite = historyItem?.isFavorite ?? false;

  const buildInfoText = () => {
    const lines = [`${t('fieldProductName')}: ${productData.productName}`, `${t('fieldPrice')}: ${productData.price} ${productData.currency}`];
    productData.customFields.forEach((f) => { if (f.name) lines.push(`${f.name}: ${f.value}`); });
    const d = new Date(productData.createdAt);
    lines.push(`${t('createdAt')}: ${d.toLocaleDateString()}`);
    return lines.join('\n');
  };

  const filename = `product-${productData.productName || 'qr'}`;

  return (
    <div className="animate-fade-in px-4 pt-2 pb-28 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4 mt-2">
        <button onClick={() => navigate('home')} className="text-on-surface p-1 md-ripple rounded-full">
          <ChevronLeft className="w-6 h-6 rtl:rotate-180" />
        </button>
        <h1 className="text-xl font-bold text-on-surface">{t('productDetailsTitle')}</h1>
      </div>

      {/* Header card */}
      <div className="md-card md-elevated-2 p-6 mb-4 text-center animate-scale-in">
        <div className="w-14 h-14 rounded-2xl bg-primary-container flex items-center justify-center mx-auto mb-3">
          <Package className="w-7 h-7 text-on-primary-container" />
        </div>
        <h2 className="text-xl font-extrabold text-on-surface">{productData.productName}</h2>
        <div className="flex items-baseline justify-center gap-1 mt-1">
          <span className="text-2xl font-bold text-primary">{productData.price}</span>
          <span className="text-sm text-on-surface-variant">{productData.currency}</span>
        </div>
      </div>

      {/* Custom fields */}
      {productData.customFields.length > 0 && (
        <div className="md-card md-elevated p-4 mb-4">
          <h3 className="font-semibold text-on-surface text-sm mb-3">{t('addCustomField')}</h3>
          <div className="space-y-2">
            {productData.customFields.map((f) => (
              <div key={f.id} className="flex justify-between items-center bg-surface-container rounded-xl px-3 py-2.5">
                <span className="text-xs text-on-surface-variant font-medium">{f.name}</span>
                <span className="text-sm text-on-surface font-semibold">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="md-card p-4 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-sm text-on-surface-variant">{t('createdAt')}</span>
          <span className="text-sm text-on-surface font-medium">
            {new Date(productData.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* QR Preview */}
      <div className="md-card md-elevated p-5 mb-4 flex flex-col items-center">
        <p className="text-sm font-semibold text-on-surface-variant mb-3">{t('qrPreview')}</p>
        <div className="rounded-2xl overflow-hidden bg-white p-2">
          <canvas ref={canvasRef} width={style.size} height={style.size} className="max-w-full" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { copyToClipboard(buildInfoText()); showToast(t('copied')); }}
          className="md-filled-btn flex items-center gap-2"
        >
          <Copy className="w-4 h-4" />
          {t('actionCopyInfo')}
        </button>
        <button onClick={() => shareText(buildInfoText(), productData.productName)} className="md-tonal-btn flex items-center gap-2">
          <Share2 className="w-4 h-4" />
          {t('actionShareInfo')}
        </button>
        <button onClick={() => shareQR(rawValue, style, filename)} className="md-tonal-btn flex items-center gap-2">
          <Share2 className="w-4 h-4" />
          {t('actionShareQr')}
        </button>
        <button onClick={() => printQR(rawValue, style, productData.productName)} className="md-tonal-btn flex items-center gap-2">
          <Printer className="w-4 h-4" />
          {t('actionPrintQr')}
        </button>
        {historyItem && (
          <button
            onClick={() => { toggleFavorite(historyItem.id); showToast(isFavorite ? t('removedFromFav') : t('addedToFav')); }}
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
