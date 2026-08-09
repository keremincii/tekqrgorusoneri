import { NextResponse } from 'next/server';
import { getAdminService } from '@/lib/services';
import { GuvenlikSabitleri } from '@/lib/utils/constants';
import { aktifTenant } from '@/lib/server/tenant';
import { getClientIp } from '@/lib/server/ip';
import { rateLimitKontrol } from '@/lib/security/rateLimit';
import { guvenlikOlayi } from '@/lib/security/guvenlikLog';

/**
 * /api/admin/magic-link/[token] — admin girişi
 *
 * İKİ AŞAMA (magic-link önizleme koruması):
 *  - GET  : token'ı TÜKETMEZ. Yalnızca bir "Giriş Yap" onay sayfası gösterir.
 *           Neden: link başkana WhatsApp'tan gönderiliyor; WhatsApp/Telegram/e-posta/AV
 *           gibi istemciler URL'yi önizleme için otomatik GET eder — eğer GET token'ı
 *           tüketseydi başkan tıklamadan link "kullanıldı" olur ve giriş yapılamazdı
 *           (kendini-DoS). Önizleme botları form GÖNDERMEZ, yalnız GET yapar.
 *  - POST : "Giriş Yap" butonuyla gelir. Token'ı ATOMİK tüketir, oturum çerezi yazar,
 *           admin haritasına yönlendirir.
 *
 * @param {Object} params - { token: string }
 */

/** IP başına sıkı limit (kimliksiz uç; token 512-bit zaten tahmin edilemez → bu, DB-yük
 *  amplifikasyonuna karşı). Aynı limit hem GET hem POST için. true = izin var. */
function ipLimitGecti(request) {
  const ip = getClientIp(request);
  if (!rateLimitKontrol(`magiclink:${ip}`, 20, 10 * 60 * 1000).izinVar) {
    guvenlikOlayi('magiclink_ip_limit', { ip });
    return false;
  }
  return true;
}

export async function GET(request, { params }) {
  try {
    if (!ipLimitGecti(request)) {
      return NextResponse.json({ hata: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.' }, { status: 429 });
    }
    const { token } = await params;
    if (!token || token.length < 64) {
      return NextResponse.json({ hata: 'Geçersiz giriş linki.' }, { status: 400 });
    }
    // Tenant'ı çöz (yoksa 404); token GEÇERLİLİĞİ burada KONTROL EDİLMEZ ve TÜKETİLMEZ.
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }
    // Onay sayfası: form POST ile aynı URL'ye gider (token yolda; ayrıca gömülmez).
    return new NextResponse(onaySayfasi(tenant.ad), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('Magic link GET hatası:', err);
    return NextResponse.json({ hata: 'İşlem başarısız.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    if (!ipLimitGecti(request)) {
      return NextResponse.json({ hata: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.' }, { status: 429 });
    }
    const { token } = await params;
    if (!token || token.length < 64) {
      return NextResponse.json({ hata: 'Geçersiz giriş linki.' }, { status: 400 });
    }
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Token'ı ATOMİK tüket (tek-kullanımlık) + oturum üret.
    const sonuc = await getAdminService().magicLinkIleGiris(token, tenant.id);
    if (!sonuc.basarili) {
      return NextResponse.json({ hata: sonuc.hata }, { status: 403 });
    }

    // Yönlendirme hedefini yalnız `host` başlığından kur (x-forwarded-host değil; tenant.js
    // ile hizalı). Proto her zaman https (cloudflared tünel TLS).
    const host = request.headers.get('host');
    const redirectUrl = new URL('/admin/harita', `https://${host}`);
    const response = NextResponse.redirect(redirectUrl, 303); // 303: POST → GET yönlendirme

    response.cookies.set(GuvenlikSabitleri.ADMIN_CEREZ_ADI, sonuc.oturumTokeni, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: GuvenlikSabitleri.ADMIN_OTURUM_SURESI_MS / 1000,
    });
    return response;
  } catch (err) {
    console.error('Magic link giriş hatası:', err);
    return NextResponse.json({ hata: 'Giriş işlemi başarısız.' }, { status: 500 });
  }
}

/** Minimal, kendine yeten onay sayfası (kullanıcı verisi render EDİLMEZ → XSS yüzeyi yok). */
function onaySayfasi(belediyeAdi) {
  const ad = String(belediyeAdi || 'Belediye')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Yönetici Girişi</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}
  .kart{max-width:400px;width:100%;background:#1e293b;border:1px solid #334155;border-radius:16px;
    padding:32px 28px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  h1{font-size:20px;margin-bottom:8px}
  p{color:#94a3b8;font-size:14px;line-height:1.5;margin-bottom:24px}
  button{width:100%;padding:14px;font-size:16px;font-weight:700;color:#fff;background:#2563eb;
    border:none;border-radius:10px;cursor:pointer}
  button:hover{background:#1d4ed8}
  .not{margin-top:16px;font-size:12px;color:#64748b}
</style></head>
<body>
  <div class="kart">
    <h1>${ad} — Yönetici Girişi</h1>
    <p>Yönetim paneline giriş yapmak üzeresiniz. Devam etmek için aşağıdaki butona dokunun.</p>
    <form method="POST"><button type="submit">Giriş Yap</button></form>
    <p class="not">Bu link size özeldir ve tek kullanımlıktır.</p>
  </div>
</body></html>`;
}
