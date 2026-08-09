import { NextResponse } from 'next/server';
import { getSikayetService, getAdminService } from '@/lib/services';
import { aktifTenant } from '@/lib/server/tenant';
import { getClientIp } from '@/lib/server/ip';
import { sha256Hashle } from '@/lib/security/hmac';
import { guvenlikOlayi } from '@/lib/security/guvenlikLog';

/**
 * GET /api/admin/sikayet/[id]/kimlik
 * ==================================
 *
 * Başkanın (admin) kötüye kullanım / troll / küfür şikayetini yetkiliye bildirmek için
 * TALEP ÜZERİNE çektiği şikayetçi kimliği: ad, soyad, telefon + oluşturma tarih-saati.
 *
 * KVKK — VERİ MİNİMİZASYONU: Kimlik, harita/panelin toplu listesinde AKMAZ (o sorgu
 * ad/soyad/telefon getirmez). Yalnız başkan bir şikayette "Kimliği göster"e basınca,
 * bu yetkili uçtan, TEK şikayet için döner. Her erişim guvenlikOlayi ile LOGLANIR
 * (kim, ne zaman, hangi şikayet — KVKK hesap verebilirlik/iz kaydı).
 *
 * YETKİ: yalnız geçerli admin_oturum'u olan, İLGİLİ belediyenin başkanı (tenant izole).
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    const oturumCerezi = request.cookies.get('admin_oturum');
    if (!oturumCerezi?.value) {
      return NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 });
    }
    // Oturumu doğrula VE etiketini al ("kim baktı" logu için).
    const oturumBilgi = await getAdminService().oturumBilgisiGetir(oturumCerezi.value, tenant.id);
    if (!oturumBilgi.gecerli) {
      return NextResponse.json({ hata: 'Oturum geçersiz veya süresi dolmuş.' }, { status: 401 });
    }

    const kimlik = await getSikayetService().kimlikGetir(id, tenant.id);
    if (!kimlik) {
      return NextResponse.json({ hata: 'Şikayet bulunamadı.' }, { status: 404 });
    }

    // KVKK iz kaydı: kişisel veriye yetkili erişim loglanır. "goruntuleyen" = oturumun
    // etiketi (Başkan/Başkan Yardımcısı/Admin) → KİM baktığı görünür. Ham IP saklanmaz (hash).
    const ip = getClientIp(request);
    guvenlikOlayi('admin_kimlik_goruntuleme', {
      tenantId: tenant.id,
      sikayetId: id,
      goruntuleyen: oturumBilgi.etiket || 'bilinmiyor',
      ipHash: ip && ip !== 'unknown' ? sha256Hashle(ip) : null,
    });

    return NextResponse.json({
      ad: kimlik.ad,
      soyad: kimlik.soyad,
      telefon: kimlik.telefon,
      olusturmaTarihi: kimlik.olusturmaTarihi,
    });
  } catch (err) {
    console.error('Kimlik görüntüleme hatası:', err);
    return NextResponse.json({ hata: 'Beklenmedik bir hata oluştu.' }, { status: 500 });
  }
}
