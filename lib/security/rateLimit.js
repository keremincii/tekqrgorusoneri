import { RateLimitKurallari, SmsGuvenlikSabitleri } from '@/lib/utils/constants.js';
import { sayacPeek, sayacArtir, sayacDeger, setUyeIzin, setUyeEkle, setBoyut } from '@/lib/infrastructure/redis/store.js';

const SAAT_MS = 60 * 60 * 1000;
const GUN_MS = 24 * 60 * 60 * 1000;
const HAFTA_MS = 7 * GUN_MS;

/**
 * Rate Limiter (İstek Hız Sınırlayıcı)
 * 
 * Defense in Depth Katmanı: Brute force, spam ve DDoS saldırılarını önler.
 * 
 * Bellek içi (in-memory) Map kullanır. Vercel'in Serverless yapısında
 * her fonksiyon çağrısı farklı bir instance'da çalışabilir, bu yüzden
 * üretim ortamında Upstash Redis (Vercel KV) ile değiştirilmelidir.
 * Ancak mevcut arayüz (interface) aynı kalır (Open/Closed prensibi).
 * 
 * Not: Gerçek üretimde bu dosyanın Upstash implementasyonu ile
 * değiştirilmesi yeterlidir, başka hiçbir kod değişmez.
 */

/** @type {Map<string, {sayac: number, ilkIstek: number}>} */
const istekKayitlari = new Map();

/** Süresi dolmuş kayıtları temizlemek için periyodik temizlik (bellek sızıntısını önler) */
const TEMIZLIK_PERIYODU_MS = 10 * 60 * 1000; // 10 dakika
let sonTemizlik = Date.now();

/**
 * Map için sert üst sınır (bellek tüketimi DoS koruması).
 * Saldırgan sahte x-forwarded-for ile sonsuz anahtar üretemesin diye:
 * sınır aşılırsa en eski kayıtlar tahliye edilir (FIFO).
 */
const MAX_KAYIT = 50000;
const TAHLIYE_PAYI = 5000; // sınır aşılınca silinecek en eski kayıt sayısı

function eskiKayitlariTemizle() {
  const simdi = Date.now();
  if (simdi - sonTemizlik < TEMIZLIK_PERIYODU_MS) return;

  for (const [anahtar, deger] of istekKayitlari.entries()) {
    // 2 saatten eski kayıtları sil
    if (simdi - deger.ilkIstek > 2 * 60 * 60 * 1000) {
      istekKayitlari.delete(anahtar);
    }
  }
  sonTemizlik = simdi;
}

/**
 * Yeni anahtar eklemeden önce Map'in sınırı aşıp aşmadığını kontrol eder.
 * Aşıyorsa önce eskileri temizler; hâlâ doluysa en eski kayıtları tahliye eder.
 * Bu, sahte IP saldırısında sınırsız bellek büyümesini engeller.
 */
function kapasiteGuvenceleyici() {
  if (istekKayitlari.size < MAX_KAYIT) return;

  // Önce normal temizliği zorla
  sonTemizlik = 0;
  eskiKayitlariTemizle();
  if (istekKayitlari.size < MAX_KAYIT) return;

  // Hâlâ doluysa: en eski (ilk eklenen) kayıtları FIFO ile at
  let silinecek = TAHLIYE_PAYI;
  for (const anahtar of istekKayitlari.keys()) {
    istekKayitlari.delete(anahtar);
    if (--silinecek <= 0) break;
  }
}

/**
 * Belirli bir anahtar için rate limit kontrolü yapar.
 * 
 * @param {string} anahtar - Rate limit anahtarı (örn: "ip:192.168.1.1" veya "tc:abc123")
 * @param {number} maxIstek - İzin verilen maksimum istek sayısı
 * @param {number} pencereSureMs - Zaman penceresi (milisaniye)
 * @returns {{izinVar: boolean, kalanHak: number, resetZamani: number}}
 */
