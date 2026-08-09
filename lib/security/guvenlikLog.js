/**
 * Yapısal Güvenlik Olay Loglaması
 *
 * Reddedilen/şüpheli istekleri tek satır JSON olarak (stderr) yazar. Böylece
 * `docker compose logs app` üzerinden saldırı tespiti (fuzzing, rate-limit taarruzu,
 * geçersiz format denemeleri) görünür ve grep'lenebilir olur.
 *
 * Gizlilik: PII yazılmaz. Kimlik hash'i yalnızca ilk 8 hane ile (korelasyon için yeterli,
 * geri-döndürülemez) loglanır. Loglama hiçbir koşulda isteği bozmamalıdır (try/catch).
 */

/**
 * @param {string} tip - olay türü (ör. 'foto_gecersiz_qr', 'foto_kimlik_limit')
 * @param {{ ip?: string, kimlik?: string, sebep?: string, [k: string]: any }} [detay]
 */
export function guvenlikOlayi(tip, detay = {}) {
  try {
    const { ip, kimlik, sebep, ...ekstra } = detay;
    const kayit = {
      seviye: 'guvenlik',
      tip,
      zaman: new Date().toISOString(),
      ...(ip ? { ip } : {}),
      ...(kimlik ? { kimlik: String(kimlik).slice(0, 8) } : {}),
      ...(sebep ? { sebep } : {}),
      ...ekstra,
    };
    console.warn(JSON.stringify(kayit));
  } catch {
    // Loglama asla ana akışı bozmamalı; sessizce yut.
  }
}
