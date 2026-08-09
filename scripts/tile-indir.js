/**
 * Tile İndirme Scripti (Belediye bbox'ı için offline harita karoları)
 * ===================================================================
 *
 * Bir belediyenin sokak CSV'sinden sınır kutusunu (bbox) hesaplar ve YALNIZCA o
 * alanın harita karolarını (tile) indirip `tiles/<slug>/<z>/<x>/<y>.png` altına yazar.
 * Böylece harita çalışma anında dış CDN'e bağımlı olmaz (bkz. app/api/tiles).
 *
 * Kullanım:
 *   node scripts/tile-indir.js <slug> <csv-yolu> [minZoom=12] [maxZoom=18]
 *
 * Örnek:
 *   node scripts/tile-indir.js gulsehir ./gulsehir-sokaklar.csv
 *   node scripts/tile-indir.js gulsehir ./gulsehir-sokaklar.csv 12 18
 *
 * Notlar:
 *  - Kaynak CARTO "dark" karolarıdır (uygulamadaki koyu tema ile uyumlu). Atıf
 *    (© OpenStreetMap © CARTO) haritada korunur.
 *  - Mevcut tile'lar atlanır → script tekrar çalıştırılabilir (kaldığı yerden devam).
 *  - İndirme kibarca (sınırlı eşzamanlılık + küçük gecikme) yapılır.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Web Mercator tile yardımcıları ----
function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function lat2tile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

function uyku(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const slug = (process.argv[2] || '').toLowerCase().trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    console.error('❌ Belediye slug\'ı eksik/geçersiz.');
    console.error('   Kullanım: node scripts/tile-indir.js <slug> <csv-yolu> [minZoom] [maxZoom]');
    process.exit(1);
  }

  const csvArg = process.argv[3];
  if (!csvArg) {
    console.error('❌ CSV yolu gerekli.');
    console.error('   Örnek: node scripts/tile-indir.js gulsehir ./gulsehir-sokaklar.csv');
    process.exit(1);
  }
  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV bulunamadı:', csvPath);
    process.exit(1);
  }

  const minZoom = parseInt(process.argv[4] || '12', 10);
  const maxZoom = parseInt(process.argv[5] || '18', 10);
  if (!(minZoom >= 1 && maxZoom <= 19 && minZoom <= maxZoom)) {
    console.error('❌ Zoom aralığı geçersiz (1..19, min<=max).');
    process.exit(1);
  }

  // ---- CSV'den koordinatları oku, bbox hesapla ----
  const satirlar = fs.readFileSync(csvPath, 'utf8').split('\n').filter((s) => s.trim());
  const veri = satirlar.slice(1); // başlık atla
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  let sayac = 0;
  for (const satir of veri) {
    const p = satir.split(',');
    if (p.length < 3) continue;
    const enlem = parseFloat(p[1]);
    const boylam = parseFloat(p[2]);
    if (!Number.isFinite(enlem) || !Number.isFinite(boylam)) continue;
    minLat = Math.min(minLat, enlem);
    maxLat = Math.max(maxLat, enlem);
    minLon = Math.min(minLon, boylam);
    maxLon = Math.max(maxLon, boylam);
    sayac++;
  }
  if (sayac === 0) {
    console.error('❌ CSV\'de geçerli koordinat bulunamadı.');
    process.exit(1);
  }

  // Kenar payı: sokakların biraz dışını da kapsa (başkan kenardan da görebilsin).
  const latPad = (maxLat - minLat) * 0.15 + 0.003;
  const lonPad = (maxLon - minLon) * 0.15 + 0.003;
  minLat -= latPad; maxLat += latPad;
  minLon -= lonPad; maxLon += lonPad;

  const cikisKok = path.join(__dirname, '..', 'tiles', slug);
  console.log(`📍 ${slug}: ${sayac} sokak | bbox [${minLat.toFixed(4)},${minLon.toFixed(4)}] – [${maxLat.toFixed(4)},${maxLon.toFixed(4)}]`);
  console.log(`🗺️  Zoom ${minZoom}–${maxZoom} | hedef: ${cikisKok}\n`);

  // ---- İndirilecek tile listesini çıkar ----
  const isler = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lon2tile(minLon, z);
    const xMax = lon2tile(maxLon, z);
    const yMin = lat2tile(maxLat, z); // kuzey = küçük y
    const yMax = lat2tile(minLat, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        isler.push({ z, x, y });
      }
    }
  }
  console.log(`📦 Toplam ${isler.length} tile.\n`);

  // ---- Kibarca indir (sınırlı eşzamanlılık + gecikme, mevcutları atla) ----
  const altKaynaklar = ['a', 'b', 'c', 'd'];
  const ESZAMAN = 4;
  let indirilen = 0, atlanan = 0, hata = 0, i = 0;

  async function isci(no) {
    while (i < isler.length) {
      const idx = i++;
      const { z, x, y } = isler[idx];
      const klasor = path.join(cikisKok, String(z), String(x));
      const dosya = path.join(klasor, `${y}.png`);
      if (fs.existsSync(dosya)) { atlanan++; continue; }

      const sub = altKaynaklar[idx % altKaynaklar.length];
      const url = `https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'DijitalBelediyem-TileFetch/1.0 (belediye sikayet sistemi)' },
        });
        if (!res.ok) { hata++; await uyku(120); continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(klasor, { recursive: true });
        fs.writeFileSync(dosya, buf);
        indirilen++;
        if (indirilen % 100 === 0) {
          console.log(`   … ${indirilen} indirildi (${atlanan} atlandı, ${hata} hata)`);
        }
        await uyku(60); // kibar gecikme
      } catch {
        hata++;
        await uyku(150);
      }
    }
  }

  await Promise.all(Array.from({ length: ESZAMAN }, (_, n) => isci(n)));

  console.log('\n═══════════════════════════════════════════════');
  console.log(`✅ Bitti: ${indirilen} indirildi, ${atlanan} zaten vardı, ${hata} hata`);
  console.log(`📂 ${cikisKok}`);
  if (hata > 0) console.log('ℹ️  Hatalı olanlar için scripti tekrar çalıştırabilirsin (kaldığı yerden devam eder).');
  console.log('═══════════════════════════════════════════════');
}

main().catch((e) => { console.error('Tile indirme hatası:', e); process.exit(1); });
