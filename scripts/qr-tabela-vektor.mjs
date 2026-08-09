/**
 * VEKTÖR QR Tabela Üretici — CorelDraw / Illustrator uyumlu (SVG + PDF)
 * =====================================================================
 * Grafikçi tasarımının (beyaz zemin, siyah) VEKTÖR muadili:
 *   - Logo    = grafikçi vektörü (gulsehir-logo-vektor.svg) — saf <path>.
 *   - QR      = tek vektör <path> (modül başına kare) → saf vektör, sonsuz ölçek.
 *   - Yazılar = EĞRİYE ÇEVRİLMİŞ (outline) vektör path'ler (opentype.js). Font gerekmez.
 *   - "Sokakta bir sorun mu var?" ve "Kamerayı açın ve şikayetinizi yazın." yazıları
 *     QR'ın SOL-SAĞ hizasına oto-sığdırılır (kenardan daraltınca taşmaz, daha büyük).
 *   - Tabela numarası QR'ın hemen üstünde, QR genişliği içinde.
 *   - Tema: TEMA=beyaz (grafikçi tasarımı) | TEMA=lacivert (eski koyu tema).
 *
 * ÖNCE canlı DB'den GÜNCEL CSV'yi dışa aktar (qr_kod DEĞİŞMİŞ olabilir):
 *   ssh belediyem 'docker exec belediye-db-1 psql -U belediye -d belediye -A -F"," -t -c \
 *     "SELECT qr_kod, tabela_no, sokak_adi, enlem, boylam FROM sokaklar \
 *      WHERE aktif=true AND tabela_no IS NOT NULL ORDER BY tabela_no"' \
 *   | (echo "qr_kod,tabela_no,sokak_adi,enlem,boylam"; cat) > fiziksel-tabelalar.csv
 *
 * Kullanım:
 *   node scripts/qr-tabela-vektor.mjs [csv-yolu]        # varsayilan: ../fiziksel-tabelalar.csv
 *   TEMA=lacivert node scripts/qr-tabela-vektor.mjs     # eski koyu tema
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import opentype from 'opentype.js';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.join(__dirname, '..');

// ------- AYARLAR -------
const QR_BASE = process.env.QR_BASE || 'https://qr.dijitalbelediyem.com';
const LOGO_VEKTOR = path.join(KOK, 'gulsehir-logo-vektor.svg'); // grafikçi vektörü (saf SVG path)
const BASKAN_VEKTOR = path.join(KOK, 'baskan-vektor.svg');      // başkan lockup (PDF'ten dönüştürülmüş saf vektör)
const CSV_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(KOK, 'fiziksel-tabelalar.csv');
const CIKTI = path.join(KOK, 'vektor-tabelalar');
const METIN = {
  soru: 'Sokakta bir sorun mu var?',
  cagri: 'Kamerayı açın ve şikayetinizi yazın.',
  // Başkan alt bloğu artık düz yazı DEĞİL, baskan-vektor.svg (eğriye çevrilmiş logo/imza) ile basılır.
};

// ------- TEMA -------
const TEMA = process.env.TEMA || 'beyaz';
const TEMALAR = {
  beyaz: { bg: '#ffffff', logo: '#111827', soru: '#111827', cagri: '#111827',
           baskanUnvan: '#475569', baskanAd: '#111827', noktaNo: '#94a3b8',
           qrKoyu: '#000000', ayrac: false, strip: false },
  lacivert: { bg: '#12192b', logo: '#ffffff', soru: '#e2e8f0', cagri: '#ffffff',
           baskanUnvan: '#e2e8f0', baskanAd: '#ffffff', noktaNo: '#94a3b8',
           qrKoyu: '#000000', ayrac: 'grad', strip: true },
};
const T = TEMALAR[TEMA] || TEMALAR.beyaz;

// ------- SAYFA BOYUTU (mm) — grafiker uğraşmasın diye kesim ölçüsü -------
const PAGE_W = 150;  // yan (genişlik) = 15 cm
const PAGE_H = 250;  // uzun (yükseklik) = 25 cm

// ------- YERLEŞİM (mm) — 150×250 sayfaya göre dengelendi -------
const LOGO_W = 66;   // amblem genişliği
const QR_MM  = 116;  // QR kare kenarı (direkt zemine, kart yok) — 150 mm sayfada ~17 mm kenar payı
const TEXT_W = 120;  // büyük yazıların hedef genişliği (~15 mm kenar payı)

const RENK = { stripA: '#38bdf8', stripB: '#818cf8' };

// ------- FONTLAR (eğriye çevirme için) -------
function fontYukle(dosya) {
  const buf = fs.readFileSync(path.join(__dirname, 'vektor-fonts', dosya));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return opentype.parse(ab);
}
const F = {
  light: fontYukle('Poppins-Light.ttf'),
  regular: fontYukle('Poppins-Regular.ttf'),
  medium: fontYukle('Poppins-Medium.ttf'),
};

const PT2MM = 25.4 / 72;      // punto -> mm
const MM2PT = 72 / 25.4;      // mm -> pt (PDF)

/** Metni EĞRİYE ÇEVRİLMİŞ <path> olarak döndürür. hiza: 'orta' | 'sag' | 'sol' */
function metinPath(font, metin, cx, yBaseline, ptBoyut, renk, hiza = 'orta') {
  const boyMm = ptBoyut * PT2MM;
  const genislik = font.getAdvanceWidth(metin, boyMm);
  let x = cx;
  if (hiza === 'orta') x = cx - genislik / 2;
  else if (hiza === 'sag') x = cx - genislik;
  const d = font.getPath(metin, x, yBaseline, boyMm).toPathData(3);
  return `<path d="${d}" fill="${renk}"/>`;
}

