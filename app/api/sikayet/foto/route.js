import { NextResponse } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { imzaDogrula, dogrulamaTokenDogrula } from '@/lib/security/hmac';
import { ipRateLimitKontrol, qrRateLimitKontrol, rateLimitKontrol } from '@/lib/security/rateLimit';
import { Semafor } from '@/lib/security/concurrency';
import { guvenlikOlayi } from '@/lib/security/guvenlikLog';
import { aktifTenant } from '@/lib/server/tenant';
import { getClientIp } from '@/lib/server/ip';
import { r2Yapilandirildi, r2Yukle } from '@/lib/server/r2';
import { FotografSabitleri, RateLimitKurallari } from '@/lib/utils/constants';

/**
 * POST /api/sikayet/foto  (multipart/form-data)
 *
 * Vatandaşın şikayet fotoğrafını yükler. Şikayet kaydından (POST /api/sikayet)
 * HEMEN ÖNCE, SMS doğrulaması tamamlandıktan sonra çağrılır.
 *
 * Güvenlik (savunma katmanları, sırayla):
 * - Sadece SMS+TC doğrulamasından geçmiş (geçerli dogrulamaToken) vatandaş yükler.
 * - QR imzası (sig) doğrulanır → rastgele biri endpoint'i kullanamaz.
 * - Content-Length ÖN-kontrolü: aşırı büyük gövde, multipart parse edilmeden önce reddedilir.
 * - IP + QR + kimlik bazlı rate limit → spam/DoS.
 * - MAGIC-BYTE BEYAZ LİSTE: dosyanın ilk baytları gerçek imzaya bakılarak sadece
 *   JPEG/PNG/WEBP kabul edilir. Content-Type/uzantı header'ına GÜVENİLMEZ. Bu, SVG/XML'in
 *   sharp'ın libvips/librsvg parser'ına HİÇ ulaşmamasını sağlar (parse-aşaması CVE koruması).
 * - sharp re-encode + limitInputPixels: gömülü payload/EXIF yok olur (raster→JPEG),
 *   decompression-bomb (küçük dosya devasa piksel) piksel tavanıyla engellenir.
 * - Dosya adı rastgele UUID; anahtar `<tenantId>/<uuid>.jpg` (path traversal yok).
 *
 * Alanlar: file (resim), sokakId, sig, dogrulamaToken
 * Yanıt: { fotografKey }
 */

/** İzin verilen yükleme piksel tavanı (decompression-bomb koruması). ~50MP: en yüksek
 *  çözünürlüklü telefon fotoğrafları bile altında kalır, çıktı zaten 1920x1080'e iner. */
const MAX_GIRDI_PIKSEL = 50_000_000;

/**
 * Resim işleme eşzamanlılık semaforu (modül düzeyinde tekil — tüm istekler paylaşır).
 * Aynı anda en fazla ESZAMANLI_ISLEME_LIMIT kadar sharp işlemi çalışır; fazlası kısa süre
 * kuyrukta bekler, yuva açılmazsa istek 503 alır (CPU/bellek tükenmesi DoS koruması).
 */
// maxKuyruk=20: kuyrukta 20'den fazla istek bekletilmez → yük patlamasında yüzlerce
// isteğin gövdeleriyle birlikte bellekte birikmesi yerine anında 503 (hızlı ret).
const resimIslemSemaforu = new Semafor(FotografSabitleri.ESZAMANLI_ISLEME_LIMIT, 20);

/**
 * Dosyanın GERÇEK içerik imzasına (magic bytes) bakar; yalnızca jpeg/png/webp tanır.
 * Header/uzantı sahte olabilir; bu kontrol içeriğe bakar. Tanımazsa null döner →
 * dosya sharp'a hiç verilmez (SVG/XML gibi tehlikeli parser yüzeyleri devre dışı).
 * @param {Buffer} buf
 * @returns {'jpeg'|'png'|'webp'|null}
 */
/**
 * İstek gövdesini SERT bir byte tavanıyla belleğe okur.
 *
 * Content-Length header'ına GÜVENMEZ: chunked / Content-Length'siz gövdede de çalışır
 * (araya giren proxy — cloudflared — gövdeyi Transfer-Encoding: chunked ile iletirse
 * bile). Tavan aşılırsa akışı iptal edip null döner → çağıran 413. Böylece formData()
 * gövdeyi SINIRSIZ belleğe almadan önce, header'ın varlığından bağımsız olarak sınırlanır.
 * @param {Request} request
 * @param {number} maxByte
 * @returns {Promise<Buffer|null>} tavan aşılırsa/okunamazsa null
 */
