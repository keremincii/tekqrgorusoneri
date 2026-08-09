import { NextResponse } from 'next/server';
import { getSikayetService, getPersonelService, getTelegramService, getAdminService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * PATCH /api/admin/sikayetler/ata
 *
 * Bir şikayeti bir personele atar veya atamayı kaldırır (başkan tarafından).
 * Mevcut durum-güncelleme PATCH'ini (/api/admin/sikayetler) kirletmemek için ayrı route.
 *
 * Gövde:
 *   { sikayetId, personelId }         → atar (durum beklemede ise inceleniyor'a geçer)
 *   { sikayetId, personelId: null }   → atamayı kaldırır
 *
 * Atamada, personele Telegram bildirimi gönderilir; yanıt `bildirimGonderildi`
 * bayrağıyla başkana bildirimin gidip gitmediğini bildirir (personel Telegram'a
 * bağlı değilse atama yine yapılır ama bildirim gitmez).
 */
export async function PATCH(request) {
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

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) return NextResponse.json({ hata: parseHata }, { status: 400 });

    const { sikayetId, personelId } = veri;
    if (!sikayetId) {
      return NextResponse.json({ hata: 'Şikayet ID zorunludur.' }, { status: 400 });
    }

    const sikayetService = getSikayetService();

    // === Atamayı kaldır ===
    if (personelId === null || personelId === undefined || personelId === '') {
      const sonuc = await sikayetService.personelAtamaKaldir(sikayetId, tenant.id);
      if (!sonuc.basarili) {
        return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
      }
      return NextResponse.json({ basarili: true, mesaj: 'Atama kaldırıldı.' });
    }

    // === Ata ===
    // Personelin bu belediyeye ait ve aktif olduğunu doğrula (tenant izolasyonu +
    // Telegram bildirimi için personel kaydı — chat_id dahil — burada gerekir).
    const personel = await getPersonelService().personelGetir(personelId, tenant.id);
    if (!personel || !personel.aktif) {
      return NextResponse.json({ hata: 'Personel bulunamadı veya aktif değil.' }, { status: 400 });
    }

    const sonuc = await sikayetService.personelAta(sikayetId, tenant.id, personelId);
    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
    }

    // Telegram bildirimi (KVKK: vatandaş kimliği gönderilmez). Bildirim çökse de
    // atama kaydı sağlamdır — kullanıcıya sonuç bayrağıyla bilgi verilir.
    const bildirim = await getTelegramService().atamaBildir(sonuc.sikayet, personel);

    return NextResponse.json({
      basarili: true,
      mesaj: 'Şikayet personele atandı.',
      bildirimGonderildi: bildirim.bildirimGonderildi,
      sebep: bildirim.sebep || null,
    });
  } catch (err) {
    console.error('Atama hatası:', err);
    return NextResponse.json({ hata: 'Atama başarısız.' }, { status: 500 });
  }
}