/** Metni verilen mm genişliğe sığdıracak punto boyutunu döndürür. */
function ptForWidth(font, metin, hedefMm) {
  const w1 = font.getAdvanceWidth(metin, 1); // 1mm boyutta genişlik (mm)
  return (hedefMm / w1) / PT2MM;
}

/** QR'ı tek vektör <path>'e çevirir (modül başına 1×1 kare, birim=modül). */
function qrPath(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' }); // ~%30 kurtarma (dış mekân)
  const n = qr.modules.size;
  const data = qr.modules.data;
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (data[r * n + c]) d += `M${c} ${r}h1v1h-1z`;
  return { d, n };
}

/** Vektör logo asset'ini (SVG) oku: viewBox + iç path'ler (tema rengine boyanır). */
function logoVektorYukle() {
  const raw = fs.readFileSync(LOGO_VEKTOR, 'utf8');
  const m = raw.match(/viewBox="([\d.eE+\- ]+)"/);
  const [vx, vy, vw, vh] = m[1].trim().split(/\s+/).map(Number);
  let inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
    .replace(/<rect[^>]*\/?>/g, '')           // önizleme fonunu at
    .replace(/<!--[\s\S]*?-->/g, '').trim();
  inner = inner.replace(/fill="#ffffff"/g, `fill="${T.logo}"`); // tema rengine boya
  return { vx, vy, vw, vh, inner, oran: vh / vw };
}

/** Başkan lockup vektörünü (baskan-vektor.svg) oku: viewBox + iç path'ler (tema rengine boyanır). */
function baskanVektorYukle() {
  const raw = fs.readFileSync(BASKAN_VEKTOR, 'utf8');
  const m = raw.match(/viewBox="([\d.eE+\- ]+)"/);
  const [vx, vy, vw, vh] = m[1].trim().split(/\s+/).map(Number);
  let inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
    .replace(/<!--[\s\S]*?-->/g, '').trim();
  inner = inner.replace(/fill="#111827"/g, `fill="${T.baskanAd}"`); // tema rengine boya
  return { vx, vy, vw, vh, inner, oran: vh / vw };
}

