import { NextResponse } from 'next/server';
import { getSikayetService, getTelegramService, getModerasyonService, getBasvuruAkisServisi } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { ipRateLimitKontrol, qrRateLimitKontrol } from '@/lib/security/rateLimit';
import { imzaDogrula, dogrulamaTokenDogrula } from '@/lib/security/hmac';
import { aktifTenant } from '@/lib/server/tenant';
import { getClientIp } from '@/lib/server/ip';
import { aydinlatmaSurumu } from '@/lib/utils/constants';

/**
 * POST /api/sikayet
 *
 * Yeni başvuru (şikayet / görüş / öneri) oluşturur.
 * Bu uca ulaşmadan önce SMS doğrulaması tamamlanmış olmalıdır.
 *
 * Defense in Depth katmanları:
 * 1. IP rate limiting
 * 2. Güvenli JSON parse (bomb koruması)
 * 3. Zorunlu alanlar + KVKK açık rızası
 * 4. QR rate limiting
 * 5. HMAC imza doğrulama (sahte QR koruması)
 * 6. Doğrulama belirteci (SMS doğrulamasının imzalı kanıtı)
 * 7. Fotoğraf anahtarı biçim + tenant kontrolü
 * 8. Servis katmanı iş kuralları (tür/metin doğrulaması, pencere limiti, kara liste)
 *
 * İstek gövdesi: { sokakId, sig, dogrulamaToken, tur, aciklama, fotografUrl?, kvkkOnay }
 *
 * Not: Kimlik (ad/soyad/telefon) GÖNDERİLMEZ. Sunucunun imzaladığı `dogrulamaToken`
 * içinde taşınır — istemci değiştiremez. TC hiçbir zaman saklanmaz.
 *
 * `sokakId` = OKUTULAN QR noktası. Tek QR ürününde vatandaş konum SEÇMEZ; bu alan
 * imza kapısının bağlandığı ve `sikayetler.sokak_id` NOT NULL kısıtını karşılayan
 * kayıttır.
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

    const { sokakId, sig, dogrulamaToken, tur, aciklama, fotografUrl, kvkkOnay } = veri;

    // Katman 3: Zorunlu alanlar. `tur` ve `aciklama` biçim doğrulaması servis
    // katmanındaki domain entity'sindedir (tek otorite) — burada yalnız VARLIK aranır.
    if (!sokakId || !sig || !dogrulamaToken || !tur) {
      return NextResponse.json(
        { hata: 'Eksik alanlar var. Lütfen formu baştan doldurun.' },
        { status: 400 }
      );
    }

    // KVKK açık rızası zorunlu: rıza olmadan kişisel veri işlenmez/saklanmaz.
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
        { hata: 'Bu QR koddan çok fazla başvuru gönderildi. Lütfen 1 saat sonra deneyin.' },
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

    // Katman 6: Doğrulama belirteci (SMS doğrulamasının kanıtı).
    // İstemci body'sindeki kimliğe GÜVENİLMEZ; kimlikHash yalnızca sunucunun
    // imzaladığı, SMS doğrulaması sonrası verilen token'dan gelir.
    const tokenSonuc = dogrulamaTokenDogrula(dogrulamaToken);
    if (!tokenSonuc.gecerli) {
      return NextResponse.json(
        { hata: tokenSonuc.hata || 'Doğrulama gerekli. Lütfen kimlik adımlarını tamamlayın.' },
        { status: 403 }
      );
    }

    // Katman 7: Fotoğraf anahtarı doğrulaması — istemciden gelen key'e GÜVENİLMEZ.
    // Yalnızca bu tenant'ın upload route'unun üreteceği `<tenantId>/<uuid>.jpg`
    // biçimini kabul et; aksi halde yok say (rastgele/çapraz-tenant key saklanmasın).
    const fotoEslesme = typeof fotografUrl === 'string' ? FOTO_KEY_DESENI.exec(fotografUrl) : null;
    const guvenliFotografKey =
      fotoEslesme && fotoEslesme[1] === String(tenant.id) ? fotografUrl : null;

    // Katman 8: Servis katmanı (iş kuralları + DB)
    const sikayetService = getSikayetService();
    const sonuc = await sikayetService.olustur({
      tenantId: tenant.id,
      sokakId,
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
      tur,
      aciklama,
      fotografUrl: guvenliFotografKey,
    });

    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    if (sonuc.moderasyonda) {
      // KÜFÜR FİLTRESİNE TAKILDI: kayıt `moderasyonda` açıldı. Panele DÜŞMEZ, saha
      // ekibine ve başkana bildirim GİTMEZ, canlı akışa da girmez — yalnız ayrı
      // moderasyon botuna düşer. Vatandaşa aşağıda SIRADAN başarı yanıtı döner:
      // filtrenin varlığı sızdırılmaz, yoksa saldırgan hangi kelimenin geçtiğini
      // deneyerek filtreyi kalibre ederdi.
      await getModerasyonService()
        .kufurBildir(sonuc.sikayet, { eslesme: sonuc.kufurEslesme, tur: sonuc.kufurTur })
        .catch((e) => console.error('moderasyon bildirimi hatası:', e));
    } else {
      // CANLI AKIŞ: açık panellere anında düşsün (başkan sayfayı yenilemeden görsün).
      // En iyi çaba — yayın hatası vatandaşın kaydını/yanıtını ETKİLEMEZ.
      await getBasvuruAkisServisi()
        .yeniBasvuru(sonuc.sikayet.id, tenant.id)
        .catch((e) => console.error('canlı akış yayını hatası:', e));

      // TELEGRAM BİLGİSİ: başkan + yardımcısına. Saha personeline OTOMATİK bildirim
      // GİTMEZ — kategori ekseni olmadığı için "hangi birime düşer" sorusunun cevabı
      // yoktur; iş dağıtımı yönetimin ATAMA kararıdır (bkz. /api/admin/sikayetler/ata).
      await getTelegramService().yeniBasvuruBildir(sonuc.sikayet).catch((e) =>
        console.error('yeni başvuru bildirimi hatası:', e));
    }

    return NextResponse.json({
      basarili: true,
      mesaj: 'Başvurunuz başarıyla iletildi.',
      sikayetId: sonuc.sikayet.id,
      // Başarı ekranında gösterilecek tenant'a özel bilgiler (kişisel veri değil)
      belediyeAdi: tenant.ad,
      baskanAdi: tenant.baskanAdi || null,
    }, { status: 201 });

  } catch (err) {
    console.error('Başvuru oluşturma hatası:', err);
    return NextResponse.json(
      { hata: 'Beklenmedik bir hata oluştu.' },
      { status: 500 }
    );
  }
}
