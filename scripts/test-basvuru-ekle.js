/**
 * TEST BAŞVURUSU ÜRETİCİ (yalnız geliştirme / demo)
 * ==================================================
 *
 * AMAÇ: Başkan panosunu dolu görmek — filtreleri, sayfalamayı ve canlı akışı gerçek
 * veriyle denemek. Rastgele tür (şikayet/görüş/öneri) ve metinle N başvuru gönderir.
 *
 * NASIL ÇALIŞIR (uygulamada test kapısı YOKTUR): /api/sikayet, SMS doğrulamasının
 * kanıtı olarak sunucunun İMZALADIĞI bir `dogrulamaToken` ve QR için bir `sig` bekler.
 * Bu script ikisini de AYNI HMAC_SECRET ile kendisi üretir; yani gerçek yazma yolunu
 * (doğrulama, küfür filtresi, DB insert, canlı yayın) OTP'ye hiç dokunmadan çalıştırır.
 * Sır yalnızca scripti çalıştırandadır — uygulamaya hiçbir baypas eklenmez.
 *
 * KULLANIM:
 *   node scripts/test-basvuru-ekle.js <qr-nokta-uuid> [adet]
 *
 * ORTAM DEĞİŞKENLERİ (.env.local'den de okunur):
 *   HMAC_SECRET        — sunucudakiyle AYNI olmalı
 *   BASE_URL           — varsayılan http://localhost:3000
 *   TENANT_HOST        — çok-belediyeli kurulumda Host başlığı (ör. derinkuyu.ornek.com)
 *
 * ⚠ Pencere limiti: aynı kimlik pencerede yalnız SIKAYET_HAFTALIK_ADET kadar başvuru
 * gönderebilir. Bu script her kayıt için BENZERSİZ bir kimlik hash'i ürettiğinden
 * limite takılmaz; ama IP/QR limitlerine takılabilirsin. Yerelde gevşetmek için:
 *   IP_DAKIKA_LIMIT=1000000 QR_SAAT_LIMIT=1000000 npm run dev
 *
 * ⚠ ÜRETİMDE ÇALIŞTIRMA. Gerçek kayıt oluşturur.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** .env.local varsa oradan (yoksa süreç ortamından) değer okur. */
function ortam() {
  const dosya = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(dosya)) return process.env;
  const satirlar = fs.readFileSync(dosya, 'utf8').split('\n');
  const okunan = {};
  for (const satir of satirlar) {
    const temiz = satir.trim();
    if (!temiz || temiz.startsWith('#')) continue;
    const ayrac = temiz.indexOf('=');
    if (ayrac < 0) continue;
    okunan[temiz.slice(0, ayrac)] = temiz.slice(ayrac + 1);
  }
  return { ...okunan, ...process.env };
}

const env = ortam();
const HMAC_SECRET = env.HMAC_SECRET;
const BASE_URL = env.BASE_URL || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const TENANT_HOST = env.TENANT_HOST || '';

const TURLER = ['sikayet', 'gorus', 'oneri'];