function tabelaSvg(nokta, LOGO, BASKAN) {
  const W = PAGE_W, H = PAGE_H, cx = W / 2;
  const logoW = LOGO_W, logoH = logoW * LOGO.oran;

  // dikey yerleşim
  const logoTop = 13;
  const logoBottom = logoTop + logoH;

  const soruPt = ptForWidth(F.light, METIN.soru, TEXT_W);
  const cagriPt = ptForWidth(F.light, METIN.cagri, TEXT_W);
  const soruH = soruPt * PT2MM, cagriH = cagriPt * PT2MM;

  const soruBaseline = logoBottom + 8 + soruH * 0.72;       // logo altı büyük soru
  const numaraBaseline = soruBaseline + 7;                    // QR'ın hemen üstü, küçük kod
  const qrTop = numaraBaseline + 3;                           // numara QR'a yapışık
  const qrX = cx - QR_MM / 2;
  const qrBottom = qrTop + QR_MM;
  const cagriBaseline = qrBottom + 6 + cagriH * 0.72;        // QR altı büyük çağrı
  // başkan lockup (vektör): çağrı yazısı ile alt kenar arasındaki zona dikey ortalanır
  const baskanZoneTop = cagriBaseline + 6;
  const baskanZoneBottom = H - 13;                            // alt çivileme payı
  const baskanZoneH = baskanZoneBottom - baskanZoneTop;
  const BASKAN_MAX_W = 96;                                    // aşırı genişlemeyi sınırla
  let baskanW = baskanZoneH / BASKAN.oran;                    // önce yüksekliğe sığdır
  if (baskanW > BASKAN_MAX_W) baskanW = BASKAN_MAX_W;
  const baskanH = baskanW * BASKAN.oran;
  const baskanX = cx - baskanW / 2;
  const baskanTop = baskanZoneTop + (baskanZoneH - baskanH) / 2;

  const { d: qrD, n } = qrPath(`${QR_BASE}/q/${nokta.kod}`);
  const qrScale = QR_MM / n;

  const p = [];
  p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${T.bg}"/>`);
  if (T.strip) p.push(`<rect x="0" y="0" width="${W}" height="2" fill="url(#strip)"/>`);

  // logo (vektör amblem, tema rengi)
  const _ls = logoW / LOGO.vw;
  p.push(`<g transform="translate(${cx - logoW / 2} ${logoTop}) scale(${_ls}) translate(${-LOGO.vx} ${-LOGO.vy})">${LOGO.inner}</g>`);

  // büyük soru yazısı (QR hizasına sığdırılmış)
  p.push(metinPath(F.light, METIN.soru, cx, soruBaseline, soruPt, T.soru));

  // tabela numarası — QR'ın hemen üstünde, ortalı
  if (nokta.no) p.push(metinPath(F.light, nokta.no, cx, numaraBaseline, 9, T.noktaNo));

  // QR — direkt zemine (beyaz temada kart gerekmez)
  p.push(`<g transform="translate(${qrX} ${qrTop}) scale(${qrScale})"><path d="${qrD}" fill="${T.qrKoyu}"/></g>`);

  // büyük çağrı yazısı (QR hizasına sığdırılmış)
  p.push(metinPath(F.light, METIN.cagri, cx, cagriBaseline, cagriPt, T.cagri));

  // ayraç (grafikçi tasarımında çizgi yok → beyaz temada kapalı)
  if (T.ayrac === 'grad') p.push(`<rect x="${cx - 36}" y="${cagriBaseline + 7}" width="72" height="0.4" fill="url(#ayrac)"/>`);
  else if (T.ayrac) p.push(`<rect x="${cx - 37}" y="${cagriBaseline + 7}" width="74" height="0.4" fill="${T.ayrac}"/>`);

  // başkan lockup (vektör görsel — "Gülşehir Belediye Başkanı Erkan Çiftci", eğriye çevrilmiş)
  const _bs = baskanW / BASKAN.vw;
  p.push(`<g transform="translate(${baskanX} ${baskanTop}) scale(${_bs}) translate(${-BASKAN.vx} ${-BASKAN.vy})">${BASKAN.inner}</g>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="strip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${RENK.stripA}"/><stop offset="1" stop-color="${RENK.stripB}"/></linearGradient>
    <linearGradient id="ayrac" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${RENK.stripA}" stop-opacity="0"/><stop offset="0.3" stop-color="${RENK.stripA}"/><stop offset="0.7" stop-color="${RENK.stripB}"/><stop offset="1" stop-color="${RENK.stripB}" stop-opacity="0"/></linearGradient>
  </defs>
${p.map((s) => '  ' + s).join('\n')}
</svg>`;
}

function csvOku() {
  const satirlar = fs.readFileSync(CSV_PATH, 'utf8').split('\n').map((s) => s.replace(/\r$/, '')).filter(Boolean);
  const bas = satirlar[0].split(',').map((h) => h.trim().toLowerCase());
  const ix = (a) => bas.indexOf(a);
  const out = [];
  for (const satir of satirlar.slice(1)) {
    const cols = satir.split(',');
    const kod = (cols[ix('qr_kod')] || '').trim();
    const no = (cols[ix('tabela_no')] || '').trim();
    if (!kod || !no) continue;
    out.push({ kod, no, sokakAdi: (cols[ix('sokak_adi')] || '').trim(), enlem: parseFloat(cols[ix('enlem')]), boylam: parseFloat(cols[ix('boylam')]) });
  }
  return out;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) { console.error('❌ CSV yok:', CSV_PATH, '\n   (Script başındaki export komutuyla üret.)'); process.exit(1); }
  const svgDir = path.join(CIKTI, 'svg');
  fs.mkdirSync(svgDir, { recursive: true });
  // Eski SVG'leri temizle: silinen tabelalar (ör. 1, 176, 602…) stale dosya bırakıp baskıya gitmesin.
  for (const f of fs.readdirSync(svgDir)) if (/^tabela-.*\.svg$/.test(f)) fs.unlinkSync(path.join(svgDir, f));

  const NOKTALAR = csvOku();
  const LOGO = logoVektorYukle();
  const BASKAN = baskanVektorYukle();

  console.log(`📍 Üretiliyor: ${NOKTALAR.length} fiziksel tabela | tema: ${TEMA} | QR kökü: ${QR_BASE}`);
  const svgler = [];
  for (const nk of NOKTALAR) {
    const svg = tabelaSvg(nk, LOGO, BASKAN);
    fs.writeFileSync(path.join(svgDir, `tabela-${nk.no}.svg`), svg, 'utf8');
    svgler.push(svg);
  }
  console.log(`✓ ${svgler.length} SVG → ${svgDir}`);

  const pdfYol = path.join(CIKTI, 'tum-tabelalar.pdf');
  const doc = new PDFDocument({ size: [PAGE_W * MM2PT, PAGE_H * MM2PT], margin: 0, autoFirstPage: false });
  const stream = fs.createWriteStream(pdfYol);
  doc.pipe(stream);
  for (let i = 0; i < svgler.length; i++) {
    doc.addPage({ size: [PAGE_W * MM2PT, PAGE_H * MM2PT], margin: 0 });
    SVGtoPDF(doc, svgler[i], 0, 0, { width: PAGE_W * MM2PT, height: PAGE_H * MM2PT, assumePt: false, useCSS: false });
    if ((i + 1) % 50 === 0) console.log(`   PDF: ${i + 1}/${svgler.length}`);
  }
  doc.end();
  await new Promise((res) => stream.on('finish', res));
  console.log(`✓ PDF (${svgler.length} sayfa) → ${pdfYol}`);

  const liste = ['tabela_no,sokak_adi,enlem,boylam,google_maps'];
  for (const n of NOKTALAR) {
    const gm = Number.isFinite(n.enlem) ? `https://www.google.com/maps?q=${n.enlem},${n.boylam}` : '';
    liste.push(`${n.no},"${(n.sokakAdi || '').replace(/"/g, '""')}",${n.enlem},${n.boylam},${gm}`);
  }
  fs.writeFileSync(path.join(CIKTI, 'yerlesim-listesi.csv'), '﻿' + liste.join('\n'), 'utf8');
  console.log(`✓ Saha yerleşim listesi → ${path.join(CIKTI, 'yerlesim-listesi.csv')}`);
  console.log('Bitti. CorelDraw: Dosya → İçe Aktar (Import) → .svg | yazılar zaten eğri, font gerekmez.');
}

main().catch((e) => { console.error('HATA:', e); process.exit(1); });
