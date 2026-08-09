/**
 * QR Tabela Üretici (baskıya hazır 190×255mm tabelalar)
 * =====================================================
 *
 * Bir belediyenin sokak/nokta CSV'sinden her nokta için baskıya hazır bir 190×255mm QR
 * tabelası üretir. QR, KALICI yönlendiriciyi kodlar:
 *   https://qr.<domain>/q/<qr_kod>          (YENİ: 8 haneli base62, kısa → kolay okunur)
 *   https://qr.<domain>/q/<uuid>            (eski export'lar; geriye uyum)
 * (lib/server/qr.js'teki qrLinkiOlustur ile AYNI biçim). Telefonla okutulunca
 * o noktanın şikayet formu açılır.
 *
 * VERİ KAYNAĞI: Canlı DB'den dışa aktarılmış CSV (kök dizindeki qr_linkleri.*.json
 * BAYAT olabilir — güvenme). Yeni export (qr_kod ile):
 *   ssh belediyem 'docker compose -f /root/belediye/docker-compose.yml exec -T db \
 *     psql -U belediye -d belediye -c "\copy (SELECT qr_kod, tabela_no, enlem, boylam \
 *     FROM sokaklar WHERE aktif=true ORDER BY tabela_no) TO STDOUT CSV HEADER"' > gulsehir-qr-data.csv
 *
 * Kullanım:
 *   node scripts/qr-tabela-uret.js [csv-yolu] [--adet N] [--base URL] [--ad "..."] [--site "..."]
 * Örnekler:
 *   node scripts/qr-tabela-uret.js gulsehir-qr-data.csv --adet 1     # önce 1 örnek bas, tara
 *   node scripts/qr-tabela-uret.js gulsehir-qr-data.csv              # 314 tabelanın hepsi
 *
 * Çıktılar (tarayıcıda aç → Ctrl+P → kağıt 190×255mm/özel → PDF/yazdır, kenar boşluğu 0, arka plan grafiği açık):
 *   qr-tabelalar.<slug>.html         → her nokta ayrı 190×255mm sayfa
 *   qr-yerlesim-listesi.<slug>.html  → saha ekibi: nokta no → koordinat + Google Maps linki
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** HTML kaçışı (XSS/bozuk işaret savunması). */
function kacis(metin) {
  return String(metin ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function argAyristir(argv) {
  const cfg = {
    csvPath: 'gulsehir-qr-data.csv',
    adet: Infinity,
    base: (process.env.QR_BASE || 'https://qr.dijitalbelediyem.com').replace(/\/+$/, ''),
    slug: 'gulsehir',
    belediyeAdi: 'GÜLŞEHİR BELEDİYESİ',
    site: 'gulsehir.dijitalbelediyem.com',
    // VARSAYILAN: yalnız NUMARALI (tabela_no dolu) sokakların tabelası basılır — fiziksel
    // olarak sahaya asılacaklar bunlar. Numarasız (tabela_no boş) sokaklar QR olarak DB'de
    // yaşamaya devam eder; sadece bu baskı çıktısına GİRMEZ. --tumu ile hepsi basılır.
    tumu: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--adet') cfg.adet = parseInt(argv[++i], 10) || Infinity;
    else if (a === '--base') cfg.base = String(argv[++i] || '').replace(/\/+$/, '');
    else if (a === '--slug') cfg.slug = String(argv[++i] || cfg.slug);
    else if (a === '--ad') cfg.belediyeAdi = String(argv[++i] || cfg.belediyeAdi);
    else if (a === '--site') cfg.site = String(argv[++i] || cfg.site);
    else if (a === '--tumu') cfg.tumu = true; // numarasız sokakları da bas (varsayılan: basma)
    else if (a && !a.startsWith('--')) cfg.csvPath = a;
  }
  return cfg;
}

/**
 * CSV'yi oku → [{kod, no, enlem, boylam}]. Başlık-farkındadır:
 *   - QR değeri: `qr_kod` sütunu (YENİ, tercih) → yoksa `id` (eski UUID export, geriye uyum)
 *   - Sahada gösterilecek numara: `tabela_no` → `sokak_adi` → `no`
 *   - `enlem`, `boylam`
 * Yeni export örneği (VPS):
 *   SELECT qr_kod, tabela_no, enlem, boylam FROM sokaklar WHERE aktif=true;
 */
function noktalariOku(csvPath) {
  const icerik = fs.readFileSync(csvPath, 'utf8');
  const satirlar = icerik.split('\n').map((s) => s.trim()).filter(Boolean);
  const baslik = satirlar[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (...adaylar) => {
    for (const a of adaylar) {
      const i = baslik.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };
  const kodIdx = idx('qr_kod', 'id');           // YENİ base62 kod, yoksa eski UUID
  const noIdx = idx('tabela_no', 'sokak_adi', 'no');
  const enlemIdx = idx('enlem');
  const boylamIdx = idx('boylam');

  const veri = satirlar.slice(1); // başlık atla
  const noktalar = [];
  for (const satir of veri) {
    const p = satir.split(',');
    const kod = (p[kodIdx] || '').trim();
    const no = noIdx !== -1 ? (p[noIdx] || '').trim() : '';
    const enlem = parseFloat(p[enlemIdx]);
    const boylam = parseFloat(p[boylamIdx]);
    if (!kod) continue;
    noktalar.push({ kod, no, enlem, boylam });
  }
  return noktalar;
}

/** Tek bir 190×255mm tabela HTML'i. */
function tabelaHtml(nokta, svg, cfg) {
  return `<section class="tabela">
    <div class="icerik">
      <div class="logo-blok">
        <div class="logo"></div>
        <div class="nokta-satir"><span class="nokta-no">${kacis(nokta.no)}</span></div>
      </div>
      <div class="ayrac"></div>
      <p class="soru">Sokakta bir sorun mu var?</p>
      <div class="qr-kart">${svg}</div>
      <p class="cagri-ana">Kamerayı açın ve şikayetinizi yazın.</p>
      <p class="baskan">Gülşehir Belediye Başkanı<br><strong>Erkan Çiftci</strong></p>
    </div>
  </section>`;
}

function tabelalarBelgesi(bolumler, cfg) {
  const logoCss = cfg.logoBase64
    ? `.logo { background-image: url('${cfg.logoBase64}'); }`
    : '.logo { display: none; }';
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"/>
<title>${kacis(cfg.belediyeAdi)} — QR Tabelaları</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap');
  @page { size: 190mm 255mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #12192b; font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif; }

  .tabela {
    position: relative;
    width: 190mm; height: 255mm;
    margin: 0 auto 6mm;
    background: #12192b;
    display: flex; align-items: center; justify-content: center;
    padding: 6mm 0 6mm;
    overflow: hidden;
    page-break-after: always;
  }
  .tabela:last-child { page-break-after: auto; }

  /* Üst gradient şerit */
  .tabela::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1.2mm;
    background: linear-gradient(90deg, #38bdf8, #818cf8);
  }

  .icerik {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; gap: 2.5mm; width: 100%;
  }

  .logo-blok { display: inline-flex; flex-direction: column; align-items: center; }
  .logo { width: 57mm; height: 42mm; background-size: contain; background-repeat: no-repeat; background-position: center; }
  ${logoCss}

  .nokta-satir { width: 100%; display: flex; justify-content: flex-end; }
  .nokta-no { font-size: 7.5pt; font-weight: 600; color: #475569; }

  .ayrac {
    width: 72mm; height: 0.3mm;
    background: linear-gradient(90deg, transparent, #38bdf8 30%, #818cf8 70%, transparent);
  }

  .soru {
    font-size: 14pt; font-weight: 700; color: #e2e8f0; line-height: 1.2;
  }

  /* QR beyaz kart + marka rengi glow */
  .qr-kart {
    background: #ffffff;
    border-radius: 4mm;
    padding: 3mm;
    box-shadow: 0 0 12mm 2mm rgba(56, 189, 248, 0.25), 0 0 4mm 1mm rgba(129, 140, 248, 0.2);
  }
  .qr-kart svg { display: block; width: 150mm; height: 150mm; }

  .cagri-ana {
    font-size: 12pt; font-weight: 700; color: #ffffff; line-height: 1.3;
  }
  .baskan {
    font-size: 13pt; font-weight: 500; color: #ffffff; line-height: 1.35;
    margin-top: 3mm;
  }
  .baskan strong { font-weight: 800; }

  @media screen {
    body { padding: 8mm 0; }
    .tabela { border-radius: 6mm; box-shadow: 0 6mm 24mm rgba(0,0,0,0.6); }
  }
</style></head>
<body>
${bolumler.join('\n')}
</body></html>`;
}

function yerlesimListesiBelgesi(noktalar, cfg) {
  const satirlar = noktalar.map((n) => {
    const koord = Number.isFinite(n.enlem) && Number.isFinite(n.boylam)
      ? `${n.enlem.toFixed(6)}, ${n.boylam.toFixed(6)}`
      : '—';
    const harita = Number.isFinite(n.enlem) && Number.isFinite(n.boylam)
      ? `<a href="https://www.google.com/maps?q=${n.enlem},${n.boylam}" target="_blank">Haritada aç</a>`
      : '—';
    return `<tr><td class="no">${kacis(n.no)}</td><td>${koord}</td><td>${harita}</td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"/>
<title>${kacis(cfg.belediyeAdi)} — QR Yerleşim Listesi</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');
  * { box-sizing: border-box; }
  body { font-family: 'Outfit', sans-serif; color: #0f172a; margin: 24px; }
  h1 { font-size: 20px; }
  p { color: #64748b; margin: 4px 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e2e8f0; padding: 7px 10px; text-align: left; }
  th { background: #f1f5f9; }
  td.no { font-weight: 700; }
  a { color: #2563eb; }
  @media print { a { color: #0f172a; text-decoration: none; } }
</style></head>
<body>
  <h1>${kacis(cfg.belediyeAdi)} — QR Yerleşim Listesi (${noktalar.length} nokta)</h1>
  <p>Hangi numaralı tabelanın nereye asılacağı. Koordinata tıklayınca Google Maps açılır.</p>
  <table>
    <thead><tr><th>Nokta No</th><th>Koordinat (enlem, boylam)</th><th>Konum</th></tr></thead>
    <tbody>
${satirlar}
    </tbody>
  </table>
</body></html>`;
}

async function main() {
  const cfg = argAyristir(process.argv.slice(2));
  const csvPath = path.resolve(cfg.csvPath);
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV bulunamadı:', csvPath);
    console.error('   Önce canlı DB\'den dışa aktarın (bkz. script başı yorumları).');
    process.exit(1);
  }

  // Logo yükle (yoksa logosuz devam et)
  const logoPaths = [
    path.resolve(__dirname, '..', 'gulsehir-logo-temiz.png'),
    'C:\\Users\\KEREM\\Desktop\\gulsehirlogosu.png',
    'C:\\Users\\KEREM\\Desktop\\gulsehir_logo.jpg',
  ];
  for (const lp of logoPaths) {
    if (fs.existsSync(lp)) {
      const ext = path.extname(lp).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      cfg.logoBase64 = `data:${mime};base64,${fs.readFileSync(lp).toString('base64')}`;
      console.log(`🖼️  Logo: ${lp}`);
      break;
    }
  }
  if (!cfg.logoBase64) console.warn('⚠️  Logo bulunamadı, logosuz devam edilecek.');

  let noktalar = noktalariOku(csvPath);
  if (noktalar.length === 0) {
    console.error('❌ CSV\'de geçerli nokta bulunamadı.');
    process.exit(1);
  }

  // NUMARASIZ (tabela_no boş) sokakları baskıdan ele. Fiziksel olarak yalnız numaralı
  // levhalar asılıyor; numarasız sokaklar QR olarak DB'de kalır ama bu çıktıya girmez.
  // --tumu verilirse bu filtre atlanır (hepsi basılır).
  let numarasizAtlanan = 0;
  if (!cfg.tumu) {
    const oncesi = noktalar.length;
    noktalar = noktalar.filter((n) => String(n.no ?? '').trim() !== '');
    numarasizAtlanan = oncesi - noktalar.length;
    if (noktalar.length === 0) {
      console.error('❌ Numaralı (tabela_no dolu) sokak bulunamadı. Hepsi numarasız olabilir —');
      console.error('   tümünü basmak isterseniz --tumu bayrağıyla çalıştırın.');
      process.exit(1);
    }
  }

  const tam = noktalar.length;
  if (Number.isFinite(cfg.adet)) noktalar = noktalar.slice(0, cfg.adet);

  if (numarasizAtlanan > 0) {
    console.log(`✂️  ${numarasizAtlanan} numarasız (tabela_no boş) sokak baskıdan elendi (--tumu ile dahil edilir).`);
  }
  console.log(`📍 ${cfg.slug}: ${tam} numaralı nokta | üretilecek: ${noktalar.length} | QR kökü: ${cfg.base}`);
  console.log('🔳 QR kodları üretiliyor (SVG, hata düzeltme H)...');

  const bolumler = [];
  for (let i = 0; i < noktalar.length; i++) {
    const n = noktalar[i];
    const url = `${cfg.base}/q/${n.kod}`;
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'H', // ~%30 kurtarma: dış mekân çizik/kir toleransı
      margin: 2,                  // quiet-zone
      color: { dark: '#000000ff', light: '#ffffffff' }, // saf B/W → en iyi okunabilirlik
    });
    bolumler.push(tabelaHtml(n, svg, cfg));
    if ((i + 1) % 50 === 0) console.log(`   … ${i + 1}/${noktalar.length}`);
  }

  const tabelaDosya = path.join(__dirname, '..', `qr-tabelalar.${cfg.slug}.html`);
  const listeDosya = path.join(__dirname, '..', `qr-yerlesim-listesi.${cfg.slug}.html`);
  fs.writeFileSync(tabelaDosya, tabelalarBelgesi(bolumler, cfg), 'utf8');
  fs.writeFileSync(listeDosya, yerlesimListesiBelgesi(noktalar, cfg), 'utf8');

  console.log('\n═══════════════════════════════════════════════');
  console.log(`✅ ${bolumler.length} tabela üretildi.`);
  console.log(`📄 Tabelalar : ${tabelaDosya}`);
  console.log(`📄 Yerleşim  : ${listeDosya}`);
  console.log('🖨️  Tarayıcıda aç → Ctrl+P → kağıt boyutu 190×255mm (özel) → "PDF olarak kaydet"/yazdır');
  console.log('    (Kenar boşlukları: Yok/None, "Arka plan grafikleri" AÇIK)');
  console.log('═══════════════════════════════════════════════');
}

main().catch((e) => { console.error('Tabela üretim hatası:', e); process.exit(1); });
