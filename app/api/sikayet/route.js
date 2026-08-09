import { NextResponse } from 'next/server';
import { getSikayetService, getTelegramService, getModerasyonService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { ipRateLimitKontrol, qrRateLimitKontrol } from '@/lib/security/rateLimit';
import { imzaDogrula, dogrulamaTokenDogrula } from '@/lib/security/hmac';
import { aktifTenant } from '@/lib/server/tenant';
import { getClientIp } from '@/lib/server/ip';
import { aydinlatmaSurumu } from '@/lib/utils/constants';
import { uuidGecerliMi, bildirilenSokakGecerliMi } from '@/lib/utils/validators';

/**
 * POST /api/sikayet
 * 
 * Yeni şikayet oluşturur.
 * Bu endpoint'e ulaşmadan önce TC ve SMS doğrulaması yapılmış olmalıdır.
 * 
 * Defense in Depth katmanları:
 * 1. IP rate limiting
 * 2. QR rate limiting
 * 3. HMAC imza doğrulama (sahte QR koruması)
 * 4. JSON parse güvenliği
 * 5. Servis katmanı iş kuralları (haftalık limit, sokak kontrolü)
 * 
 * İstek gövdesi:
 * { sokakId, sig, dogrulamaToken, kategori, aciklama?, fotografUrl?, secilenSokakId? }
 * Not: TC/telefon GÖNDERİLMEZ. Kimlik, SMS doğrulaması sonrası verilen
 * imzalı dogrulamaToken içindeki kimlikHash ile taşınır (TC saklanmaz).
 *
 * `sokakId` = OKUTULAN QR (imza/anti-abuse kapısı — hiç değişmez).
 * `secilenSokakId` (opsiyonel) = vatandaşın formda seçtiği sokak; yanlış QR ya da
 * komşu sokak durumunda okutulan QR'dan FARKLI olabilir. Kaydedilecek konum budur.
 * Verilmezse okutulan QR'a düşülür (geriye dönük uyumlu). Tenant sahipliği, servis
 * katmanındaki `SokakRepository.idIleGetir(sokakId, tenantId)` ile doğrulanır.
 */

/**
 * Güvenli fotoğraf anahtarı deseni: `<tenantId>/<uuid>.jpg`. Modül düzeyinde BİR KEZ
 * derlenir (eskiden her POST'ta tenant.id ile `new RegExp` derleniyordu). tenantId
 * ayrı karşılaştırılır → tek jenerik regex tüm tenant'lar için yeniden kullanılır.
 */
const FOTO_KEY_DESENI = /^(\d+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;

export async function POST(request) {
  try {
    // === Tenant (belediye) — host'tan sunucuda çözülür; bilinmiyorsa 404 ===
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Katman 1: IP rate limiting
    const ip = getClientIp(request);
    const ipLimit = ipRateLimitKontrol(ip, 'sikayet');
    if (!ipLimit.izinVar) {
      return NextResponse.json(
        { hata: 'Çok fazla istek. Lütfen biraz bekleyin.' },
        { status: 429 }
      );
    }

    // Katman 2: Güvenli JSON parse
    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ hata: parseHata }, { status: 400 });
    }

    const { sokakId, sig, dogrulamaToken, kategori, aciklama, fotografUrl, kvkkOnay, secilenSokakId, secilenSokakAdi } = veri;

    // Katman 3: Zorunlu alanlar
    if (!sokakId || !sig || !dogrulamaToken || !kategori) {
      return NextResponse.json(
        { hata: 'Eksik alanlar var. Tüm zorunlu alanları doldurun.' },
        { status: 400 }
      );
    }

    // KVKK açık rızası zorunlu: ad/soyad/telefon yalnızca rıza ile saklanır.
    // İstemci onay vermeden kişisel veri işlenmez/saklanmaz.
    if (kvkkOnay !== true) {
      return NextResponse.json(
        { hata: 'Kişisel verilerin işlenmesine ilişkin onay (KVKK Aydınlatma Metni) gereklidir.' },
        { status: 400 }
      );
    }

    // Katman 4: QR rate limiting
    const qrLimit = qrRateLimitKontrol(sokakId);
    if (!qrLimit.izinVar) {
      return NextResponse.json(
        { hata: 'Bu QR koddan çok fazla şikayet gönderildi. Lütfen 1 saat sonra deneyin.' },
        { status: 429 }
      );
    }

    // Katman 5: HMAC imza doğrulama (sahte QR koruması)
    if (!imzaDogrula(sokakId, sig)) {
      return NextResponse.json(
        { hata: 'Geçersiz QR kodu. Bu link sahte veya bozulmuş olabilir.' },
        { status: 403 }
      );
    }

    // Katman 6: Doğrulama belirteci (TC+SMS doğrulamasının kanıtı).
    // İstemci body'sindeki kimliğe GÜVENİLMEZ; kimlikHash yalnızca sunucunun
    // imzaladığı, SMS doğrulaması sonrası verilen token'dan gelir. TC taşınmaz.
    const tokenSonuc = dogrulamaTokenDogrula(dogrulamaToken);
    if (!tokenSonuc.gecerli) {
      return NextResponse.json(
        { hata: tokenSonuc.hata || 'Doğrulama gerekli. Lütfen kimlik adımlarını tamamlayın.' },
        { status: 403 }
      );
    }

    // Fotoğraf anahtarı doğrulaması: istemciden gelen key'e GÜVENİLMEZ.
    // Yalnızca bu tenant'ın upload route'unun üreteceği `<tenantId>/<uuid>.jpg`
    // biçimini kabul et; aksi halde yok say (rastgele/çapraz-tenant key saklanmasın).
    // Önceden derlenmiş jenerik desenle eşle, tenantId'yi ayrıca karşılaştır.
    const fotoEslesme = typeof fotografUrl === 'string' ? FOTO_KEY_DESENI.exec(fotografUrl) : null;
    const guvenliFotografKey =
      fotoEslesme && fotoEslesme[1] === String(tenant.id) ? fotografUrl : null;

    // Konum artık vatandaştan ALINMAZ. Şikayetin haritadaki yeri, okutulan QR'ın
    // (sokağın) CSV'den gelen sabit koordinatıdır; servis/repo sokakId üzerinden çözer.
    // Cihaz GPS'i, anti-spoof denetimi ve foto EXIF karşılaştırması kaldırıldı.

    // Kaydedilecek KONUM sokağı + (varsa) bildirilen sokak adı. İki durum:
    //  (a) Vatandaş KAYITLI OLMAYAN bir sokak seçti/yazdı (secilenSokakAdi dolu): konum
    //      okutulan QR'da kalır (kayitSokakId = sokakId), sokak adı `bildirilenSokakAdi`
    //      olarak saklanır. Bu alan hem "±10 numara" önerisinden ("NNNN. SOKAK") hem de
    //      vatandaşın ELLE yazdığı serbest sokak adından gelebilir (kasıtlı özellik).
    //      bildirilenSokakGecerliMi: harf/rakam/boşluk + . - / ' dışına izin vermez →
    //      HTML/kontrol karakteri reddedilir (panelde ayrıca render'da kaçışlanır).
    //  (b) Aksi halde: kayıtlı sokak (secilenSokakId) veya okutulan QR. Tenant sahipliği
    //      servis katmanındaki SokakRepository.idIleGetir(sokakId, tenantId) ile doğrulanır.
    // İmza yukarıda okutulan `sokakId` üzerinden zaten doğrulandı (anti-abuse kapısı).
    if (secilenSokakId != null && !uuidGecerliMi(secilenSokakId)) {
      return NextResponse.json({ hata: 'Geçersiz sokak seçimi.' }, { status: 400 });
    }
    let kayitSokakId = secilenSokakId || sokakId;
    let bildirilenSokakAdi = null;
    if (secilenSokakAdi != null && String(secilenSokakAdi).trim() !== '') {
      const ad = String(secilenSokakAdi).trim();
      if (!bildirilenSokakGecerliMi(ad)) {
        return NextResponse.json({ hata: 'Geçersiz sokak adı.' }, { status: 400 });
      }
      bildirilenSokakAdi = ad;
      kayitSokakId = sokakId; // kayıtlı olmayan sokak → konum okutulan QR'da kalır
    }

    // Katman 7: Servis katmanı (iş kuralları + DB)
    const sikayetService = getSikayetService();
    const sonuc = await sikayetService.olustur({
      tenantId: tenant.id,
      sokakId: kayitSokakId,
      bildirilenSokakAdi,
      kimlikHash: tokenSonuc.kimlikHash,
      // Doğrulanmış kişisel veri (imzalı token'dan; istemci değiştiremez)
      ad: tokenSonuc.ad,
      soyad: tokenSonuc.soyad,
      telefon: tokenSonuc.telefon,
      // Numara YALNIZ bu belediye çözüm SMS'ini açtıysa (şifreli) saklanır. Bayrak
      // sunucuda, host'tan çözülen tenant kaydından gelir — istemci etkileyemez.
      cozumSmsiAcik: tenant.cozumSmsiAcik === true,
      kvkkOnay: true,
      // Onay verilen metnin sürümü BELEDİYEYE GÖRE değişir: çözüm SMS'i kapalı
      // belediyede aydınlatma metninde telefon saklama maddesi hiç görünmez, dolayısıyla
      // vatandaş farklı bir metne onay vermiştir. Aynı sürüm dizesini yazmak, hangi
      // metne rıza verildiğini ayırt edilemez kılardı (KVKK ispat yükümlülüğü).
      kvkkMetinSurumu: aydinlatmaSurumu(tenant),
      kategori,
      aciklama: aciklama || '',
      fotografUrl: guvenliFotografKey,
    });

    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    if (sonuc.moderasyonda) {
      // KÜFÜR FİLTRESİNE TAKILDI: kayıt `moderasyonda` açıldı. Saha ekibine ve başkana
      // bildirim GİTMEZ, haritaya/panele düşmez — yalnız ayrı moderasyon botuna düşer.
      // Vatandaşa aşağıda SIRADAN başarı yanıtı döner: filtrenin varlığı sızdırılmaz,
      // yoksa saldırgan hangi kelimenin geçtiğini deneyerek filtreyi kalibre ederdi.
      await getModerasyonService()
        .kufurBildir(sonuc.sikayet, { eslesme: sonuc.kufurEslesme, tur: sonuc.kufurTur })
        .catch((e) => console.error('moderasyon bildirimi hatası:', e));
    } else {
      // OTOMATİK BİLDİRİM: kategorinin biriminde bağlı personellere (aksiyon butonlu) +
      // başkan/yardımcıya (bilgi) Telegram bildirimi. En iyi çaba — asla fırlatmaz;
      // Telegram hatası vatandaşın kaydını/yanıtını ETKİLEMEZ (şikayet zaten kaydedildi).
      await getTelegramService().yeniSikayetBildir(sonuc.sikayet).catch((e) =>
        console.error('yeni şikayet bildirimi hatası:', e));
    }

    return NextResponse.json({
      basarili: true,
      mesaj: 'Şikayetiniz başarıyla iletildi.',
      sikayetId: sonuc.sikayet.id,
      // Başarı ekranında gösterilecek tenant'a özel bilgiler (kişisel veri değil)
      belediyeAdi: tenant.ad,
      baskanAdi: tenant.baskanAdi || null,
    }, { status: 201 });

  } catch (err) {
    console.error('Şikayet oluşturma hatası:', err);
    return NextResponse.json(
      { hata: 'Beklenmedik bir hata oluştu.' },
      { status: 500 }
    );
  }
}
