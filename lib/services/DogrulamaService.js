import { sha256Hashle, smsKoduUret, kimlikHashOlustur, sabitZamanliMetinEsit } from '@/lib/security/hmac.js';
import { tcKimlikGecerliMi, telefonGecerliMi, telefonuStandartlastir, adGecerliMi, dogumYiliGecerliMi } from '@/lib/utils/validators.js';
import { smsGonderimKontrol, smsGonderimTuket, hedefKaynakKaydet, smsDogrulandiKaydet } from '@/lib/security/rateLimit.js';
import { kvSetJson, kvGetJson, kvDel, kvSetJsonKeepTtl, kvSetNx } from '@/lib/infrastructure/redis/store.js';
import { GuvenlikSabitleri, SmsGuvenlikSabitleri, GENEL_RED_MESAJI } from '@/lib/utils/constants.js';

/** OTP deposu Redis anahtarı (telefonHash başına). */
const otpAnahtar = (telefonHash) => `otp:${telefonHash}`;

/** OTP doğrulama serileştirme kilidinin ömrü (ms). Kısa tutulur: eşzamanlı yanlış-kod
 *  isteklerinin deneme sayacını (oku-değiştir-yaz) yarıştırıp 5-deneme sınırını
 *  yumuşatmasını engeller. */
const OTP_DOGRULA_KILIT_MS = 10_000;

/**
 * DogrulamaService - Kimlik ve Telefon Doğrulama Servisi
 * 
 * Single Responsibility: Sadece doğrulama işlemlerini yönetir.
 * Dependency Inversion: SMS gönderim sağlayıcısını dışarıdan alır (constructor injection).
 *
 * Defense in Depth: Validasyon burada tekrar yapılır (API katmanındaki kontrole ek olarak).
 */
export class DogrulamaService {
  /**
   * @param {import('../../domain/interfaces/ISmsProvider.js').ISmsProvider} smsProvider
   *   SMS taşıyıcısı (Netgsm/Mock). Kod BİZDE üretilir, Redis'te TTL'li saklanır ve bu
   *   taşıyıcı ile gönderilir.
   */
  constructor(smsProvider) {
    this.smsProvider = smsProvider;
    // SMS/OTP kodları store (Redis öncelikli, in-memory fallback) üzerinde TTL'li
    // tutulur — restart/deploy'da kaybolmaması + çok-container için.
    // Bkz. lib/infrastructure/redis/store.js.
  }

