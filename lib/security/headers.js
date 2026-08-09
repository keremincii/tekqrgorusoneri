/**
 * Güvenlik Başlıkları (Security Headers)
 * 
 * Defense in Depth: HTTP yanıtlarına güvenlik başlıkları ekleyerek
 * XSS, Clickjacking, MIME sniffing ve diğer saldırıları önler.
 * 
 * Bu başlıklar Next.js proxy'sinde (proxy.js) her yanıta otomatik eklenir.
 */

/** 
 * Güvenlik başlıklarını bir Response veya Headers nesnesine ekler.
 * @param {Headers} headers - Başlık eklenecek Headers nesnesi
 * @returns {Headers} Güvenlik başlıkları eklenmiş Headers nesnesi
 */
export function guvenlikBasliklariEkle(headers) {
  // XSS saldırılarını engeller: yalnız izin verilen kaynaklardan script/style yüklenir.
  // 'unsafe-inline' Next.js'in kendi inline script/stilleri için gereklidir.
  // Dış bağımlılıklar (bilinçli izin verilenler):
  //   • challenges.cloudflare.com → Cloudflare Turnstile bot kapısı. Hem script-src
  //     (api.js) hem de frame-src (widget bir iframe içinde render olur) gerekir;
  //     frame-src OLMADAN default-src 'self'e düşer ve iframe bloklanır → widget çıkmaz.
  //   • cdn.jsdelivr.net → FingerprintJS UMD (cihaz parmak izi; SMS throttle boyutu).
  //     Yüklenemezse akış parmak izsiz devam eder ama script-src izni yoksa CSP blok1ar.
  //   • static.cloudflareinsights.com / cloudflareinsights.com → Cloudflare'in otomatik
  //     enjekte ettiği web analytics beacon'ı (işlevsel değil; yalnız konsol gürültüsünü
  //     ve analitik kaybını önlemek için eklendi).
  // 'unsafe-eval' YALNIZ geliştirmede (Next.js HMR/React Refresh eval kullanır).
  // Üretimde kaldırılır → XSS payload'ları için eval/Function yolu kapanır.
  // 'unsafe-inline' Next'in inline bootstrap script'leri için (prod'da da) gerekli.
  const dev = process.env.NODE_ENV !== 'production';

  // Doğrulama tek yollu (Netgsm SMS OTP) olduğundan CSP dar tutulur: yalnız Cloudflare
  // (Turnstile + analitik) ve jsDelivr (FingerprintJS) origin'lerine izin verilir.
  const scriptSrc =
    "script-src 'self' 'unsafe-inline'" + (dev ? " 'unsafe-eval'" : '') +
    ' https://challenges.cloudflare.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com; ';
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
    scriptSrc +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' https://cloudflareinsights.com; " +
    "frame-src https://challenges.cloudflare.com; " +
    // object-src 'none': eklenti/flash tabanlı enjeksiyon yüzeyini kapatır.
    // base-uri 'self': enjekte edilen <base> ile script yollarının kaçırılmasını önler.
    // form-action 'self': enjekte/gömülü bir <form> yalnız kendi origin'ine POST edebilir
    //   (girilen KVKK verisini harici bir sunucuya sızdıran form-exfil vektörünü kapatır).
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'none';"
  );

  // Clickjacking koruması: Sayfanın iframe içine gömülmesini engeller
  headers.set('X-Frame-Options', 'DENY');

  // MIME type sniffing koruması: Tarayıcının dosya türünü tahmin etmesini engeller
  headers.set('X-Content-Type-Options', 'nosniff');

  // X-XSS-Protection: modern tarayıcılarda kaldırıldı; '1; mode=block' bazı eski
  // tarayıcılarda yan-kanal açabildiği için güncel öneri '0'. Asıl koruma CSP.
  headers.set('X-XSS-Protection', '0');

  // Referrer bilgisi sızıntısını önler (gizlilik koruması)
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HTTPS zorunlu kılar (tarayıcı bir daha HTTP kullanmaz)
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // Kamera, mikrofon, konum gibi API'lere erişimi kısıtlar. Konum (GPS) artık HİÇ
  // kullanılmıyor (her QR sabit koordinat) → geolocation tamamen kapalı: geolocation=().
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  return headers;
}
