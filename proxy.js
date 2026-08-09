import { NextResponse } from 'next/server';
import { guvenlikBasliklariEkle } from '@/lib/security/headers.js';

/**
 * Next.js Proxy (eski adıyla Middleware — Next.js 16'da yeniden adlandırıldı)
 *
 * Defense in Depth'in EN DIŞ katmanıdır. Tüm istekler buradan geçer.
 * Uygulamaya ulaşmadan önce, sunucu tarafında çalışır (varsayılan: Node.js runtime).
 *
 * Görevleri:
 * 1. Host'tan belediye (tenant) slug'ını çıkartıp header'a koymak
 * 2. Güvenlik başlıklarını eklemek
 * 3. Admin sayfalarını oturum çerezine göre korumak
 * 4. İzin verilmeyen yöntemleri engelleme
 *
 * Subdomain Örnekleri:
 *   gulsehir.sikayet.com     → X-Tenant-Slug: gulsehir
 *   nevsehir.sikayet.com     → X-Tenant-Slug: nevsehir
 *   localhost:3000           → X-Tenant-Slug: (NEXT_PUBLIC_TENANT_SLUG'dan)
 */
/** Sabit-zamanlı string karşılaştırma (crypto bağımlılığı olmadan; her runtime'da güvenli).
 *  Gizli origin header'ını uzunluk-sızdırmadan kıyaslar. */
function sabitZamanliEsit(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return fark === 0;
}

export function proxy(request) {
  const { pathname } = request.nextUrl;

  // 0. CLOUDFLARE→ORIGIN GİZLİ HEADER ZORLAMASI (opt-in; ORIGIN_SECRET tanımlıysa).
  //    Cloudflare Transform Rule ile edge'de her isteğe eklenen gizli header origin'de
  //    zorunlu kılınır → biri cloudflared tünelini bir şekilde atlayıp origin'e doğrudan
  //    ulaşsa bile (cf-connecting-ip / Host spoofing girişimi) bu header olmadan 403 alır.
  //    Sağlık kontrolü (docker healthcheck, localhost) muaftır. ORIGIN_SECRET tanımlı
  //    DEĞİLSE hiçbir şey değişmez (mevcut kurulum bozulmaz) — kullanıcı CF kuralını
  //    kurduktan sonra env'i doldurup aktifleştirir.
  const originSecret = process.env.ORIGIN_SECRET;
  if (originSecret && !pathname.startsWith('/api/health')) {
    const gelen = request.headers.get('x-origin-secret') || '';
    if (!sabitZamanliEsit(gelen, originSecret)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // NOT: Tenant slug'ını burada çıkarıp header'a KOYMUYORUZ. Slug yalnızca bilgi
  // amaçlıydı ve hiçbir uç onu okumuyordu (güvenlik kararı sunucuda aktifTenant() ile
  // host'tan YENİDEN çözülür). Her istekte (proxy %100 trafikte çalışır) boşa parse +
  // header-set yapmamak için kaldırıldı; host, yalnız ihtiyaç duyan admin dalında okunur.

  // Tüm yanıtlara güvenlik başlıkları ekle
  const response = NextResponse.next();
  guvenlikBasliklariEkle(response.headers);

  // 1b. İkili (resim) içerik servis eden hassas uç için global CSP'yi SIKILAŞTIR.
  // Başkanın gördüğü şikayet fotoğrafı özel içeriktir: global CSP (script-src 'unsafe-*')
  // bir resim yanıtı için fazla gevşek. Burada otoriter olarak (handler'ı proxy ezer)
  // her şeyi yasaklayan CSP + çapraz-origin gömülmeyi engelleyen CORP koyarız.
  // (nosniff + image/jpeg content-type zaten resmi HTML olarak yorumlanmaktan korur;
  //  bu, defense-in-depth ek katmanıdır.)
  if (pathname.startsWith('/api/admin/foto/')) {
    response.headers.set('Content-Security-Policy', "default-src 'none'; sandbox;");
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }

  // 2. Admin sayfalarını koru (Magic Link ile giriş yapılmış mı?)
  // Prefix '/admin' — yalnız '/admin/harita' DEĞİL: ileride eklenecek her admin sayfası da varsayılan
  // olarak korumalı olmalı. Tek bir sayfayı adıyla saymak, yeni sayfayı sessizce
  // herkese açık bırakan türden bir hatadır.
  if (pathname.startsWith('/admin')) {
    const oturumCerezi = request.cookies.get('admin_oturum');

    if (!oturumCerezi || !oturumCerezi.value) {
      // Oturum yoksa ana sayfaya yönlendir. Reverse proxy (cloudflared) arkasında
      // request.url iç bind adresini (0.0.0.0:3000) verir; gerçek dış adresi
      // Host başlığından kurarız. Proto https (tünel TLS).
      const host = request.headers.get('host') || '';
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      const girisUrl = new URL('/', `${proto}://${host}`);
      return NextResponse.redirect(girisUrl);
    }
  }

  // 3. API isteklerinde sadece izin verilen HTTP metotlarını kabul et
  if (pathname.startsWith('/api/')) {
    const izinliMetotlar = ['GET', 'POST', 'PATCH', 'DELETE'];
    if (!izinliMetotlar.includes(request.method)) {
      return new NextResponse(
        JSON.stringify({ hata: 'Bu HTTP metodu desteklenmiyor.' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return response;
}

/**
 * Proxy'nin çalışacağı URL kalıpları.
 * Statik dosyalar (_next/static, favicon.ico) hariç tutulur.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