export function rateLimitKontrol(anahtar, maxIstek, pencereSureMs) {
  eskiKayitlariTemizle();

  const simdi = Date.now();
  const kayit = istekKayitlari.get(anahtar);

  // İlk istek
  if (!kayit) {
    kapasiteGuvenceleyici(); // yeni anahtar eklemeden önce bellek sınırını koru
    istekKayitlari.set(anahtar, { sayac: 1, ilkIstek: simdi });
    return { izinVar: true, kalanHak: maxIstek - 1, resetZamani: simdi + pencereSureMs };
  }

  // Zaman penceresi dolmuş, sıfırla
  if (simdi - kayit.ilkIstek > pencereSureMs) {
    istekKayitlari.set(anahtar, { sayac: 1, ilkIstek: simdi });
    return { izinVar: true, kalanHak: maxIstek - 1, resetZamani: simdi + pencereSureMs };
  }

  // Limit aşılmış
  if (kayit.sayac >= maxIstek) {
    const resetZamani = kayit.ilkIstek + pencereSureMs;
    return { izinVar: false, kalanHak: 0, resetZamani };
  }

  // İzin var, sayacı artır
  kayit.sayac += 1;
  return {
    izinVar: true,
    kalanHak: maxIstek - kayit.sayac,
    resetZamani: kayit.ilkIstek + pencereSureMs,
  };
}

/**
 * IP bazlı rate limit kontrolü (UÇ BAŞINA dakikalık tavan).
 *
 * `uc` etiketi anahtara girer ('ip_baslat:', 'ip_sikayet:' ...) → uçlar birbirinin
 * hakkını TÜKETMEZ. Eskiden tüm uçlar tek 'ip:' sayacını paylaşıyordu ve tam akış
 * (baslat→sikayet→foto) 3 hakkı bitiriyordu; CGNAT arkasındaki (tek IP'de yüzlerce
 * vatandaş) mahalle pik anda kilitleniyordu.
 *
 * @param {string} ip - İstemci IP adresi
 * @param {string} [uc='genel'] - Uç etiketi (baslat, sms, tc, sikayet, foto)
 */
export function ipRateLimitKontrol(ip, uc = 'genel') {
  return rateLimitKontrol(
    `ip_${uc}:${ip}`,
    RateLimitKurallari.IP_DAKIKA_LIMIT,
    60 * 1000 // 1 dakika
  );
}

/**
 * QR kod bazlı rate limit kontrolü (saatte max N şikayet).
 * @param {string} qrId - QR kodun UUID'si
 */
export function qrRateLimitKontrol(qrId) {
  return rateLimitKontrol(
    `qr:${qrId}`,
    RateLimitKurallari.QR_SAAT_LIMIT,
    60 * 60 * 1000 // 1 saat
  );
}

// NOT: Kimlik başına haftalık şikayet limiti artık burada (in-memory) DEĞİL,
// SikayetService'te DB sayımı (pencereSikayetSayisiGetir) ile uygulanır — tek,
// restart-dayanıklı gerçek kaynak. Eski in-memory kontrol, insert'ten önce sayacı
// artırıp hata halinde geri almadığı için kullanıcıyı yanlışça kilitliyordu; kaldırıldı.
// (OTP yanlış-deneme sayacı da Redis kv'de tutulur; ayrı bir in-memory sayaç yoktur.)

// ============================================================================
// SMS GÖNDERİM THROTTLE (kredi tükenmesi + numara tarama + bombardıman koruması)
// ============================================================================
//
// Bir SMS gönderiminin AYNI ANDA birden çok limiti geçmesi gerekir (telefon
// cooldown + IP haftalık-benzersiz-telefon/toplam + global günlük). Telefon
// başına HAFTALIK sayı limiti YOKTUR — şikayet zaten haftada 1 ile sınırlıdır,
// o yüzden meşru tekrar denemeleri haftaya yayılmaz; kısa pencerede ise
// SMS_GONDER_MAX (tc route'unda) aynı numaranın kod adedini kapar. Bu dosyadaki
// asıl savunma IP'nin haftalık tavanı + mağdur-hedef susturmadır.
// Bu yüzden "peek" (sayacı ARTIRMADAN kontrol) ile "tüket" (başarılı gönderimde
// TÜM sayaçları artır) ayrılmıştır:
//
//   1) Tüm limitleri PEEK ile kontrol et → biri bile reddederse HİÇBİR sayaç artmaz.
//   2) Hepsi geçerse gönderimden hemen önce TÜKET → tüm sayaçlar birlikte artar.
//
// Neden kritik? Saldırgan mağdurun numarasını girip IP limitine takılırsa,
// mağdurun telefon sayacı BOŞUNA yükselmemeli — aksi halde saldırgan başkasının
// numarasını kilitleyebilirdi (GÜVENLİK planı Açık 3/4). Peek/tüket ayrımı bunu önler.
//
// KALICILIK: sayaçlar store üzerinden Redis'te tutulur (REDIS_URL varsa), yoksa
// in-memory fallback (bkz. lib/infrastructure/redis/store.js) — restart/deploy'da
// SIFIRLANMAZ. Bu yüzden bu fonksiyonlar async'tir. Not: peek→tüket arası ağ
// gecikmesinde ufak yarış payı vardır; her zaman limiti SIKILAŞTIRMA (güvenli)
// yönünde. Tam atomiklik ileride tek Lua script'e alınabilir.

