/**
 * Girdi Temizleme (Input Sanitization) Modülü
 * 
 * Defense in Depth: Validators.js'teki doğrulamaya EK olarak çalışır.
 * Validators = "Bu veri doğru formatta mı?" (kabul/ret)
 * Sanitize   = "Bu veriyi tehlikesiz hale getir" (temizleme)
 * 
 * Her ikisi de farklı katmanlarda birlikte kullanılır.
 */

/**
 * Objedeki tüm string değerleri temizler (derin/recursive).
 * - Başındaki ve sonundaki boşlukları kaldırır
 * - HTML etiketlerini temizler
 * - Null byte'ları kaldırır (null byte injection koruması)
 * - Kontrol karakterlerini temizler
 * 
 * @param {Object} obj - Temizlenecek obje
 * @returns {Object} Temizlenmiş obje (yeni kopya, orijinal değişmez - immutability)
 */
export function objeTemizle(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return metniTemizle(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => objeTemizle(item));

  const temizObj = {};
  for (const [anahtar, deger] of Object.entries(obj)) {
    // Prototype pollution koruması
    if (anahtar === '__proto__' || anahtar === 'constructor' || anahtar === 'prototype') {
      continue;
    }
    temizObj[anahtar] = objeTemizle(deger);
  }
  return temizObj;
}

/**
 * Tek bir metin değerini temizler.
 * @param {string} metin
 * @returns {string}
 */
function metniTemizle(metin) {
  return metin
    // Null byte injection koruması
    .replace(/\0/g, '')
    // Kontrol karakterlerini temizle (tab ve newline hariç)
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // NOSONAR
    // HTML etiketlerini temizle
    .replace(/<[^>]*>/g, '')
    // Birden fazla boşluğu teke düşür
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * İstek gövdesini (request body) güvenli bir şekilde parse eder.
 * JSON bomb ve aşırı büyük payload koruması.
 * 
 * @param {Request} request - Next.js Request nesnesi
 * @param {number} [maxBoyut=1048576] - Maksimum payload boyutu (byte, varsayılan 1MB)
 * @returns {Promise<{veri: Object|null, hata: string|null}>}
 */
export async function guvenliJsonParse(request, maxBoyut = 1024 * 1024) {
  try {
    // Content-Length kontrolü (aşırı büyük payload koruması)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxBoyut) {
      return { veri: null, hata: 'İstek boyutu çok büyük.' };
    }

    const rawText = await request.text();

    // Ham metin boyutu kontrolü (Content-Length sahteyse diye)
    if (rawText.length > maxBoyut) {
      return { veri: null, hata: 'İstek boyutu çok büyük.' };
    }

    const parsed = JSON.parse(rawText);

    // Nesne derinliği kontrolü (JSON bomb koruması)
    if (objeDerinligiKontrol(parsed, 5)) {
      return { veri: null, hata: 'İstek yapısı çok derin.' };
    }

    // Temizle ve döndür
    return { veri: objeTemizle(parsed), hata: null };
  } catch {
    return { veri: null, hata: 'Geçersiz JSON formatı.' };
  }
}

/**
 * Nesnenin derinliğinin belirli bir sınırı aşıp aşmadığını kontrol eder.
 * @private
 */
function objeDerinligiKontrol(obj, maxDerinlik, mevcutDerinlik = 0) {
  if (mevcutDerinlik > maxDerinlik) return true;
  if (typeof obj !== 'object' || obj === null) return false;

  for (const deger of Object.values(obj)) {
    if (objeDerinligiKontrol(deger, maxDerinlik, mevcutDerinlik + 1)) {
      return true;
    }
  }
  return false;
}
