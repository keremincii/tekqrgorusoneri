import { NextResponse } from 'next/server';
import { getAdminService } from '@/lib/services';
import { aktifTenant } from '@/lib/server/tenant.js';
import { GuvenlikSabitleri } from '@/lib/utils/constants.js';

/**
 * Yönetim (başkan) uçları için ORTAK oturum kapısı.
 * =================================================
 *
 * Her admin ucunda tekrarlanan üç adımı tek yerde toplar:
 *   1. Belediyeyi (tenant) HOST'tan çöz — istemciden gelen hiçbir değerle DEĞİL.
 *   2. Oturum çerezi var mı?
 *   3. Çerez bu belediyede geçerli bir oturuma mı ait? (tenant izolasyonu)
 *
 * NEDEN TEK YERDE: proxy.js `/admin` SAYFALARINI korur ama `/api/admin/*` uçlarını
 * çerez VARLIĞINA bakarak geçirir; asıl doğrulama uçlarda yapılır. Bu üç adım her
 * uçta elle tekrarlandığında, yeni eklenen bir uçta birinin (çoğunlukla 3. adımın)
 * unutulması an meselesidir — ve unutulduğunda uç, BAŞKA bir belediyenin çerezini
 * kabul eder. Ortak kapı bu hatayı yapısal olarak imkânsızlaştırır.
 *
 * @param {import('next/server').NextRequest} request
 * @returns {Promise<{tenant?: Object, hataYanit?: NextResponse}>}
 *   `hataYanit` doluysa çağıran onu OLDUĞU GİBİ döndürmelidir.
 */
export async function adminOturumKontrol(request) {
  const tenant = await aktifTenant(request);
  if (!tenant) {
    return { hataYanit: NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 }) };
  }

  const cerez = request.cookies.get(GuvenlikSabitleri.ADMIN_CEREZ_ADI);
  if (!cerez?.value) {
    return { hataYanit: NextResponse.json({ hata: 'Yetkisiz erişim.' }, { status: 401 }) };
  }

  const gecerli = await getAdminService().oturumDogrula(cerez.value, tenant.id);
  if (!gecerli) {
    return { hataYanit: NextResponse.json({ hata: 'Oturum geçersiz veya süresi dolmuş.' }, { status: 401 }) };
  }

  return { tenant };
}
