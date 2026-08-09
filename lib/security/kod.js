import crypto from 'crypto';

/**
 * QR Kısa Kod Üretici (base62)
 * ============================
 *
 * Neden: QR'a basılan adres ne kadar kısaysa, aynı fiziksel boyutta QR o kadar az
 * modül (kare) içerir → daha büyük kareler → düşük/orta donanımda ve kirli/çizik
 * dış mekân levhasında daha kolay okunur. Sokağın UUID'si (36 karakter) yerine 8
 * haneli opak bir kod basarak `https://qr.<domain>/q/<kod>` adresini ~42 karaktere
 * indiririz (QR Version 5, 37×37 modül).
 *
 * GÜVENLİK: Kod tahmin edilebilir olsa bile /q yalnızca herkese açık form adresine
 * yönlendirir; asıl koruma /api/sikayet'teki Host'tan tenant çözümü + canlı HMAC
 * doğrulaması + Turnstile'dır. Yine de defense-in-depth için kod crypto-güvenli
 * rastgeledir (Math.random DEĞİL) ve enumerate edilemez.
 *
 * ÇAKIŞMA: 8 hane base62 = 62^8 ≈ 2.18e14 olasılık. `sokaklar.qr_kod` üzerindeki
 * UNIQUE index tek gerçek garanti kaynağıdır; çağıran taraf ihlalde yeniden üretir.
 *
 * NOT: Bu mantık scriptlerde (seed-sokaklar.js vb.) satır-içi kopya olarak da
 * bulunur — scriptler `@/` alias çözümü olmadan `node` ile çalıştığından ortak
 * modülü import edemezler. İkisini birlikte güncel tut.
 */

/** base62 alfabesi (62 sembol). */
const ALFABE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Crypto-güvenli base62 kısa kod üretir (bias'sız rejection sampling).
 *
 * 256, 62'nin tam katı olmadığından `byte % 62` alt değerlere hafif önyargı
 * yaratır. 248 = 4×62 eşiğinin üstündeki baytları eleyerek düzgün dağılım sağlarız.
 *
 * @param {number} [uzunluk=8] - Kod karakter sayısı
 * @returns {string} base62 kod (ör. "aB3xQ9pL")
 */
export function qrKodUret(uzunluk = 8) {
  let kod = '';
  while (kod.length < uzunluk) {
    const bytes = crypto.randomBytes(uzunluk);
    for (let i = 0; i < bytes.length && kod.length < uzunluk; i++) {
      if (bytes[i] < 248) kod += ALFABE[bytes[i] % 62]; // 248 = 4×62 → bias yok
    }
  }
  return kod;
}
