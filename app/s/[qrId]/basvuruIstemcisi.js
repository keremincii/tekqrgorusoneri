/**
 * Başvuru API İstemcisi (tarayıcı tarafı)
 * ========================================
 *
 * Formun sunucuyla konuştuğu TEK yer. Bileşenlerin içine `fetch` serpiştirmek yerine
 * burada toplanır çünkü:
 *   - Adım bileşenleri (tür seçimi, foto, kimlik, kod) saf GÖRÜNÜM kalır; ne uç adı
 *     ne istek gövdesi bilirler → tek sorumluluk.
 *   - Hata biçimi TEK: her fonksiyon `{basarili, hata?, ...}` döner. Bir yerde
 *     `res.ok` unutulup hatalı yanıtın başarı sayılması mümkün değildir.
 *   - Ağ hatası ile sunucu hatası aynı kapıdan geçer; kullanıcıya "Bağlantı hatası"
 *     mesajı tek yerde üretilir.
 *
 * GÜVENLİK NOTU: Bu katman bir güvenlik sınırı DEĞİLDİR — istemcide çalışan her şey
 * kullanıcı tarafından değiştirilebilir. Buradaki kontroller yalnız kullanıcıya hızlı
 * geri bildirim içindir; gerçek doğrulama sunucudadır (bkz. app/api/**).
 */

/** Ağ katmanı hatalarında kullanıcıya gösterilecek tek mesaj. */
const BAGLANTI_HATASI = 'Bağlantı hatası. Lütfen tekrar deneyin.';

/**
 * JSON gövdeli POST atar ve yanıtı tek biçime indirger.
 * @param {string} url
 * @param {Object} govde
 * @returns {Promise<{basarili: boolean, veri: Object, hata?: string, adim?: string}>}
 */
async function jsonPost(url, govde) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(govde),
    });
    // Sunucu her zaman JSON döndürür; yine de bozuk/boş gövdeye karşı korunuyoruz
    // (ör. araya giren bir vekilin ürettiği HTML hata sayfası).
    const veri = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { basarili: false, veri, hata: veri.hata || BAGLANTI_HATASI, adim: veri.adim };
    }
    return { basarili: true, veri };
  } catch {
    return { basarili: false, veri: {}, hata: BAGLANTI_HATASI };
  }
}

/**
 * SMS'ten ÖNCE ucuz ön kontrol: bu numara limitli/engelli mi?
 * Ulaşılamazsa akışı BOZMAZ (`{izin: true}` varsayılır) — bu yalnız bir
 * optimizasyondur, nihai kapı /api/sikayet'tir.
 * @returns {Promise<{izin: boolean, hata?: string}>}
 */
export async function onKontrolYap(telefon) {
  const sonuc = await jsonPost('/api/dogrulama/on-kontrol', { telefon });
  if (!sonuc.basarili) return { izin: true }; // ulaşılamadı → normal akışa devam
  return sonuc.veri?.izin === false
    ? { izin: false, hata: sonuc.veri.hata }
    : { izin: true };
}

/**
 * Kimlik bilgilerini gönderir ve telefona SMS doğrulama kodu ister.
 * @returns {Promise<{basarili: boolean, hata?: string, adim?: string}>}
 *   `adim === 'gonder_limit'` → kod gönderim sınırı doldu (tekrar gönder gizlenmeli).
 */
export async function kodGonder({ ad, soyad, telefon, turnstileToken, fingerprint }) {
  const sonuc = await jsonPost('/api/dogrulama/tc', { ad, soyad, telefon, turnstileToken, fingerprint });
  return { basarili: sonuc.basarili, hata: sonuc.hata, adim: sonuc.adim };
}

/**
 * SMS kodunu doğrular. Başarılıysa, başvuruyu göndermeye yetkili İMZALI belirteci
 * döner (kimlik bilgisi istemcide taşınmaz — belirtecin içindedir ve sunucu imzalar).
 * @returns {Promise<{basarili: boolean, dogrulamaToken?: string, hata?: string}>}
 */
export async function kodDogrula({ telefon, kod }) {
  const sonuc = await jsonPost('/api/dogrulama/sms', { telefon, kod });
  return sonuc.basarili
    ? { basarili: true, dogrulamaToken: sonuc.veri.dogrulamaToken }
    : { basarili: false, hata: sonuc.hata };
}

/**
 * (Varsa) fotoğrafı yükler. Fotoğraf OPSİYONELDİR: yükleme başarısız olsa bile
 * başvuru yine gönderilir — vatandaş, bizim depolama sorunumuz yüzünden başvurusunu
 * kaybetmemelidir. Bu yüzden hata FIRLATMAZ, `null` döner.
 * @returns {Promise<string|null>} Sunucunun ürettiği güvenli nesne anahtarı
 */
export async function fotografYukle({ dosya, qrId, sig, dogrulamaToken }) {
  if (!dosya) return null;
  try {
    const fd = new FormData();
    fd.append('sokakId', qrId);
    fd.append('sig', sig);
    fd.append('dogrulamaToken', dogrulamaToken);
    fd.append('file', dosya);
    const res = await fetch('/api/sikayet/foto', { method: 'POST', body: fd });
    if (!res.ok) return null;
    const veri = await res.json().catch(() => ({}));
    return veri.fotografKey || null;
  } catch {
    return null;
  }
}

/**
 * Başvuruyu kaydeder. Yalnız SMS doğrulaması sonrası (imzalı belirteçle) çağrılır.
 * @returns {Promise<{basarili: boolean, belediyeAdi?: string, baskanAdi?: string, hata?: string}>}
 */
export async function basvuruGonder({ qrId, sig, dogrulamaToken, tur, aciklama, fotografKey }) {
  const sonuc = await jsonPost('/api/sikayet', {
    // sokakId + sig: HMAC kapısı (sahte QR koruması) + sikayetler.sokak_id NOT NULL.
    sokakId: qrId,
    sig,
    dogrulamaToken,
    tur,
    aciklama,
    fotografUrl: fotografKey,
    kvkkOnay: true, // kimlik adımında işaretlendi (sunucu da doğrular)
  });
  return sonuc.basarili
    ? {
      basarili: true,
      belediyeAdi: sonuc.veri.belediyeAdi || '',
      baskanAdi: sonuc.veri.baskanAdi || '',
    }
    : { basarili: false, hata: sonuc.hata };
}
