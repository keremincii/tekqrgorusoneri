/**
 * Telegram Polling — YEREL GELİŞTİRME köprüsü
 *
 * Kullanım (Next dev sunucusu ÇALIŞIRKEN ayrı bir terminalde):
 *   node scripts/telegram-polling-dev.js
 *
 * Telegram localhost'a webhook gönderemez. Bu script Telegram'dan getUpdates ile
 * güncellemeleri çeker ve YEREL webhook ucuna (http://localhost:3000/api/telegram/
 * webhook) POST eder — yani çalışan dev sunucusunun GERÇEK handler'ını kullanır.
 * Böylece webhook mantığı (DB, servisler) olduğu gibi test edilir.
 *
 * Not: Webhook ile getUpdates birlikte çalışmaz; script başta deleteWebhook yapar.
 * Üretime geçerken tekrar: node scripts/telegram-webhook-ayarla.js <url>
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
  if (!envPath) { console.error('❌ .env.local veya .env bulunamadı!'); process.exit(1); }
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((satir) => {
    const [k, ...v] = satir.split('=');
    if (k && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim();
  });
}

envOku();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const HEDEF = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '') + '/api/telegram/webhook';

if (!TOKEN) { console.error('❌ TELEGRAM_BOT_TOKEN tanımlı değil!'); process.exit(1); }
if (!SECRET) { console.error('❌ TELEGRAM_WEBHOOK_SECRET tanımlı değil!'); process.exit(1); }

const API = `https://api.telegram.org/bot${TOKEN}`;

async function tgCagir(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json().catch(() => ({}));
}

async function yereleIlet(update) {
  try {
    await fetch(HEDEF, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': SECRET,
      },
      body: JSON.stringify(update),
    });
  } catch (err) {
    console.error('   ⚠ Yerel webhook\'a iletilemedi (dev sunucusu çalışıyor mu?):', err.message);
  }
}

async function main() {
  console.log('🤖 Telegram polling (geliştirme) başlatılıyor...');
  await tgCagir('deleteWebhook', { drop_pending_updates: false });
  console.log(`   Güncellemeler şuraya iletilecek: ${HEDEF}`);
  console.log('   Durdurmak için Ctrl+C.\n');

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const veri = await tgCagir('getUpdates', {
      offset,
      timeout: 25,
      allowed_updates: ['message', 'callback_query'],
    });
    if (veri.ok && Array.isArray(veri.result)) {
      for (const u of veri.result) {
        offset = u.update_id + 1;
        const tur = u.callback_query ? 'callback' : (u.message?.text || 'mesaj');
        console.log(`→ update ${u.update_id}: ${tur}`);
        await yereleIlet(u);
      }
    } else if (!veri.ok) {
      console.error('   ⚠ getUpdates hatası:', veri.description || 'bilinmiyor');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
