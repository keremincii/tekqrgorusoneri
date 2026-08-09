import { NextResponse } from 'next/server';
import { getPersonelService, getAdminService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * Başkan oturumunu doğrular (tüm metotlarda ortak). Geçerliyse tenant döner,
 * değilse hazır bir hata yanıtı döner.
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
 * GET /api/admin/personel — Belediyenin aktif personellerini listeler.
 * chat_id sızdırılmaz; yalnızca telegramBagli bayrağı döner.
 */
export async function GET(request) {
  try {
    const { tenant, hataYanit } = await oturumKontrol(request);
    if (hataYanit) return hataYanit;

    const liste = await getPersonelService().personelListele(tenant.id);
    return NextResponse.json({ personeller: liste });
  } catch (err) {
    console.error('Personel listeleme hatası:', err);
    return NextResponse.json({ hata: 'Personeller yüklenemedi.' }, { status: 500 });
  }
}

/**
 * POST /api/admin/personel — Yeni personel ekler (saha personeli / başkan / yardımcı).
 * Gövde: { ad, soyad, telefon?, rol?, birimId? }
 *   rol: 'personel' (varsayılan) | 'baskan' | 'baskan_yardimcisi'
 *   birimId: yalnız rol='personel' için anlamlı (hangi birime bağlı)
 */
export async function POST(request) {
  try {
    const { tenant, hataYanit } = await oturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) return NextResponse.json({ hata: parseHata }, { status: 400 });

    const { ad, soyad, telefon, rol, birimId } = veri;
    const sonuc = await getPersonelService().personelEkle(tenant.id, ad, soyad, telefon, { rol, birimId });
    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    return NextResponse.json({
      basarili: true,
      personel: {
        id: sonuc.personel.id, ad: sonuc.personel.ad, soyad: sonuc.personel.soyad,
        rol: sonuc.personel.rol, birimId: sonuc.personel.birimId,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('Personel ekleme hatası:', err);
    return NextResponse.json({ hata: 'Personel eklenemedi.' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/personel — Personeli pasifleştirir (Telegram bağlantısı koparılır).
 * Gövde: { personelId }
 */
export async function DELETE(request) {
  try {
    const { tenant, hataYanit } = await oturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) return NextResponse.json({ hata: parseHata }, { status: 400 });

    const { personelId } = veri;
    if (!personelId) {
      return NextResponse.json({ hata: 'Personel ID zorunludur.' }, { status: 400 });
    }

    const sonuc = await getPersonelService().personelPasifYap(tenant.id, personelId);
    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    return NextResponse.json({ basarili: true, mesaj: 'Personel kaldırıldı.' });
  } catch (err) {
    console.error('Personel silme hatası:', err);
    return NextResponse.json({ hata: 'İşlem başarısız.' }, { status: 500 });
  }
}
