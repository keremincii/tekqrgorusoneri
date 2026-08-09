import { NextResponse } from 'next/server';
import { getSikayetService, getAdminService, getTelegramService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { SikayetDurumu, GORUNMEZ_DURUMLAR, durumKapaliMi } from '@/lib/utils/constants';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * GET /api/admin/sikayetler
 * 
 * Başkanın haritasında gösterilecek tüm aktif şikayetleri döndürür.
 * Oturum çerezi ile korunur (proxy.js + buradaki ek kontrol).
 */
export async function GET(request) {
  try {
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Defense in Depth: Proxy zaten kontrol ediyor ama biz de yapalım
    const oturumCerezi = request.cookies.get('admin_oturum');
    if (!oturumCerezi?.value) {
      return NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 });
    }

    const adminService = getAdminService();
    const gecerli = await adminService.oturumDogrula(oturumCerezi.value, tenant.id);
    if (!gecerli) {
      return NextResponse.json({ hata: 'Oturum geçersiz veya süresi dolmuş.' }, { status: 401 });
    }

    // Sayfalama: ?limit ve ?offset (varsayılan 1000 kayıt)
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '1000', 10) || 1000, 1), 5000);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

    const sikayetService = getSikayetService();
    const sikayetler = await sikayetService.aktifSikayetleriGetir(tenant.id, { limit, offset });

    // R2 anahtarını istemciye SIZDIRMA: yalnızca fotoğraf VAR MI bilgisini ver.
    // Fotoğrafın kendisi yetkili /api/admin/foto/[id] route'undan çekilir.
    const guvenliListe = sikayetler.map(({ fotografUrl, ...s }) => ({
      ...s,
      fotografVar: Boolean(fotografUrl),
    }));

    // Haritanın bu belediyeye odaklanması için tenant'ın kendi merkez/zoom değerleri
    // (tenantlar tablosundan). Çok-tenant'lı tek dağıtımda harita merkezi build-time
    // env'den DEĞİL, subdomain'den çözülen tenant kaydından gelir.
    const merkezVar = Number.isFinite(tenant.haritaEnlem) && Number.isFinite(tenant.haritaBoylam);
    // Sabit görünüm kutusu (sinir): dört köşe de tanımlıysa haritayı bu kutuya kilitle.
    // Global env DEĞİL, bu belediyenin DB kaydından (per-tenant).
    const sinirVar = [tenant.sinirGbEnlem, tenant.sinirGbBoylam, tenant.sinirKdEnlem, tenant.sinirKdBoylam]
      .every((v) => Number.isFinite(v));
    const belediye = {
      ad: tenant.ad,
      merkez: merkezVar ? [tenant.haritaEnlem, tenant.haritaBoylam] : null,
      zoom: tenant.haritaZoom || 14,
      sinir: sinirVar
        ? [[tenant.sinirGbEnlem, tenant.sinirGbBoylam], [tenant.sinirKdEnlem, tenant.sinirKdBoylam]]
        : null,
    };

    return NextResponse.json({ sikayetler: guvenliListe, belediye });
  } catch (err) {
    console.error('Şikayet listeleme hatası:', err);
    return NextResponse.json({ hata: 'Veriler yüklenemedi.' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/sikayetler
 * 
 * Şikayet durumunu günceller (başkan tarafından).
 * 
 * İstek gövdesi:
 * { sikayetId, yeniDurum }
 */
export async function PATCH(request) {
  try {
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Oturum kontrolü
    const oturumCerezi = request.cookies.get('admin_oturum');
    if (!oturumCerezi?.value) {
      return NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 });
    }

    const adminService = getAdminService();
    const gecerli = await adminService.oturumDogrula(oturumCerezi.value, tenant.id);
    if (!gecerli) {
      return NextResponse.json({ hata: 'Oturum geçersiz.' }, { status: 401 });
    }

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ hata: parseHata }, { status: 400 });
    }

    const { sikayetId, yeniDurum } = veri;

    if (!sikayetId || !yeniDurum) {
      return NextResponse.json({ hata: 'Şikayet ID ve yeni durum zorunludur.' }, { status: 400 });
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
      mesaj: `Şikayet durumu "${yeniDurum}" olarak güncellendi.`,
    });
  } catch (err) {
    console.error('Durum güncelleme hatası:', err);
    return NextResponse.json({ hata: 'Güncelleme başarısız.' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/sikayetler
 * 
 * Şikayeti soft-delete ile siler (başkan tarafından).
 * Veritabanından tamamen kaldırılmaz, sadece "silindi" olarak işaretlenir.
 * 
 * İstek gövdesi:
 * { sikayetId }
 */
export async function DELETE(request) {
  try {
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Oturum kontrolü
    const oturumCerezi = request.cookies.get('admin_oturum');
    if (!oturumCerezi?.value) {
      return NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 });
    }

    const adminService = getAdminService();
    const gecerli = await adminService.oturumDogrula(oturumCerezi.value, tenant.id);
    if (!gecerli) {
      return NextResponse.json({ hata: 'Oturum geçersiz.' }, { status: 401 });
    }

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ hata: parseHata }, { status: 400 });
    }

    const { sikayetId } = veri;

    if (!sikayetId) {
      return NextResponse.json({ hata: 'Şikayet ID zorunludur.' }, { status: 400 });
    }

    const sikayetService = getSikayetService();
    const sonuc = await sikayetService.sil(sikayetId, tenant.id);

    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    return NextResponse.json({
      basarili: true,
      mesaj: 'Şikayet başarıyla silindi.',
    });
  } catch (err) {
    console.error('Şikayet silme hatası:', err);
    return NextResponse.json({ hata: 'Silme işlemi başarısız.' }, { status: 500 });
  }
}