/** IP başına "o saat tetiklenen farklı telefonlar" kümesinin anahtarı. */
const ipSetAnahtar = (ip) => `sms_ipset:${ip}`;
/** Cihaz parmak izi başına "o saat tetiklenen farklı telefonlar" kümesinin anahtarı. */
const fpSetAnahtar = (fp) => `sms_fpset:${fp}`;

/**
 * Yürürlükteki (etkin) SMS sayaç limitleri. Normalde sabittir; ancak "savunma modu"
 * aktifse (conversion oranı düşünce kurulur) sayaç-tabanlı limitler SMS_SAVUNMA_CARPAN
 * ile kısılır (ör. yarıya). Cooldown penceresi değişmez (TTL fiziksel; tutarlılık için).
 * @returns {Promise<object & {savunma: boolean}>}
 */
async function etkinSabitler(tenantId) {
  const S = SmsGuvenlikSabitleri;
  const savunma = !(await sayacPeek(`sms_savunma:${tenantId}`, 1, S.SMS_SAVUNMA_SURE_MS)).izinVar;
  if (!savunma) return { ...S, savunma: false };
  const kis = (n) => Math.max(1, Math.floor(n * S.SMS_SAVUNMA_CARPAN));
  return {
    ...S,
    savunma: true,
    SMS_IP_HAFTA_BENZERSIZ_TELEFON: kis(S.SMS_IP_HAFTA_BENZERSIZ_TELEFON),
    SMS_IP_HAFTA_LIMIT: kis(S.SMS_IP_HAFTA_LIMIT),
    SMS_FP_HAFTA_BENZERSIZ_TELEFON: kis(S.SMS_FP_HAFTA_BENZERSIZ_TELEFON),
    SMS_FP_HAFTA_LIMIT: kis(S.SMS_FP_HAFTA_LIMIT),
  };
}

// --- Mağdur-hedef tespiti + sessiz susturma -------------------------------
// Aynı numaraya kısa sürede çok FARKLI kaynaktan (IP) istek gelmesi, o numaranın
// hedef alındığının işaretidir (telefon cooldown/saat limiti tek numarayı zaten
// 3/saat'e kapardı; bu katman ÇOK-IP saldırısını tespit edip numarayı SESSİZCE ve
// daha UZUN süre susturur — saldırgana sinyal vermeden bombalamayı bitirir).

/** Bir gönderim denemesinin kaynağını (IP) numaranın hedef-kümesine ekler; eşik
 *  aşılırsa susturma bayrağını kurar. Her denemede (throttle sonucundan bağımsız)
 *  çağrılmalı ki saldırının genişliği (kaç farklı IP) görülebilsin. */
export async function hedefKaynakKaydet(telefonHash, kaynak) {
  const S = SmsGuvenlikSabitleri;
  const key = `sms_hedef_kaynak:${telefonHash}`;
  await setUyeEkle(key, kaynak, S.SMS_HEDEF_PENCERE_MS);
  if ((await setBoyut(key)) >= S.SMS_HEDEF_ESIK) {
    // Susturma bayrağı: sayacArtir yalnız ilk artışta TTL kurar → süre ilk tespitten
    // itibaren sabit (SMS_HEDEF_SUSTURMA_MS). Bayrak varlığı yeterli (>=1).
    await sayacArtir(`sms_hedef_sustur:${telefonHash}`, S.SMS_HEDEF_SUSTURMA_MS);
  }
}

