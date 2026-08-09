/**
 * Sokak GÜNCELLEME Scripti (akıllı diff / upsert)
 * ================================================
 *
 * `seed-sokaklar.js` İLK yükleme içindir (her şeyi INSERT eder). Bir belediyede
 * SOKAKLAR ZATEN VARKEN haritacıdan GÜNCEL bir CSV gelince bunu kullan: yeni gelen
 * listeyi mevcut DB durumuyla karşılaştırır ve YALNIZCA farkı uygular.
 *
 * Neden mevcut durum gerekiyor? Çünkü:
 *   - Hangi sokağın "yeni" olduğunu (=QR basılacak) ancak DB'dekiyle kıyaslayınca
 *     bilebiliriz.
 *   - Ad/koordinat değişiminde sokağın ESKİ UUID'sini KORUMAK zorundayız; aksi halde
 *     o sokağın BASILI QR'ı ölür. UUID yalnızca DB'de var, gelen CSV'de yok.
 *
 * Üç işlem de UUID kalıcılığı bozulmadan ayrıştırılır:
 *   1) YENİ      : koordinatı mevcut hiçbir sokağa uymayan satır → INSERT (yeni UUID + QR)
 *   2) AD DEĞİŞTİ: koordinat eşleşiyor, ad farklı → UPDATE ad (AYNI UUID → QR DEĞİŞMEZ)
 *   3) TAŞINDI   : ad eşleşiyor, koordinat farklı → UPDATE koordinat (AYNI UUID → QR DEĞİŞMEZ)
 *   - DB'de olup yeni CSV'de OLMAYAN → SİLİNMEZ; yalnızca yorum satırı olarak uyarılır
 *     (istersen guncelle.<slug>.sql içindeki yorumu açıp pasifleştirirsin).
 *
 * Kullanım:
 *   1) Mevcut durumu DB'den dışa aktar (UUID'li):
 *        docker compose exec -T db psql -U belediye -d belediye -c \
 *          "COPY (SELECT id, sokak_adi, enlem, boylam FROM sokaklar \
 *           WHERE tenant_id=(SELECT id FROM tenantlar WHERE slug='gulsehir') AND aktif=true \
 *           ORDER BY sokak_adi) TO STDOUT WITH (FORMAT CSV, HEADER true)" > mevcut.gulsehir.csv
 *
 *   2) Diff'i üret:
 *        node scripts/sokak-guncelle.js gulsehir ./yeni-sokaklar.csv ./mevcut.gulsehir.csv
 *
 *   3) İncele (konsol raporu) ve uygula:
 *        docker compose exec -T db psql -U belediye -d belediye < guncelle.gulsehir.sql
 *
 *   4) yeni_qr.gulsehir.json içindeki SADECE YENİ sokakların QR'ını bastır.
 *
 * Mevcut CSV argümanı verilmezse script onu nasıl üreteceğini yazar ve çıkar.
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

/** Tırnaklı alanları ve kaçışlı tırnağı ("") doğru işleyen minimal CSV satır ayrıştırıcı. */
function csvSatirAyir(satir) {
  const alanlar = [];
  let mevcut = '';
  let tirnakIcinde = false;
  for (let i = 0; i < satir.length; i++) {
    const c = satir[i];
    if (tirnakIcinde) {
      if (c === '"') {
        if (satir[i + 1] === '"') { mevcut += '"'; i++; }
        else tirnakIcinde = false;
      } else mevcut += c;
    } else if (c === '"') {
      tirnakIcinde = true;
    } else if (c === ',') {
      alanlar.push(mevcut); mevcut = '';
    } else mevcut += c;
  }
  alanlar.push(mevcut);
  return alanlar;
}

/** Bir CSV dosyasını satır dizisine çevirir (başlık atlanır, boş satırlar elenir). */
function csvOku(dosyaYolu) {
  const icerik = fs.readFileSync(dosyaYolu, 'utf8');
  return icerik
    .split('\n')
    .map(s => s.replace(/\r$/, ''))
    .filter(s => s.trim())
    .slice(1) // başlık
    .map(csvSatirAyir);
}

