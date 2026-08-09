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
 * @returns {Promise<{gecerli: boolean, atlandi?: boolean, hata?: string}>}
 */
export async function turnstileDogrula(token, ip) {
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