/** Numara şu an sessiz susturulmuş mu? */
export async function hedefSusturulduMu(telefonHash) {
  return !(await sayacPeek(`sms_hedef_sustur:${telefonHash}`, 1, SmsGuvenlikSabitleri.SMS_HEDEF_SUSTURMA_MS)).izinVar;
}

/**
 * Bir SMS gönderiminin tüm limitlerini ARTIRMADAN kontrol eder.
 * Sıra: mağdur-hedef susturma → global bütçe kesici → telefon cooldown
 *       → IP haftalık-benzersiz-telefon/toplam → (parmak izi varsa) fp haftalık.
 *
 * NOT: Bu fonksiyonda telefon başına SAYI limiti YOKTUR (şikayet zaten haftada 1
 * ile sınırlı; meşru tekrar denemeleri — yanlış numara, kod gelmeme — burada
 * kısıtlanmaz). Pencere başına kod adedi ayrı bir kapıda, tc route'unda
 * SMS_GONDER_MAX ile uygulanır. Cooldown (art arda çift tıklama koruması) da
 * ayrı bir mekanizmadır, kalır.
 *
 * @param {string} telefonHash - Standart telefonun SHA-256 hash'i
 * @param {string} ip - İstemci IP'si
 * @param {string} [fpHash] - Cihaz parmak izinin hash'i (yoksa fp katmanı atlanır)
 * @returns {Promise<{izinVar: boolean, sebep?: string}>} sebep: hedef | global_kesici |
 *   cooldown | ip_hafta_farkli | ip_hafta_toplam | fp_hafta_farkli | fp_hafta_toplam
 */
export async function smsGonderimKontrol(tenantId, telefonHash, ip, fpHash = null) {
  const S = await etkinSabitler(tenantId);

  // Mağdur-hedef susturma EN ÖNCE (sessiz): hedef numaraya sanki gönderilmiş gibi
  // davranılır ama SMS üretilmez (route bunu 200 nötr yanıta çevirir).
  if (await hedefSusturulduMu(telefonHash)) {
    return { izinVar: false, sebep: 'hedef' };
  }
  // TENANT-BAŞINA bütçe kesici (her belediye kendi günlük SMS bütçesine sahip). Anahtar
  // tenant-öneklidir → bir belediyeye yapılan saldırı DİĞER belediyeleri 503'e düşüremez
  // (eskiden 'sms_global' tek/paylaşımlıydı; çapraz-tenant DoS kapatıldı).
  if (!(await sayacPeek(`sms_global:${tenantId}`, S.SMS_GLOBAL_GUN_LIMIT, GUN_MS)).izinVar) {
    return { izinVar: false, sebep: 'global_kesici' };
  }
  // Telefon: yalnız cooldown (ardışık gönderim arası); sayı limiti yok.
  if (!(await sayacPeek(`sms_cd:${telefonHash}`, 1, S.SMS_COOLDOWN_MS)).izinVar) {
    return { izinVar: false, sebep: 'cooldown' };
  }
  // IP: haftada farklı telefon sayısı + haftada toplam gönderim.
  if (!(await setUyeIzin(ipSetAnahtar(ip), telefonHash, S.SMS_IP_HAFTA_BENZERSIZ_TELEFON, HAFTA_MS)).izinVar) {
    return { izinVar: false, sebep: 'ip_hafta_farkli' };
  }
  if (!(await sayacPeek(`sms_ip_hafta:${ip}`, S.SMS_IP_HAFTA_LIMIT, HAFTA_MS)).izinVar) {
    return { izinVar: false, sebep: 'ip_hafta_toplam' };
  }
  // Cihaz parmak izi (varsa): IP rotasyonuna karşı ek boyut. Parmak izi gelmezse
  // atlanır — üstteki katmanlar zaten korur (savunma-derinliği, hard-block değil).
  if (fpHash) {
    if (!(await setUyeIzin(fpSetAnahtar(fpHash), telefonHash, S.SMS_FP_HAFTA_BENZERSIZ_TELEFON, HAFTA_MS)).izinVar) {
      return { izinVar: false, sebep: 'fp_hafta_farkli' };
    }
    if (!(await sayacPeek(`sms_fp_hafta:${fpHash}`, S.SMS_FP_HAFTA_LIMIT, HAFTA_MS)).izinVar) {
      return { izinVar: false, sebep: 'fp_hafta_toplam' };
    }
  }
  return { izinVar: true };
}

