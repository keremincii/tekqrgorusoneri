/**
 * CSV Koordinat Önizleme + Doğrulama Aracı
 * ========================================
 *
 * AMAÇ: Sokakları veritabanına YÜKLEMEDEN ÖNCE, CSV'deki her enlem/boylam'ın
 * haritada NEREYE düşeceğini gerçek bir harita üzerinde gözle doğrulamak.
 * Harita render'ı zaten kusursuz (Leaflet, WGS84) — hata yalnızca CSV verisinden
 * gelir (enlem/boylam ters, düşük ondalık hassasiyet, yazım hatası). Bu araç o
 * hataları hem otomatik yakalar hem de göz kontrolü için harita çıktısı üretir.
 *
 * KULLANIM:
 *   node scripts/csv-onizleme.js <csv-yolu> [merkezEnlem] [merkezBoylam]
 *   node scripts/csv-onizleme.js ../gulsehir-sokaklar.csv 38.717 34.625
 *
 * CSV FORMATI (seed-sokaklar.js ile AYNI): ilk satır başlık, sonra
 *   Sokak_Adi,Enlem_Y,Boylam_X
 *
 * ÇIKTI:
 *   1. Konsola doğrulama raporu (uyarılı satırlar + özet).
 *   2. `csv-onizleme.html` — tarayıcıda açınca TÜM noktaları gerçek OSM haritası
 *      üzerinde pin olarak gösterir (yeşil=temiz, kırmızı=uyarı). Pine tıkla →
 *      sokak adı, koordinat, uyarı ve Google Maps linki. Böylece her pini gerçek
 *      sokakla karşılaştırıp "doğru yerde mi?" diye bakarsın.
 *
 * NOT: Önizleme HTML'i internet ister (OSM tile + Leaflet CDN) — bu yalnız senin
 * göz kontrolün için; üretim uygulaması kendi tile'larını kendi sunar.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Türkiye kaba sınır kutusu (bariz ters/yanlış koordinatı yakalamak için).
const TR_ENLEM = [35.8, 42.2];   // latitude
const TR_BOYLAM = [25.6, 44.9];  // longitude

function ondalikSay(rawToken) {
  const s = String(rawToken).trim();
  const nokta = s.indexOf('.');
  if (nokta < 0) return 0;
  return s.length - nokta - 1;
}

function medyan(sayilar) {
  const s = [...sayilar].sort((a, b) => a - b);
  const orta = Math.floor(s.length / 2);
  return s.length % 2 ? s[orta] : (s[orta - 1] + s[orta]) / 2;
}

function main() {
  const csvArg = process.argv[2];
  if (!csvArg) {
    console.error('❌ CSV yolu gerekli.');
    console.error('   Kullanım: node scripts/csv-onizleme.js <csv-yolu> [merkezEnlem] [merkezBoylam]');
    console.error('   Örnek:    node scripts/csv-onizleme.js ../gulsehir-sokaklar.csv 38.717 34.625');
    process.exit(1);
  }
  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV bulunamadı:', csvPath);
    process.exit(1);
  }

  const merkezEnlemArg = process.argv[3] ? parseFloat(process.argv[3]) : null;
  const merkezBoylamArg = process.argv[4] ? parseFloat(process.argv[4]) : null;

  const icerik = fs.readFileSync(csvPath, 'utf8');
  const satirlar = icerik.split('\n').filter((s) => s.trim());
  const veriSatirlari = satirlar.slice(1); // ilk satır başlık

  const noktalar = [];
  const hatalar = []; // parse edilemeyen satırlar

  veriSatirlari.forEach((satir, i) => {
    const p = satir.split(',');
    const satirNo = i + 2; // 1-tabanlı + başlık
    if (p.length < 3) { hatalar.push({ satirNo, satir, sebep: 'sütun < 3' }); return; }
    const ad = p[0].trim();
    const enlemRaw = p[1].trim();
    const boylamRaw = p[2].trim();
    const enlem = parseFloat(enlemRaw);
    const boylam = parseFloat(boylamRaw);
    if (!ad || Number.isNaN(enlem) || Number.isNaN(boylam)) {
      hatalar.push({ satirNo, satir, sebep: 'ad boş veya sayı değil' });
      return;
    }
    noktalar.push({
      satirNo,
      ad: ad.toUpperCase(),
      enlem,
      boylam,
      enlemOndalik: ondalikSay(enlemRaw),
      boylamOndalik: ondalikSay(boylamRaw),
      uyarilar: [], // CİDDİ (kırmızı): yükleme öncesi düzeltilmeli
      bilgiler: [], // BİLGİ (sarı): büyük ihtimalle sorun değil ama göz at
    });
  });

  if (noktalar.length === 0) {
    console.error('❌ Geçerli koordinatlı hiç satır yok.');
    if (hatalar.length) console.error(`   ${hatalar.length} satır parse edilemedi.`);
    process.exit(1);
  }

  // Merkez: argüman verildiyse onu, yoksa medyanı (kümenin ortası) kullan.
  const merkezEnlem = Number.isFinite(merkezEnlemArg) ? merkezEnlemArg : medyan(noktalar.map((n) => n.enlem));
  const merkezBoylam = Number.isFinite(merkezBoylamArg) ? merkezBoylamArg : medyan(noktalar.map((n) => n.boylam));

  // --- Doğrulama kuralları ---
  // NOT: "enlem > boylam → ters" gibi bir kural KULLANMIYORUZ — Orta/Batı Türkiye'de
  // enlem (36–42) çoğu zaman boylamdan (26–38) BÜYÜKTÜR; bu normaldir. Gerçek ters
  // yazma zaten "Türkiye dışı" + "kümeden uzak" kurallarıyla yakalanır (koordinat
  // takas edilince enlem, boylam aralığına düşer ve sınır dışına çıkar).
  const koordSayac = new Map(); // "enlem,boylam" -> [adlar] (aynı noktaya düşen sokaklar)
  for (const n of noktalar) {
    // 1. CİDDİ: Türkiye sınırları dışında mı? (ters yazma / yanlış sayı bunu tetikler)
    if (n.enlem < TR_ENLEM[0] || n.enlem > TR_ENLEM[1]) n.uyarilar.push(`enlem Türkiye dışı (${n.enlem}) → sütunlar ters olabilir`);
    if (n.boylam < TR_BOYLAM[0] || n.boylam > TR_BOYLAM[1]) n.uyarilar.push(`boylam Türkiye dışı (${n.boylam}) → sütunlar ters olabilir`);

    // 2. CİDDİ: kümenin ortasından çok uzak (>0.25° ≈ ~28 km → tek ilçede typo/ters).
    const dLat = Math.abs(n.enlem - merkezEnlem);
    const dLon = Math.abs(n.boylam - merkezBoylam);
    if (dLat > 0.25 || dLon > 0.25) n.uyarilar.push('diğer sokaklardan ~28km+ uzak → typo/ters şüphesi');

    // 3. Hassasiyet: ≤3 ondalık (≥~110m) CİDDİ (yanlış sokağa düşebilir);
    //    4 ondalık (~11m) yalnız BİLGİ (sokak üstünde kalır, kabul edilebilir).
    const minOnd = Math.min(n.enlemOndalik, n.boylamOndalik);
    if (minOnd <= 3) n.uyarilar.push(`çok düşük hassasiyet (${minOnd} ondalık ≈ ${hassasiyetMetre(minOnd)})`);
    else if (minOnd === 4) n.bilgiler.push('4 ondalık (~11m) — sokak için yeterli ama 5-6 daha iyi');

    // 4. BİLGİ: aynı koordinata düşen farklı sokaklar (kopyala-yapıştır olabilir).
    const anahtar = `${n.enlem},${n.boylam}`;
    if (!koordSayac.has(anahtar)) koordSayac.set(anahtar, []);
    koordSayac.get(anahtar).push(n.ad);
  }
  for (const n of noktalar) {
    const grup = koordSayac.get(`${n.enlem},${n.boylam}`);
    if (grup.length > 1) n.bilgiler.push(`aynı koordinatı ${grup.length} sokak paylaşıyor`);
  }

  // --- Konsol raporu ---
  const uyarili = noktalar.filter((n) => n.uyarilar.length > 0);
  const bilgili = noktalar.filter((n) => n.uyarilar.length === 0 && n.bilgiler.length > 0);
  const temizSayi = noktalar.length - uyarili.length - bilgili.length;
  console.log('═══════════════════════════════════════════════');
  console.log(`📂 CSV: ${csvPath}`);
  console.log(`📍 Merkez (harita odağı): ${merkezEnlem.toFixed(5)}, ${merkezBoylam.toFixed(5)}`);
  console.log(`   Toplam geçerli: ${noktalar.length} sokak`);
  if (hatalar.length) console.log(`   ✗ Parse edilemeyen satır: ${hatalar.length}`);
  console.log(`   🟢 Temiz: ${temizSayi}   🟡 Bilgi: ${bilgili.length}   🔴 Ciddi: ${uyarili.length}`);
  console.log('═══════════════════════════════════════════════');
  if (uyarili.length) {
    console.log('\n🔴 CİDDİ (yüklemeden ÖNCE düzelt):');
    for (const n of uyarili.slice(0, 40)) {
      console.log(`  • [satır ${n.satirNo}] ${n.ad}  (${n.enlem}, ${n.boylam})`);
      for (const u of n.uyarilar) console.log(`       ↳ ${u}`);
    }
    if (uyarili.length > 40) console.log(`  … ve ${uyarili.length - 40} sokak daha (tamamı HTML'de).`);
  } else {
    console.log('\n🟢 Ciddi hata yok — koordinatlar sağlıklı görünüyor.');
  }
  if (bilgili.length) {
    console.log(`\n🟡 BİLGİ (${bilgili.length} sokak — muhtemelen sorun değil, HTML'de gör):`);
    for (const n of bilgili.slice(0, 8)) {
      console.log(`  • [satır ${n.satirNo}] ${n.ad}: ${n.bilgiler.join(' · ')}`);
    }
    if (bilgili.length > 8) console.log(`  … ve ${bilgili.length - 8} sokak daha.`);
  }
  for (const h of hatalar.slice(0, 10)) {
    console.log(`  ✗ [satır ${h.satirNo}] parse HATASI (${h.sebep}): ${h.satir.slice(0, 60)}`);
  }

  // --- HTML önizleme çıktısı ---
  const html = htmlOlustur(noktalar, merkezEnlem, merkezBoylam, path.basename(csvPath));
  const htmlYolu = path.join(__dirname, '..', 'csv-onizleme.html');
  fs.writeFileSync(htmlYolu, html, 'utf8');
  console.log(`\n🗺️  Harita önizlemesi: ${htmlYolu}`);
  console.log('    → Bu dosyayı tarayıcıda AÇ. Her pini gerçek sokakla karşılaştır.');
  console.log('    → Kırmızı pinler uyarılı; yeşiller temiz. Pine tıkla → detay + Google Maps linki.\n');
}

function hassasiyetMetre(ondalik) {
  const tablo = { 0: '~111 km', 1: '~11 km', 2: '~1.1 km', 3: '~110 m', 4: '~11 m', 5: '~1.1 m', 6: '~11 cm' };
  return tablo[ondalik] || 'çok hassas';
}

function htmlOlustur(noktalar, merkezEnlem, merkezBoylam, csvAdi) {
  const veri = JSON.stringify(noktalar.map((n) => ({
    ad: n.ad, enlem: n.enlem, boylam: n.boylam, uyarilar: n.uyarilar, bilgiler: n.bilgiler,
  })));
  const uyariliSayi = noktalar.filter((n) => n.uyarilar.length).length;
  const bilgiliSayi = noktalar.filter((n) => !n.uyarilar.length && n.bilgiler.length).length;
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CSV Koordinat Önizleme — ${csvAdi}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html,body{margin:0;height:100%;font-family:system-ui,Segoe UI,Roboto,sans-serif}
  #kap{display:flex;height:100%}
  #yan{width:320px;overflow:auto;border-right:1px solid #ddd;padding:12px;box-sizing:border-box}
  #harita{flex:1}
  h1{font-size:15px;margin:0 0 8px}
  .ozet{font-size:13px;color:#444;margin-bottom:10px;line-height:1.6}
  .rozet{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;font-weight:600;margin-right:4px}
  .yesil{background:#d1fae5;color:#065f46}.kirmizi{background:#fee2e2;color:#991b1b}.sari{background:#fef3c7;color:#92400e}
  .satir{padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13px;border:1px solid #eee;margin-bottom:6px}
  .satir:hover{background:#f5f7ff}
  .satir.u{border-color:#fca5a5;background:#fff5f5}
  .satir.b{border-color:#fcd34d;background:#fffbeb}
  .satir .ad{font-weight:600}
  .satir .k{color:#666;font-size:11px}
  .satir .uy{color:#b91c1c;font-size:11px;margin-top:2px}
  .lej{font-size:12px;color:#555;margin-top:6px}
</style>
</head>
<body>
<div id="kap">
  <div id="yan">
    <h1>🗺️ CSV Koordinat Önizleme</h1>
    <div class="ozet">
      <b>${csvAdi}</b> — toplam <b>${noktalar.length}</b> sokak<br>
      <span class="rozet ${uyariliSayi ? 'kirmizi' : 'yesil'}">🔴 ${uyariliSayi} ciddi</span>
      <span class="rozet sari">🟡 ${bilgiliSayi} bilgi</span>
      <span class="rozet yesil">🟢 ${noktalar.length - uyariliSayi - bilgiliSayi} temiz</span>
      <div class="lej">Pine/satıra tıkla → detay + Google Maps. Her pini gerçek sokakla karşılaştır.</div>
    </div>
    <div id="liste"></div>
  </div>
  <div id="harita"></div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const noktalar = ${veri};
  const map = L.map('harita').setView([${merkezEnlem}, ${merkezBoylam}], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);

  const markerlar = [];
  const bounds = [];
  noktalar.forEach((n, i) => {
    const renk = n.uyarilar.length ? '#ef4444' : (n.bilgiler.length ? '#f59e0b' : '#22c55e');
    const m = L.circleMarker([n.enlem, n.boylam], {
      radius: 8, color: '#fff', weight: 2, fillColor: renk, fillOpacity: 0.95
    }).addTo(map);
    const gmaps = 'https://www.google.com/maps?q=' + n.enlem + ',' + n.boylam;
    let uyHtml;
    if (n.uyarilar.length) uyHtml = '<div style="color:#b91c1c;margin-top:6px;font-size:12px">🔴 ' + n.uyarilar.map(escapeHtml).join('<br>🔴 ') + '</div>';
    else if (n.bilgiler.length) uyHtml = '<div style="color:#92400e;margin-top:6px;font-size:12px">🟡 ' + n.bilgiler.map(escapeHtml).join('<br>🟡 ') + '</div>';
    else uyHtml = '<div style="color:#065f46;margin-top:6px;font-size:12px">✅ Uyarı yok</div>';
    m.bindPopup(
      '<b>' + escapeHtml(n.ad) + '</b><br>' +
      '<span style="font-family:monospace">' + n.enlem + ', ' + n.boylam + '</span><br>' +
      '<a href="' + gmaps + '" target="_blank" rel="noopener">📍 Google Maps\\'te aç</a>' +
      uyHtml
    );
    markerlar.push(m);
    bounds.push([n.enlem, n.boylam]);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });

  // Sidebar listesi
  const liste = document.getElementById('liste');
  noktalar.forEach((n, i) => {
    const d = document.createElement('div');
    const sinif = n.uyarilar.length ? ' u' : (n.bilgiler.length ? ' b' : '');
    const nokta = n.uyarilar.length ? '🔴 ' : (n.bilgiler.length ? '🟡 ' : '🟢 ');
    const notlar = [...n.uyarilar, ...n.bilgiler];
    d.className = 'satir' + sinif;
    d.innerHTML = '<div class="ad">' + nokta + escapeHtml(n.ad) + '</div>' +
      '<div class="k">' + n.enlem + ', ' + n.boylam + '</div>' +
      (notlar.length ? '<div class="uy">' + notlar.map(escapeHtml).join(' · ') + '</div>' : '');
    d.onclick = () => { map.setView([n.enlem, n.boylam], 17); markerlar[i].openPopup(); };
    liste.appendChild(d);
  });

  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
</script>
</body>
</html>`;
}

main();
