import type { QRType, QRStyleOptions, ProductData } from '../types';

export interface DetectedQR {
  type: QRType;
  rawValue: string;
  data: Record<string, unknown>;
  productData?: ProductData;
}

const PRODUCT_PREFIX = 'QRSTUDIO_PRODUCT:';

export function isProductQR(raw: string): boolean {
  return raw.startsWith(PRODUCT_PREFIX);
}

export function encodeProductQR(data: ProductData): string {
  return PRODUCT_PREFIX + JSON.stringify(data);
}

export function decodeProductQR(raw: string): ProductData | undefined {
  try {
    return JSON.parse(raw.slice(PRODUCT_PREFIX.length));
  } catch {
    return undefined;
  }
}

export function detectQRType(raw: string): DetectedQR {
  const value = raw.trim();
  if (!value) return { type: 'custom', rawValue: raw, data: {} };

  // Product QR
  if (isProductQR(value)) {
    const productData = decodeProductQR(value);
    if (productData) {
      return { type: 'product', rawValue: raw, data: {}, productData };
    }
  }

  // URL
  if (/^https?:\/\//i.test(value) || /^www\./i.test(value)) {
    return { type: 'url', rawValue: value, data: { url: value.startsWith('http') ? value : `https://${value}` } };
  }

  // WhatsApp
  if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)/i.test(value) || value.startsWith('whatsapp:')) {
    const m = value.match(/(\+?\d{6,15})/);
    const msgM = value.match(/[?&]text=([^&]+)/);
    return {
      type: 'whatsapp',
      rawValue: value,
      data: {
        phone: m?.[1] ?? '',
        message: msgM ? decodeURIComponent(msgM[1]) : '',
      },
    };
  }

  // Telegram
  if (/^https?:\/\/t\.me\//i.test(value) || value.startsWith('tg:')) {
    const u = value.match(/t\.me\/([^?\/\s]+)/i);
    return { type: 'telegram', rawValue: value, data: { username: u?.[1] ?? '' } };
  }

  // Facebook
  if (/^https?:\/\/(www\.)?facebook\.com\//i.test(value) || value.startsWith('fb:')) {
    return { type: 'facebook', rawValue: value, data: { url: value } };
  }

  // Instagram
  if (/^https?:\/\/(www\.)?instagram\.com\//i.test(value)) {
    const u = value.match(/instagram\.com\/([^?\/\s]+)/i);
    return { type: 'instagram', rawValue: value, data: { username: u?.[1] ?? '' } };
  }

  // Twitter / X
  if (/^https?:\/\/(www\.)?(twitter|x)\.com\//i.test(value)) {
    const u = value.match(/(?:twitter|x)\.com\/([^?\/\s]+)/i);
    return { type: 'twitter', rawValue: value, data: { username: u?.[1] ?? '' } };
  }

  // YouTube
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(value)) {
    return { type: 'youtube', rawValue: value, data: { url: value } };
  }

  // Email
  if (value.startsWith('mailto:')) {
    const email = value.slice(7).split('?')[0];
    const subj = value.match(/[?&]subject=([^&]+)/);
    const body = value.match(/[?&]body=([^&]+)/);
    return {
      type: 'email',
      rawValue: value,
      data: { email, subject: subj ? decodeURIComponent(subj[1]) : '', body: body ? decodeURIComponent(body[1]) : '' },
    };
  }
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(value)) {
    return { type: 'email', rawValue: value, data: { email: value } };
  }

  // SMS
  if (value.startsWith('sms:') || value.startsWith('smsto:')) {
    const parts = value.replace(/^smsto?:/i, '').split('?');
    const phone = parts[0];
    const msgM = parts[1]?.match(/body=([^&]+)/);
    return {
      type: 'sms',
      rawValue: value,
      data: { phone, message: msgM ? decodeURIComponent(msgM[1]) : '' },
    };
  }

  // Phone
  if (value.startsWith('tel:')) {
    return { type: 'phone', rawValue: value, data: { phone: value.slice(4) } };
  }
  if (/^\+?[\d\s\-()]{7,}$/.test(value) && !value.includes('\n')) {
    return { type: 'phone', rawValue: value, data: { phone: value } };
  }

  // Wi-Fi
  if (value.startsWith('WIFI:')) {
    const ssidM = value.match(/S:([^;]*)/);
    const passM = value.match(/P:([^;]*)/);
    const encM = value.match(/T:([^;]*)/);
    const hiddenM = value.match(/H:true/);
    return {
      type: 'wifi',
      rawValue: value,
      data: {
        ssid: ssidM?.[1] ?? '',
        password: passM?.[1] ?? '',
        encryption: encM?.[1] ?? 'WPA',
        hidden: !!hiddenM,
      },
    };
  }

  // vCard
  if (value.startsWith('BEGIN:VCARD')) {
    const nameM = value.match(/FN:([^\r\n]+)/);
    const phoneM = value.match(/TEL[^:]*:([^\r\n]+)/);
    const emailM = value.match(/EMAIL[^:]*:([^\r\n]+)/);
    const orgM = value.match(/ORG:([^\r\n]+)/);
    const titleM = value.match(/TITLE:([^\r\n]+)/);
    const addrM = value.match(/ADR[^:]*:([^\r\n]+)/);
    const urlM = value.match(/URL:([^\r\n]+)/);
    return {
      type: 'vcard',
      rawValue: value,
      data: {
        name: nameM?.[1] ?? '',
        phone: phoneM?.[1] ?? '',
        email: emailM?.[1] ?? '',
        org: orgM?.[1] ?? '',
        title: titleM?.[1] ?? '',
        address: addrM?.[1] ?? '',
        url: urlM?.[1] ?? '',
      },
    };
  }

  // Location
  if (value.startsWith('geo:')) {
    const m = value.match(/geo:([\d.-]+),([\d.-]+)/);
    return { type: 'location', rawValue: value, data: { lat: m?.[1] ?? '', lng: m?.[2] ?? '' } };
  }
  const gmapsM = value.match(/maps\?q=([\d.-]+),([\d.-]+)/);
  if (gmapsM) {
    return { type: 'location', rawValue: value, data: { lat: gmapsM[1], lng: gmapsM[2] } };
  }

  return { type: 'text', rawValue: value, data: { text: value } };
}