/** Ad normalizasyonu (eşleştirme için): büyük harf + tek boşluk + trim. */
function adNormal(ad) {
  return String(ad || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Koordinat anahtarı: ~1.1 m hassasiyet (5 ondalık). Float gürültüsünü yutar. */
function koordAnahtar(enlem, boylam) {
  return `${enlem.toFixed(5)},${boylam.toFixed(5)}`;
}

function sqlEsc(s) {
  return String(s).replace(/'/g, "''");
}

// QR'a basılan kısa base62 kod (8 hane). lib/security/kod.js ile AYNI mantık.
const QR_ALFABE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function qrKodUret(uzunluk = 8) {
  let kod = '';
  while (kod.length < uzunluk) {
    const bytes = crypto.randomBytes(uzunluk);
    for (let i = 0; i < bytes.length && kod.length < uzunluk; i++) {
      if (bytes[i] < 248) kod += QR_ALFABE[bytes[i] % 62];
    }
  }
  return kod;
}

function main() {
  envOku();

  const tenantSlug = (process.argv[2] || '').toLowerCase().trim();
  if (!tenantSlug || !/^[a-z0-9-]+$/.test(tenantSlug)) {
    console.error('❌ Belediye slug\'ı eksik veya geçersiz!');
    console.error('   Kullanım: node scripts/sokak-guncelle.js <slug> <yeni-csv> <mevcut-csv>');
    process.exit(1);
  }

  const yeniCsvArg = process.argv[3];
  const mevcutCsvArg = process.argv[4];

  if (!yeniCsvArg) {
    console.error('❌ Yeni CSV yolu eksik.');
    console.error('   Kullanım: node scripts/sokak-guncelle.js <slug> <yeni-csv> <mevcut-csv>');
    process.exit(1);
  }
  const yeniCsvPath = path.resolve(yeniCsvArg);
  if (!fs.existsSync(yeniCsvPath)) {
    console.error('❌ Yeni CSV bulunamadı:', yeniCsvPath);
    process.exit(1);
  }

  // Mevcut durum (UUID'li) verilmezse, nasıl üretileceğini söyle ve çık.
  if (!mevcutCsvArg) {
    console.error('❌ Mevcut durum CSV\'si (UUID\'li) gerekli. Önce DB\'den dışa aktar:\n');
    console.error('   docker compose exec -T db psql -U belediye -d belediye -c \\');
    console.error(`     "COPY (SELECT id, sokak_adi, enlem, boylam FROM sokaklar \\`);
    console.error(`      WHERE tenant_id=(SELECT id FROM tenantlar WHERE slug='${tenantSlug}') AND aktif=true \\`);
    console.error(`      ORDER BY sokak_adi) TO STDOUT WITH (FORMAT CSV, HEADER true)" > mevcut.${tenantSlug}.csv\n`);
    console.error(`   Sonra: node scripts/sokak-guncelle.js ${tenantSlug} ${yeniCsvArg} ./mevcut.${tenantSlug}.csv`);
    process.exit(1);
  }
  const mevcutCsvPath = path.resolve(mevcutCsvArg);
  if (!fs.existsSync(mevcutCsvPath)) {
    console.error('❌ Mevcut CSV bulunamadı:', mevcutCsvPath);
    process.exit(1);
  }

  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) {
    console.error('❌ HMAC_SECRET tanımlı değil! (.env.local) — üretimdekiyle AYNI olmalı.');
    process.exit(1);
  }

  // QR kökü (lib/server/qr.js ile AYNI mantık)
  const _base = (process.env.APP_BASE_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
  const qrBaseUrl = process.env.QR_BASE_URL
    ? process.env.QR_BASE_URL.trim().replace(/\/+$/, '')
    : (_base ? `https://qr.${_base}` : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));

  // ---- Mevcut durumu oku: id, sokak_adi, enlem, boylam ----
  const mevcutSokaklar = [];
  for (const p of csvOku(mevcutCsvPath)) {
    if (p.length < 4) continue;
    const id = p[0].trim();
    const ad = p[1].trim();
    const enlem = parseFloat(p[2]);
    const boylam = parseFloat(p[3]);
    if (!id || isNaN(enlem) || isNaN(boylam)) continue;
    mevcutSokaklar.push({ id, ad, enlem, boylam });
  }

  // ---- Yeni CSV'yi oku: Sokak_Adi, Enlem_Y, Boylam_X ----
  const yeniSatirlar = [];
  for (const p of csvOku(yeniCsvPath)) {
    if (p.length < 3) continue;
    const ad = p[0].trim();
    const enlem = parseFloat(p[1]);
    const boylam = parseFloat(p[2]);
    if (!ad || isNaN(enlem) || isNaN(boylam)) continue;
    yeniSatirlar.push({ ad, enlem, boylam });
  }

  // ---- İndeksler ----
  const mevcutKoordIle = new Map(); // koordAnahtar -> mevcut sokak
  const mevcutAdIle = new Map();    // adNormal -> [mevcut sokaklar]
  for (const m of mevcutSokaklar) {
    mevcutKoordIle.set(koordAnahtar(m.enlem, m.boylam), m);
    const an = adNormal(m.ad);
    if (!mevcutAdIle.has(an)) mevcutAdIle.set(an, []);
    mevcutAdIle.get(an).push(m);
  }

  const yeniler = [];      // INSERT (yeni UUID + QR)
  const adDegisen = [];    // UPDATE ad
  const tasinan = [];      // UPDATE koordinat (+ad)
  const degismeyen = [];   // dokunma
  const eslesenMevcutId = new Set();
  const yeniEslesmeyen = [];

  // 1. geçiş: koordinatla eşleştir (değişmeyen + ad değişikliği)
  for (const y of yeniSatirlar) {
    const m = mevcutKoordIle.get(koordAnahtar(y.enlem, y.boylam));
    if (m && !eslesenMevcutId.has(m.id)) {
      eslesenMevcutId.add(m.id);
      if (adNormal(m.ad) === adNormal(y.ad)) {
        degismeyen.push(m);
      } else {
        adDegisen.push({ id: m.id, eskiAd: m.ad, yeniAd: y.ad });
      }
    } else {
      yeniEslesmeyen.push(y);
    }
  }

  // 2. geçiş: koordinatı tutmayanları AD ile eşleştir (taşınma) — UUID korunur
  for (const y of yeniEslesmeyen) {
    const an = adNormal(y.ad);
    const adaylar = (mevcutAdIle.get(an) || []).filter(m => !eslesenMevcutId.has(m.id));
    if (adaylar.length === 1) {
      const m = adaylar[0];
      eslesenMevcutId.add(m.id);
      tasinan.push({ id: m.id, ad: m.ad, eskiEnlem: m.enlem, eskiBoylam: m.boylam, enlem: y.enlem, boylam: y.boylam });
    } else {
      // 3. gerçek YENİ sokak → INSERT (yeni UUID + QR + kısa base62 qr_kod)
      const id = crypto.randomUUID();
      const hmacImza = crypto.createHmac('sha256', hmacSecret).update(id).digest('hex');
      const qrKod = qrKodUret();
      yeniler.push({ id, ad: y.ad.toUpperCase(), enlem: y.enlem, boylam: y.boylam, hmacImza, qrKod });
    }
  }

  // DB'de olup yeni CSV'de bulunmayanlar → silme adayı (uyarı; otomatik silinmez)
  const silmeAdaylari = mevcutSokaklar.filter(m => !eslesenMevcutId.has(m.id));

  // ---- SQL üret ----
  const slugSql = sqlEsc(tenantSlug);
  let sql = `-- GÜNCELLEME (tenant: ${tenantSlug}) — Otomatik üretildi\n`;
  sql += `-- Yükleme: docker compose exec -T db psql -U belediye -d belediye < guncelle.${tenantSlug}.sql\n\n`;
  sql += 'BEGIN;\n\n';
  sql += `DO $$ BEGIN\n`;
  sql += `  IF NOT EXISTS (SELECT 1 FROM tenantlar WHERE slug = '${slugSql}' AND aktif = true) THEN\n`;
  sql += `    RAISE EXCEPTION 'Tenant bulunamadi veya pasif: ${slugSql}';\n`;
  sql += `  END IF;\n`;
  sql += `END $$;\n\n`;

  sql += `-- ${yeniler.length} YENİ SOKAK (bunların QR'ını bastır → yeni_qr.${tenantSlug}.json)\n`;
  for (const s of yeniler) {
    sql += `INSERT INTO sokaklar (id, tenant_id, sokak_adi, enlem, boylam, hmac_imza, qr_kod, aktif) VALUES `;
    sql += `('${s.id}', (SELECT id FROM tenantlar WHERE slug='${slugSql}'), '${sqlEsc(s.ad)}', ${s.enlem}, ${s.boylam}, '${s.hmacImza}', '${s.qrKod}', true);\n`;
  }

  sql += `\n-- ${adDegisen.length} AD DEĞİŞİKLİĞİ (UUID korunur → QR DEĞİŞMEZ)\n`;
  for (const a of adDegisen) {
    sql += `UPDATE sokaklar SET sokak_adi='${sqlEsc(a.yeniAd.toUpperCase())}' WHERE id='${a.id}';  -- ${sqlEsc(a.eskiAd)} → ${sqlEsc(a.yeniAd.toUpperCase())}\n`;
  }

  sql += `\n-- ${tasinan.length} TAŞINMA (koordinat güncellenir, UUID korunur → QR DEĞİŞMEZ)\n`;
  for (const t of tasinan) {
    sql += `UPDATE sokaklar SET enlem=${t.enlem}, boylam=${t.boylam} WHERE id='${t.id}';  -- ${sqlEsc(t.ad)}\n`;
  }

  sql += `\n-- ${silmeAdaylari.length} SİLME ADAYI: yeni CSV'de yok. Otomatik SİLİNMEZ.\n`;
  sql += `-- Pasifleştirmek istersen ilgili satırın başındaki '-- ' işaretini kaldır:\n`;
  for (const s of silmeAdaylari) {
    sql += `-- UPDATE sokaklar SET aktif=false WHERE id='${s.id}';  -- ${sqlEsc(s.ad)}\n`;
  }

  sql += '\nCOMMIT;\n';

  const sqlYol = path.join(__dirname, '..', `guncelle.${tenantSlug}.sql`);
  fs.writeFileSync(sqlYol, sql, 'utf8');

  // Sadece YENİ sokakların QR linkleri
  const yeniQr = yeniler.map(s => ({ sokakAdi: s.ad, qrLinki: `${qrBaseUrl}/q/${s.qrKod}` }));
  const qrYol = path.join(__dirname, '..', `yeni_qr.${tenantSlug}.json`);
  fs.writeFileSync(qrYol, JSON.stringify(yeniQr, null, 2), 'utf8');

  // ---- Rapor ----
  console.log('═══════════════════════════════════════════════');
  console.log(`📊 GÜNCELLEME RAPORU — ${tenantSlug}`);
  console.log('═══════════════════════════════════════════════');
  console.log(`   Mevcut sokak (DB) : ${mevcutSokaklar.length}`);
  console.log(`   Yeni CSV satırı   : ${yeniSatirlar.length}`);
  console.log('   ─────────────────────────────');
  console.log(`   ➕ YENİ (QR bas)  : ${yeniler.length}`);
  console.log(`   ✏️  AD DEĞİŞTİ     : ${adDegisen.length}   (QR değişmez)`);
  console.log(`   📍 TAŞINDI        : ${tasinan.length}   (QR değişmez)`);
  console.log(`   ✔️  DEĞİŞMEYEN     : ${degismeyen.length}`);
  console.log(`   ⚠️  SİLME ADAYI   : ${silmeAdaylari.length}   (otomatik silinmez)`);
  console.log('═══════════════════════════════════════════════');
  if (adDegisen.length) {
    console.log('\n✏️  Ad değişiklikleri:');
    adDegisen.forEach(a => console.log(`   ${a.eskiAd}  →  ${a.yeniAd.toUpperCase()}`));
  }
  if (tasinan.length) {
    console.log('\n📍 Taşınanlar:');
    tasinan.forEach(t => console.log(`   ${t.ad}: (${t.eskiEnlem},${t.eskiBoylam}) → (${t.enlem},${t.boylam})`));
  }
  if (silmeAdaylari.length) {
    console.log('\n⚠️  Yeni CSV\'de olmayanlar (kontrol et — taşınmış olabilir):');
    silmeAdaylari.forEach(s => console.log(`   ${s.ad}`));
  }
  console.log(`\n📄 SQL : ${sqlYol}`);
  console.log(`📄 Yeni QR: ${qrYol}  (${yeniler.length} sokak)`);
  console.log('\n👉 SQL\'i incele, sonra uygula:');
  console.log(`   docker compose exec -T db psql -U belediye -d belediye < guncelle.${tenantSlug}.sql`);
}

main();
