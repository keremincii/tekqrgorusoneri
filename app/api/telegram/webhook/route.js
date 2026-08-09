import { NextResponse, after } from 'next/server';
import { getTelegramService } from '@/lib/services';
import { kvSetNx } from '@/lib/infrastructure/redis/store.js';
import { sabitZamanliMetinEsit } from '@/lib/security/hmac.js';

/**
 * POST /api/telegram/webhook
 *
 * Telegram Bot API'nin güncelleme (update) gönderdiği uçtur. Kimlik doğrulaması
 * COOKIE ile DEĞİL, Telegram'ın `setWebhook` sırasında verilen gizli token'ı ile
 * yapılır: Telegram her isteği `X-Telegram-Bot-Api-Secret-Token` header'ında bu
 * token'la imzalar. Eşleşmezse 401 → sahte update enjekte edilemez.
 *
 * Tenant burada Host'tan çözülmez (Telegram ana domaine vurur); tenant, güncellemeyi
 * işlerken bağlanan personel kaydından (chat_id / token) belirlenir (TelegramService).
 *
 * İşleme ARKA PLANDA (after) yapılıp HEMEN 200 döner: aksi halde işleme yavaşsa
 * (iş başına birden çok seri Telegram API çağrısı) Telegram aynı update'i tekrar
 * gönderir (retry fırtınası → personele çift/üçlü mesaj). Ayrıca `update_id` bazlı
 * kısa-TTL dedup ile, erken-200'e rağmen Telegram'ın ağ hatasında tekrar gönderdiği
 * aynı update iki kez İŞLENMEZ.
 */
export async function POST(request) {
  // === secret_token doğrulaması (tek kapı) — sabit zamanlı karşılaştırma ===
  const beklenen = process.env.TELEGRAM_WEBHOOK_SECRET;
  const gelen = request.headers.get('x-telegram-bot-api-secret-token');
  if (!beklenen || !gelen || !sabitZamanliMetinEsit(gelen, beklenen)) {
    return NextResponse.json({ hata: 'Yetkisiz.' }, { status: 401 });
  }

  // Gövdeyi DOĞRUDAN parse et — guvenliJsonParse KULLANMA:
  // KRİTİK: guvenliJsonParse'ın 5-seviye derinlik limiti gerçek Telegram
  // callback_query update'lerini (message.reply_markup.inline_keyboard[[button]] ~8
  // seviye) reddeder → webhook 200 döner ama işlenmez → "Çözüldü" hiç çalışmazdı.
  // Kaynak zaten secret_token ile doğrulandı (güvenilir = Telegram) ve updateIsle
  // yalnız belirli alanları güvenli okur (callback_data prefix+DB lookup, chat_id sayı,
  // metin startsWith + htmlKacis). Yalnız boyut sınırı (JSON bomb) korunur.
  let veri;
  try {
    const ham = await request.text();
    if (ham.length > 1024 * 1024) return NextResponse.json({ ok: true }); // aşırı büyük → sessiz 200
    veri = JSON.parse(ham);
  } catch {
    return NextResponse.json({ ok: true }); // bozuk gövde → yine 200 (Telegram retry etmesin)
  }
  if (!veri || typeof veri !== 'object') {
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      // update_id dedup: aynı update ağ-retry ile iki kez gelirse yalnız ilki işlenir.
      // kvSetNx atomik "yoksa-yaz"; false → bu update zaten işlendi/işleniyor, atla.
      const updateId = veri?.update_id;
      if (updateId != null) {
        const ilk = await kvSetNx(`tg_update:${updateId}`, { t: 1 }, 60 * 1000);
        if (!ilk) return;
      }
      await getTelegramService().updateIsle(veri);
    } catch (err) {
      console.error('Telegram webhook işleme hatası (arka plan):', err?.message);
    }
  });

  return NextResponse.json({ ok: true });
}
