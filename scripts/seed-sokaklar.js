/**
 * Sokak Yükleme Scripti (Seed)
 * 
 * Kullanım:
 *   node scripts/seed-sokaklar.js
 * 
 * Bu script bir sokak CSV dosyasını (Sokak_Adi,Enlem_Y,Boylam_X) okur ve tüm
 * sokakları veritabanına toplu olarak ekler. Her sokak için otomatik UUID ve
 * HMAC imzası üretilir.
 *
 * CSV yolu (öncelik sırası):
 *   1. Komut satırı argümanı:   node scripts/seed-sokaklar.js ./yeni-ilce.csv
 *   2. SOKAK_CSV çevre değişkeni
 *   3. Varsayılan:              ../sokak_listesi.csv
 *
 * Yeni İLÇE için: o ilçenin veritabanına (DATABASE_URL) bağlanıp, ilçenin kendi
 * CSV'sini bu scriptle yükleyin. Kod değişmez; yalnızca veri ve env değişir.
 *
 * Yeni sokak eklemek için: CSV'ye satır ekleyip tekrar çalıştırın (mevcut veri
 * silinmez), VEYA: node scripts/sokak-ekle.js "BAYRAK SOKAK" 38.745 34.621
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function envOku() {
  const envLocal = path.join(__dirname, '..', '.env.local');
  const envProd = path.join(__dirname, '..', '.env');
  const envPath = fs.existsSync(envLocal) ? envLocal : fs.existsSync(envProd) ? envProd : null;
  if (!envPath) {
    console.error('❌ .env.local veya .env dosyası bulunamadı!');
    process.exit(1);
  }
  const icerik = fs.readFileSync(envPath, 'utf8');
  icerik.split('\n').forEach(satir => {
    const [anahtar, ...degerParcalari] = satir.split('=');
    if (anahtar && !anahtar.startsWith('#')) {
      process.env[anahtar.trim()] = degerParcalari.join('=').trim();
    }
  });
}

function hmacImzaOlustur(veri, secret) {
  return crypto.createHmac('sha256', secret).update(veri).digest('hex');
}

// QR'a basılan kısa opak base62 kod (8 hane). lib/security/kod.js ile AYNI mantık —
// scriptler `@/` alias'ı olmadan çalıştığından burada satır-içi kopya tutulur.
const QR_ALFABE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function qrKodUret(uzunluk = 8) {
  let kod = '';
  while (kod.length < uzunluk) {
    const bytes = crypto.randomBytes(uzunluk);
    for (let i = 0; i < bytes.length && kod.length < uzunluk; i++) {
      if (bytes[i] < 248) kod += QR_ALFABE[bytes[i] % 62]; // 248=4×62 → bias yok
    }
  }
  return kod;
}

async function main() {
  envOku();

  // 1. argüman = TENANT SLUG (zorunlu, subdomain ile AYNI). Tenant'ı açıkça
  // belirtmek, env'i değiştirmeyi unutup sokakları YANLIŞ belediyeye yükleme
  // hatasını önler. tenant_id, slug'dan veritabanında çözülür (aşağıdaki SQL).
  const tenantSlug = (process.argv[2] || '').toLowerCase().trim();
  if (!tenantSlug || !/^[a-z0-9-]+$/.test(tenantSlug)) {
    console.error('❌ Belediye slug\'ı eksik veya geçersiz!');
    console.error('   Kullanım: node scripts/seed-sokaklar.js <belediye-slug> <csv-yolu>');
    console.error('   Örnek:    node scripts/seed-sokaklar.js gulsehir ./gulsehir-sokaklar.csv');
    process.exit(1);
  }

  // CSV yolu: 2. argüman > SOKAK_CSV env > varsayılan
  const csvPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : process.env.SOKAK_CSV
      ? path.resolve(process.env.SOKAK_CSV)
      : path.join(__dirname, '..', '..', 'sokak_listesi.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV dosyası bulunamadı!');
    console.error('   Beklenen konum:', csvPath);
    console.error('   Kullanım: node scripts/seed-sokaklar.js <belediye-slug> <csv-yolu>');
    process.exit(1);
  }
  console.log(`📍 Belediye: ${tenantSlug}  |  CSV: ${csvPath}`);

  console.log('📂 CSV dosyası okunuyor...');
  const csvIcerik = fs.readFileSync(csvPath, 'utf8');
  const satirlar = csvIcerik.split('\n').filter(s => s.trim());

  // İlk satır başlık, atla
  const veriSatirlari = satirlar.slice(1);

  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) {
    console.error('❌ HMAC_SECRET çevre değişkeni tanımlı değil!');
    process.exit(1);
  }

  // QR'lara KALICI yönlendirici adresi basılır: https://qr.<domain>/q/<id>
  // (form adresi /s/...?sig=... DEĞİL). Böylece form yolu/imza/subdomain ileride
  // değişse bile basılı QR'lar bozulmaz; tek değişmemesi gereken qr.<domain> köküdür.
  // Kök, QR_BASE_URL ile elle verilebilir; yoksa APP_BASE_DOMAIN'den türetilir.
  // Bu mantık uygulamadaki lib/server/qr.js ile AYNI tutulmalıdır.
  const _base = (process.env.APP_BASE_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
  const qrBaseUrl = process.env.QR_BASE_URL
    ? process.env.QR_BASE_URL.trim().replace(/\/+$/, '')
    : (_base ? `https://qr.${_base}` : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));

  console.log(`✅ ${veriSatirlari.length} sokak bulundu. QR yönlendirici kökü: ${qrBaseUrl}\n`);

  const sokaklar = [];
  const qrLinkleri = [];
  const kullanilanKodlar = new Set(); // parti içi qr_kod benzersizliği

  for (const satir of veriSatirlari) {
    // CSV formatı: Sokak_Adi,Enlem_Y,Boylam_X
    const parcalar = satir.split(',');
    if (parcalar.length < 3) continue;

    const sokakAdi = parcalar[0].trim();
    const enlem = parseFloat(parcalar[1]);
    const boylam = parseFloat(parcalar[2]);

    if (!sokakAdi || isNaN(enlem) || isNaN(boylam)) continue;

    const id = crypto.randomUUID();
    const hmacImza = hmacImzaOlustur(id, hmacSecret);

    // QR'a UUID DEĞİL, kısa base62 kod basılır → daha az modül, daha kolay okunur.
    let qrKod;
    do { qrKod = qrKodUret(); } while (kullanilanKodlar.has(qrKod));
    kullanilanKodlar.add(qrKod);

    sokaklar.push({
      id,
      sokakAdi: sokakAdi.toUpperCase(),
      enlem,
      boylam,
      hmacImza,
      qrKod,
    });

    qrLinkleri.push({
      sokakAdi: sokakAdi.toUpperCase(),
      qrLinki: `${qrBaseUrl}/q/${qrKod}`,
    });
  }

  // Çıktı dosyaları tenant'a (belediyeye) göre adlandırılır; böylece bir belediyeyi
  // seed ederken bir öncekinin QR/SQL dosyaları ÜZERİNE YAZILMAZ.
  const belediyeAdi = process.env.NEXT_PUBLIC_BELEDIYE_ADI || tenantSlug;
  const slugSql = tenantSlug.replace(/'/g, "''"); // SQL string güvenliği

  // QR linklerini dosyaya kaydet
  const qrDosyaYolu = path.join(__dirname, '..', `qr_linkleri.${tenantSlug}.json`);
  fs.writeFileSync(qrDosyaYolu, JSON.stringify(qrLinkleri, null, 2), 'utf8');

  // SQL INSERT komutları oluştur (DB bağlantısı olmadan da üretilir; psql ile yüklenir).
  // tenant_id, slug'dan ÇALIŞMA ANINDA çözülür → numeric id elle yazılmaz, yanlış
  // belediyeye yükleme imkânsızdır. Slug yoksa/pasifse hata verir, hiçbir şey eklemez.
  // Tek transaction: ya hepsi eklenir ya hiçbiri (yarım yükleme olmaz).
  const sqlDosyaYolu = path.join(__dirname, '..', `seed.${tenantSlug}.sql`);
  let sqlKomutlari = `-- ${belediyeAdi} (tenant: ${tenantSlug}) Sokak Verileri (Otomatik Üretildi)\n`;
  sqlKomutlari += `-- Yükleme: docker compose exec -T db psql -U belediye -d belediye < seed.${tenantSlug}.sql\n\n`;
  sqlKomutlari += 'BEGIN;\n\n';
  sqlKomutlari += `-- Güvenlik: tenant yoksa/pasifse hata ver, hiçbir sokak ekleme\n`;
  sqlKomutlari += `DO $$ BEGIN\n`;
  sqlKomutlari += `  IF NOT EXISTS (SELECT 1 FROM tenantlar WHERE slug = '${slugSql}' AND aktif = true) THEN\n`;
  sqlKomutlari += `    RAISE EXCEPTION 'Tenant bulunamadi veya pasif: ${slugSql} — once scripts/tenant-ekle.js calistirin';\n`;
  sqlKomutlari += `  END IF;\n`;
  sqlKomutlari += `END $$;\n\n`;

  for (const s of sokaklar) {
    sqlKomutlari += `INSERT INTO sokaklar (id, tenant_id, sokak_adi, enlem, boylam, hmac_imza, qr_kod, aktif) VALUES `;
    sqlKomutlari += `('${s.id}', (SELECT id FROM tenantlar WHERE slug='${slugSql}'), '${s.sokakAdi.replace(/'/g, "''")}', ${s.enlem}, ${s.boylam}, '${s.hmacImza}', '${s.qrKod}', true);\n`;
  }

  sqlKomutlari += '\nCOMMIT;\n';
  fs.writeFileSync(sqlDosyaYolu, sqlKomutlari, 'utf8');

  console.log('═══════════════════════════════════════════════');
  console.log(`✅ ${sokaklar.length} sokak başarıyla işlendi!`);
  console.log(`📄 QR Linkleri: ${qrDosyaYolu}`);
  console.log(`📄 SQL Dosyası: ${sqlDosyaYolu}`);
  console.log('═══════════════════════════════════════════════');
  console.log('\n📋 İlk 5 QR Linki (Örnek):');
  qrLinkleri.slice(0, 5).forEach(q => {
    console.log(`   ${q.sokakAdi}`);
    console.log(`   → ${q.qrLinki}\n`);
  });
}

main().catch(console.error);
