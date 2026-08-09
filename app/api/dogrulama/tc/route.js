import { NextResponse } from 'next/server';
import { getDogrulamaService, getAlarmService, getSmsLogRepository, getTenantSmsProvider, getSikayetService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { ipRateLimitKontrol, conversionDegerlendir } from '@/lib/security/rateLimit';
import { turnstileDogrula } from '@/lib/security/turnstile';
import { datacenterEngelliMi } from '@/lib/security/ipReputation';
import { sha256Hashle } from '@/lib/security/hmac';
import { getClientIp } from '@/lib/server/ip';
import { aktifTenant } from '@/lib/server/tenant';
import { adGecerliMi, telefonuStandartlastir } from '@/lib/utils/validators';
import { SmsGuvenlikSabitleri, GENEL_RED_MESAJI } from '@/lib/utils/constants';
import { sayacPeek, sayacArtir } from '@/lib/infrastructure/redis/store.js';

/** 429 (çok fazla istek) dönecek throttle sebepleri (audit log 'throttle' etiketi). */
const THROTTLE_SEBEPLER = ['cooldown', 'ip_hafta_farkli', 'ip_hafta_toplam', 'fp_hafta_farkli', 'fp_hafta_toplam'];

/**
 * POST /api/dogrulama/tc
 * 
 * Vatandaşın TC kimlik bilgilerini doğrular.
 * TC doğruysa otomatik olarak telefona SMS kodu gönderir.
 * 
 * Defense in Depth (ucuz kontrol önce — SMS ancak hepsini geçince üretilir):
 * 1. Rate limiting (IP bazlı)
 * 2. JSON parse güvenliği (bomb koruması)
 * 3. Girdi doğrulama (validators)
 * 4. Bot kapısı (Cloudflare Turnstile)
 * 5. NVİ SOAP sorgusu (yalnız NVI_DOGRULAMA=acik)
 * 6. Katmanlı SMS gönderim throttle'ı + global bütçe kesici (serviste)
 *
 * İstek gövdesi:
 * { tc, ad, soyad, dogumYili, telefon }
 */
export async function POST(request) {
  try {
    // Tenant (belediye) — host'tan çözülür; SMS metninde adı kullanılır
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Katman 1: IP rate limiting
    const ip = getClientIp(request);
    const ipHash = ip && ip !== 'unknown' ? sha256Hashle(ip) : null; // audit log (KVKK: ham IP saklanmaz)
    const rateLimitSonuc = ipRateLimitKontrol(ip, 'tc');
    if (!rateLimitSonuc.izinVar) {
      return NextResponse.json(
        { hata: 'Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.' },
        { status: 429 }
      );
    }

    // Katman 1b: Datacenter/VPN kapısı (Cloudflare edge header'ı) — en ucuz eleme,
    // SMS üretiminden ve JSON parse'tan önce. Gerçek vatandaş residential/mobil ISP'de;
    // bot AWS/DigitalOcean/VPN'de. Header yoksa (kural kurulmamış) etkisizdir.
    if (datacenterEngelliMi(request)) {
      try {
        await getSmsLogRepository().kaydet({ tenantId: tenant.id, ipHash, sonuc: 'datacenter' });
      } catch { /* audit log ana akışı bozmaz */ }
      return NextResponse.json(
        { hata: 'İsteğiniz güvenlik nedeniyle işlenemedi. Lütfen mobil bağlantı/farklı ağ deneyin.', adim: 'bot' },
        { status: 403 }
      );
    }

    // Katman 2: Güvenli JSON parse
    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ hata: parseHata }, { status: 400 });
    }

    const { tc, ad, soyad, dogumYili, telefon, turnstileToken, fingerprint } = veri;

    // Cihaz parmak izi (FingerprintJS visitorId) → hash'lenerek throttle boyutu olur.
    // KVKK: ham parmak izi saklanmaz; yalnız throttle anahtarı olarak hash kullanılır.
    // Gelmezse (CDN engelli/JS kapalı) fpHash null → fp katmanı atlanır, diğerleri çalışır.
    const fpHash = (typeof fingerprint === 'string' && fingerprint.length >= 8 && fingerprint.length <= 128)
      ? sha256Hashle(`fp:${fingerprint}`)
      : null;

    // Katman 3: Zorunlu alanlar. SMS-only modda ad/soyad/telefon yeterlidir;
    // TC ve doğum yılı yalnızca NVİ açıkken (kurumsal KPS) gerekir.
    if (!ad || !soyad || !telefon) {
      return NextResponse.json(
        { hata: 'Ad, Soyad ve Telefon alanları zorunludur.' },
        { status: 400 }
      );
    }
    if (!adGecerliMi(ad) || !adGecerliMi(soyad)) {
      return NextResponse.json({ hata: 'Ad veya soyad geçersiz.' }, { status: 400 });
    }

    // Katman 4: Bot kapısı (Cloudflare Turnstile) — SMS üretiminden ÖNCE, NVİ SOAP'tan
    // önce. Otomatik kredi tüketimini/numara taramayı daha kapıda durdurur. Secret
    // tanımlı değilse geliştirmede otomatik atlanır (turnstileDogrula içinde).
    const botSonuc = await turnstileDogrula(turnstileToken, ip);
    if (!botSonuc.gecerli) {
      try {
        await getSmsLogRepository().kaydet({ tenantId: tenant.id, ipHash, sonuc: 'turnstile' });
      } catch { /* audit log ana akışı bozmaz */ }
      return NextResponse.json({ hata: botSonuc.hata, adim: 'bot' }, { status: 403 });
    }

    const dogrulamaService = getDogrulamaService();

    // Katman 4a-1: KARA LİSTE — engellenmiş numaraya SMS GÖNDERME. Telefon girilir girilmez
    // burada kesilir → engelli kişi boşuna SMS/kredi harcatamaz (nihai kapı /api/sikayet).
    try {
      if (await getSikayetService().telefonEngelliMi(telefon, tenant.id)) {
        return NextResponse.json({ hata: GENEL_RED_MESAJI, adim: 'red' }, { status: 403 });
      }
    } catch { /* patlarsa akışı bozma; nihai kapı /api/sikayet */ }

    // Katman 4a-2: Kod gönderim sınırı — aynı numaraya penceresinde en fazla SMS_GONDER_MAX
    // kod (ilk + "tekrar gönder"lerin toplamı). "Yeniden gönder" spam'ini keser (SMS parası).
    const gonderKey = `sms_gonder:${tenant.id}:${sha256Hashle(`tel:${telefonuStandartlastir(String(telefon || ''))}`)}`;
    if (!(await sayacPeek(gonderKey, SmsGuvenlikSabitleri.SMS_GONDER_MAX, SmsGuvenlikSabitleri.SMS_GONDER_PENCERE_MS)).izinVar) {
      return NextResponse.json({ hata: GENEL_RED_MESAJI, adim: 'gonder_limit' }, { status: 429 });
    }

    // Katman 4b: Haftalık limit ÖN-KONTROLÜ (SMS ÜRETMEDEN). Kullanıcı limite zaten
    // takıldıysa Netgsm SMS'i boşa gitmesin — nihai kapı /api/sikayet olsa da parayı
    // burada koruyoruz. (Optimizasyon; DB sayımı otoritedir.)
    try {
      const limitDurum = await getSikayetService().telefonHaftalikDolu(telefon, tenant.id);
      if (limitDurum.dolu) {
        // Haftalık limit MEŞRU bir kuraldır (engelleme/cihaz gibi gizli mekanizma DEĞİL) →
        // dürüst vatandaşa kaç hak / ne zaman tekrar bilgisi verilir.
        return NextResponse.json({ hata: `Bu dönemde en fazla ${limitDurum.adet} şikayet gönderebilirsiniz. Yaklaşık ${limitDurum.kalanGun} gün sonra tekrar deneyebilirsiniz.`, adim: 'limit' }, { status: 429 });
      }
    } catch { /* ön-kontrol patlarsa akışı bozma; nihai kapı /api/sikayet */ }

    // Katman 5: TC doğrulama YALNIZCA NVI_DOGRULAMA=acik iken (kurumsal KPS bağlıyken).
    // NVİ public servisi kapandığı için varsayılan SMS-only'dir; kimlik güvencesi
    // SMS OTP (doğrulanmış telefon) ile sağlanır.
    if (process.env.NVI_DOGRULAMA === 'acik') {
      if (!tc || !dogumYili) {
        return NextResponse.json(
          { hata: 'TC Kimlik No ve Doğum Yılı zorunludur.' },
          { status: 400 }
        );
      }
      const tcSonuc = await dogrulamaService.tcDogrula(tc, ad, soyad, dogumYili);
      if (!tcSonuc.gecerli) {
        return NextResponse.json({ hata: tcSonuc.hata, adim: 'tc' }, { status: 400 });
      }
    }

    // Katman 6: SMS kodu gönder. Doğrulanmış kişisel veri (ad/soyad/telefon) ve
    // 1 hafta kuralının kimlikHash'i burada hazırlanıp koda bağlanır (TC saklanmaz).
    // Belediye adı tenant'tan gelir (SMS metni için, multi-tenant). IP geçilir →
    // servis içinde katmanlı gönderim throttle'ı + global bütçe kesici uygulanır.
    // Per-tenant SMS sağlayıcısı: belediyenin kendi Netgsm hesabı (varsa) → o hesaptan
    // gönderilir; yoksa global env fallback'i.
    const tenantSmsProvider = getTenantSmsProvider(tenant);
    const smsSonuc = await dogrulamaService.smsKoduGonder(
      tenant.id,
      telefon,
      { ad, soyad, dogumYili },
      tenant.ad,
      ip,
      fpHash,
      tenantSmsProvider
    );

    // Audit log (fire-safe): her gönderim denemesini kaydet (anomali/adli iz).
    try {
      const sonucEtiket = smsSonuc.gonderildi ? 'gonderildi'
        : smsSonuc.sebep === 'hedef' ? 'hedef'
        : smsSonuc.sebep === 'global_kesici' ? 'kesici'
        : THROTTLE_SEBEPLER.includes(smsSonuc.sebep) ? 'throttle'
        : smsSonuc.sebep === 'gecersiz_telefon' ? 'gecersiz'
        : 'sms_hata';
      await getSmsLogRepository().kaydet({
        tenantId: tenant.id,
        telefonHash: smsSonuc.telefonHash || null,
        ipHash,
        sonuc: sonucEtiket,
        sebep: smsSonuc.sebep || null,
      });
    } catch { /* audit log ana akışı bozmaz */ }

    // Başarıyla gönderildiyse kod-gönderim sayacını artır (sınır: SMS_GONDER_MAX/pencere).
    if (smsSonuc.gonderildi) {
      try { await sayacArtir(gonderKey, SmsGuvenlikSabitleri.SMS_GONDER_PENCERE_MS); } catch { /* sayaç hatası akışı bozmaz */ }
    }

    if (!smsSonuc.gonderildi) {
      // Mağdur-hedef sessiz susturma: numara çok-IP saldırısıyla hedef alınmış. Saldırgana
      // NÖTR 200 döneriz (sanki kod gönderilmiş gibi) ama SMS ÜRETİLMEDİ → ne mağdur
      // bombalanır ne de limit sinyali sızar. Meşru sahip susturuldu ise sonra tekrar dener.
      if (smsSonuc.sebep === 'hedef') {
        return NextResponse.json({
          basarili: true,
          mesaj: 'Bilgiler alındı. Telefonunuza doğrulama kodu gönderildi.',
        });
      }
      // Global bütçe kesici tetiklendi → operatöre AYRI Telegram botuyla uyar, 503 dön.
      if (smsSonuc.sebep === 'global_kesici') {
        try {
          await getAlarmService().smsButcesiUyar({
            limit: SmsGuvenlikSabitleri.SMS_GLOBAL_GUN_LIMIT,
            belediye: tenant.ad,
          });
        } catch (e) {
          console.error('Alarm bildirimi gönderilemedi:', e?.message);
        }
        return NextResponse.json({ hata: smsSonuc.hata, adim: 'sms' }, { status: 503 });
      }
      // Throttle sebepleri → 429 (çok fazla istek); diğerleri (geçersiz telefon / SMS
      // sağlayıcı hatası) → 400.
      const durum = THROTTLE_SEBEPLER.includes(smsSonuc.sebep) ? 429 : 400;
      return NextResponse.json({ hata: smsSonuc.hata, adim: 'sms' }, { status: durum });
    }

    // Conversion izleme: bu başarılı gönderimden sonra günlük doğrulanan/gönderilen
    // oranını değerlendir. Oran düşük + yeni tetiklenmişse SAVUNMA MODU kuruldu →
    // operatörü AYRI Telegram botuyla uyar (fire-safe; ana akışı bozmaz).
    try {
      const konv = await conversionDegerlendir(tenant.id);
      if (konv.kotu && konv.yeniTetik) {
        await getAlarmService().konversiyonUyar({
          oran: konv.oran,
          gonderilen: konv.gonderilen,
          dogrulanan: konv.dogrulanan,
          belediye: tenant.ad,
        });
      }
    } catch (e) {
      console.error('Conversion değerlendirme/uyarı hatası:', e?.message);
    }

    return NextResponse.json({
      basarili: true,
      mesaj: 'Bilgiler alındı. Telefonunuza doğrulama kodu gönderildi.',
    });

  } catch (err) {
    console.error('TC doğrulama hatası:', err);
    return NextResponse.json(
      { hata: 'Beklenmedik bir hata oluştu. Lütfen tekrar deneyin.' },
      { status: 500 }
    );
  }
}
