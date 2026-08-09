/**
 * Tek Sokak Ekleme/Çıkarma Scripti
 * 
 * Kullanım:
 *   node scripts/sokak-ekle.js ekle "YENİ SOKAK" 38.745 34.621
 *   node scripts/sokak-ekle.js cikar <sokak-uuid>
 *   node scripts/sokak-ekle.js listele
 * 
 * Bu script, veritabanına bağlanmadan çalışır.
 * Çıktı olarak gerekli SQL komutlarını ve QR linkini verir.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function main() {
  envOku();

  const args = process.argv.slice(2);
  const komut = args[0];

  if (!komut || !['ekle', 'cikar', 'listele'].includes(komut)) {
    console.log('');
    console.log('Kullanım:');
    console.log('  node scripts/sokak-ekle.js ekle "SOKAK ADI" ENLEM BOYLAM');
    console.log('  node scripts/sokak-ekle.js cikar SOKAK_UUID');
    console.log('  node scripts/sokak-ekle.js listele');
    console.log('');
    console.log('Örnekler:');
    console.log('  node scripts/sokak-ekle.js ekle "BAYRAK SOKAK" 38.74567 34.62123');
    console.log('  node scripts/sokak-ekle.js cikar a7f3e9b1-4c2d-48a6-b8e5-1f9d3c7a2e4b');
    return;
  }

  // QR'a KALICI yönlendirici kökü basılır (https://qr.<domain>/q/<id>), form
  // adresi değil. Mantık lib/server/qr.js + seed-sokaklar.js ile AYNI tutulmalı.
  const _base = (process.env.APP_BASE_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
  const qrBaseUrl = process.env.QR_BASE_URL
    ? process.env.QR_BASE_URL.trim().replace(/\/+$/, '')
    : (_base ? `https://qr.${_base}` : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
  const hmacSecret = process.env.HMAC_SECRET;

  if (komut === 'ekle') {
    const sokakAdi = args[1];
    const enlem = parseFloat(args[2]);
    const boylam = parseFloat(args[3]);

    if (!sokakAdi || isNaN(enlem) || isNaN(boylam)) {
      console.error('❌ Hatalı kullanım. Örnek: node scripts/sokak-ekle.js ekle "BAYRAK SOKAK" 38.745 34.621');
      return;
    }

    const id = crypto.randomUUID();
    const hmacImza = crypto.createHmac('sha256', hmacSecret).update(id).digest('hex');
    const qrKod = qrKodUret();
    const qrLinki = `${qrBaseUrl}/q/${qrKod}`;

    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('✅ YENİ SOKAK HAZIRLANDI');
    console.log('═══════════════════════════════════════════════');
    console.log(`   Sokak Adı: ${sokakAdi.toUpperCase()}`);
    console.log(`   UUID:      ${id}`);
    console.log(`   QR Kod:    ${qrKod}`);
    console.log(`   Enlem:     ${enlem}`);
    console.log(`   Boylam:    ${boylam}`);
    console.log('');
    console.log('🔗 QR Kodu bu linke yönlendirilecek:');
    console.log(`   ${qrLinki}`);
    console.log('');
    console.log('📄 Aşağıdaki SQL komutunu DB konsolunda çalıştırın:');
    console.log('');
    console.log(`INSERT INTO sokaklar (id, sokak_adi, enlem, boylam, hmac_imza, qr_kod, aktif)`);
    console.log(`VALUES ('${id}', '${sokakAdi.toUpperCase().replace(/'/g, "''")}', ${enlem}, ${boylam}, '${hmacImza}', '${qrKod}', true);`);
    console.log('');

  } else if (komut === 'cikar') {
    const sokakId = args[1];
    if (!sokakId) {
      console.error('❌ Sokak UUID gerekli.');
      return;
    }

    console.log('');
    console.log('📄 Aşağıdaki SQL komutunu Neon DB konsolunda çalıştırın:');
    console.log('');
    console.log(`UPDATE sokaklar SET aktif = false WHERE id = '${sokakId}';`);
    console.log('');
    console.log('✅ Bu sokağın QR kodu artık çalışmayacaktır.');
    console.log('');

  } else if (komut === 'listele') {
    const qrDosyaYolu = path.join(__dirname, '..', 'qr_linkleri.json');
    if (!fs.existsSync(qrDosyaYolu)) {
      console.log('❌ qr_linkleri.json bulunamadı. Önce seed-sokaklar.js çalıştırın.');
      return;
    }

    const qrLinkleri = JSON.parse(fs.readFileSync(qrDosyaYolu, 'utf8'));
    console.log(`\n📋 Toplam ${qrLinkleri.length} sokak kayıtlı:\n`);
    qrLinkleri.forEach((q, i) => {
      console.log(`${(i + 1).toString().padStart(3)}. ${q.sokakAdi}`);
    });
    console.log('');
  }
}

main();
