import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check } from 'k6';

/**
 * YAZMA YOLU YÜK TESTİ (k6) — telefon doğrulamasını BACKDOOR OLMADAN aşar
 * ======================================================================
 * NASIL: /api/sikayet, SMS/WhatsApp yerine sunucunun ürettiği İMZALI bir
 * `dogrulamaToken` + QR `sig` bekler (ikisi de HMAC_SECRET ile imzalı). Bu script,
 * AYNI HMAC_SECRET ile bu token'ı ve imzayı KENDİSİ üretir — yani gerçek yazma
 * yolunu (DB insert dahil) OTP'ye hiç dokunmadan test eder. Uygulamaya hiçbir
 * "test bypass" kapısı eklenmez; sır sadece testi çalıştıranda olur.
 *
 * ÖN HAZIRLIK (sunucuda, SADECE test penceresi için — sonra geri al!):
 *   Rate limitleri gevşet ki tek IP'den gelen yük 429 yemesin:
 *     docker compose exec app sh -c 'env'   # (mevcut env'i görmek istersen)
 *   .env'e EKLE, sonra `docker compose up -d app` ile yeniden başlat:
 *     IP_DAKIKA_LIMIT=100000000
 *     QR_SAAT_LIMIT=100000000
 *     SIKAYET_HAFTALIK_ADET=100000000   # aynı kimlikten tekrar tekrar yazabilmek için
 *   TEST BİTİNCE bu üç satırı .env'den SİL ve app'i yeniden başlat.
 *
 * ÇALIŞTIRMA:
 *   k6 run \
 *     -e HOST=https://gulsehir.sikayet.com \
 *     -e HMAC_SECRET=<sunucudaki .env ile AYNI secret> \
 *     -e SOKAK_ID=<gerçek-bir-sokak-uuid> \
 *     scripts/yuk-testi/yaz-testi.js
 *
 * NOT: Bu test GERÇEK kayıt oluşturur. Tercihen STAGING/ayrı bir DB'ye karşı çalıştır;
 * prod'a karşı çalıştırdıysan sonra test kayıtlarını temizle (kimlikHash 'test' ile başlar).
 */

const HOST = __ENV.HOST;
const SECRET = __ENV.HMAC_SECRET;
const SOKAK_ID = __ENV.SOKAK_ID;
const MAKS_VU = Number(__ENV.MAKS_VU) || 500; // pik eş zamanlı sanal kullanıcı (-e MAKS_VU=100)
// Cloudflare baypas edip origin'e (http://app:3000) vururken tenant Host'tan çözülür;
// gerçek tenant subdomain'ini Host başlığı olarak GÖNDER (yoksa 404). Örn:
//   -e HOST_HEADER=gulsehir.dijitalbelediyem.com
const HOST_HEADER = __ENV.HOST_HEADER || '';

export const options = {
  scenarios: {
    kademeli: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.max(1, Math.ceil(MAKS_VU * 0.1)) },
        { duration: '1m',  target: Math.max(1, Math.ceil(MAKS_VU * 0.4)) },
        { duration: '2m',  target: MAKS_VU },   // yazma yolu okuma'dan ağırdır
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
  },
};

/** QR imzası: sunucudaki imzaOlustur(sokakId) ile birebir aynı (HMAC-SHA256 hex). */
function sig(id) {
  return crypto.hmac('sha256', SECRET, id, 'hex');
}

/** Sunucudaki dogrulamaTokenOlustur ile birebir aynı: base64url(payload) + '.' + HMAC(payload). */
function dogrulamaToken(kimlikHash) {
  const payload = {
    k: kimlikHash,
    ad: 'YukTest',
    sa: 'Kullanici',
    tel: '05000000000',
    exp: Date.now() + 10 * 60 * 1000, // 10 dk (sunucu TTL'i ile uyumlu)
  };
  // base64url (padding'siz) → sunucudaki Buffer.toString('base64url') ile aynı ('rawurl').
  const govde = encoding.b64encode(JSON.stringify(payload), 'rawurl');
  const imza = crypto.hmac('sha256', SECRET, govde, 'hex');
  return `${govde}.${imza}`;
}

export default function () {
  // Her sanal kullanıcı+iterasyon için BENZERSIZ kimlikHash → haftalık dedup'a takılmaz.
  // (Sunucu kimlikHash'i token'dan olduğu gibi alır; ad/soyad'dan yeniden hesaplamaz.)
  const uid = `test-${__VU}-${__ITER}-${Date.now()}`;
  const kimlikHash = crypto.sha256(uid, 'hex'); // 64 hex → /^[0-9a-f]{64}$/ geçerli

  const body = JSON.stringify({
    sokakId: SOKAK_ID,
    sig: sig(SOKAK_ID),
    dogrulamaToken: dogrulamaToken(kimlikHash),
    tur: 'sikayet',
    aciklama: 'Yuk testi otomatik olusturulan basvuru metni.',
    kvkkOnay: true,
  });

  const headers = { 'Content-Type': 'application/json' };
  if (HOST_HEADER) headers['Host'] = HOST_HEADER; // origin-direkt testte tenant çözümü için
  const r = http.post(`${HOST}/api/sikayet`, body, {
    headers,
    tags: { ad: 'sikayet_post' },
  });
  check(r, {
    'sikayet 201': (res) => res.status === 201,
    '429 degil (limit gevsedi mi?)': (res) => res.status !== 429,
  });
}
