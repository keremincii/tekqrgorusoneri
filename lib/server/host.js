/**
 * Host → Belediye (tenant) slug çıkarımı
 *
 * Ana alan adı `APP_BASE_DOMAIN` ile verilir (ör. "sikayet.com" veya
 * "belediye.com.tr"). slug = host'tan ".<APP_BASE_DOMAIN>" eki çıkınca kalan
 * ilk etiket. Bu yöntem çok parçalı uzantılarda (.com.tr, .bel.tr) doğru çalışır;
 * "parça say" sezgisi (parts.length >= 3) bunlarda KIRILIR.
 *
 *   APP_BASE_DOMAIN=sikayet.com:
 *     gulsehir.sikayet.com      → "gulsehir"
 *     sikayet.com (apex)        → ""  (tenant yok)
 *     www.sikayet.com           → ""  (tenant yok)
 *     baskasite.com             → ""  (base ile bitmiyor → bilinmeyen)
 *
 *   APP_BASE_DOMAIN=belediye.com.tr:
 *     gulsehir.belediye.com.tr  → "gulsehir"
 *     belediye.com.tr (apex)    → ""  (tenant yok)
 *
 * Geliştirme (localhost / IP / boş host): subdomain olmadığından
 * NEXT_PUBLIC_TENANT_SLUG'a düşer.
 *
 * APP_BASE_DOMAIN hiç tanımlı değilse güvenli sezgiye düşer (ilk etiket, >=3 parça).
 *
 * @param {string} rawHost - İstek Host başlığı ("gulsehir.sikayet.com:443" olabilir)
 * @returns {string} slug (küçük harf, boş olabilir)
 */
export function hosttanSlug(rawHost) {
  const host = String(rawHost || '').split(':')[0].toLowerCase().trim();
  const devSlug = () => (process.env.NEXT_PUBLIC_TENANT_SLUG || '').toLowerCase();

  // Geliştirme: subdomain yok
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return devSlug();
  }

  const base = (process.env.APP_BASE_DOMAIN || '')
    .toLowerCase()
    .trim()
    .replace(/^\.+|\.+$/g, ''); // baştaki/sondaki noktaları temizle

  if (base) {
    // apex veya www → tenant yok
    if (host === base || host === `www.${base}`) return '';

    const ek = `.${base}`;
    if (host.endsWith(ek)) {
      const altKisim = host.slice(0, -ek.length); // "gulsehir" (ya da çok seviyeli ise "a.b")
      return altKisim.split('.')[0]; // ilk etiket
    }
    // base alan adıyla bitmiyorsa bu host bize ait değil → bilinmeyen
    return '';
  }

  // APP_BASE_DOMAIN yoksa: güvenli sezgi (subdomain.domain.tld → ilk etiket)
  const parts = host.split('.');
  return parts.length >= 3 ? parts[0] : devSlug();
}
