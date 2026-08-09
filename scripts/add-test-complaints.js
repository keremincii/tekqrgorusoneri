import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => l.split('='))
);

const HMAC_SECRET = env.HMAC_SECRET;
const BASE_URL = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// 30 test TC'si
const TEST_TCS = [
  '11111111110', '22222222220', '33333333330', '44444444440', '55555555550',
  '66666666660', '77777777770', '88888888880', '99999999990',
  '11111111111', '22222222221', '33333333331', '44444444441', '55555555551',
  '66666666661', '77777777771', '88888888881', '99999999991',
  '11111111112', '22222222222', '33333333332', '44444444442', '55555555552',
  '66666666662', '77777777772', '88888888882', '99999999992',
  '11111111113', '22222222223', '33333333333',
];

const KATEGORILER = [
  'cop-temizlik',
  'asfalt-yol',
  'su-kanalizasyon',
  'aydinlatma-elektrik',
  'otopark-trafik',
  'hayvan-sorunu',
  'gurultu-cevre',
];

const ACIKLAMALAR = [
  'Sorun devam ediyor, acil müdahale gerekli',
  '3 gündür bu şekilde, lütfen kontrol edin',
  'Çevre temizlik çok kötü, yapılması gerek',
  'Halkın çoğu şikayetçi, hemen çözülsün',
  'Zarar verici durum, nasıl bu hale geldi',
  'Yardım gerekli, artık dayanılmaz',
];

function imzaOlustur(sokakId) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(sokakId).digest('hex');
}

async function sokakAriGetir() {
  const res = await fetch(`${BASE_URL}/api/sokaklar`);
  if (!res.ok) throw new Error(`Sokak API hatası: ${res.status}`);
  const data = await res.json();
  return data.sokaklar;
}

async function sikayetGonder(sokak, tc, telefon, kategori, aciklama) {
  const sig = imzaOlustur(sokak.id);
  const res = await fetch(`${BASE_URL}/api/sikayet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sokakId: sokak.id,
      sig,
      tc,
      telefon,
      kategori,
      aciklama,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.warn(`  ⚠ TC ${tc} → ${sokak.sokakAdi}: ${data.hata || 'Hata'}`);
    return false;
  }
  console.log(`  ✓ TC ${tc} → ${sokak.sokakAdi}`);
  return true;
}

async function main() {
  console.log('📍 Test şikayetleri ekleniyor...\n');

  const sokaklar = await sokakAriGetir();
  console.log(`✓ ${sokaklar.length} sokak yüklendi\n`);

  let toplam = 0;
  for (let i = 0; i < TEST_TCS.length; i++) {
    const tc = TEST_TCS[i];
    const telefon = `05${String(50 + i).padStart(2, '0')}${String(i).padStart(3, '0')}${String(i * 7).padStart(4, '0')}`.slice(0, 11);

    // Her test kullanıcısı 1-2 sokağa şikayet gönder
    const sikayet_sayisi = Math.random() > 0.4 ? 2 : 1;
    const secilenSokaklar = new Set();

    for (let j = 0; j < sikayet_sayisi; j++) {
      let sokak;
      do {
        sokak = sokaklar[Math.floor(Math.random() * sokaklar.length)];
      } while (secilenSokaklar.has(sokak.id));
      secilenSokaklar.add(sokak.id);

      const kategori = KATEGORILER[Math.floor(Math.random() * KATEGORILER.length)];
      const aciklama = ACIKLAMALAR[Math.floor(Math.random() * ACIKLAMALAR.length)];

      const sonuc = await sikayetGonder(sokak, tc, telefon, kategori, aciklama);
      if (sonuc) toplam++;

      // API yükünü hafifletmek için kısa bekle
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n✅ Toplam ${toplam} şikayet eklendi!`);
}

main().catch(err => {
  console.error('❌ Hata:', err.message);
  process.exit(1);
});
