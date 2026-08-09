import crypto from 'crypto';
import { GuvenlikSabitleri } from '@/lib/utils/constants.js';
import { telefonuStandartlastir } from '@/lib/utils/validators.js';

/**
 * HMAC (Hash-based Message Authentication Code) Modülü
 * 
 * QR kodların sahte olup olmadığını doğrular.
 * Brute force'a karşı koruma: Saldırgan UUID'yi tahmin etse bile,
 * sunucudaki gizli anahtarı bilmeden geçerli bir imza üretemez.
 * 
 * Single Responsibility: Sadece HMAC imzalama/doğrulama yapar.
 */

/**
 * Gizli anahtar çevre değişkeninden okunur.
 * Bu anahtar asla kaynak kodda (source code) bulunmaz.
 * @private
 */
function gizliAnahtarGetir() {
  const anahtar = process.env.HMAC_SECRET;
  if (!anahtar || anahtar.length < 32) {
    throw new Error(
      'HMAC_SECRET çevre değişkeni tanımlı değil veya 32 karakterden kısa. ' +
      '.env.local dosyasını kontrol edin.'
    );
  }
  return anahtar;
}

/**
 * Verilen veri için HMAC-SHA256 imzası üretir.
 * @param {string} veri - İmzalanacak veri (genellikle sokak UUID'si)
 * @returns {string} Hex formatında HMAC imzası
 */
export function imzaOlustur(veri) {
  const anahtar = gizliAnahtarGetir();
  return crypto
    .createHmac(GuvenlikSabitleri.HMAC_ALGORITMASI, anahtar)
    .update(veri)
    .digest('hex');
}

/**
 * QR linkindeki imzanın geçerli olup olmadığını doğrular.
 * Timing-safe karşılaştırma kullanır (timing attack koruması).
 * 
 * @param {string} veri - Doğrulanacak veri (sokak UUID'si)
 * @param {string} imza - QR linkinden gelen imza
 * @returns {boolean} İmza geçerli mi?
 */
export function imzaDogrula(veri, imza) {
  if (!veri || !imza || typeof imza !== 'string') return false;

  try {
    const beklenenImza = imzaOlustur(veri);

    // Timing attack koruması: Her iki string de aynı uzunluğa getirilir
    // ve sabit zamanlı karşılaştırma yapılır. Böylece saldırgan
    // yanıt süresinden imzanın doğruluğunu çıkaramaz.
    const buf1 = Buffer.from(beklenenImza, 'hex');
    const buf2 = Buffer.from(imza, 'hex');

    if (buf1.length !== buf2.length) return false;

    return crypto.timingSafeEqual(buf1, buf2);
  } catch {
    return false;
  }
}

/**
 * Verilen veriyi SHA-256 ile hashler (TC ve telefon numarası için).
 * Tek yönlü: Hash'ten orijinal veriye geri dönülemez.
 * 
 * @param {string} veri - Hashlenecek veri
 * @returns {string} SHA-256 hash (hex formatında)
 */
export function sha256Hashle(veri) {
  if (!veri || typeof veri !== 'string') {
    throw new Error('Hashlenecek veri boş veya geçersiz.');
  }
  // KEYED-HASH (HMAC-SHA256). Eskiden düz SHA256(salt + veri) idi; bu yapı
  // length-extension saldırısına açık bir biçimdir. HMAC hem rainbow-table hem
  // length-extension'a kapalıdır. Anahtar = HMAC_SECRET.
  // NOT: Çıktı değiştiği için bu fonksiyonun ürettiği kalıcı hash'ler (admin oturum/
  // magic-link hash'i, kimlikHash) eski değerlerle EŞLEŞMEZ — dağıtımdan sonra mevcut
  // admin oturumları düşer (yeni magic link gerekir) ve haftalık-limit dedup sıfırlanır.
  const anahtar = gizliAnahtarGetir();
  return crypto
    .createHmac('sha256', anahtar)
    .update(veri)
    .digest('hex');
}

/**
 * İki metni SABİT ZAMANDA (timing-safe) karşılaştırır. Uzunluk farklıysa erken false
 * döner (uzunluk zaten gizli bir bilgi değildir). Webhook secret token gibi paylaşılan
 * gizli sabitlerin `===` yerine bununla kıyaslanması timing oracle'ı kapatır.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sabitZamanliMetinEsit(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Kimlik kombinasyonundan tek yönlü bir hash üretir (1 hafta kuralı için).
 *
 * KVKK: TC kimlik numarası ASLA saklanmaz. Bunun yerine vatandaşı tekrar
 * tanımak için ad + soyad + doğum yılı + telefon kombinasyonunun hash'i tutulur.
 * TC yalnızca NVİ doğrulaması sırasında anlık kullanılır, hiçbir yere yazılmaz.
 *
 * Determinizm: Aynı kişi her zaman aynı hash'i üretmeli, bu yüzden alanlar
 * kanonik biçime getirilir (Türkçe büyük harf, tek boşluk, standart telefon).
 *
 * @param {string} ad
 * @param {string} soyad
 * @param {string|number} dogumYili
 * @param {string} telefon
 * @returns {string} SHA-256 hash (hex)
 */
