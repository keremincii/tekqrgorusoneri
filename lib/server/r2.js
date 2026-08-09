/**
 * Cloudflare R2 Nesne Deposu (S3 uyumlu)
 * ======================================
 *
 * Vatandaşların şikayet fotoğrafları R2'de saklanır. R2 S3 API'si SigV4 imzası
 * ister; bunu hafif `aws4fetch` ile yaparız (tam aws-sdk gerekmez).
 *
 * Güvenlik / gizlilik:
 * - Bucket PRIVATE'dir (herkese açık değil). Fotoğraflar yalnızca başkanın
 *   yetkili route'u (/api/admin/foto/[id]) üzerinden, tenant kontrolünden geçerek
 *   servis edilir. Doğrudan R2 URL'si dışarı verilmez.
 * - Anahtar (key) şeması: `<tenantId>/<uuid>.jpg` → her belediyenin fotoğrafı
 *   kendi klasöründe; başkan yalnızca kendi tenant prefix'ine erişebilir.
 *
 * Gerekli env:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */

import https from 'node:https';
import { AwsClient } from 'aws4fetch';

let _client = null;

/** R2 yapılandırılmış mı? (env eksikse fotoğraf özelliği sessizce devre dışı kalır) */
export function r2Yapilandirildi() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

function client() {
  if (!_client) {
    _client = new AwsClient({
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });
  }
  return _client;
}

/** Bir nesnenin tam R2 S3 endpoint URL'si. */
function nesneUrl(key) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  // key'i path olarak güvenli kullan (UUID + .jpg olduğu için encode gereksiz ama yine de)
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
}

/**
 * R2 çağrısı: aws4fetch ile İMZALA, isteği Node'un `https` modülüyle GÖNDER.
 *
 * NEDEN global `fetch` DEĞİL: Next.js sunucu çalışma zamanında global fetch'i patch'liyor
 * (cache/instrumentation). aws4fetch gövdeyi `new Request(url, {body})` ile sardığında Next
 * bu Request'i klonlarken buffer gövdesini bilinmeyen-uzunlukta bir stream'e çeviriyor →
 * `Transfer-Encoding: chunked`, `Content-Length` YOK. Cloudflare R2 (AWS'nin aksine)
 * Content-Length'siz PUT'u reddediyor → **411 MissingContentLength**, yükleme düşüyor.
 * Ham undici (Next dışı) doğru davranıyor; sorun yalnızca patch'li fetch'te. Bu yüzden
 * imzalamayı aws4fetch'e bırakıp (ağ yapmaz), isteği patch'lenmemiş `https` ile gönderiyoruz
 * ve Content-Length'i açıkça set ediyoruz. 15 sn timeout korunur.
 *
 * Not: `host` başlığı forbidden olduğundan Request'ten düşebilir; ama imza `host`u kapsar ve
 * `https` Host'u `hostname`'e (imzalananla aynı) otomatik set eder → imza tutarlı kalır.
 * @private
 * @returns {Promise<{ok:boolean,status:number,headers:{get:(n:string)=>string|null},text:()=>Promise<string>,arrayBuffer:()=>Promise<ArrayBuffer>}>}
 */
async function r2Fetch(url, init) {
  const imzali = await client().sign(url, init); // yalnız imzalar, ağ çağrısı yapmaz
  const u = new URL(imzali.url);
  const headers = {};
  imzali.headers.forEach((v, k) => { headers[k] = v; });
  const govde = init.body ?? null;
  if (govde != null) headers['content-length'] = Buffer.byteLength(govde);

  return await new Promise((resolve, reject) => {
    const istek = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: init.method || 'GET',
        headers,
      },
      (yanit) => {
        const parcalar = [];
        yanit.on('data', (c) => parcalar.push(c));
        yanit.on('end', () => {
          const tampon = Buffer.concat(parcalar);
          const kod = yanit.statusCode || 0;
          resolve({
            ok: kod >= 200 && kod < 300,
            status: kod,
            headers: { get: (n) => yanit.headers[String(n).toLowerCase()] ?? null },
            text: async () => tampon.toString('utf8'),
            arrayBuffer: async () =>
              tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + tampon.byteLength),
          });
        });
      }
    );
    istek.on('error', reject);
    // R2 yavaşlarsa buffer'lar bellekte rehin kalmasın: 15 sn'de kes → çağıranın hata yolu.
    istek.setTimeout(15_000, () => istek.destroy(new Error('R2 zaman aşımı (15s)')));
    if (govde != null) istek.write(govde);
    istek.end();
  });
}

/**
 * Bir nesneyi R2'ye yükler.
 * @param {string} key - `<tenantId>/<uuid>.jpg`
 * @param {Buffer} buffer - Dosya içeriği (yeniden kodlanmış JPEG)
 * @param {string} [contentType='image/jpeg']
 * @returns {Promise<void>}
 */
export async function r2Yukle(key, buffer, contentType = 'image/jpeg') {
  // aws4fetch, SigV4 imzası için gövdenin SHA-256'sını `crypto.subtle.digest` ile alır.
  // Web Crypto, SharedArrayBuffer destekli görünümleri REDDEDER ("...view on a
  // SharedArrayBuffer, which is not allowed"). sharp'ın .toBuffer() çıktısı bazı
  // ortamlarda (bu Node/libvips derlemesi) SAB-destekli gelir → imzalamadan önce
  // paylaşımsız bir kopyaya çevir. Kopya maliyeti foto boyutunda ihmal edilebilir.
  const govde =
    ArrayBuffer.isView(buffer) && buffer.buffer instanceof SharedArrayBuffer
      ? Buffer.from(buffer)
      : buffer;
  const res = await r2Fetch(nesneUrl(key), {
    method: 'PUT',
    body: govde,
    headers: { 'Content-Type': contentType },
  });
  if (!res.ok) {
    const metin = await res.text().catch(() => '');
    throw new Error(`R2 yükleme başarısız (${res.status}): ${metin.slice(0, 200)}`);
  }
}

/**
 * Bir nesneyi R2'den indirir.
 * @param {string} key
 * @returns {Promise<{buffer: Buffer, contentType: string} | null>} Yoksa null
 */
export async function r2Indir(key) {
  const res = await r2Fetch(nesneUrl(key), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`R2 indirme başarısız (${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get('content-type') || 'image/jpeg',
  };
}

/**
 * Bir nesneyi R2'den siler (öksüz/kullanılmayan fotoğraf temizliği).
 * 404 (zaten yok) başarı sayılır.
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function r2Sil(key) {
  const res = await r2Fetch(nesneUrl(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 silme başarısız (${res.status})`);
  }
}
