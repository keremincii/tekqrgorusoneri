/* eslint-disable react/prop-types */
import './globals.css';
import { headers } from 'next/headers';
import { hosttanSlug } from '@/lib/server/host.js';
import { tenantSlugIle } from '@/lib/server/tenant.js';

/**
 * Sayfa başlığı/açıklaması PER-TENANT: subdomain'den (Host) belediye adı çözülür.
 * Eskiden build-time global siteConfig.belediyeAdi idi → tüm belediyelerin sekmesinde
 * AYNI ad görünürdü; artık her belediye kendi adını gösterir (çözülemezse genel başlık).
 *
 * BAŞLIKTAKİ "Şikayet" KELİMESİ TENANT BAYRAĞINA BAĞLIDIR:
 * Tür seçimi AÇIK bir belediyede vatandaş teşekkür/öneri de gönderebilir; tarayıcı
 * sekmesinde ve PWA paylaşımında "Şikayet Sistemi" yazması o vatandaşa fiilen yanlış
 * bilgi verir ("burası yalnız şikayet yeri" izlenimi) — ölçülebilir biçimde teşekkür
 * göndermekten caydırır. Bayrak KAPALIYKEN (Gülşehir — canlı) başlık HARFİ HARFİNE
 * eskisi gibi kalır; hiçbir metin değişmez.
 *
 * Not: /manifest.json burada ÜRETİLMEZ — `public/manifest.json` STATİK bir dosyadır ve
 * içindeki name/short_name/description sabit ("Gülşehir Şikayet") olduğu için belediyeye
 * duyarlı DEĞİLDİR; yani PWA olarak eklenen kısayolun adı her belediyede aynı görünür.
 * Düzeltilmesi için dosyanın dinamik bir `app/manifest.js` route'una taşınması gerekir.
 */
export async function generateMetadata() {
  let ad = null;
  try {
    const h = await headers();
    const slug = hosttanSlug(h.get('host'));
    const tenant = slug ? await tenantSlugIle(slug) : null;
    ad = tenant?.ad || null;
  } catch { /* Host çözülemedi → genel başlık */ }

  return {
    title: ad ? `${ad} - Şikayet Sistemi` : 'Belediye Şikayet Sistemi',
    description: ad
      ? `${ad} vatandaş şikayet takip ve yönetim sistemi.`
      : 'Belediye vatandaş şikayet takip ve yönetim sistemi.',
    manifest: '/manifest.json',
  };
}

// Next.js 16: viewport ve themeColor artık metadata yerine ayrı viewport export'unda.
export const viewport = {
  themeColor: '#0a0e1a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
