import { NextResponse } from 'next/server';
import { getBirimService, getAdminService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * Başkan oturumunu doğrular (tüm metotlarda ortak).
 * @returns {Promise<{tenant?: Object, hataYanit?: NextResponse}>}
 */
async function oturumKontrol(request) {
  const tenant = await aktifTenant(request);
  if (!tenant) {
    return { hataYanit: NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 }) };
  }
  const oturumCerezi = request.cookies.get('admin_oturum');
  if (!oturumCerezi?.value) {
    return { hataYanit: NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 }) };
  }
  const gecerli = await getAdminService().oturumDogrula(oturumCerezi.value, tenant.id);
  if (!gecerli) {
    return { hataYanit: NextResponse.json({ hata: 'Oturum geçersiz.' }, { status: 401 }) };
  }
  return { tenant };
}

/**
 * GET /api/admin/birim — Belediyenin birimlerini (kapsadıkları kategorilerle) listeler.
 * Yanıt: { birimler: [{ id, ad, kategoriler: string[] }] }
 */
export async function GET(request) {
  try {
    const { tenant, hataYanit } = await oturumKontrol(request);
    if (hataYanit) return hataYanit;

    const birimler = await getBirimService().birimListele(tenant.id);
    return NextResponse.json({ birimler });
  } catch (err) {
    console.error('Birim listeleme hatası:', err);
    return NextResponse.json({ hata: 'Birimler yüklenemedi.' }, { status: 500 });
  }
}

/**
 * POST /api/admin/birim — Yeni birim ekler.
 * Gövde: { ad }
 */
export async function POST(request) {
  try {
    const { tenant, hataYanit } = await oturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) return NextResponse.json({ hata: parseHata }, { status: 400 });

    const sonuc = await getBirimService().birimEkle(tenant.id, veri.ad);
    if (!sonuc.basarili) return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    return NextResponse.json({ basarili: true, birim: sonuc.birim }, { status: 201 });
  } catch (err) {
    console.error('Birim ekleme hatası:', err);
    return NextResponse.json({ hata: 'Birim eklenemedi.' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/birim — Bir birimin kapsadığı kategori kümesini AYARLAR (tam değiştirir).
 * Gövde: { birimId, kategoriler: string[] }
 * (PATCH kullanılıyor çünkü proxy.js yalnız GET/POST/PATCH/DELETE'e izin verir — PUT 405.)
 */
export async function PATCH(request) {
  try {
    const { tenant, hataYanit } = await oturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) return NextResponse.json({ hata: parseHata }, { status: 400 });

    const sonuc = await getBirimService().birimKategorileriAyarla(tenant.id, veri.birimId, veri.kategoriler);
    if (!sonuc.basarili) return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    return NextResponse.json({ basarili: true, kategoriler: sonuc.kategoriler });
  } catch (err) {
    console.error('Birim kategori ayarlama hatası:', err);
    return NextResponse.json({ hata: 'İşlem başarısız.' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/birim — Birimi pasifleştirir (kategori eşleşmeleri de silinir).
 * Gövde: { birimId }
 */
export async function DELETE(request) {
  try {
    const { tenant, hataYanit } = await oturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) return NextResponse.json({ hata: parseHata }, { status: 400 });

    if (!veri.birimId) return NextResponse.json({ hata: 'Birim ID zorunludur.' }, { status: 400 });
    const sonuc = await getBirimService().birimSil(tenant.id, veri.birimId);
    if (!sonuc.basarili) return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    return NextResponse.json({ basarili: true, mesaj: 'Birim kaldırıldı.' });
  } catch (err) {
    console.error('Birim silme hatası:', err);
    return NextResponse.json({ hata: 'İşlem başarısız.' }, { status: 500 });
  }
}
