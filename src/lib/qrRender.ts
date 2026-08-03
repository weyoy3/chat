import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import type { QRStyleOptions } from '../types';

export async function renderQRToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  opts: QRStyleOptions,
): Promise<void> {
  if (!text) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    return;
  }

  await QRCode.toCanvas(canvas, text, {
    width: opts.size,
    margin: opts.margin,
    color: {
      dark: opts.fgColor,
      light: opts.bgColor,
    },
    errorCorrectionLevel: opts.logoDataUrl ? 'H' : 'M',
  });

  if (opts.rounded) {
    roundCanvasCorners(canvas);
  }

  if (opts.logoDataUrl) {
    await drawLogo(canvas, opts.logoDataUrl, opts.size);
  }
}

function roundCanvasCorners(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const radius = width * 0.08;
  const imgData = ctx.getImageData(0, 0, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(width, 0, width, height, radius);
  ctx.arcTo(width, height, 0, height, radius);
  ctx.arcTo(0, height, 0, 0, radius);
  ctx.arcTo(0, 0, width, 0, radius);
  ctx.closePath();
  ctx.clip();
  ctx.putImageData(imgData, 0, 0);
  ctx.restore();
}

async function drawLogo(canvas: HTMLCanvasElement, logoUrl: string, size: number) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve();
      const logoSize = size * 0.22;
      const x = (size - logoSize) / 2;
      const y = (size - logoSize) / 2;
      const pad = logoSize * 0.12;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      const r = 12;
      ctx.roundRect(x - pad, y - pad, logoSize + pad * 2, logoSize + pad * 2, r);
      ctx.fill();
      ctx.drawImage(img, x, y, logoSize, logoSize);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = logoUrl;
  });
}

export async function renderQRToDataURL(text: string, opts: QRStyleOptions): Promise<string> {
  const canvas = document.createElement('canvas');
  await renderQRToCanvas(canvas, text, opts);
  return canvas.toDataURL('image/png');
}

export async function exportPNG(text: string, opts: QRStyleOptions, filename: string) {
  const dataUrl = await renderQRToDataURL(text, opts);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${filename}.png`;
  link.click();
}

export async function exportSVG(text: string, opts: QRStyleOptions, filename: string) {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: opts.margin,
    color: {
      dark: opts.fgColor,
      light: opts.bgColor,
    },
    errorCorrectionLevel: opts.logoDataUrl ? 'H' : 'M',
  });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.svg`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportPDF(text: string, opts: QRStyleOptions, filename: string, label?: string) {
  const dataUrl = await renderQRToDataURL(text, opts);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const qrSize = 120;
  const x = (pageWidth - qrSize) / 2;
  const y = pageHeight / 2 - qrSize / 2 - 10;
  pdf.addImage(dataUrl, 'PNG', x, y, qrSize, qrSize);
  if (label) {
    pdf.setFontSize(16);
    pdf.text(label, pageWidth / 2, y + qrSize + 15, { align: 'center' });
  }
  pdf.save(`${filename}.pdf`);
}

export async function printQR(text: string, opts: QRStyleOptions, label?: string) {
  const dataUrl = await renderQRToDataURL(text, opts);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`
    <html><head><title>Print QR</title>
    <style>
      body { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif; }
      img { width: 350px; height: 350px; }
      p { margin-top: 16px; font-size: 18px; font-weight: 600; }
    </style></head><body>
    <img src="${dataUrl}" />
    ${label ? `<p>${label}</p>` : ''}
    <script>window.onload=function(){window.print();}</script>
    </body></html>
  `);
  win.document.close();
}

export async function shareQR(text: string, opts: QRStyleOptions, filename: string) {
  const dataUrl = await renderQRToDataURL(text, opts);
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], `${filename}.png`, { type: 'image/png' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
  } else {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${filename}.png`;
    link.click();
  }
}

export async function shareText(text: string, title?: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text, title });
    } catch {
      // user cancelled
    }
  } else {
    await copyToClipboard(text);
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // ignore
  }
}

export function vibrate(ms = 100) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    // ignore
  }
}