  /**
   * TC Kimlik numarasını NVİ (Nüfus ve Vatandaşlık İşleri) üzerinden doğrular.
   * 
   * @param {string} tc - 11 haneli TC kimlik numarası
   * @param {string} ad - Kişinin adı (büyük harfle)
   * @param {string} soyad - Kişinin soyadı (büyük harfle)
   * @param {string|number} dogumYili - 4 haneli doğum yılı
   * @returns {Promise<{gecerli: boolean, hata?: string}>}
   */
  async tcDogrula(tc, ad, soyad, dogumYili) {
    // Katman 1: Format kontrolü (hızlı ret)
    if (!tcKimlikGecerliMi(tc)) {
      return { gecerli: false, hata: 'TC Kimlik numarası 11 haneli olmalıdır.' };
    }
    if (!adGecerliMi(ad)) {
      return { gecerli: false, hata: 'Ad alanı geçersiz.' };
    }
    if (!adGecerliMi(soyad)) {
      return { gecerli: false, hata: 'Soyad alanı geçersiz.' };
    }
    if (!dogumYiliGecerliMi(dogumYili)) {
      return { gecerli: false, hata: 'Doğum yılı geçersiz.' };
    }

    // NVİ KAPALI MODU (SMS-only):
    // NVİ ücretsiz public SOAP servisi (KPSPublic.asmx) NVİ tarafından kapatıldı
    // (her istek reCAPTCHA'lı web formuna / hata sayfasına yönleniyor; programatik
    // erişim yok). Kurumsal KPS erişimi (belediyenin resmi protokolü) devreye girene
    // kadar NVİ doğrulaması KAPALIDIR. Bu modda format kontrolleri (yukarıda) geçen
    // TC kabul edilir; kimlik güvencesi SMS OTP (doğrulanmış telefon) ile sağlanır.
    // Gerçek KPS bağlandığında açmak için: NVI_DOGRULAMA=acik
    if (process.env.NVI_DOGRULAMA !== 'acik') {
      return { gecerli: true };
    }

    // Katman 2: NVİ SOAP API sorgusu (yalnızca NVI_DOGRULAMA=acik iken)
    // XML KAÇIŞI (savunma-derinliği): ad/soyad zaten adGecerliMi ile harf+boşluğa
    // kısıtlı (< > & giremez), ama SOAP gövdesine gömülürken yine de kaçışlanır ki
    // ileride doğrulama gevşerse XML/SOAP parametre enjeksiyonu yüzeyi açılmasın.
    const xmlKacis = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    try {
      const soapXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TCKimlikNoDogrula xmlns="http://tckimlik.nvi.gov.tr/WS">
      <TCKimlikNo>${xmlKacis(tc)}</TCKimlikNo>
      <Ad>${xmlKacis(ad.toLocaleUpperCase('tr-TR').trim())}</Ad>
      <Soyad>${xmlKacis(soyad.toLocaleUpperCase('tr-TR').trim())}</Soyad>
      <DogumYili>${parseInt(dogumYili, 10)}</DogumYili>
    </TCKimlikNoDogrula>
  </soap:Body>
</soap:Envelope>`;

      const response = await fetch(
        'https://tckimlik.nvi.gov.tr/Service/KPSPublic.asmx',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://tckimlik.nvi.gov.tr/WS/TCKimlikNoDogrula"',
          },
          body: soapXml,
        }
      );

      const xmlText = await response.text();

      // NVİ yanıtında <TCKimlikNoDogrulaResult>true</TCKimlikNoDogrulaResult> varsa doğru
      const gecerli = xmlText.includes('>true<');

      if (!gecerli) {
        return { gecerli: false, hata: 'TC Kimlik bilgileri doğrulanamadı.' };
      }

      return { gecerli: true };
    } catch (err) {
      console.error('NVİ sorgusu hatası:', err.message);
      return { gecerli: false, hata: 'Kimlik doğrulama servisi şu an erişilemez. Lütfen tekrar deneyin.' };
    }
  }

  /**
   * Telefon numarasına SMS doğrulama kodu gönderir.
   *
   * Kimlik bilgileri (NVİ'de doğrulanmış ad/soyad/doğum yılı) verilirse,
   * 1 hafta kuralı için kullanılacak kimlikHash burada hesaplanıp koda bağlanır.
   * Böylece kimlikHash, istemcinin sonradan değiştiremeyeceği şekilde
   * doğrulanmış veriden türetilmiş olur.
   *
   * @param {string} telefon - Telefon numarası
   * @param {{ad: string, soyad: string, dogumYili: string|number}} [kimlikBilgisi]
   * @param {string} [belediyeAdi] - SMS metninde görünecek belediye adı (tenant'tan)
   * @param {string} [ip] - İstemci IP'si (IP bazlı gönderim throttle'ı için)
   * @param {string} [fpHash] - Cihaz parmak izinin hash'i (IP rotasyonuna karşı ek boyut)
   * @returns {Promise<{gonderildi: boolean, hata?: string, sebep?: string, sessiz?: boolean}>}
   *   sebep (reddedilince): gecersiz_telefon | hedef | global_kesici | cooldown |
   *   ip_hafta_farkli | ip_hafta_toplam | fp_hafta_farkli | fp_hafta_toplam | sms_hata.
   *   sebep='hedef' + sessiz=true: numara hedef alınmış, SESSİZCE susturuldu (SMS gitmez).
   */
  async smsKoduGonder(tenantId, telefon, kimlikBilgisi = null, belediyeAdi = null, ip = 'unknown', fpHash = null, smsProviderOverride = null) {
    if (!telefonGecerliMi(telefon)) {
      return { gonderildi: false, hata: 'Geçersiz telefon numarası.', sebep: 'gecersiz_telefon' };
    }

    const standartTelefon = telefonuStandartlastir(telefon);
    const telefonHash = sha256Hashle(standartTelefon);

    // Mağdur-hedef tespiti: bu denemenin kaynağını (IP) numaranın hedef-kümesine ekle.
    // Throttle sonucundan BAĞIMSIZ her denemede çağrılır ki çok-IP saldırısının
    // genişliği görülüp numara sessizce susturulabilsin.
    await hedefKaynakKaydet(telefonHash, ip);

    // Katmanlı gönderim throttle'ı (kredi tükenmesi + numara tarama + bombardıman +
    // parmak izi + global bütçe kesici). Önce ARTIRMADAN kontrol; geçerse gönderimden
    // hemen önce tüm sayaçlar birlikte tüketilir. Böylece reddedilen istekler mağdurun
    // telefon sayacını boşuna yükseltmez (GÜVENLİK planı Açık 3/4).
    const throttle = await smsGonderimKontrol(tenantId, telefonHash, ip, fpHash);
    if (!throttle.izinVar) {
      // Sessiz susturma: numara hedef alınmış. Route bunu nötr 200'e çevirir (saldırgana
      // "kod gönderildi" görünür ama SMS ÜRETİLMEZ; mağdur bombalanmaz, limit sızmaz).
      if (throttle.sebep === 'hedef') {
        return { gonderildi: false, sebep: 'hedef', sessiz: true, telefonHash };
      }
      // Mekanizmayı ifşa etmemek için TÜM throttle sebepleri (cooldown/IP/cihaz/global)
      // AYNI belirsiz mesajı döndürür — saldırgan hangi katmana takıldığını anlayamaz.
      // Gerçek sebep yalnız `sebep` alanında (audit log için) kalır, kullanıcıya sızmaz.
      return {
        gonderildi: false,
        sebep: throttle.sebep,
        telefonHash,
        hata: GENEL_RED_MESAJI,
      };
    }

    // 1 hafta kuralı için kimlikHash.
    // - NVİ AÇIK iken: ad+soyad+doğum+telefon (NVİ'de doğrulanmış kimliğe bağlı).
    // - NVİ KAPALI (SMS-only) iken: YALNIZCA doğrulanmış telefon. Kimlik bilgisi NVİ'de
    //   doğrulanmadığından ada bağlamak, troll'ün her seferinde adını değiştirip haftalık
    //   limiti aşmasına izin verirdi; SMS ile kanıtlanan tek şey telefon sahipliğidir.
    const nviAcik = process.env.NVI_DOGRULAMA === 'acik';
    const kimlikHash = (nviAcik && kimlikBilgisi)
      ? kimlikHashOlustur(kimlikBilgisi.ad, kimlikBilgisi.soyad, kimlikBilgisi.dogumYili, standartTelefon)
      : sha256Hashle(`tel:${standartTelefon}`);

    // OTP Redis kaydı: 6 haneli kod bizde üretilir ve kimlik bilgileriyle birlikte
    // TTL'li yazılır. ad/soyad/telefon, doğrulama başarılı olunca imzalı token'a
    // gömülür ve şikayetle birlikte saklanır (KVKK açık rızasıyla).
    const kayit = {
      sonGecerlilik: Date.now() + GuvenlikSabitleri.SMS_KOD_SURESI_MS,
      kimlikHash,
      ad: kimlikBilgisi?.ad ? String(kimlikBilgisi.ad).trim() : '',
      soyad: kimlikBilgisi?.soyad ? String(kimlikBilgisi.soyad).trim() : '',
      telefon: standartTelefon,
      deneme: 0, // yanlış kod deneme sayacı (brute-force koruması, per-OTP)
      kod: smsKoduUret(), // 6 haneli
    };
    await kvSetJson(otpAnahtar(telefonHash), kayit, GuvenlikSabitleri.SMS_KOD_SURESI_MS);

    // Tüm limitleri geçtik → gönderimden hemen önce sayaçları TÜKET (telefon + IP +
    // global bütçe). Gönderim öncesi tüketmek eşzamanlı istek yarışında güvenli
    // yöndedir (limiti sıkılaştırır). SMS başarısız olsa bile bir slot harcanmış
    // sayılır (nadir; cüzdan-güvenli taraf).
    await smsGonderimTuket(tenantId, telefonHash, ip, fpHash);

    // Gönderim: per-tenant sağlayıcı (o belediyenin kendi Netgsm hesabı) verildiyse
    // onu kullan; yoksa DI ile gelen global sağlayıcıya (Netgsm/Mock) düş.
    const gonderici = smsProviderOverride || this.smsProvider;
    const ad = belediyeAdi || process.env.NEXT_PUBLIC_BELEDIYE_ADI || 'Belediye';
    const mesaj = `${ad} Şikayet Sistemi doğrulama kodunuz: ${kayit.kod}`;
    const sonuc = await gonderici.smsGonder(standartTelefon, mesaj);

    if (!sonuc.basarili) {
      await kvDel(otpAnahtar(telefonHash));
      return { gonderildi: false, hata: sonuc.hata || 'SMS gönderilemedi.', sebep: 'sms_hata', telefonHash };
    }

    return { gonderildi: true, telefonHash };
  }

  /**
   * Vatandaşın girdiği SMS kodunu doğrular.
   *
   * @param {string} telefon - Telefon numarası
   * @param {string} girilenKod - Vatandaşın girdiği kod
   * @returns {Promise<{gecerli: boolean, kimlikHash?: string|null, ad?: string, soyad?: string, telefon?: string, hata?: string}>}
   */
  async smsKoduDogrula(tenantId, telefon, girilenKod) {
    const standartTelefon = telefonuStandartlastir(telefon);
    const telefonHash = sha256Hashle(standartTelefon);
    const anahtar = otpAnahtar(telefonHash);

    // Per-OTP atomik serileştirme: eşzamanlı yanlış-kod istekleri deneme sayacını
    // (kvGet → +1 → kvSet) yarıştırıp hepsi deneme=0 okuyarak 5-deneme sert sınırını
    // AŞMASIN diye, aynı numaranın doğrulaması aynı anda TEK yürür. Kaybeden istek
    // "işleniyor" alır: meşru kullanıcı kodu tek tek girer (etkilenmez); saldırganın
    // paralel tahmin seli serileştirilir → 5-deneme sınırı gerçekten yürürlükte kalır.
    const dogrulaKilit = `otp_dogrula_kilit:${telefonHash}`;
    if (!(await kvSetNx(dogrulaKilit, { t: 1 }, OTP_DOGRULA_KILIT_MS))) {
      return { gecerli: false, hata: 'Doğrulama işleniyor; lütfen birkaç saniye sonra tekrar deneyin.' };
    }
    try {
      const kayit = await kvGetJson(anahtar);

      if (!kayit) {
        return { gecerli: false, hata: 'Doğrulama kodu bulunamadı. Lütfen yeni kod isteyin.' };
      }

      // Süre kontrolü (store TTL zaten süreyi yönetir; bu ek bir güvence katmanı).
      if (Date.now() > kayit.sonGecerlilik) {
        await kvDel(anahtar);
        return { gecerli: false, hata: 'Doğrulama kodunun süresi doldu. Lütfen yeni kod isteyin.' };
      }

      // Kod bizde üretildi → kayıtla karşılaştır (per-OTP deneme sayacı).
      // Karşılaştırma SABİT ZAMANLI (timing yan-kanalını kapatır). ÖNEMLİ: Ceza telefona
      // GLOBAL ban DEĞİL, yalnızca BU koda özeldir. Limit dolunca sadece bu kod iptal edilir;
      // gerçek numara sahibi yeni kod isteyip devam edebilir → saldırgan başkasının
      // numarasını kilitleyemez (GÜVENLİK planı Açık 3/4).
      if (!sabitZamanliMetinEsit(String(kayit.kod), String(girilenKod))) {
        kayit.deneme = (kayit.deneme || 0) + 1;
        if (kayit.deneme >= SmsGuvenlikSabitleri.SMS_KOD_DENEME_LIMIT) {
          await kvDel(anahtar);
          return { gecerli: false, hata: 'Çok fazla hatalı deneme. Lütfen yeni kod isteyin.' };
        }
        // Artan deneme sayısını, kodun kalan TTL'ini KORUYARAK kalıcı yap.
        await kvSetJsonKeepTtl(anahtar, kayit);
        return { gecerli: false, hata: 'Girdiğiniz kod hatalı.' };
      }

      // Başarılı → kodu temizle (tek kullanımlık) + conversion (doğrulanan) sayacına işle.
      // Bu sayaç, gönderilen/doğrulanan oranını besler (saldırı = gönderir ama doğrulamaz).
      const { kimlikHash, ad, soyad, telefon: kayitTelefon } = kayit;
      await kvDel(anahtar);
      await smsDogrulandiKaydet(tenantId);
      return { gecerli: true, kimlikHash, ad, soyad, telefon: kayitTelefon };
    } finally {
      await kvDel(dogrulaKilit);
    }
  }
}
