import { SmsGuvenlikSabitleri } from '@/lib/utils/constants.js';

/**
 * IP İtibar / Ağ İstihbaratı — Datacenter & VPN Tespiti
 * =====================================================
 *
 * Gerçek vatandaş residential/mobil bir ISP üzerinden gelir; otomatik saldırılar
 * ise büyük ölçüde datacenter (AWS, DigitalOcean, Hetzner…) veya ticari VPN
 * ASN'lerinden gelir. Bu isteği daha SMS üretilmeden kesmek en ucuz katmandır.
 *
 * Mimari: ASN listesini KODDA tutmak (sürekli güncellenmesi gereken devasa liste)
 * yerine işi CLOUDFLARE EDGE'e bırakırız. Cloudflare'de bir "Transform Rule"
 * (Modify Request Header) datacenter/VPN ASN koşulunda bir işaret header'ı ekler;
 * origin (bu kod) yalnızca o header'ı okuyup bloklar. Böylece liste yönetimi
 * ücretsiz ve otomatik (Cloudflare tarafında) olur, kod basit kalır.
 *
 * Cloudflare kurulumu (dashboard → Rules → Transform Rules → Modify Request Header):
 *   When incoming requests match:  (ip.src.asnum in {16509 14618 15169 14061 24940 ...})
 *   Then set static header:        <SMS_DC_HEADER>  =  1
 * (İstenirse Cloudflare "Bot Fight Mode" / WAF rate-limit ile birlikte kullanılır.)
 *
 * Header YOKSA (kural kurulmamışsa) hiçbir şey olmaz → güvenli varsayılan; bu katman
 * yalnızca operatör Cloudflare kuralını kurunca aktifleşir, diğer katmanlar hep çalışır.
 */

/** Truthy sayılan header değerleri (Cloudflare "1"/"true" set edebilir). */
const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'evet']);

/**
 * İstek datacenter/VPN olarak işaretlenmiş mi? (Cloudflare edge header'ına göre.)
 * @param {Request} request
 * @returns {boolean}
 */
export function datacenterEngelliMi(request) {
  if (!SmsGuvenlikSabitleri.SMS_DC_ENGELLE) return false;
  try {
    const deger = request.headers.get(SmsGuvenlikSabitleri.SMS_DC_HEADER);
    return Boolean(deger) && TRUTHY.has(String(deger).trim().toLowerCase());
  } catch {
    return false; // header okunamazsa engelleme (güvenli varsayılan)
  }
}
