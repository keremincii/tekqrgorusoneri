/**
 * QR Yönlendirici Adresleri (Single Source of Truth)
 * ===================================================
 *
 * SORUN: QR koda doğrudan form adresi (`https://gulsehir.<domain>/s/<id>?sig=<hmac>`)
 * basılırsa; o adresin İÇİNDEKİ her parça (subdomain, `/s/` yolu, imza şeması,
 * query adı) donar. Bunlardan biri ileride değişirse basılı 148 QR çöp olur.
 *
 * ÇÖZÜM: QR'a yalnızca SABİT ve aptal bir adres basarız:
 *
 *     https://qr.<domain>/q/<id>
 *
 * Bu adres hiçbir iş yapmaz; sadece sunucudaki yönlendiriciye (app/q/[id]) gider.
 * Gerçek form adresi o an sunucuda üretilir. Böylece form yolu, imza şeması, hatta
 * belediyenin subdomain'i değişse bile QR'lar AYNEN çalışmaya devam eder — tek
 * değişmemesi gereken şey `qr.<domain>` köküdür (zaten redirect'ten başka iş
 * yapmadığı için onu kapatmak için sebebin olmaz).
 *
 * Kök adres `QR_BASE_URL` ile elle verilebilir; verilmezse `APP_BASE_DOMAIN`'den
 * `https://qr.<domain>` türetilir. Geliştirmede (ikisi de yoksa) localhost'a düşer.
 *
 * İMZA (sig): Yönlendirici, forma eklenecek imzayı DB'deki `hmac_imza`'dan OKUMAZ;
 * her istekte ÇALIŞAN sunucunun HMAC_SECRET'ıyla CANLI hesaplar (imzaOlustur). Böylece
 * secret değişse/dönse bile imza daima doğrulayıcıyla (imzaDogrula) eşleşir → basılı
 * QR'lar kendini onarır; yeniden imzalama da yeniden baskı da gerekmez.
 */
import { imzaOlustur } from '@/lib/security/hmac.js';

/** Baş/son nokta ve sondaki eğik çizgileri temizler. */
function temizDomain(d) {
  return String(d || '').trim().replace(/^\.+|\.+$/g, '');
}

/**
 * QR'lara gömülecek SABİT kök adres (ör. "https://qr.sikayet.com").
 * @returns {string}
 */
export function qrBaseUrl() {
  if (process.env.QR_BASE_URL) {
    return process.env.QR_BASE_URL.trim().replace(/\/+$/, '');
  }
  const base = temizDomain(process.env.APP_BASE_DOMAIN);
  if (base) return `https://qr.${base}`;
  // Geliştirme / yedek
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/**
 * Bir sokak için QR'a basılacak kalıcı yönlendirici linki.
 * @param {string} kod - Sokağın kısa base62 `qr_kod`'u (yeni). Geriye uyum için
 *   UUID de geçilebilir; /q yönlendiricisi ikisini de çözer.
 * @returns {string} ör. "https://qr.sikayet.com/q/<kod>"
 */
export function qrLinkiOlustur(kod) {
  return `${qrBaseUrl()}/q/${kod}`;
}

/**
 * Yönlendiricinin (app/q/[id]) 302 atacağı GERÇEK form adresini üretir.
 *
 * Üretimde mutlaka ilgili belediyenin subdomain'ine MUTLAK adresle gidilir; çünkü
 * /api/sikayet tenant'ı Host başlığından çözer — form yanlış host'ta açılırsa
 * şikayet kaydı 404 olur. APP_BASE_DOMAIN yoksa (geliştirme/localhost) aynı origin'e
 * göreli adresle düşülür; orada tenant NEXT_PUBLIC_TENANT_SLUG'tan çözülür.
 *
 * @param {Request} request - Gelen istek (dev yedeği için origin kaynağı)
 * @param {string} slug - Hedef belediyenin subdomain slug'ı
 * @param {{id: string}} sokak
 * @returns {string} Mutlak veya göreli form adresi
 */
export function formHedefiOlustur(request, slug, sokak) {
  // İmzayı DB'deki hmac_imza'dan DEĞİL, çalışan secret'la CANLI türet → secret dönse
  // bile /api/sikayet'in imzaDogrula'sıyla daima eşleşir (QR kendini onarır).
  const sig = encodeURIComponent(imzaOlustur(sokak.id));
  const yol = `/s/${sokak.id}?sig=${sig}`;

  const base = temizDomain(process.env.APP_BASE_DOMAIN);
  if (base && slug) {
    return `https://${slug}.${base}${yol}`;
  }
  // Geliştirme / yedek: aynı origin
  return new URL(yol, request.url).toString();
}
