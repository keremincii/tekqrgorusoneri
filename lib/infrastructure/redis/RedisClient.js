/**
 * Redis İstemcisi (tekil bağlantı)
 * ================================
 *
 * SMS kötüye kullanım korumasının KALICI katmanı: gönderim sayaçları, global bütçe
 * kesici ve OTP deposu Redis'te tutulunca sunucu restart/deploy'da SIFIRLANMAZ ve
 * çok-container'da ortak çalışır.
 *
 * VPS'te docker-compose ile aynı iç ağda çalışır (REDIS_URL=redis://redis:6379).
 * REDIS_URL tanımlı DEĞİLSE istemci null döner ve store otomatik olarak in-memory
 * moda düşer (tek container'da çalışır, restart'ta sıfırlanır).
 *
 * Not: ioredis harici bağımlılıktır (projenin tek altyapı bağımlılığı bu katmanda).
 */
import Redis from 'ioredis';

let _client = null;
let _denendi = false;
let _hataBasildi = false;

/**
 * Tekil Redis istemcisini döndürür (REDIS_URL yoksa null).
 * @returns {import('ioredis').Redis | null}
 */
export function getRedis() {
  if (_denendi) return _client;
  _denendi = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    _client = null;
    return null;
  }

  try {
    _client = new Redis(url, {
      // Rate-limit yolunda takılıp kalmamak için sınırlı deneme; hata olursa store
      // in-memory'e düşer (fail-safe: limitler kaybolmaz).
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      // KRİTİK: Redis AYAKTA ama YAVAŞKEN (AOF fsync, CPU steal, bellek baskısı)
      // komutlar timeout'suz süresiz askıda kalır ve store.js'in try/catch in-memory
      // fail-safe'i HİÇ tetiklenmez (komut hata vermez, asılı kalır). commandTimeout
      // ile komut reddedilir → catch → in-memory fallback GERÇEKTEN çalışır.
      // 5000 bilinçli: connectTimeout(3000)+handshake payının ÜSTÜNDE, yoksa cold
      // boot/reconnect penceresinde offline kuyruktaki ilk OTP yazımı timeout'a düşüp
      // split-brain ("Doğrulama kodu bulunamadı") regresyonu yaratırdı.
      commandTimeout: 5000,
      // Cold boot / yeniden bağlanma penceresinde komutları KUYRUĞA al (reddetme).
      // enableOfflineQueue:false iken, bağlantı "ready" olana kadarki komutlar hata
      // verip in-memory'e düşüyordu: OTP YAZIMI belleğe, saniyeler sonra OKUMA Redis'e
      // gidiyordu (split-brain → "Doğrulama kodu bulunamadı"). Kuyruk sayesinde ilk
      // istek de Redis'e yazılır. maxRetriesPerRequest ile sınırlı: Redis gerçekten
      // erişilemezse komutlar kısa sürede reddedilip yine memory fallback'e düşer.
      enableOfflineQueue: true,
    });
    _client.on('error', (e) => {
      if (!_hataBasildi) {
        _hataBasildi = true;
        console.warn('⚠ Redis bağlantı hatası — rate-limit/OTP in-memory\'e düşüyor:', e?.message);
      }
    });
    return _client;
  } catch (e) {
    console.warn('⚠ Redis istemcisi oluşturulamadı — in-memory kullanılacak:', e?.message);
    _client = null;
    return null;
  }
}

/** REDIS_URL tanımlı ve istemci kurulabildi mi? */
export function redisVarMi() {
  return Boolean(getRedis());
}