export function buildQRString(type: QRType, data: Record<string, unknown>): string {
  switch (type) {
    case 'url': {
      const url = String(data.url ?? '');
      return url.startsWith('http') ? url : `https://${url}`;
    }
    case 'text':
      return String(data.text ?? '');
    case 'phone':
      return `tel:${data.phone ?? ''}`;
    case 'email': {
      const email = String(data.email ?? '');
      const params: string[] = [];
      if (data.subject) params.push(`subject=${encodeURIComponent(String(data.subject))}`);
      if (data.body) params.push(`body=${encodeURIComponent(String(data.body))}`);
      return params.length ? `mailto:${email}?${params.join('&')}` : `mailto:${email}`;
    }
    case 'sms': {
      const phone = String(data.phone ?? '');
      const msg = String(data.message ?? '');
      return msg ? `sms:${phone}?body=${encodeURIComponent(msg)}` : `sms:${phone}`;
    }
    case 'vcard': {
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${data.name ?? ''}`,
        data.phone ? `TEL:${data.phone}` : '',
        data.email ? `EMAIL:${data.email}` : '',
        data.org ? `ORG:${data.org}` : '',
        data.title ? `TITLE:${data.title}` : '',
        data.address ? `ADR:;;${data.address};;;;` : '',
        data.url ? `URL:${data.url}` : '',
        'END:VCARD',
      ].filter(Boolean).join('\n');
    }
    case 'wifi': {
      const enc = String(data.encryption ?? 'WPA');
      const hidden = data.hidden ? 'H:true;' : '';
      return `WIFI:T:${enc};S:${data.ssid ?? ''};P:${data.password ?? ''};${hidden};`;
    }
    case 'location': {
      if (data.query) return `https://www.google.com/maps?q=${encodeURIComponent(String(data.query))}`;
      return `geo:${data.lat ?? ''},${data.lng ?? ''}`;
    }
    case 'whatsapp': {
      const phone = String(data.phone ?? '').replace(/\D/g, '');
      const msg = String(data.message ?? '');
      return msg ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/${phone}`;
    }
    case 'telegram':
      return `https://t.me/${data.username ?? ''}`;
    case 'facebook':
      return String(data.url ?? '');
    case 'instagram':
      return `https://instagram.com/${data.username ?? ''}`;
    case 'twitter':
      return `https://x.com/${data.username ?? ''}`;
    case 'youtube':
      return String(data.url ?? '');
    case 'product':
      return String(data.productString ?? '');
    case 'custom':
      return String(data.custom ?? '');
    default:
      return '';
  }
}

export function getQRTitle(type: QRType, data: Record<string, unknown>, rawValue: string): string {
  switch (type) {
    case 'url':
      return String(data.url ?? rawValue).replace(/^https?:\/\//, '').slice(0, 50);
    case 'text':
      return String(data.text ?? rawValue).slice(0, 60);
    case 'phone':
      return String(data.phone ?? '');
    case 'email':
      return String(data.email ?? '');
    case 'sms':
      return String(data.phone ?? '');
    case 'vcard':
      return String(data.name ?? 'Contact');
    case 'wifi':
      return String(data.ssid ?? 'Wi-Fi');
    case 'location':
      return `${data.lat ?? ''}, ${data.lng ?? ''}`;
    case 'whatsapp':
      return String(data.phone ?? '');
    case 'telegram':
      return `@${data.username ?? ''}`;
    case 'facebook':
      return String(data.url ?? '').replace(/^https?:\/\/(www\.)?facebook\.com\//, '').slice(0, 50);
    case 'instagram':
      return `@${data.username ?? ''}`;
    case 'twitter':
      return `@${data.username ?? ''}`;
    case 'youtube':
      return String(data.url ?? '').replace(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//, '').slice(0, 50);
    case 'product':
      return String(data.productName ?? 'Product');
    case 'custom':
      return rawValue.slice(0, 60);
    default:
      return rawValue.slice(0, 60);
  }
}

export function getActionUrl(type: QRType, data: Record<string, unknown>, rawValue: string): string | undefined {
  switch (type) {
    case 'url':
      return String(data.url ?? rawValue);
    case 'phone':
      return `tel:${data.phone ?? ''}`;
    case 'email':
      return rawValue.startsWith('mailto:') ? rawValue : `mailto:${data.email ?? ''}`;
    case 'sms':
      return rawValue.startsWith('sms:') ? rawValue : `sms:${data.phone ?? ''}`;
    case 'wifi':
      return undefined;
    case 'location':
      return `https://www.google.com/maps?q=${data.lat ?? ''},${data.lng ?? ''}`;
    case 'whatsapp':
      return rawValue.startsWith('http') ? rawValue : `https://wa.me/${String(data.phone ?? '').replace(/\D/g, '')}`;
    case 'telegram':
      return rawValue.startsWith('http') ? rawValue : `https://t.me/${data.username ?? ''}`;
    case 'facebook':
      return String(data.url ?? rawValue);
    case 'instagram':
      return `https://instagram.com/${data.username ?? ''}`;
    case 'twitter':
      return `https://x.com/${data.username ?? ''}`;
    case 'youtube':
      return String(data.url ?? rawValue);
    default:
      return undefined;
  }
}

export const QR_TYPES: QRType[] = [
  'url', 'text', 'phone', 'email', 'sms', 'vcard', 'wifi', 'location',
  'whatsapp', 'telegram', 'facebook', 'instagram', 'twitter', 'youtube', 'custom',
];

export const TYPE_ICONS: Record<QRType, string> = {
  url: 'Globe',
  text: 'Type',
  phone: 'Phone',
  email: 'Mail',
  sms: 'MessageSquare',
  vcard: 'Contact',
  wifi: 'Wifi',
  location: 'MapPin',
  whatsapp: 'MessageCircle',
  telegram: 'Send',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'Twitter',
  youtube: 'Youtube',
  product: 'Package',
  custom: 'QrCode',
};

export function defaultStyle(): QRStyleOptions {
  return {
    fgColor: '#006c4c',
    bgColor: '#ffffff',
    margin: 2,
    rounded: false,
    size: 320,
    logoDataUrl: undefined,
  };
}
