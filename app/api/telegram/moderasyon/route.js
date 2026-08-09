import { NextResponse, after } from 'next/server';
import { getModerasyonService } from '@/lib/services';
import { kvSetNx } from '@/lib/infrastructure/redis/store.js';
import { sabitZamanliMetinEsit } from '@/lib/security/hmac.js';

/**
 * POST /api/telegram/moderasyon
 *
 * MODERASYON botunun (küfür filtresine takılan şikayetler) webhook ucu. Saha ekibi
 * botunun ucundan (/api/telegram/webhook) AYRIDIR: farklı bot, farklı token, farklı
 * secret — biri sızsa diğeri etkilenmez.
 *
 * Kimlik doğrulaması iki katmanlıdır:
 *   1. Telegram'ın `setWebhook` sırasında verilen gizli token'ı (bu uçta) — sahte
 *      update enjekte edilemez.
 *   2. ModerasyonService içinde chat kimliği (TELEGRAM_MODERASYON_CHAT_ID) — botu
 *      bulup yazan üçüncü bir kişi butona basamaz.
 *
 * Secret: TELEGRAM_MODERASYON_WEBHOOK_SECRET; tanımlı değilse saha botunun secret'ına
 * düşer (tek operatörlü kurulumda pratik olsun diye). İkisini AYRI tutmak tercih edilir.
 *
 * İşleme ARKA PLANDA (after) yapılıp hemen 200 döner — saha botu ucundaki gerekçenin
 * aynısı: yavaş işleme Telegram'ın retry fırtınasına yol açar. update_id dedup'ı da
 * aynı sebeple vardır; anahtar ÖN EKİ farklıdır çünkü her botun update_id sayacı kendine aittir.
 */
export async function POST(request) {
  const beklenen = process.env.TELEGRAM_MODERASYON_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
  const gelen = request.headers.get('x-telegram-bot-api-secret-token');
  if (!beklenen || !gelen || !sabitZamanliMetinEsit(gelen, beklenen)) {
    return NextResponse.json({ hata: 'Yetkisiz.' }, { status: 401 });
  }

  // Gövde DOĞRUDAN parse edilir — guvenliJsonParse'ın derinlik limiti gerçek
  // callback_query update'lerini reddeder (bkz. /api/telegram/webhook). Kaynak zaten
  // secret_token ile doğrulandı; yalnız boyut sınırı (JSON bomb) korunur.
  let veri;
  try {
    const ham = await request.text();
    if (ham.length > 1024 * 1024) return NextResponse.json({ ok: true });
    veri = JSON.parse(ham);
  } catch {
    return NextResponse.json({ ok: true }); // bozuk gövde → yine 200 (Telegram retry etmesin)
  }
  if (!veri || typeof veri !== 'object') {
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      const updateId = veri?.update_id;
      if (updateId != null) {
        const ilk = await kvSetNx(`tg_mod_update:${updateId}`, { t: 1 }, 60 * 1000);
        if (!ilk) return;
      }
      await getModerasyonService().updateIsle(veri);
    } catch (err) {
      console.error('Moderasyon webhook işleme hatası (arka plan):', err?.message);
    }
  });

  return NextResponse.json({ ok: true });
}
