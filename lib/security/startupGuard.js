/**
 * Üretim Başlangıç Güvenlik Denetimi
 * ==================================
 *
 * instrumentation.js `register()` ile sunucu açılışında BİR KEZ çalışır.
 *
 * İKİ SINIF:
 *  - ÖLÜMCÜL (fail-closed): Güvenliği kökten çökerten yapılandırma eksikse `throw` eder
 *    → sunucu GÜVENSİZ başlamaktansa HİÇ başlamaz. (HMAC_SECRET zayıf/örnek; Turnstile
 *    yok.) Operatör env'i düzeltip yeniden başlatana kadar açılmaz.
 *  - UYARI: Önemli ama ölümcül olmayan eksikler (alarm botu, Netgsm bilgileri vs.)
 *    yalnız log'a yazılır; operatör görüp tamamlar.
 */
export function guvenlikBaslangicKontrolu() {
  const prod = process.env.NODE_ENV === 'production';

  if (!prod) {
    console.info('ℹ Geliştirme modu (NODE_ENV != production). Üretim güvenlik denetimi atlandı.');
    return;
  }

  const olumcul = []; // sistem AÇILMAMALI (fail-closed → throw)
  const uyarilar = []; // açılır ama en kısa sürede düzeltilmeli

  // ÖLÜMCÜL — HMAC_SECRET zayıf/örnek/eksik: QR imzası, doğrulama token'ı, kimlik/IP
  // hash'leri hepsi buna dayanır. Tahmin edilebilir secret → imza sahteleme → doğrulama
  // atlama. (≥32 karakter değilse imza katmanı zaten throw eder; buradaki ek kontrol
  // "32+ ama örnek/placeholder" durumunu da yakalar.)
  const hmac = process.env.HMAC_SECRET || '';
  if (!hmac || hmac.length < 32 || hmac.includes('buraya_gercek_anahtar')) {
    olumcul.push('HMAC_SECRET zayıf/örnek/eksik → gerçek, en az 32 karakter rastgele bir değer olmalı.');
  }

  // ÖLÜMCÜL — Turnstile yoksa bot kapısı tümüyle devre dışı kalır → Netgsm SMS
  // kredisi otomatik tüketimine açık. Doğrulama tek yollu (SMS OTP) olduğu için
  // bu kapı her zaman zorunludur.
  if (!process.env.TURNSTILE_SECRET_KEY) {
    olumcul.push('TURNSTILE_SECRET_KEY yok → bot kapısı devre dışı; SMS kötüye kullanımına açık.');
  }

  // --- Uyarılar (açılışı engellemez) ---
  const netgsmHazir =
    process.env.NETGSM_USERCODE && process.env.NETGSM_PASSWORD && process.env.NETGSM_HEADER;

  if (!netgsmHazir) {
    uyarilar.push('Netgsm bilgileri (NETGSM_USERCODE/PASSWORD/HEADER) eksik → GERÇEK SMS GÖNDERİLMEZ (MockSmsProvider sessiz çalışır).');
  }

  if (!process.env.TELEGRAM_ALARM_BOT_TOKEN || !process.env.TELEGRAM_ALARM_CHAT_ID) {
    uyarilar.push('TELEGRAM_ALARM_BOT_TOKEN/CHAT_ID eksik → SMS bütçe kesici uyarıları gönderilmez.');
  }

  // Küfür filtresine takılan şikayet yalnız moderasyon botuna düşer; bot yoksa kayıt
  // `moderasyonda` durumunda bekler ve HİÇBİR YERDE görünmez.
  if (!process.env.TELEGRAM_MODERASYON_BOT_TOKEN || !process.env.TELEGRAM_MODERASYON_CHAT_ID) {
    uyarilar.push('TELEGRAM_MODERASYON_BOT_TOKEN/CHAT_ID eksik → küfür filtresine takılan şikayetler görünmez şekilde bekler.');
  }

  // ÖLÜMCÜL varsa: sistemi başlatma (throw → instrumentation register() başarısız olur).
  if (olumcul.length) {
    throw new Error(
      '\n🛑 ÜRETİM GÜVENLİK DENETİMİ BAŞARISIZ — sistem GÜVENSİZ başlatılmadı:\n' +
      olumcul.map((u) => '  ✖ ' + u).join('\n') +
      '\nBu env değişkenlerini düzeltip yeniden başlatın.\n'
    );
  }

  if (uyarilar.length) {
    console.warn(
      '\n🚨 ÜRETİM GÜVENLİK UYARILARI (sistem başlatıldı, ölümcül değil):\n' +
      uyarilar.map((u) => '  • ' + u).join('\n') +
      '\nBu maddeleri en kısa sürede düzeltin.\n'
    );
  } else {
    console.info('✅ Üretim güvenlik denetimi geçti (HMAC, Turnstile/mod, sağlayıcı, alarm botu tanımlı).');
  }
}
