import { NextResponse } from 'next/server';
import { getSikayetService, getAdminService } from '@/lib/services';
import { aktifTenant } from '@/lib/server/tenant';
import { getClientIp } from '@/lib/server/ip';
import { rateLimitKontrol } from '@/lib/security/rateLimit';
import { r2Yapilandirildi, r2Indir } from '@/lib/server/r2';

/**
 * GET /api/admin/foto/[id]
 *
 * Bir şikayetin fotoğrafını YETKİLİ olarak servis eder (başkan görüntüleme).
 *
 * Güvenlik / tenant izolasyonu:
 * - Oturum çerezi + tenant doğrulanır (başka belediyenin başkanı erişemez).
 * - Şikayet, isteğin tenant'ına bağlı olarak getirilir (idIleGetir tenant filtreli).
 * - R2 anahtarının ilgili tenant prefix'i (`<tenantId>/`) ile başladığı bir kez daha
 *   doğrulanır (defense in depth — çapraz-tenant anahtar enjeksiyonu imkânsız).
 * - Fotoğraf body olarak stream edilir; R2 URL'si veya anahtarı dışarı sızmaz.
 */
export async function GET(request, { params }) {
  try {
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Hafif rate-limit: yetkili olsa da tek IP'nin aşırı (enumerasyon/bant genişliği)
    // isteklerini sınırla. Auth DB sorgusundan ÖNCE çalışır, böylece onu da korur.
    const ip = getClientIp(request);
    if (!rateLimitKontrol(`adminfoto:${tenant.id}:${ip}`, 120, 60 * 1000).izinVar) {
      return NextResponse.json({ hata: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const oturumCerezi = request.cookies.get('admin_oturum');
    if (!oturumCerezi?.value) {
      return NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 });
    }
    const adminService = getAdminService();
    const gecerli = await adminService.oturumDogrula(oturumCerezi.value, tenant.id);
    if (!gecerli) {
      return NextResponse.json({ hata: 'Oturum geçersiz.' }, { status: 401 });
    }

    if (!r2Yapilandirildi()) {
      return NextResponse.json({ hata: 'Fotoğraf deposu yapılandırılmamış.' }, { status: 503 });
    }

    const { id } = await params;
    const sikayetService = getSikayetService();
    const key = await sikayetService.fotografKeyGetir(id, tenant.id);

    if (!key) {
      return NextResponse.json({ hata: 'Fotoğraf yok.' }, { status: 404 });
    }

    // Defense in depth: anahtar bu tenant'a ait olmalı
    if (!key.startsWith(`${tenant.id}/`)) {
      return NextResponse.json({ hata: 'Erişim reddedildi.' }, { status: 403 });
    }

    const nesne = await r2Indir(key);
    if (!nesne) {
      return NextResponse.json({ hata: 'Fotoğraf bulunamadı.' }, { status: 404 });
    }

    return new NextResponse(nesne.buffer, {
      status: 200,
      headers: {
        'Content-Type': nesne.contentType,
        // Tarayıcı içeriği daima resim olarak ve gömülü (inline) göstersin; yanlış
        // bağlamda yorumlama/indirme-olarak-çalıştırma riskine karşı (nosniff zaten global).
        'Content-Disposition': `inline; filename="sikayet-${id}.jpg"`,
        // Özel veri: sadece başkan, önbelleğe alınmasın (yetkisiz paylaşım riski)
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('Fotoğraf servis hatası:', err);
    return NextResponse.json({ hata: 'Fotoğraf yüklenemedi.' }, { status: 500 });
  }
}
