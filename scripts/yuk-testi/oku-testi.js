import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * OKUMA YOLU YÜK TESTİ (k6) — telefon doğrulaması GEREKMEZ
 * =======================================================
 * Gerçek dünyada en yüksek QPS'li ve çökme riski en yüksek yol budur:
 *   QR okut → 302 redirect (/q/<id>) → form sayfası (/s/<id>) → sokak listesi.
 * Hiçbiri OTP istemez; darboğazlar (DB havuzu, tenant cache, polling) tam burada ölçülür.
 *
 * ÇALIŞTIRMA (sunucuda veya sunucuya yakın bir makinede):
 *   k6 run \
 *     -e HOST=https://gulsehir.sikayet.com \
 *     -e QR_HOST=https://qr.sikayet.com \
 *     -e SOKAK_ID=<gerçek-bir-sokak-uuid> \
 *     scripts/yuk-testi/oku-testi.js
 *
 * SOKAK_ID: seed sonrası oluşan qr_linkleri.<slug>.json içinden bir UUID al.
 */

const HOST = __ENV.HOST;                 // tenant subdomain (form burada açılır)
const QR_HOST = __ENV.QR_HOST || HOST;   // qr.<domain> (redirect kökü)
const SOKAK_ID = __ENV.SOKAK_ID;
const MAKS_VU = Number(__ENV.MAKS_VU) || 1000; // pik eş zamanlı sanal kullanıcı (-e MAKS_VU=300)

export const options = {
  scenarios: {
    kademeli: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.max(1, Math.ceil(MAKS_VU * 0.2)) }, // ısınma
        { duration: '1m',  target: Math.max(1, Math.ceil(MAKS_VU * 0.5)) },
        { duration: '2m',  target: MAKS_VU },                                // hedef pik
        { duration: '30s', target: 0 },                                      // soğuma
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],          // %2'den az hata
    http_req_duration: ['p(95)<800'],        // p95 < 800ms
  },
};

export default function () {
  // 1) QR okutma → yönlendirici. Redirect'i TAKİP ETME; sadece 302 süresini ölç.
  const r1 = http.get(`${QR_HOST}/q/${SOKAK_ID}`, { redirects: 0, tags: { ad: 'qr_redirect' } });
  check(r1, { 'qr 302/200': (r) => r.status === 302 || r.status === 200 });

  // 2) Form sayfası (server-render). sig herhangi olabilir; doğrulama gönderimde yapılır.
  const r2 = http.get(`${HOST}/s/${SOKAK_ID}?sig=yuktest`, { tags: { ad: 'form' } });
  check(r2, { 'form 200': (r) => r.status === 200 });

  // 3) Sokak listesi (form açılırken çekilir; okuma yolunun en sık DB sorgusu).
  const r3 = http.get(`${HOST}/api/sokaklar`, { tags: { ad: 'sokaklar' } });
  check(r3, { 'sokaklar 200': (r) => r.status === 200 });

  sleep(1); // gerçekçi düşünme süresi
}
