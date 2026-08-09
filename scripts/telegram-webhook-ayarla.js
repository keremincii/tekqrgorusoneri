/**
 * Telegram Webhook Ayarlama Scripti
 *
 * Kullanım:
 *   node scripts/telegram-webhook-ayarla.js [webhook-url]              → saha ekibi botu
 *   node scripts/telegram-webhook-ayarla.js [webhook-url] --moderasyon → moderasyon botu
 *
 * webhook-url verilmezse APP_BASE_DOMAIN veya NEXT_PUBLIC_APP_URL'den türetilir.
 * Telegram'a "güncellemeleri şu adrese, şu gizli token ile gönder" der.
 *
 * İKİ AYRI BOT vardır ve her biri için bu script BİR KEZ çalıştırılmalıdır:
 *   • saha ekibi botu → /api/telegram/webhook     (TELEGRAM_BOT_TOKEN)
 *   • moderasyon botu → /api/telegram/moderasyon  (TELEGRAM_MODERASYON_BOT_TOKEN)
 *
 * ⚠ Telegram yalnızca PUBLIC HTTPS adreslere webhook kurabilir. Yerel geliştirmede
 *   ya bir tünel (cloudflared) URL'si verin ya da bunun yerine polling kullanın:
 *   node scripts/telegram-polling-dev.js
 *
 * ⚠ SUNUCUDA çalıştırın (token + secret üretimdeki .env ile eşleşmeli).
 */

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
    if (anahtar && !anahtar.startsWith('#')) {
      process.env[anahtar.trim()] = deger.join('=').trim();
    }
  });
  console.log(`   (env: ${path.basename(envPath)})`);
}

/** `--moderasyon` bayrağı dışındaki ilk argüman (varsa) taban URL'dir. */
function tabanUrlArgumani() {
  return process.argv.slice(2).find((a) => !a.startsWith('--')) || null;
}

function webhookUrlBelirle(yol) {
  const arg = tabanUrlArgumani();
  if (arg) return arg.replace(/\/+$/, '') + yol;
  const base = (process.env.APP_BASE_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
  if (base) return `https://${base}${yol}`;
  const app = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (app) return `${app}${yol}`;
  return null;
}

async function main() {
  envOku();

  const moderasyonMu = process.argv.includes('--moderasyon');
  const yol = moderasyonMu ? '/api/telegram/moderasyon' : '/api/telegram/webhook';

  const token = moderasyonMu ? process.env.TELEGRAM_MODERASYON_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;
  // Moderasyon secret'ı tanımlı değilse saha botunun secret'ına düşülür — route da
  // aynı sırayı uygular, ikisi tutarlı olmalı.
  const secret = moderasyonMu
    ? (process.env.TELEGRAM_MODERASYON_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET)
    : process.env.TELEGRAM_WEBHOOK_SECRET;

  const tokenAdi = moderasyonMu ? 'TELEGRAM_MODERASYON_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN';
  if (!token) { console.error(`❌ ${tokenAdi} tanımlı değil!`); process.exit(1); }
  if (!secret) { console.error('❌ TELEGRAM_WEBHOOK_SECRET tanımlı değil!'); process.exit(1); }

  console.log(`   (bot: ${moderasyonMu ? 'moderasyon' : 'saha ekibi'})`);
  const url = webhookUrlBelirle(yol);
  if (!url) {
    console.error('❌ Webhook URL belirlenemedi. Argüman verin: node scripts/telegram-webhook-ayarla.js https://alanadi.com');
    process.exit(1);
  }
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    console.error('❌ Telegram localhost\'a webhook kuramaz. Tünel URL\'si verin veya polling kullanın:');
    console.error('   node scripts/telegram-polling-dev.js');
    process.exit(1);
  }

  console.log(`\n🔗 Webhook ayarlanıyor: ${url}`);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    }),
  });
  const veri = await res.json().catch(() => ({}));

  if (veri.ok) {
    console.log('✅ Webhook başarıyla ayarlandı.');
    console.log(moderasyonMu
      ? '   Botu doğrulamak için sohbete /bekleyenler yazın (onay bekleyen kayıtları listeler).'
      : '   Botu doğrulamak için bir personele bağlantı linki gönderip /start deneyin.');
  } else {
    console.error('❌ Webhook ayarlanamadı:', veri.description || `HTTP ${res.status}`);
    process.exit(1);
  }
}

main();
