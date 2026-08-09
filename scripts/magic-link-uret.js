/**
 * Magic Link Üretme Scripti
 *
 * Kullanım:
 *   node scripts/magic-link-uret.js <belediye-slug>
 *
 * Örnek:
 *   node scripts/magic-link-uret.js gulsehir
 *
 * Bu script:
 *   1. 128 hex karakterlik kriptografik token üretir
 *   2. Token'ın HMAC-SHA256(HMAC_SECRET, token) hash'ini içeren INSERT SQL'i üretir
 *   3. Başkana WhatsApp'tan gönderilecek linki gösterir
 *
 * ⚠ BEST PRACTICE: Bu scripti SUNUCUDA çalıştır (git pull yaptıktan sonra).
 *   Çünkü token hash'i HMAC_SECRET ile üretilir; hash'in sunucudaki secret ile
 *   eşleşmesi ZORUNLU. Windows'ta çalıştırıp SQL'i sunucuya atarsan ve
 *   secret'lar farklıysa başkan linke tıklayınca "geçersiz" alır.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function envOku() {
  // Sunucuda .env, geliştirmede .env.local
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
  console.log(`   (env: ${path.basename(envPath)})`);
}

function main() {
  const tenantSlug = (process.argv[2] || '').toLowerCase().trim();
  if (!tenantSlug || !/^[a-z0-9-]+$/.test(tenantSlug)) {
    console.error('❌ Belediye slug\'ı eksik veya geçersiz!');
    console.error('   Kullanım: node scripts/magic-link-uret.js <belediye-slug>');
    console.error('   Örnek:    node scripts/magic-link-uret.js gulsehir');
    process.exit(1);
  }

  envOku();

  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) {
    console.error('❌ HMAC_SECRET tanımlı değil!');
    process.exit(1);
  }

  // Subdomain URL: başkanın tıklayacağı link bu domain'de olmalı
  const _base = (process.env.APP_BASE_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
  const baseUrl = _base
    ? `https://${tenantSlug}.${_base}`
    : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

  const slugSql = tenantSlug.replace(/'/g, "''");

  // 3 yetkili: her birine AYRI link + etiket. Etiket, girişte oturuma taşınır → şikayetçi
  // kimliğini KİMİN görüntülediği loglanabilir (KVKK hesap verebilirlik). Etiket sadece
  // rol adıdır (kişisel veri değil); [A-Za-z ] ile sınırlı → SQL/enjeksiyon yüzeyi yok.
  const ROLLER = ['Başkan', 'Başkan Yardımcısı', 'Admin'];

  const insertSatirlari = [];

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🔐 MAGIC LINK (3 yetkili) — ${tenantSlug}`);
  console.log('═══════════════════════════════════════════════════════════');

  for (const etiket of ROLLER) {
    // 128 hex karakter (64 byte) token — her yetkiliye ayrı.
    const token = crypto.randomBytes(64).toString('hex');
    // Token hash: HMAC-SHA256(HMAC_SECRET, token) — lib/security/hmac.js sha256Hashle
    // ile AYNI olmalı (keyed HMAC; length-extension'a kapalı). Formül değişirse burada da.
    const tokenHash = crypto.createHmac('sha256', hmacSecret).update(token).digest('hex');
    const link = `${baseUrl}/api/admin/magic-link/${token}`;
    const linkId = crypto.randomUUID();
    const etiketSql = etiket.replace(/'/g, "''");

    console.log('');
    console.log(`📋 ${etiket} linki (SADECE ${etiket}'na gönder, TEK KULLANIMLIK):`);
    console.log(`   ${link}`);

    insertSatirlari.push(
      `INSERT INTO magic_linkler (id, tenant_id, token_hash, kullanildi, son_gecerlilik_tarihi, etiket)\n` +
      `VALUES ('${linkId}', (SELECT id FROM tenantlar WHERE slug='${slugSql}'), '${tokenHash}', false, NOW() + INTERVAL '48 hours', '${etiketSql}');`
    );
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📄 VPS\'te ÇALIŞTIR (tek parça, olduğu gibi kopyala-yapıştır — 3 kayıt):');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  // Script BİLEREK DB'ye kendisi yazmıyor (Windows'ta da sunucuda da üretilebilsin).
  // Hazır `docker compose exec` + heredoc'u basar; olduğu gibi kopyala-yapıştır → 3 INSERT.
  console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
  console.log(insertSatirlari.join('\n'));
  console.log('EOF');
  console.log('');
  console.log('⏱️  Linkler 48 saat geçerli. Her yetkili KENDİ linkine tıklayınca oturum açılır.');
  console.log('🔎 Kimlik görüntüleme logunda "goruntuleyen" alanı bu etiketi (kim baktı) gösterir.');
  console.log('');
}

main();
