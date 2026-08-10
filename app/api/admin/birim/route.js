import { NextResponse } from 'next/server';
import { getBirimService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { adminOturumKontrol as oturumKontrol } from '@/lib/server/adminOturum';

/**
 * GET /api/admin/birim — Belediyenin aktif birimlerini listeler.
 * Yanıt: { birimler: [{ id, ad }] }
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
 * DELETE /api/admin/birim — Birimi pasifleştirir. Personeller silinmez; birimsiz kalır.
 * Gövde: { birimId }
 *
 * (Kategori kümesi ayarlayan PATCH ucu KALDIRILDI: kategori ekseni bu üründe yok,
 *  birim artık bir yönlendirme kuralı değil yalnızca gruplamadır.)
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
