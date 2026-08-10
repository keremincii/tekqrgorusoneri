import './globals.css';
import { headers } from 'next/headers';
import { hosttanSlug } from '@/lib/server/host.js';
import { tenantSlugIle } from '@/lib/server/tenant.js';

/**
 * Sayfa başlığı/açıklaması PER-TENANT: subdomain'den (Host) belediye adı çözülür.
 * Eskiden build-time global bir sabitti → tüm belediyelerin sekmesinde AYNI ad
 * görünürdü; artık her belediye kendi adını gösterir (çözülemezse genel başlık).
 *
 * BAŞLIKTA "ŞİKAYET" GEÇMEZ ve bu bilinçlidir: bu üründe vatandaş şikayetin yanı sıra
 * GÖRÜŞ ve ÖNERİ de gönderir. Sekmede "Şikayet Sistemi" yazması, öneri yazmaya gelen
 * vatandaşa "burası yalnız şikayet yeri" izlenimi verir ve fiilen caydırır.
 *
 * Not: /manifest.json burada ÜRETİLMEZ — `public/manifest.json` STATİK bir dosyadır;
 * içindeki ad belediyeye duyarlı DEĞİLDİR. Duyarlı olması gerekirse dosyanın dinamik
 * bir `app/manifest.js` route'una taşınması gerekir.
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
    title: ad ? `${ad} — Görüş ve Öneri Sistemi` : 'Belediye Görüş ve Öneri Sistemi',
    description: ad
      ? `${ad} vatandaş şikayet, görüş ve öneri sistemi.`
      : 'Belediye vatandaş şikayet, görüş ve öneri sistemi.',
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
