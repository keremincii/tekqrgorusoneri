/**
 * Google Maps Ekran Görüntüsü → CSV (Vision AI ile toplu koordinat çıkarımı)
 * =========================================================================
 *
 * AMAÇ: Bir klasördeki ~300 Google Maps ekran görüntüsünden her birinin
 * (1) yer/sokak adını (kartın başlığı) ve (2) About/Hakkında altındaki ONDALIK
 * koordinatını otomatik çıkarıp doğrudan seed formatında CSV üretir. Elle tek tek
 * yazmaya gerek kalmaz. DMS (38°44'39"N) ve Plus Code gibi "koordinat gibi görünen"
 * gürültü ELENİR — yalnız en hassas decimal alınır.
 *
 * NEDEN Vision AI (Gemini) — Tesseract değil: ekran görüntüsü UI gürültüsüyle dolu
 * (arama çubuğu, butonlar, saat...). Vision modeli "kartın başlığı" ve "About
 * altındaki decimal" bağlamını anlar; ham OCR + regex bunu güvenilir ayıramaz.
 *
 * ÜCRETSİZ: Google Gemini free tier (günde 1500 istek). Anahtar:
 *   https://aistudio.google.com/apikey  (1 dk, bedava)
 *
 * KULLANIM:
 *   1) Anahtarı ayarla (PowerShell):   $env:GEMINI_API_KEY="AIza..."
 *      (kalıcı istersen .env'e GEMINI_API_KEY=... ekle — script .env'i de okur)
 *   2) Fotoğrafları bir klasöre koy (ör. ./fotolar)
 *   3) node scripts/foto-ocr-coord.js ./fotolar
 *
 * ÇIKTI (script klasörünün üstünde):
 *   - foto-cikti.csv       → Sokak_Adi,Enlem_Y,Boylam_X   (seed-sokaklar.js'e hazır)
 *   - foto-cikti-ham.json  → her dosya için ham sonuç (hangi foto ne verdi — denetim)
 *   - foto-cikti-hata.txt  → okunamayan/başarısız dosyalar (elle bakılacaklar)
 *
 * SONRA: node scripts/csv-onizleme.js ../foto-cikti.csv   ← haritada doğrula, sonra seed.
 *
 * NOT: Node 18+ (global fetch) gerekir. Ek npm paketi YOK.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Free-tier hız sınırı için istekler arası bekleme (gemini-2.0-flash ~15 RPM).
const BEKLEME_MS = Number(process.env.OCR_BEKLEME_MS) || 4500;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const UZANTILAR = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const PROMPT = `Bu bir Google Maps ekran görüntüsü. Şu iki bilgiyi çıkar:

1. "ad": Alt karttaki BAŞLIK — koordinatların hemen üstündeki büyük yazı (yer/sokak/nokta adı). Örn: "830", "ATATÜRK CADDESİ".
2. "enlem" ve "boylam": ONDALIK koordinat. Ekranda genelde "About"/"Hakkında" bölümünün altında en HASSAS (en çok ondalıklı) decimal olarak yazar. Örn: 38.7442111, 34.6335810 → enlem=38.7442111, boylam=34.6335810.

ÖNEMLİ:
- DMS biçimini (38°44'39.2"N 34°38'00.9"E) ALMA.
- Plus Code'u (8G8R+PX gibi harfli-artılı kod) ALMA.
- İki decimal koordinat varsa DAHA ÇOK ONDALIKLI (About altındaki) olanı seç.
- Enlem her zaman ilk (yaklaşık 36-42), boylam ikinci (yaklaşık 26-45) sayıdır.

Yalnız şu JSON'u döndür (başka metin yok):
{"ad": "<başlık>", "enlem": <sayı>, "boylam": <sayı>, "okundu": true}
Koordinat okunamıyorsa: {"ad": "", "enlem": null, "boylam": null, "okundu": false}`;

function envOku() {
  if (process.env.GEMINI_API_KEY) return;
  for (const dosya of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', dosya);
    if (!fs.existsSync(p)) continue;
    for (const satir of fs.readFileSync(p, 'utf8').split('\n')) {
      const [k, ...v] = satir.split('=');
      if (k && !k.startsWith('#') && k.trim() === 'GEMINI_API_KEY') {
        process.env.GEMINI_API_KEY = v.join('=').trim();
      }
    }
  }
}

function mimeTuru(uzanti) {
  if (uzanti === '.png') return 'image/png';
  if (uzanti === '.webp') return 'image/webp';
  return 'image/jpeg';
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bir görüntüyü Gemini'ye gönderir; {ad, enlem, boylam, okundu} döndürür. 429/5xx'te backoff. */
async function gorseliOku(apiKey, base64, mime, denemeler = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const govde = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  for (let i = 0; i < denemeler; i++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(govde),
      });
    } catch (e) {
      if (i === denemeler - 1) throw new Error('ağ hatası: ' + e.message);
      await bekle(2000 * (i + 1));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      // Hız limiti / geçici sunucu hatası → artan bekleme ile tekrar dene
      const bekleSure = res.status === 429 ? 12000 * (i + 1) : 3000 * (i + 1);
      if (i === denemeler - 1) throw new Error(`HTTP ${res.status} (deneme bitti)`);
      await bekle(bekleSure);
      continue;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = await res.json();
    const metin = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!metin) throw new Error('boş yanıt');
    try {
      return JSON.parse(metin);
    } catch {
      // Model bazen JSON'u ```json ... ``` içine koyar → çıkar
      const m = metin.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('JSON parse edilemedi: ' + metin.slice(0, 120));
    }
  }
  throw new Error('beklenmedik döngü sonu');
}

