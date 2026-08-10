import { NextResponse } from 'next/server';
import { getSikayetService, getTelegramService, getBasvuruAkisServisi } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { SikayetDurumu, GORUNMEZ_DURUMLAR, durumKapaliMi } from '@/lib/utils/constants';
import { adminOturumKontrol } from '@/lib/server/adminOturum';

/** Tek sayfada dönebilecek en fazla kayıt (istemci daha fazlasını isteyemez). */
const SAYFA_TAVANI = 500;
/** Sayfa boyutu belirtilmezse. Panelin ilk ekranını rahat dolduran bir değer. */
const SAYFA_VARSAYILAN = 100;

/**
 * GET /api/admin/sikayetler
 *
 * Başkan panelinin listesi. Filtreler SUNUCUDA uygulanır:
 *   ?tur=sikayet|gorus|oneri   → tek tür (yoksa hepsi)
 *   ?durum=beklemede,inceleniyor → virgüllü durum listesi (yoksa görünür olanların hepsi)
 *   ?q=<arama>                 → başvuru metninde geçen ifade
 *   ?limit= &offset=           → sayfalama ("daha fazla yükle")
 *   ?sayimlar=1                → yanıta (tür, durum) kırılımlı toplam sayaçlar eklenir
 *
 * Sayaçlar liste ile aynı yanıtta ama AYRI hesaplanır: liste sayfalıdır, rozetlerin
 * ise TÜM tabloyu yansıtması gerekir. İstemci ilk yüklemede ister, sonraki
 * "daha fazla" isteklerinde istemez (boşuna sayım yapılmasın).
 */
export async function GET(request) {
  try {
    const { tenant, hataYanit } = await adminOturumKontrol(request);
    if (hataYanit) return hataYanit;

    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || String(SAYFA_VARSAYILAN), 10) || SAYFA_VARSAYILAN, 1),
      SAYFA_TAVANI
    );
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    const durumParam = url.searchParams.get('durum');

    const sikayetService = getSikayetService();
    const liste = await sikayetService.panelListesi(tenant.id, {
      tur: url.searchParams.get('tur') || null,
      // Whitelist servis katmanında; burada yalnız ayrıştırma yapılır.
      durumlar: durumParam ? durumParam.split(',').map((d) => d.trim()).filter(Boolean) : null,
      arama: url.searchParams.get('q') || '',
      limit,
      offset,
    });

    // R2 anahtarını istemciye SIZDIRMA: yalnızca fotoğraf VAR MI bilgisini ver.
    // Fotoğrafın kendisi yetkili /api/admin/foto/[id] route'undan çekilir.
    const guvenliListe = liste.map(({ fotografUrl, ...s }) => ({
      ...s,
      fotografVar: Boolean(fotografUrl),
    }));

    const yanit = {
      basvurular: guvenliListe,
      // Sayfanın sonuna gelindi mi? İstemci "daha fazla yükle" butonunu buna göre gizler.
      devamVar: guvenliListe.length === limit,
      belediye: { ad: tenant.ad, baskanAdi: tenant.baskanAdi || null },
    };

    if (url.searchParams.get('sayimlar') === '1') {
      yanit.sayimlar = await sikayetService.panelSayimlari(tenant.id);
    }

    return NextResponse.json(yanit);
  } catch (err) {
    console.error('Başvuru listeleme hatası:', err);
    return NextResponse.json({ hata: 'Veriler yüklenemedi.' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/sikayetler
 *
 * Başvuru durumunu günceller (başkan tarafından).
 * İstek gövdesi: { sikayetId, yeniDurum }
 */
export async function PATCH(request) {
  try {
    const { tenant, hataYanit } = await adminOturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ hata: parseHata }, { status: 400 });
    }

    const { sikayetId, yeniDurum } = veri;

    if (!sikayetId || !yeniDurum) {
      return NextResponse.json({ hata: 'Başvuru ID ve yeni durum zorunludur.' }, { status: 400 });
    }

    // Kaba durum kontrolü; ASIL KAPI SikayetService.durumGuncelle'dedir (orası
    // constants.SikayetDurumlari sözlüğüne göre doğrular). Burada yalnız GİZLİ durumlar
    // elenir: 'silindi'/'moderasyonda' bir "durum güncellemesi" değil, ayrı akışların
    // (soft-delete / küfür moderasyonu) sonucudur; bu uçtan yazılabilmeleri gerekmez.
    // Liste sabit KOPYALANMAZ, sözleşmeden türetilir.
    const gecerliDurumlar = Object.values(SikayetDurumu).filter((d) => !GORUNMEZ_DURUMLAR.includes(d));
    if (!gecerliDurumlar.includes(yeniDurum)) {
      return NextResponse.json(
        { hata: `Geçersiz durum. Geçerli durumlar: ${gecerliDurumlar.join(', ')}` },
        { status: 400 }
      );
    }

    const sikayetService = getSikayetService();
    const sonuc = await sikayetService.durumGuncelle(sikayetId, tenant.id, yeniDurum);

    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    // Diğer açık paneller de anında görsün (aynı başkanlıkta iki kişi bakıyor olabilir).
    await getBasvuruAkisServisi()
      .basvuruGuncellendi(sikayetId, tenant.id)
      .catch((e) => console.error('canlı akış yayını hatası:', e));

    // ÇÖZÜM SMS'i: kayıt bu güncellemeyle SONUÇLANDIYSA vatandaşa bilgi gider.
    // Telegram'daki "Çözüldü" butonu bunu zaten yapıyordu; panelden kapatılan kayıt
    // ise bildirimsiz kalıyordu — vatandaş açısından kimin kapattığı önemli değil.
    // `zatenKapaliydi` kontrolü tekrar SMS'i önler (aynı duruma ikinci kez basmak).
    if (durumKapaliMi(yeniDurum) && !sonuc.zatenKapaliydi) {
      await getTelegramService()
        .cozumSmsiGonder(sonuc.sikayet)
        .catch((e) => console.error('panelden çözüm SMS hatası:', e));
    }

    return NextResponse.json({
      basarili: true,
      mesaj: `Başvuru durumu "${yeniDurum}" olarak güncellendi.`,
    });
  } catch (err) {
    console.error('Durum güncelleme hatası:', err);
    return NextResponse.json({ hata: 'Güncelleme başarısız.' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/sikayetler
 *
 * Başvuruyu soft-delete ile siler (başkan tarafından). Veritabanından hemen
 * kaldırılmaz; `SILINEN_KALICI_GUN` sonunda periyodik imha görevi kalıcı siler.
 *
 * İstek gövdesi: { sikayetId }
 */
export async function DELETE(request) {
  try {
    const { tenant, hataYanit } = await adminOturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ hata: parseHata }, { status: 400 });
    }

    const { sikayetId } = veri;

    if (!sikayetId) {
      return NextResponse.json({ hata: 'Başvuru ID zorunludur.' }, { status: 400 });
    }

    const sonuc = await getSikayetService().sil(sikayetId, tenant.id);

    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    await getBasvuruAkisServisi()
      .basvuruSilindi(sikayetId, tenant.id)
      .catch((e) => console.error('canlı akış yayını hatası:', e));

    return NextResponse.json({
      basarili: true,
      mesaj: 'Başvuru silindi.',
    });
  } catch (err) {
    console.error('Başvuru silme hatası:', err);
    return NextResponse.json({ hata: 'Silme işlemi başarısız.' }, { status: 500 });
  }
}
