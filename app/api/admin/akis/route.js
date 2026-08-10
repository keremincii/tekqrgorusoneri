import { adminOturumKontrol } from '@/lib/server/adminOturum';
import { getOlayYayini } from '@/lib/services';

/**
 * GET /api/admin/akis — Başkan panelinin CANLI AKIŞI (Server-Sent Events)
 * =======================================================================
 *
 * Panel bu uca bir kez bağlanır ve bağlantı açık kalır; yeni bir başvuru geldiğinde
 * ya da bir kaydın durumu değiştiğinde sunucu olayı ANINDA iter. Başkanın ekranda
 * beklerken sayfayı yenilemesi gerekmez.
 *
 * NEDEN SSE (WebSocket değil):
 *   - Akış TEK YÖNLÜDÜR (sunucu → panel). Panelin yazma işlemleri normal REST
 *     uçlarından gider; çift yönlü bir kanal fazlalık olurdu.
 *   - SSE düz HTTP'dir: Cloudflare tüneli, proxy ve güvenlik başlıkları hiçbir
 *     istisna gerektirmeden çalışır (`connect-src 'self'` CSP'si yeterlidir).
 *   - Tarayıcının EventSource'u kopan bağlantıyı KENDİ yeniden kurar; yeniden
 *     bağlanma mantığını elle yazmak gerekmez.
 *
 * GÜVENLİK:
 *   - Kapı diğer yönetim uçlarıyla AYNI: geçerli admin oturumu + host'tan çözülen
 *     belediye (adminOturumKontrol).
 *   - Abonelik TENANT'A BAĞLIDIR: bir belediyenin olayı diğerinin paneline ulaşamaz
 *     (yayının kendi kuralı — bkz. IOlayYayini).
 *   - Akış yalnız panel DTO'su taşır: vatandaşın adı/telefonu, kimlik hash'i ve
 *     fotoğrafın R2 anahtarı BU AKIŞTA YOKTUR (liste ucuyla aynı sınır).
 *   - Bağlantı tavanı: yetkili bir oturum bile sınırsız akış açıp sunucu belleğini
 *     tüketememeli (AKIS_TAVANI).
 *
 * DAYANIKLILIK:
 *   - Yorum satırı (`:`) biçiminde düzenli "kalp atışı" gönderilir. Aradaki proxy'ler
 *     (Cloudflare ~100 sn) sessiz bağlantıyı düşürür; kalp atışı bunu önler ve
 *     istemcinin bağlantının canlı olduğunu bilmesini sağlar.
 *   - İstemci koparsa (sekme kapandı) `request.signal` tetiklenir → abonelik ve zaman
 *     ayarlayıcı temizlenir. Bu temizlik ŞART: yapılmazsa her kapanan sekme bir
 *     dinleyici + bir interval sızdırır.
 */

/** Kalp atışı aralığı (ms). Cloudflare'in ~100 sn'lik boşta kalma sınırının altında. */
const KALP_ATISI_MS = 25_000;

/**
 * Bir belediyede aynı anda açılabilecek en fazla akış (bu uygulama kopyasında).
 * Meşru kullanım birkaç panel/sekmedir; 20 rahat bir tavandır ve kötü niyetli ya da
 * hatalı bir istemcinin (yeniden bağlanma döngüsü) belleği şişirmesini engeller.
 */
const AKIS_TAVANI = Number(process.env.ADMIN_AKIS_TAVANI) || 20;

export async function GET(request) {
  const { tenant, hataYanit } = await adminOturumKontrol(request);
  if (hataYanit) return hataYanit;

  const yayin = getOlayYayini();
  if (yayin.aboneSayisi(tenant.id) >= AKIS_TAVANI) {
    // 503 + Retry-After: istemci bunu geçici görür ve bir süre sonra yeniden dener.
    return new Response('Canlı akış kapasitesi dolu.', {
      status: 503,
      headers: { 'Retry-After': '30', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const kodlayici = new TextEncoder();
  let aboneligiBirak = null;
  let kalpAtisi = null;

  const akis = new ReadableStream({
    start(kontrolcu) {
      let kapandi = false;

      /** Akışa güvenli yazma: bağlantı koptuysa sessizce vazgeç. */
      const yaz = (metin) => {
        if (kapandi) return;
        try {
          kontrolcu.enqueue(kodlayici.encode(metin));
        } catch {
          // Kuyruk kapanmış (istemci koptu ama abort henüz işlenmedi) → temizle.
          kapat();
        }
      };

      const kapat = () => {
        if (kapandi) return;
        kapandi = true;
        if (kalpAtisi) clearInterval(kalpAtisi);
        if (aboneligiBirak) aboneligiBirak();
        try { kontrolcu.close(); } catch { /* zaten kapalı */ }
      };

      /**
       * SSE olay biçimi: `event:` + `data:` + BOŞ SATIR. Veri tek satır JSON'dur
       * (JSON.stringify kaçışları sayesinde içinde satır sonu bulunamaz — çok satırlı
       * bir gövde protokolü bozardı).
       */
      const olayYaz = (tip, veri) => yaz(`event: ${tip}\ndata: ${JSON.stringify(veri)}\n\n`);

      // 1) İlk mesaj: bağlantı kuruldu. Panel bunu alınca "canlı" göstergesini yakar.
      //    `retry`, tarayıcıya kopma hâlinde kaç ms sonra yeniden deneyeceğini söyler.
      yaz(`retry: 5000\n\n`);
      olayYaz('hazir', { zaman: new Date().toISOString() });

      // 2) Belediyenin olaylarına abone ol.
      aboneligiBirak = yayin.abone(tenant.id, (olay) => {
        olayYaz(olay.tip, olay);
      });

      // 3) Kalp atışı — yorum satırı (istemcide olay tetiklemez, yalnız hattı canlı tutar).
      kalpAtisi = setInterval(() => yaz(': kalp\n\n'), KALP_ATISI_MS);

      // 4) İstemci koptuğunda temizle.
      if (request.signal.aborted) kapat();
      else request.signal.addEventListener('abort', kapat, { once: true });
    },

    cancel() {
      // Tüketici akışı iptal etti (ör. yanıt gövdesi kapatıldı): start() içindeki
      // kapat() ya abort ile ya buradan çağrılır; ikisi de idempotenttir.
      if (kalpAtisi) clearInterval(kalpAtisi);
      if (aboneligiBirak) aboneligiBirak();
    },
  });

  return new Response(akis, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform KRİTİK: aradaki bir katman yanıtı sıkıştırmak/tamponlamak için
      // dönüştürürse olaylar toplu hâlde gecikmeli gelir ve "canlı" olmaktan çıkar.
      'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
      Connection: 'keep-alive',
      // Nginx benzeri ters vekillere "bu yanıtı tamponlama" der (varsa etkili, yoksa zararsız).
      'X-Accel-Buffering': 'no',
    },
  });
}