async function main() {
  envOku();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY tanımlı değil.');
    console.error('   Ücretsiz anahtar: https://aistudio.google.com/apikey');
    console.error('   PowerShell:  $env:GEMINI_API_KEY="AIza..."');
    process.exit(1);
  }

  const klasor = path.resolve(process.argv[2] || './fotolar');
  if (!fs.existsSync(klasor)) {
    console.error('❌ Klasör bulunamadı:', klasor);
    console.error('   Kullanım: node scripts/foto-ocr-coord.js <foto-klasoru>');
    process.exit(1);
  }

  const dosyalar = fs.readdirSync(klasor)
    .filter((f) => UZANTILAR.has(path.extname(f).toLowerCase()))
    .sort();
  if (dosyalar.length === 0) {
    console.error('❌ Klasörde görüntü yok (.jpg/.png/.webp):', klasor);
    process.exit(1);
  }

  const tahminiDk = Math.ceil((dosyalar.length * BEKLEME_MS) / 60000);
  console.log(`📷 ${dosyalar.length} görüntü bulundu. Model: ${MODEL}`);
  console.log(`⏱️  İstekler arası ${BEKLEME_MS}ms bekleme (free-tier limiti) → ~${tahminiDk} dk sürer.\n`);

  const csvYolu = path.join(__dirname, '..', 'foto-cikti.csv');
  const hamYolu = path.join(__dirname, '..', 'foto-cikti-ham.json');
  const hataYolu = path.join(__dirname, '..', 'foto-cikti-hata.txt');

  const satirlar = ['Sokak_Adi,Enlem_Y,Boylam_X'];
  const ham = [];
  const hatalar = [];

  for (let i = 0; i < dosyalar.length; i++) {
    const dosya = dosyalar[i];
    const tam = path.join(klasor, dosya);
    const etiket = `[${i + 1}/${dosyalar.length}] ${dosya}`;
    try {
      const base64 = fs.readFileSync(tam).toString('base64');
      const sonuc = await gorseliOku(apiKey, base64, mimeTuru(path.extname(dosya).toLowerCase()));
      ham.push({ dosya, ...sonuc });

      const enlem = Number(sonuc?.enlem);
      const boylam = Number(sonuc?.boylam);
      const ad = String(sonuc?.ad || '').trim();
      if (sonuc?.okundu && Number.isFinite(enlem) && Number.isFinite(boylam)) {
        // Ad boşsa dosya adını yedek olarak kullan (sonra elle düzeltilebilir)
        const adTemiz = (ad || path.parse(dosya).name).replace(/[",\n\r]/g, ' ').trim();
        satirlar.push(`${adTemiz},${enlem},${boylam}`);
        console.log(`✅ ${etiket} → ${adTemiz} (${enlem}, ${boylam})`);
      } else {
        hatalar.push(`${dosya}\tkoordinat okunamadı`);
        console.log(`⚠️  ${etiket} → koordinat okunamadı`);
      }
    } catch (e) {
      ham.push({ dosya, hata: e.message });
      hatalar.push(`${dosya}\t${e.message}`);
      console.log(`❌ ${etiket} → HATA: ${e.message}`);
    }

    // Her adımda diske yaz (yarıda kesilirse ilerleme kaybolmasın)
    fs.writeFileSync(csvYolu, satirlar.join('\n') + '\n', 'utf8');
    fs.writeFileSync(hamYolu, JSON.stringify(ham, null, 2), 'utf8');
    if (hatalar.length) fs.writeFileSync(hataYolu, hatalar.join('\n') + '\n', 'utf8');

    if (i < dosyalar.length - 1) await bekle(BEKLEME_MS);
  }

  const basarili = satirlar.length - 1;
  console.log('\n═══════════════════════════════════════════════');
  console.log(`✅ Başarılı: ${basarili} / ${dosyalar.length}`);
  if (hatalar.length) console.log(`⚠️  Okunamayan: ${hatalar.length} (bkz. foto-cikti-hata.txt — elle bak)`);
  console.log(`📄 CSV: ${csvYolu}`);
  console.log(`📄 Ham denetim: ${hamYolu}`);
  console.log('═══════════════════════════════════════════════');
  console.log('\n➡️  SONRAKİ: koordinatları haritada doğrula:');
  console.log('   node scripts/csv-onizleme.js ../foto-cikti.csv');
  console.log('   (kırmızı/sarı uyarıları düzelt, sonra seed-sokaklar.js ile yükle)\n');
}

main().catch((e) => { console.error('Beklenmedik hata:', e); process.exit(1); });
