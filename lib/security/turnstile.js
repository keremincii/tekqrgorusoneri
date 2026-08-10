/**
 * Cloudflare Turnstile — Bot Doğrulama (siteverify)
 * =================================================
 *
 * SMS OTP kötüye kullanımına karşı EN YÜKSEK ROI'li tek önlem: SMS üretilmeden
 * ÖNCE isteğin bir bottan değil gerçek tarayıcıdan geldiğini doğrular. Böylece
 * otomatik kredi tüketimi ve numara tarama daha kapıda durur.
 *
 * Tasarım (projedeki Netgsm/Telegram entegrasyonları gibi):
 * - Harici kütüphane YOK; ham `fetch`.
 * - Hiçbir zaman exception FIRLATMAZ; her zaman `{ gecerli, ... }` döner.
 * - Secret tanımlı DEĞİLSE: geliştirmede sessizce ATLAR (dev'de Turnstile kurmak
 *   zorunda kalmayasın). Üretimde tanımlı değilse FAIL-CLOSED: istek REDDEDİLİR
 *   (eskiden fail-open ile sessizce geçiriliyordu — kaldırıldı). Zaten SMS modunda
 *   TURNSTILE_SECRET_KEY yoksa startupGuard sunucuyu HİÇ başlatmaz (ölümcül).
 *
 * Gerekli env:
 *   TURNSTILE_SECRET_KEY        — Cloudflare Turnstile gizli anahtarı (server)
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY — site anahtarı (frontend widget, ayrı dosyada)
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Turnstile token'ını Cloudflare'e doğrulatır.
 *
 * @param {string} token - Frontend widget'ının ürettiği token (cf-turnstile-response)
 * @param {string} [ip]  - İstemci IP'si (opsiyonel; Cloudflare'e remoteip olarak geçer)
 * @param {string} [beklenenHost] - Bu isteğin geldiği belediyenin host'u (ör.
 *   "derinkuyu.dijitalbelediyem.com"). Verilirse, Cloudflare'in siteverify yanıtındaki
 *   `hostname` alanıyla karşılaştırılır.
 *
 *   NEDEN GEREKLİ: Site key/secret çift birden çok belediye arasında PAYLAŞILABİLİR
 *   (ör. tek bir Cloudflare Turnstile widget'ı apex domain'e kurulup tüm alt alan
 *   adlarını kapsayabilir). Bu durumda, widget'ın ÜRETTİĞİ token her zaman hangi
 *   sayfada çözüldüyse o sayfanın hostname'ini taşır — ama `success:true` kontrolü
 *   TEK BAŞINA bunu ayırt etmez. Kontrol olmadan, Belediye A'nın sayfasında çözülen
 *   bir challenge'ın token'ı Belediye B'nin doğrulama ucuna gönderilip kabul
 *   edilebilirdi (iki belediye arasında bot-kapısı çapraz kullanımı). `beklenenHost`
 *   verilmezse bu kontrol atlanır (geriye dönük uyumlu; paylaşılmayan anahtarlarda
 *   zaten gereksizdir).
 * @returns {Promise<{gecerli: boolean, atlandi?: boolean, hata?: string}>}
 */
export async function turnstileDogrula(token, ip, beklenenHost) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Secret yoksa: dev'de atla (akış çalışsın); prod'da FAIL-CLOSED (reddet).
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '⛔ TURNSTILE_SECRET_KEY tanımlı değil — bot doğrulaması REDDEDİLİYOR (fail-closed). ' +
        'Anahtarı tanımlayın (SMS modunda startupGuard zaten başlatmayı engeller).'
      );
      return { gecerli: false, hata: 'Bot doğrulaması şu an yapılandırılmamış. Lütfen daha sonra tekrar deneyin.' };
    }
    return { gecerli: true, atlandi: true }; // yalnız geliştirme
  }

  // Token yoksa geçersiz (widget çözülmemiş / gönderilmemiş).
  if (!token || typeof token !== 'string') {
    return { gecerli: false, hata: 'Bot doğrulaması eksik. Sayfayı yenileyip tekrar deneyin.' };
  }

  // Timeout ZORUNLU: siteverify yavaş-ama-bağlı kalırsa (timeout'suz fetch undici
  // varsayılanıyla ~300 sn bekler) sıcak uçlarda binlerce istek asılı kalır ve
  // aşağıdaki fail-open catch'i HİÇ tetiklenmez. 5 sn'de kes → catch → fail-open.
  const ctrl = new AbortController();
  const zamanlayici = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const govde = new URLSearchParams();
    govde.append('secret', secret);
    govde.append('response', token);
    if (ip && ip !== 'unknown') govde.append('remoteip', ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: govde,
      signal: ctrl.signal,
    });
    const veri = await res.json().catch(() => ({}));

    if (veri && veri.success === true) {
      // Çapraz-belediye token kullanımı: challenge Belediye A'nın sayfasında
      // çözülmüş ama Belediye B'nin ucuna gönderilmiş. Yalnızca beklenenHost
      // VERİLDİYSE ve Cloudflare bir hostname döndürdüyse karşılaştırılır — ikisi
      // de eksikse (eski davranış) atlanır, sahte reddetme üretmez.
      //
      // Port SOYULUR: `request.headers.get('host')` bazen ":3000" gibi port taşır
      // (dev/origin-direkt istek), ama Cloudflare'in döndürdüğü hostname hiçbir
      // zaman port içermez — soymadan karşılaştırmak meşru isteği YANLIŞLIKLA
      // reddederdi. lib/server/host.js'teki hosttanSlug() ile AYNI normalizasyon.
      const beklenenAd = beklenenHost ? String(beklenenHost).split(':')[0].toLowerCase() : '';
      if (beklenenAd && veri.hostname && veri.hostname.toLowerCase() !== beklenenAd) {
        console.warn(
          `⚠ Turnstile hostname uyuşmazlığı: token "${veri.hostname}" sayfasında üretildi, ` +
          `"${beklenenAd}" ucuna gönderildi. Reddedildi.`
        );
        return { gecerli: false, hata: 'Bot doğrulaması bu sayfa için geçerli değil. Sayfayı yenileyip tekrar deneyin.' };
      }
      return { gecerli: true };
    }
    return { gecerli: false, hata: 'Bot doğrulaması başarısız. Lütfen tekrar deneyin.' };
  } catch (err) {
    // Cloudflare'e ulaşılamadı (kesinti/timeout). VARSAYILAN: fail-open — meşru kullanıcıyı
    // CF kesintisinde mağdur etme (SMS'i asıl koruyan katmanlı throttle + tenant bütçe
    // kesici + mağdur-susturma zaten devrede). OPT-IN: TURNSTILE_AG_HATASI_FAIL_CLOSED=1
    // ise ağ hatasında da REDDET (bot kapısı hiç düşmesin; erişilebilirlikten güvenliğe
    // ödün). Operatör tehdit modeline göre seçer.
    console.error('Turnstile siteverify hatası:', err?.message);
    if (process.env.TURNSTILE_AG_HATASI_FAIL_CLOSED === '1') {
      return { gecerli: false, hata: 'Bot doğrulaması şu an yapılamıyor. Lütfen birazdan tekrar deneyin.' };
    }
    return { gecerli: true, atlandi: true, hata: 'dogrulama-servisi-erisilemez' };
  } finally {
    clearTimeout(zamanlayici);
  }
}