async function govdeyiSinirliOku(request, maxByte) {
  const okuyucu = request.body?.getReader?.();
  if (!okuyucu) return null;
  const parcalar = [];
  let toplam = 0;
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      if (!value) continue;
      toplam += value.byteLength;
      if (toplam > maxByte) {
        try { await okuyucu.cancel(); } catch { /* akış zaten kapanıyor */ }
        return null; // tavan aşıldı → çağıran 413
      }
      parcalar.push(value);
    }
  } catch {
    return null; // ağ/okuma hatası
  }
  return Buffer.concat(parcalar);
}

function resimFormatiTespit(buf) {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  // WEBP: "RIFF"...."WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp';
  return null;
}

export async function POST(request) {
  try {
    if (!r2Yapilandirildi()) {
      // Fotoğraf depo yapılandırılmamış → özellik kapalı (şikayet yine de gönderilebilir)
      return NextResponse.json({ hata: 'Fotoğraf yükleme şu an kapalı.' }, { status: 503 });
    }

    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    // Rate limit (IP)
    const ip = getClientIp(request);
    if (!ipRateLimitKontrol(ip, 'foto').izinVar) {
      guvenlikOlayi('foto_ip_limit', { ip });
      return NextResponse.json({ hata: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    // Gövde boyut tavanı (auth'tan ÖNCE bellek koruması). Tarayıcının max 5MB ön kontrolü
    // + %15 multipart payı. Content-Length header'ına GÜVENMEYİZ (proxy chunked iletebilir):
    const MAX_GOVDE_BYTE = Math.ceil(FotografSabitleri.MAX_BOYUT_BYTE * 1.15);

    // Hızlı yol: Content-Length VARSA ve tavanı aşıyorsa gövdeyi hiç okumadan reddet.
    const contentLength = parseInt(request.headers.get('content-length') || '', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_GOVDE_BYTE) {
      guvenlikOlayi('foto_buyuk_contentlength', { ip, boyut: contentLength });
      return NextResponse.json({ hata: 'Fotoğraf çok büyük.' }, { status: 413 });
    }

    // Gövdeyi SERT byte-tavanıyla oku (Content-Length olsun olmasın). Tavan aşılırsa 413.
    // formData() gövdeyi kendisi sınırsız buffer'lardı; burada tavanı biz uyguluyoruz.
    const hamGovde = await govdeyiSinirliOku(request, MAX_GOVDE_BYTE);
    if (!hamGovde) {
      guvenlikOlayi('foto_govde_tavani', { ip, sebep: 'gövde tavanı aşıldı veya okunamadı' });
      return NextResponse.json({ hata: 'Fotoğraf çok büyük veya istek bozuk.' }, { status: 413 });
    }

    // Tavan-sınırlı ham gövdeyi multipart olarak parse et. Aynı undici parser'ı
    // (request.formData ile birebir); Content-Type boundary'si header'dan taşınır.
    const form = await new Response(hamGovde, {
      headers: { 'content-type': request.headers.get('content-type') || '' },
    }).formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ hata: 'Geçersiz istek.' }, { status: 400 });
    }

    const sokakId = String(form.get('sokakId') || '');
    const sig = String(form.get('sig') || '');
    const dogrulamaToken = String(form.get('dogrulamaToken') || '');
    const file = form.get('file');

    if (!sokakId || !sig || !file || typeof file === 'string' || !dogrulamaToken) {
      return NextResponse.json({ hata: 'Eksik alanlar.' }, { status: 400 });
    }

    // QR imzası (sahte QR koruması)
    if (!imzaDogrula(sokakId, sig)) {
      guvenlikOlayi('foto_gecersiz_qr', { ip, sebep: 'imza dogrulanamadi' });
      return NextResponse.json({ hata: 'Geçersiz QR kodu.' }, { status: 403 });
    }

    // QR rate limit (/api/sikayet ile AYNI `qr:` sayacını paylaşır)
    if (!qrRateLimitKontrol(sokakId).izinVar) {
      guvenlikOlayi('foto_qr_limit', { ip });
      return NextResponse.json({ hata: 'Bu QR koddan çok fazla istek.' }, { status: 429 });
    }

    // Yetki: dogrulamaToken (SMS doğrulamasının imzalı kanıtı). `yetkiEtiket` yalnız
    // loglama/limit anahtarı içindir.
    const tokenSonuc = dogrulamaTokenDogrula(dogrulamaToken);
    if (!tokenSonuc.gecerli) {
      guvenlikOlayi('foto_gecersiz_token', { ip, sebep: 'dogrulama tokeni gecersiz' });
      return NextResponse.json({ hata: 'Doğrulama gerekli.' }, { status: 403 });
    }
    const yetkiEtiket = tokenSonuc.kimlikHash;
    // Kimlik bazlı yükleme limiti: token 10 dk tekrar kullanılabildiği için doğrulanmış
    // tek kişinin ağır yükleme selini engeller (FOTO_SAAT_LIMIT: 1 foto + birkaç deneme).
    if (!rateLimitKontrol(`foto:${yetkiEtiket}`, RateLimitKurallari.FOTO_SAAT_LIMIT, 60 * 60 * 1000).izinVar) {
      guvenlikOlayi('foto_kimlik_limit', { ip, kimlik: yetkiEtiket });
      return NextResponse.json({ hata: 'Çok fazla fotoğraf yükleme denemesi. Lütfen sonra deneyin.' }, { status: 429 });
    }

    // Boyut kontrolü (buffer'a almadan önce)
    if (file.size > FotografSabitleri.MAX_BOYUT_BYTE) {
      guvenlikOlayi('foto_buyuk_dosya', { ip, kimlik: yetkiEtiket, boyut: file.size });
      return NextResponse.json(
        { hata: `Fotoğraf çok büyük (max ${Math.round(FotografSabitleri.MAX_BOYUT_BYTE / 1024 / 1024)}MB).` },
        { status: 413 }
      );
    }

    // Eşzamanlılık yuvası kap: aynı anda çok sayıda ağır sharp işlemi CPU/belleği
    // patlatmasın. Yuva açılmazsa (sunucu yoğun / kuyruk dolu) 503 + Retry-After.
    // DİKKAT: Semafor formData()'dan SONRA, arrayBuffer()'dan ÖNCE alınır — daha önce
    // alınsaydı yavaş gövde okuyan istemci (slowloris) yuvayı rehin alırdı; daha geç
    // alınsaydı kuyrukta bekleyen her istek dosyanın 2. kopyasını (Blob+Buffer) tutardı.
    const yuvaAlindi = await resimIslemSemaforu.al(FotografSabitleri.ISLEME_BEKLEME_TIMEOUT_MS);
    if (!yuvaAlindi) {
      guvenlikOlayi('foto_semafor_dolu', { ip, kimlik: yetkiEtiket, sebep: 'eszamanli isleme tavani' });
      return NextResponse.json(
        { hata: 'Sunucu şu an yoğun. Lütfen birazdan tekrar deneyin.' },
        { status: 503, headers: { 'Retry-After': '5' } }
      );
    }

    // Bu noktadan sonra yuva her çıkış yolunda (başarı/ret/hata) finally ile bırakılır.
    let ciktiBuffer;
    try {
      const girdiBuffer = Buffer.from(await file.arrayBuffer());

      // MAGIC-BYTE BEYAZ LİSTE: sharp'a vermeden ÖNCE gerçek imzayı doğrula. Yalnızca
      // jpeg/png/webp geçer; SVG/XML/diğer formatlar librsvg/libxml2 parser'ına ulaşmadan
      // burada reddedilir (parse-aşaması saldırı yüzeyi kapalı).
      if (!resimFormatiTespit(girdiBuffer)) {
        guvenlikOlayi('foto_gecersiz_format', { ip, kimlik: yetkiEtiket, sebep: 'magic-byte beyaz listede yok' });
        return NextResponse.json(
          { hata: 'Yalnızca JPEG, PNG veya WEBP fotoğraf yükleyebilirsiniz.' },
          { status: 400 }
        );
      }

      // YENİDEN KODLAMA: gömülü içeriği yok eder, EXIF siler, boyutlandırır. limitInputPixels
      // ile decompression-bomb engellenir. failOn:'error' bozuk/sahte raster'ı reddeder.
      try {
        ciktiBuffer = await sharp(girdiBuffer, { failOn: 'error', limitInputPixels: MAX_GIRDI_PIKSEL })
          .rotate() // EXIF yönelimini uygula, sonra meta silinir
          .resize(FotografSabitleri.MAX_GENISLIK_PX, FotografSabitleri.MAX_YUKSEKLIK_PX, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: FotografSabitleri.JPEG_KALITESI })
          .toBuffer();
      } catch {
        guvenlikOlayi('foto_bozuk_resim', { ip, kimlik: yetkiEtiket, sebep: 'sharp re-encode basarisiz' });
        return NextResponse.json({ hata: 'Geçersiz veya bozuk resim dosyası.' }, { status: 400 });
      }
    } finally {
      resimIslemSemaforu.birak();
    }

    const key = `${tenant.id}/${crypto.randomUUID()}.jpg`;
    await r2Yukle(key, ciktiBuffer, 'image/jpeg');

    // Anahtar istemciye döner ve /api/sikayet gövdesine konur (kayıt orada yapılır).
    return NextResponse.json({ fotografKey: key }, { status: 201 });
  } catch (err) {
    console.error('Fotoğraf yükleme hatası:', err);
    return NextResponse.json({ hata: 'Fotoğraf yüklenemedi.' }, { status: 500 });
  }
}
