import { NextResponse } from 'next/server';
import { getAdminService } from '@/lib/services';
import { GuvenlikSabitleri } from '@/lib/utils/constants';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * POST /api/admin/cikis
 *
 * Admin oturumunu sonlandırır (çıkış / logout).
 * 1. Çerezdeki oturumu DB'de iptal eder (aktif=false) → çalınmış olsa bile geçersizleşir.
 * 2. Oturum çerezini siler.
 */
export async function POST(request) {
  try {
    const oturumCerezi = request.cookies.get(GuvenlikSabitleri.ADMIN_CEREZ_ADI);

    if (oturumCerezi?.value) {
      const tenant = await aktifTenant(request);
      if (tenant) {
        const adminService = getAdminService();
        await adminService.cikisYap(oturumCerezi.value, tenant.id);
      }
    }

    const response = NextResponse.json({ basarili: true, mesaj: 'Çıkış yapıldı.' });

    // Çerezi sil (maxAge=0)
    response.cookies.set(GuvenlikSabitleri.ADMIN_CEREZ_ADI, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (err) {
    console.error('Çıkış hatası:', err);
    return NextResponse.json({ hata: 'Çıkış yapılamadı.' }, { status: 500 });
  }
}