export function kimlikHashOlustur(ad, soyad, dogumYili, telefon) {
  const norm = (s) => String(s).trim().toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');
  const kanonik = [
    norm(ad),
    norm(soyad),
    String(parseInt(dogumYili, 10)),
    telefonuStandartlastir(String(telefon)),
  ].join('|');
  return sha256Hashle(kanonik);
}

/**
 * SMS doğrulaması başarılı olduğunda üretilen, HMAC imzalı kısa ömürlü token.
 * İçinde kimlikHash, doğrulanmış kişisel veriler (ad/soyad/telefon) ve son
 * geçerlilik zamanı taşır. /api/sikayet bu token'ı doğrular; böylece şikayet
 * yalnızca SMS doğrulamasından geçmiş biri tarafından oluşturulabilir ve KAYDEDİLEN
 * ad/soyad/telefon, istemcinin sonradan değiştiremeyeceği doğrulanmış veridir
 * (istemci body'sine güvenilmez).
 *
 * Format: base64url(payload) + "." + HMAC-SHA256(base64url(payload))
 *
 * @param {{kimlikHash: string, ad?: string, soyad?: string, telefon?: string}} veri
 * @returns {string} İmzalı doğrulama token'ı
 */
export function dogrulamaTokenOlustur({ kimlikHash, ad = '', soyad = '', telefon = '' }) {
  const payload = {
    k: kimlikHash,
    ad,
    sa: soyad,
    tel: telefon,
    exp: Date.now() + GuvenlikSabitleri.DOGRULAMA_TOKEN_SURESI_MS,
  };
  const govde = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const imza = crypto.createHmac('sha256', gizliAnahtarGetir()).update(govde).digest('hex');
  return `${govde}.${imza}`;
}

/**
 * Doğrulama token'ını doğrular (imza + son geçerlilik).
 * @param {string} token
 * @returns {{gecerli: boolean, kimlikHash?: string, ad?: string, soyad?: string, telefon?: string, hata?: string}}
 */
export function dogrulamaTokenDogrula(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { gecerli: false, hata: 'Geçersiz doğrulama belirteci.' };
  }
  const [govde, imza] = token.split('.');
  if (!govde || !imza) return { gecerli: false, hata: 'Geçersiz doğrulama belirteci.' };

  try {
    const beklenen = crypto.createHmac('sha256', gizliAnahtarGetir()).update(govde).digest('hex');
    const a = Buffer.from(imza, 'hex');
    const b = Buffer.from(beklenen, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { gecerli: false, hata: 'Doğrulama belirteci geçersiz.' };
    }
    const payload = JSON.parse(Buffer.from(govde, 'base64url').toString('utf8'));
    if (!payload || typeof payload.k !== 'string' || typeof payload.exp !== 'number') {
      return { gecerli: false, hata: 'Doğrulama belirteci bozuk.' };
    }
    if (Date.now() > payload.exp) {
      return { gecerli: false, hata: 'Doğrulama süresi doldu. Lütfen baştan deneyin.' };
    }
    return {
      gecerli: true,
      kimlikHash: payload.k,
      ad: typeof payload.ad === 'string' ? payload.ad : '',
      soyad: typeof payload.sa === 'string' ? payload.sa : '',
      telefon: typeof payload.tel === 'string' ? payload.tel : '',
    };
  } catch {
    return { gecerli: false, hata: 'Doğrulama belirteci geçersiz.' };
  }
}

/**
 * Kriptografik olarak güvenli rastgele token üretir (Magic Link için).
 * @param {number} [byteUzunlugu=64] - Token uzunluğu (byte)
 * @returns {string} Hex formatında rastgele token (byte x 2 karakter)
 */
export function rastgeleTokenUret(byteUzunlugu = GuvenlikSabitleri.MAGIC_LINK_TOKEN_BYTE) {
  return crypto.randomBytes(byteUzunlugu).toString('hex');
}

/**
 * SMS doğrulama kodu üretir (6 haneli sayısal).
 * @returns {string} 6 haneli doğrulama kodu
 */
export function smsKoduUret() {
  const uzunluk = GuvenlikSabitleri.SMS_KOD_UZUNLUGU;
  // crypto.randomInt güvenli rastgele sayı üretir (Math.random değil!)
  const min = Math.pow(10, uzunluk - 1);   // 100000
  const max = Math.pow(10, uzunluk) - 1;    // 999999
  return crypto.randomInt(min, max + 1).toString();
}
