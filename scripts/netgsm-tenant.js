/**
 * Per-Tenant Netgsm Bilgisi Ayarlama Aracı
 * ========================================
 *
 * Bir belediyenin (tenant) kendi Netgsm hesabını sisteme tanıtır: API şifresini
 * AES-256-GCM ile ŞİFRELER (lib/security/sifreleme.js ile AYNI biçim) ve DB'ye
 * yazılacak hazır UPDATE komutunu (docker exec + heredoc) basar. Şifre asla düz
 * saklanmaz; çözme anahtarı SIR_SIFRELEME_ANAHTARI env'indedir.
 *
 * Kullanım:
 *   node scripts/netgsm-tenant.js <slug> <usercode> <password> <header>
 * Örnek:
 *   node scripts/netgsm-tenant.js gulsehir 8503023023 "ApiSifre123" GULSEHIR
 *
 * ⚠ Bu scripti SUNUCUDA (git pull sonrası) çalıştır: ürettiği ciphertext yalnızca
 *   aynı SIR_SIFRELEME_ANAHTARI ile çözülebilir → üretim anahtarıyla üretilmeli.
 * ⚠ Şifre komut satırında görünür (shell geçmişi/işlem listesi). Çalıştırdıktan sonra
 *   geçmişi temizlemen önerilir (history -c) ya da boşlukla başlat.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function envOku() {
  const envLocal = path.join(__dirname, '..', '.env.local');
  const envProd = path.join(__dirname, '..', '.env');
  const envPath = fs.existsSync(envLocal) ? envLocal : fs.existsSync(envProd) ? envProd : null;
  if (!envPath) {
    console.error('❌ .env.local veya .env bulunamadı!');
    process.exit(1);
  }
  const icerik = fs.readFileSync(envPath, 'utf8');
  icerik.split('\n').forEach((satir) => {
    const [anahtar, ...deger] = satir.split('=');
    if (anahtar && !anahtar.startsWith('#')) process.env[anahtar.trim()] = deger.join('=').trim();
  });
  console.log(`   (env: ${path.basename(envPath)})`);
}

/** lib/security/sifreleme.js ile AYNI: SHA-256(anahtar) → aes-256-gcm → "v1.iv.tag.ct". */
function sirSifrele(duz, envAnahtar) {
  if (!envAnahtar || envAnahtar.length < 16) {
    console.error('❌ SIR_SIFRELEME_ANAHTARI tanımlı değil veya <16 karakter.');
    process.exit(1);
  }
  const key = crypto.createHash('sha256').update(envAnahtar, 'utf8').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(duz, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

const sqlEsc = (s) => String(s).replace(/'/g, "''");

function main() {
  const [slug, usercode, password, header] = process.argv.slice(2);
  if (!slug || !usercode || !password || !header) {
    console.error('Kullanım: node scripts/netgsm-tenant.js <slug> <usercode> <password> <header>');
    console.error('Örnek:    node scripts/netgsm-tenant.js gulsehir 8503023023 "ApiSifre123" GULSEHIR');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error('❌ Geçersiz slug (yalnız a-z 0-9 -).');
    process.exit(1);
  }
  if (header.length > 20) {
    console.error('❌ Header 20 karakterden uzun olamaz (Netgsm başlığı).');
    process.exit(1);
  }

  envOku();
  const enc = sirSifrele(password, process.env.SIR_SIFRELEME_ANAHTARI);

  const sql =
    `UPDATE tenantlar SET\n` +
    `  netgsm_usercode = '${sqlEsc(usercode)}',\n` +
    `  netgsm_sifre_enc = '${sqlEsc(enc)}',\n` +
    `  netgsm_header = '${sqlEsc(header)}'\n` +
    `WHERE slug = '${sqlEsc(slug)}';`;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🔐 NETGSM — ${slug} (şifre AES-256-GCM ile şifrelendi)`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log("📄 VPS'te ÇALIŞTIR (tek parça kopyala-yapıştır):");
  console.log('');
  console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
  console.log(sql);
  console.log('EOF');
  console.log('');
  console.log('ℹ Uygulandıktan sonra tenant snapshot 60 sn içinde yenilenir; o belediyenin');
  console.log('  OTP\'leri artık bu Netgsm hesabından gönderilir. Düz şifre HİÇBİR YERE yazılmadı.');
  console.log('⚠ Shell geçmişini temizle (history -c) — şifre komut satırında görünmüştü.');
  console.log('');
}

main();