/** Türe göre gerçekçi örnek metinler (panelde okunabilirliği denemek için). */
const METINLER = {
  sikayet: [
    'Sokak lambası üç gündür yanmıyor, akşamları yürümek tedirgin edici oluyor.',
    'Çöp konteyneri iki haftadır boşaltılmadı, koku çevredeki tüm apartmanlara yayılıyor.',
    'Kaldırımdaki taşlar yerinden oynamış; yaşlı komşumuz geçen hafta orada düştü.',
    'Su basıncı sabahları çok düşük, üst katlarda musluktan hiç su gelmiyor.',
    'Pazar kurulduğu günler araçlar kaldırıma park ediyor, bebek arabasıyla geçmek imkânsız.',
  ],
  gorus: [
    'Yeni düzenlenen park çok güzel olmuş, akşamları ailece vakit geçiriyoruz. Emeği geçenlere teşekkürler.',
    'Belediye otobüslerinin saatleri okul çıkışlarıyla uyumsuz; öğrenciler uzun süre bekliyor.',
    'Kütüphanenin hafta sonu da açık olması bizim mahalle için büyük fark yarattı.',
    'Geri dönüşüm kutuları güzel bir uygulama ama ne atılacağı yeterince anlaşılmıyor.',
  ],
  oneri: [
    'Park girişine bisiklet park yeri yapılabilir; birçok kişi bisikletle geliyor ama bağlayacak yer yok.',
    'Meydandaki banklara gölgelik eklenirse yazın oturmak mümkün olur.',
    'Mahalle muhtarlığının yanına bir içme suyu çeşmesi konulmasını öneriyorum.',
    'Sokak hayvanları için kışlık barınak yapılabilir; komşular malzeme desteği vermeye hazır.',
    'Çocuk parkının zemini kauçuk olursa düşmelerde yaralanma azalır.',
  ],
};

/** Sunucudaki imzaOlustur(sokakId) ile birebir aynı (HMAC-SHA256 hex). */
function imzala(veri) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(veri).digest('hex');
}

/** Sunucudaki dogrulamaTokenOlustur ile birebir aynı: base64url(payload) + '.' + HMAC. */
function dogrulamaTokenUret(kimlikHash) {
  const govde = Buffer.from(JSON.stringify({
    k: kimlikHash,
    ad: 'Test',
    sa: 'Kullanici',
    tel: '05000000000',
    exp: Date.now() + 10 * 60 * 1000,
  })).toString('base64url');
  return `${govde}.${imzala(govde)}`;
}

function rastgele(dizi) {
  return dizi[Math.floor(Math.random() * dizi.length)];
}

async function basvuruGonder(qrId, sira) {
  // Her kayıt için BENZERSİZ kimlik → pencere başına başvuru limitine takılmaz.
  const kimlikHash = crypto.createHash('sha256')
    .update(`test-${sira}-${Date.now()}-${Math.random()}`)
    .digest('hex');
  const tur = rastgele(TURLER);

  const headers = { 'Content-Type': 'application/json' };
  if (TENANT_HOST) headers.Host = TENANT_HOST;

  const res = await fetch(`${BASE_URL}/api/sikayet`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sokakId: qrId,
      sig: imzala(qrId),
      dogrulamaToken: dogrulamaTokenUret(kimlikHash),
      tur,
      aciklama: rastgele(METINLER[tur]),
      kvkkOnay: true,
    }),
  });

  const veri = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn(`  ⚠ ${sira}. başvuru (${tur}): ${veri.hata || res.status}`);
    return false;
  }
  console.log(`  ✓ ${sira}. başvuru eklendi (${tur})`);
  return true;
}

async function main() {
  const [qrId, adetArg] = process.argv.slice(2);
  const adet = Number(adetArg) || 15;

  if (!HMAC_SECRET) {
    console.error('❌ HMAC_SECRET tanımlı değil (.env.local veya ortam değişkeni).');
    process.exit(1);
  }
  if (!qrId) {
    console.error('Kullanım: node scripts/test-basvuru-ekle.js <qr-nokta-uuid> [adet]');
    console.error('QR noktasının UUID\'sini `sokaklar` tablosundan alabilirsin.');
    process.exit(1);
  }

  console.log(`📨 ${BASE_URL} adresine ${adet} test başvurusu gönderiliyor…\n`);
  let basarili = 0;
  for (let i = 1; i <= adet; i++) {
    if (await basvuruGonder(qrId, i)) basarili++;
    // Sunucuyu boğmamak + canlı akışın kartları tek tek düşürmesini izleyebilmek için.
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`\n✅ ${basarili}/${adet} başvuru eklendi. Panoyu açık tuttuysan hepsi anında düşmüş olmalı.`);
}

main().catch((err) => {
  console.error('❌ Hata:', err.message);
  process.exit(1);
});
