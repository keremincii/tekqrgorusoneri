import { NextResponse } from 'next/server';
import { getSikayetService, getPersonelService, getTelegramService, getBasvuruAkisServisi } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { adminOturumKontrol } from '@/lib/server/adminOturum';

/**
 * PATCH /api/admin/sikayetler/ata
 *
 * Bir başvuruyu bir personele atar veya atamayı kaldırır (başkan tarafından).
 * Mevcut durum-güncelleme PATCH'ini (/api/admin/sikayetler) kirletmemek için ayrı route.
 *
 * Gövde:
 *   { sikayetId, personelId }         → atar (durum beklemede ise inceleniyor'a geçer)
 *   { sikayetId, personelId: null }   → atamayı kaldırır
 *
 * ATAMA, SAHA EKİBİNE İŞ DÜŞMESİNİN TEK YOLUDUR: kategori ekseni olmadığı için
 * otomatik dağıtım yoktur. Personele Telegram bildirimi burada gönderilir; yanıt
 * `bildirimGonderildi` bayrağıyla başkana bildirimin gidip gitmediğini söyler
 * (personel Telegram'a bağlı değilse atama yine yapılır ama bildirim gitmez).
 */
export async function PATCH(request) {
  try {
    const { tenant, hataYanit } = await adminOturumKontrol(request);
    if (hataYanit) return hataYanit;

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) return NextResponse.json({ hata: parseHata }, { status: 400 });

    const { sikayetId, personelId } = veri;
    if (!sikayetId) {
      return NextResponse.json({ hata: 'Başvuru ID zorunludur.' }, { status: 400 });
    }

    const sikayetService = getSikayetService();

    // === Atamayı kaldır ===
    if (personelId === null || personelId === undefined || personelId === '') {
      const sonuc = await sikayetService.personelAtamaKaldir(sikayetId, tenant.id);
      if (!sonuc.basarili) {
        return NextResponse.json({ hata: sonuc.hata }, { status: 400 });
      }
      await getBasvuruAkisServisi()
        .basvuruGuncellendi(sikayetId, tenant.id)
        .catch((e) => console.error('canlı akış yayını hatası:', e));
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

    // Atama hem durumu hem "kime atandı" bilgisini değiştirir → açık paneller güncellensin.
    await getBasvuruAkisServisi()
      .basvuruGuncellendi(sikayetId, tenant.id)
      .catch((e) => console.error('canlı akış yayını hatası:', e));

    // Telegram bildirimi (KVKK: vatandaş kimliği gönderilmez). Bildirim çökse de
    // atama kaydı sağlamdır — kullanıcıya sonuç bayrağıyla bilgi verilir.
    const bildirim = await getTelegramService().atamaBildir(sonuc.sikayet, personel);

    return NextResponse.json({
      basarili: true,
      mesaj: 'Başvuru personele atandı.',
      bildirimGonderildi: bildirim.bildirimGonderildi,
      sebep: bildirim.sebep || null,
    });
  } catch (err) {
    console.error('Atama hatası:', err);
    return NextResponse.json({ hata: 'Atama başarısız.' }, { status: 500 });
  }
}
