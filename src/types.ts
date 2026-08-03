export type QRType =
  | 'url'
  | 'text'
  | 'phone'
  | 'email'
  | 'sms'
  | 'vcard'
  | 'wifi'
  | 'location'
  | 'whatsapp'
  | 'telegram'
  | 'facebook'
  | 'instagram'
  | 'twitter'
  | 'youtube'
  | 'product'
  | 'custom';

export type Lang = 'en' | 'ar';
export type ThemeMode = 'light' | 'dark';

export interface CustomField {
  id: string;
  name: string;
  value: string;
}

export interface ProductData {
  productName: string;
  price: string;
  currency: string;
  customFields: CustomField[];
  createdAt: string;
}

export interface HistoryItem {
  id: string;
  type: QRType;
  title: string;
  rawValue: string;
  data: Record<string, unknown>;
  productData?: ProductData;
  createdAt: number;
  isFavorite: boolean;
  source: 'scan' | 'generate';
}

export interface AppSettings {
  lang: Lang;
  theme: ThemeMode;
  autoOpenLinks: boolean;
  sound: boolean;
  vibration: boolean;
  defaultCamera: 'environment' | 'user';
}

export interface QRStyleOptions {
  fgColor: string;
  bgColor: string;
  margin: number;
  rounded: boolean;
  size: number;
  logoDataUrl?: string;
}
