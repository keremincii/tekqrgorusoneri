import { NextResponse } from 'next/server';
import { getSokakYonetimService } from '@/lib/services';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * GET /api/sokaklar
 * 
 * Tüm aktif sokakları listeler.
 * QR okutma sayfasında sokak bilgisini göstermek için kullanılır.
 */
export async function GET(request) {
  try {
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    const sokakService = getSokakYonetimService();
    const sokaklar = await sokakService.tumSokaklariListele(tenant.id);

    // Hassas veriyi (hmacImza) client'a gönderme
    const guvenliListe = sokaklar.map(s => ({
      id: s.id,
      sokakAdi: s.sokakAdi,
      enlem: s.enlem,
      boylam: s.boylam,
      tabelaNo: s.tabelaNo, // fiziksel levha numarası — form sayfasında köşe rozetinde gösterilir
    }));

    return NextResponse.json({ sokaklar: guvenliListe });
  } catch (err) {
    console.error('Sokak listeleme hatası:', err);
    return NextResponse.json(
      { hata: 'Sokaklar yüklenirken hata oluştu.' },
      { status: 500 }
    );
  }
}
