/**
 * Güvenli İstemci IP Çıkarımı
 *
 * `x-forwarded-for` başlığı TAMAMEN istemci kontrolündedir; doğrudan okunursa
 * saldırgan her istekte sahte bir IP göndererek IP bazlı rate limit'i atlatır.
 *
 * Bu sistem internete DOĞRUDAN açılmaz: önünde Cloudflare + `cloudflared` tüneli
 * vardır ve origin'e TEK giriş yolu budur (sunucuda hiçbir inbound port açık değil).
 * Cloudflare gerçek istemci IP'sini `CF-Connecting-IP` başlığına edge'de yazar;
 * tünel dışından origin'e erişilemediği için bu başlık taklit edilemez.
 *
 * Öncelik sırası:
 *   1. cf-connecting-ip → Cloudflare'in yazdığı gerçek istemci IP'si (üretim)
 *   2. x-real-ip        → farklı bir ters proxy (Caddy/Nginx) kullanılırsa
 *   3. x-forwarded-for  → yalnızca yerel geliştirme için son çare
 *
 * @param {Request} request
 * @returns {string} İstemci IP'si veya 'unknown'
 */
export function getClientIp(request) {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf && cf.trim()) return cf.trim();

  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const ilk = xff.split(',')[0]?.trim();
    if (ilk) return ilk;
  }

  return 'unknown';
}
