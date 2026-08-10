/**
 * Girdi doğrulama (validation) yardımcı fonksiyonları.
 * Defense in Depth: Her katmanda (API route, service, repository) kullanılabilir.
 * Tek Sorumluluk: Her fonksiyon sadece bir şeyi doğrular.
 */

import { turGecerliMi } from '@/lib/utils/constants.js';

/** TC Kimlik numarası formatını doğrular (11 haneli, sıfırla başlamaz) */
export function tcKimlikGecerliMi(tc) {
  return typeof tc === 'string' && tc.length === 11 && !tc.startsWith('0') && /^\d{11}$/.test(tc);
}

/** Telefon numarası formatını doğrular (05XX XXX XX XX) */
export function telefonGecerliMi(telefon) {
  if (typeof telefon !== 'string') return false;
  // Boşluk, tire, parantez temizle
  const temiz = telefon.replace(/[\s\-()]/g, '');
  // 05XXXXXXXXX veya +905XXXXXXXXX
  if (!/^(0|(\+90))?5\d{9}$/.test(temiz)) return false;

  // Bariz sahte/otomatik numaraları ele (ör. 05000000000, 05111111111): önek atılıp
  // kalan 10 haneli mobil kısmın SON 9 hanesi tümüyle aynıysa reddet. Konservatif
  // tutuldu (gerçek numaraların 9 tekrar hanesi olması pratikte imkânsız) — meşru
  // vatandaşı yanlışlıkla engellememek için. Asıl kötüye kullanım korumasını Turnstile
  // + katmanlı throttle üstlenir; bu yalnız ucuz bir ön eleme.
  const mobil = temiz.replace(/^(\+90|0)/, ''); // 5XXXXXXXXX (10 hane)
  if (/^(\d)\1{8}$/.test(mobil.slice(1))) return false;

  return true;
}

/** Telefon numarasını standart formata (05XXXXXXXXX) çevirir */
export function telefonuStandartlastir(telefon) {
  const temiz = telefon.replace(/[\s\-()]/g, '');
  if (temiz.startsWith('+90')) return '0' + temiz.slice(3);
  if (temiz.startsWith('90') && temiz.length === 12) return '0' + temiz.slice(2);
  if (!temiz.startsWith('0')) return '0' + temiz;
  return temiz;
}

/** Ad/soyad formatını doğrular (en az 2 karakter, sadece harfler ve boşluk) */
export function adGecerliMi(ad) {
  if (typeof ad !== 'string') return false;
  const temiz = ad.trim();
  if (temiz.length < 2 || temiz.length > 50) return false;
  // Türkçe karakterler dahil, sadece harf ve boşluk
  return /^[a-zA-ZçÇğĞıİöÖşŞüÜ\s]+$/.test(temiz);
}

/** Doğum yılı formatını doğrular (4 haneli, mantıklı aralıkta) */
export function dogumYiliGecerliMi(yil) {
  const sayi = parseInt(yil, 10);
  if (isNaN(sayi)) return false;
  const buYil = new Date().getFullYear();
  return sayi >= 1900 && sayi <= buYil - 10; // En az 10 yaşında olmalı
}

/** Başvuru metninin üst sınırı (karakter). Depolama/gösterim sınırıdır. */
export const ACIKLAMA_MAX = 1000;

/**
 * Başvuru metnini doğrular.
 *
 * ALT SINIR YOKTUR (bilinçli): "en az 10 karakter" kuralı kaldırıldı. Gerçek başvuruların
 * çoğu kısa ve tam anlaşılır oluyordu ("çöp alınmadı", "su yok", "sağ olun") ve kural
 * vatandaşı ya cümle uydurmaya ya da vazgeçmeye zorluyordu.
 *
 * ÜST SINIR 280 → 1000: kategori ekseni kalkınca metin, başvurunun TEK içerik alanı
 * oldu. 280 karakter bir tweet uzunluğudur; "şu sokakta şu sorun var, şu saatlerde
 * oluyor, daha önce şuraya bildirdim" diyen meşru bir vatandaşı ortasında kesiyordu.
 * 1000 hem panelde rahat okunur hem depolama açısından önemsizdir.
 *
 * @param {string} aciklama
 * @param {boolean} [zorunlu=false] - true ise boş metin REDDEDİLİR. Bu üründe vatandaş
 *   akışında ZORUNLUDUR: kategori sorulmadığı için metin, başvurunun tek içeriğidir —
 *   boş bir kayıt yönetim için hiçbir şey ifade etmez.
 */
export function aciklamaGecerliMi(aciklama, zorunlu = false) {
  if (typeof aciklama !== 'string') return false;
  const temiz = aciklama.trim();
  if (temiz.length === 0) return !zorunlu;
  return temiz.length <= ACIKLAMA_MAX;
}

/**
 * Başvuru türünü doğrular (whitelist — istemciden sahte tür gelemez).
 *
 * Liste constants.js'teki tek otoriteden (BasvuruTurleri) okunur; burada elle tekrar
 * edilseydi tür listesi her değiştiğinde sessizce bayatlama riski taşırdı (constants
 * ile validator'ın ayrışması = whitelist'in yalan söylemesi). constants.js saf bir
 * sabit modülüdür (sunucuya/DB'ye bağımlılığı yoktur) → burada içe aktarmak güvenlidir.
 *
 * ÜÇÜNCÜ KATMAN DB'DEDİR: `sikayetler_tur_check` CHECK kısıtı, uygulama katmanı
 * atlansa (elle SQL, bakım script'i) bile tutarsız türü keser.
 *
 * @param {string} turId
 */
export function basvuruTuruGecerliMi(turId) {
  return turGecerliMi(turId);
}

/** UUID v4 formatını doğrular */
export function uuidGecerliMi(id) {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/**
 * QR kısa kodu (base62) biçimini doğrular. QR yönlendiricisi (/q/[id]) gelen
 * parametre UUID değilse bununla kontrol eder → biçimsiz/bot taraması DB'ye HİÇ
 * gitmeden 404 düşer. 6–12 hane esnek: üretici 8 hane basar, ileride uzatılabilir.
 */
export function qrKodGecerliMi(kod) {
  if (typeof kod !== 'string') return false;
  return /^[0-9A-Za-z]{6,12}$/.test(kod);
}

/**
 * Metin girdisini zararsız hale getirir (XSS koruması).
 * HTML etiketlerini ve tehlikeli karakterleri temizler.
 */
export function metniTemizle(metin) {
  if (typeof metin !== 'string') return '';
  return metin
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}
