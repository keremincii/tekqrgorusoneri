import { NextResponse } from 'next/server';
import { getSikayetService } from '@/lib/services';
import { GENEL_RED_MESAJI } from '@/lib/utils/constants';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { ipRateLimitKontrol } from '@/lib/security/rateLimit';
import { getClientIp } from '@/lib/server/ip';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * POST /api/dogrulama/on-kontrol  — SMS/doğrulama ÖNCESİ haftalık limit ön-kontrolü
 * ===============================================================================
 *
 * Amaç: Haftalık şikayet limitine ZATEN takılmış bir kullanıcı, ad/soyad/telefon
 * ekranından SMS adımına GEÇMESİN — çünkü Netgsm SMS'i o aşamada gönderilir ve limit
 * sonunda /api/sikayet reddedecek olsa bile SMS parası boşa gider. İstemci, doğrulama
 * SMS'ini tetiklemeden ÖNCE burayı çağırır; {izin:false} dönerse SMS hiç üretilmez.
 *
 * NOT: Bu bir ön-eleme/optimizasyondur; nihai otorite yine /api/sikayet'teki DB sayımıdır
 * (yarış durumlarına karşı). Telefon geçersiz/eksikse izin verilir (asıl doğrulama sonra).
 *
 * İstek gövdesi: { telefon }
 */
export async function POST(request) {
  try {
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Kaba IP rate limit (numara sorgulama amplifikasyonunu sınırlar; ucuz DB kapısı).
    const ip = getClientIp(request);
    if (!ipRateLimitKontrol(ip, 'onkontrol').izinVar) {
      // Sınır aşımında izin ver (fail-open): amaç SMS israfını önlemek; nihai kapı
      // /api/sikayet'te. Burada sertçe reddetmek meşru kullanıcıyı da durdurabilir.
      return NextResponse.json({ izin: true });
    }

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ izin: true }); // parse edilemeyen istekte akışı bozma
    }

    const telefon = veri?.telefon;
    if (!telefon) return NextResponse.json({ izin: true });

    // Kara liste: engellenmiş numara SMS/doğrulama adımına HİÇ geçmesin (kredi yanmasın).
    // Mesaj belirsiz — engelli mi limit mi ayırt edilemez (mekanizma ifşa olmasın).
    if (await getSikayetService().telefonEngelliMi(telefon, tenant.id)) {
      return NextResponse.json({ izin: false, hata: GENEL_RED_MESAJI });
    }

    // Haftalık limit MEŞRU kural (engelleme gibi gizli mekanizma değil) → bilgilendirici.
    const durum = await getSikayetService().telefonHaftalikDolu(telefon, tenant.id);
    if (durum.dolu) {
      return NextResponse.json({ izin: false, hata: `Bu dönemde en fazla ${durum.adet} şikayet gönderebilirsiniz. Yaklaşık ${durum.kalanGun} gün sonra tekrar deneyebilirsiniz.` });
    }
    return NextResponse.json({ izin: true });
  } catch {
    // Beklenmedik hatada akışı bozma (fail-open) — bu yalnız optimizasyon katmanı.
    return NextResponse.json({ izin: true });
  }
}
