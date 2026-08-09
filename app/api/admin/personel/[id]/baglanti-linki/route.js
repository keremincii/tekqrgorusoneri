import { NextResponse } from 'next/server';
import { getPersonelService, getAdminService } from '@/lib/services';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * POST /api/admin/personel/[id]/baglanti-linki
 *
 * Bir personel için tek-kullanımlık Telegram bağlantı linki (deep link) üretir.
 * Başkan bu linki personele WhatsApp'tan gönderir; personel tıklayınca botun
 * /start akışı chat_id'sini kaydına bağlar.
 */
export async function POST(request, { params }) {
  try {
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    const oturumCerezi = request.cookies.get('admin_oturum');
    if (!oturumCerezi?.value) {
      return NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 });
    }
    const gecerli = await getAdminService().oturumDogrula(oturumCerezi.value, tenant.id);
    if (!gecerli) {
      return NextResponse.json({ hata: 'Oturum geçersiz.' }, { status: 401 });
    }

    const { id } = await params;
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;

    const sonuc = await getPersonelService().baglantiKoduUret(tenant.id, id, botUsername);
    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    return NextResponse.json({ basarili: true, link: sonuc.link });
  } catch (err) {
    console.error('Bağlantı linki üretme hatası:', err);
    return NextResponse.json({ hata: 'Bağlantı linki oluşturulamadı.' }, { status: 500 });
  }
}