/**
 * Başarılı bir gönderimde ilgili TÜM sayaçları birlikte artırır (tüket).
 * smsGonderimKontrol izin verdikten sonra, SMS gönderilmeden hemen önce çağrılır.
 * @returns {Promise<void>}
 */
export async function smsGonderimTuket(tenantId, telefonHash, ip, fpHash = null) {
  const S = SmsGuvenlikSabitleri;
  await sayacArtir(`sms_cd:${telefonHash}`, S.SMS_COOLDOWN_MS);
  await setUyeEkle(ipSetAnahtar(ip), telefonHash, HAFTA_MS);
  await sayacArtir(`sms_ip_hafta:${ip}`, HAFTA_MS);
  if (fpHash) {
    await setUyeEkle(fpSetAnahtar(fpHash), telefonHash, HAFTA_MS);
    await sayacArtir(`sms_fp_hafta:${fpHash}`, HAFTA_MS);
  }
  await sayacArtir(`sms_global:${tenantId}`, GUN_MS);
}

// --- Conversion (gönderilen/doğrulanan) izleme → savunma modu --------------

/** Başarılı bir SMS doğrulamasını (kod eşleşti) tenant'ın günlük sayacına işler. */
export async function smsDogrulandiKaydet(tenantId) {
  await sayacArtir(`sms_dogrulandi:${tenantId}`, GUN_MS);
}

/**
 * Günlük doğrulanan/gönderilen oranını değerlendirir. Yeterli hacimde (>= min hacim)
 * oran eşiğin altındaysa "savunma modu" bayrağını kurar (limitler kısılır) ve bunun
 * BUGÜN İLK tetiklenişi olup olmadığını döndürür (route tek uyarı göndersin diye).
 * Gönderimi ASLA reddetmez (kötü niyetli doğrulamama ile meşru kullanıcı kilitlenmesin).
 * @returns {Promise<{kotu: boolean, oran?: number, yeniTetik?: boolean, gonderilen?: number, dogrulanan?: number}>}
 */
export async function conversionDegerlendir(tenantId) {
  const S = SmsGuvenlikSabitleri;
  const gonderilen = await sayacDeger(`sms_global:${tenantId}`);
  if (gonderilen < S.SMS_CONV_MIN_HACIM) return { kotu: false };

  const dogrulanan = await sayacDeger(`sms_dogrulandi:${tenantId}`);
  const oran = gonderilen > 0 ? dogrulanan / gonderilen : 1;
  if (oran >= S.SMS_CONV_MIN_ORAN) return { kotu: false, oran, gonderilen, dogrulanan };

  // Kötü oran → savunma modunu (tenant-başına) kur. yeniTetik: bayrak henüz yokken ilk kuruluş.
  const yeniTetik = (await sayacPeek(`sms_savunma:${tenantId}`, 1, S.SMS_SAVUNMA_SURE_MS)).izinVar;
  await sayacArtir(`sms_savunma:${tenantId}`, S.SMS_SAVUNMA_SURE_MS);
  return { kotu: true, oran, yeniTetik, gonderilen, dogrulanan };
}

/**
 * Global günlük SMS bütçe kesicisinin durumu (uyarı/log amaçlı).
 * @returns {Promise<{izinVar: boolean, kalanHak: number}>}
 */
export async function globalSmsButceDurumu(tenantId) {
  return sayacPeek(`sms_global:${tenantId}`, SmsGuvenlikSabitleri.SMS_GLOBAL_GUN_LIMIT, GUN_MS);
}

/**
 * Bir olay için "günde en fazla 1 kez" bayrağı (ör. bütçe kesici uyarısını
 * tekrar tekrar göndermemek için). true dönerse bu olay bugün İLK kez işleniyor.
 * @param {string} anahtar
 * @returns {Promise<boolean>}
 */
export async function gunlukTekSefer(anahtar) {
  const ilk = (await sayacPeek(`gunluk1:${anahtar}`, 1, GUN_MS)).izinVar;
  if (ilk) await sayacArtir(`gunluk1:${anahtar}`, GUN_MS);
  return ilk;
}
