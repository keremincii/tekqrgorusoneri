/**
 * Kalıcı Sayaç / Küme / KV Store — Redis öncelikli, in-memory fallback
 * ===================================================================
 *
 * SMS kötüye kullanım korumasının kalıcı katmanı bu primitifler üzerine kuruludur:
 *   - sayac*  : pencere içi artan sayaç (throttle limitleri, global bütçe kesici)
 *   - setUye* : pencere içi benzersiz üye kümesi (IP başına farklı telefon sayısı)
 *   - kv*     : TTL'li JSON kayıt (OTP deposu)
 *
 * Davranış:
 *   - REDIS_URL varsa Redis kullanılır (restart'a dayanıklı, çok-container ortak).
 *   - Yoksa ya da bir Redis çağrısı HATA verirse → in-memory'e düşer (FAIL-SAFE:
 *     limitler asla "sessizce kapanmaz"; en kötü ihtimalle tek-container belleğinde
 *     çalışır). Redis toparlanınca otomatik geri döner.
 */
import { getRedis } from './RedisClient.js';

// ----------------------------------------------------------------------------
// In-memory fallback yapıları (Redis yok/erişilemez iken)
// ----------------------------------------------------------------------------
const memSayac = new Map(); // key -> { sayac, ilkIstek }
const memSet = new Map();   // key -> { uyeler: Set, ilkIstek }
const memKv = new Map();    // key -> { val: string, expireAt: number }

const MAX_KAYIT = 50000;
const TAHLIYE_PAYI = 5000;
const TEMIZLIK_PERIYODU_MS = 10 * 60 * 1000;
let sonTemizlik = Date.now();

function suresiGecti(ilkIstek, windowMs) {
  return Date.now() - ilkIstek > windowMs;
}

function memTemizle() {
  const simdi = Date.now();
  if (simdi - sonTemizlik < TEMIZLIK_PERIYODU_MS) return;
  sonTemizlik = simdi;
  for (const [k, v] of memSayac) if (simdi - v.ilkIstek > 2 * 60 * 60 * 1000) memSayac.delete(k);
  for (const [k, v] of memSet) if (simdi - v.ilkIstek > 2 * 60 * 60 * 1000) memSet.delete(k);
  for (const [k, v] of memKv) if (simdi > v.expireAt) memKv.delete(k);
}

function kapasite(map) {
  if (map.size < MAX_KAYIT) return;
  let n = TAHLIYE_PAYI;
  for (const k of map.keys()) { map.delete(k); if (--n <= 0) break; }
}

// ----------------------------------------------------------------------------
// SAYAÇ (pencere içi artan sayı)
// ----------------------------------------------------------------------------

/** Sayacı ARTIRMADAN kontrol eder. @returns {Promise<{izinVar:boolean, kalanHak:number}>} */
export async function sayacPeek(key, max, windowMs) {
  const r = getRedis();
  if (r) {
    try {
      const n = Number(await r.get(key)) || 0;
      return { izinVar: n < max, kalanHak: Math.max(0, max - n) };
    } catch { /* fail-safe → memory */ }
  }
  memTemizle();
  const kayit = memSayac.get(key);
  if (!kayit || suresiGecti(kayit.ilkIstek, windowMs)) return { izinVar: true, kalanHak: max };
  return { izinVar: kayit.sayac < max, kalanHak: Math.max(0, max - kayit.sayac) };
}

/** Sayacın şu anki değerini döndürür (conversion oranı hesabı için). @returns {Promise<number>} */
export async function sayacDeger(key) {
  const r = getRedis();
  if (r) {
    try { return Number(await r.get(key)) || 0; } catch { /* fail-safe → memory */ }
  }
  memTemizle();
  const kayit = memSayac.get(key);
  // Bu primitif yalnız günlük sayaçlar (sms_global/sms_dogrulandi) için kullanılır;
  // in-memory fallback'te gün penceresini varsay.
  if (!kayit || suresiGecti(kayit.ilkIstek, 24 * 60 * 60 * 1000)) return 0;
  return kayit.sayac;
}

/** Sayacı 1 artırır (pencere yoksa/dolduysa yeni pencere başlatır). */
export async function sayacArtir(key, windowMs) {
  const r = getRedis();
  if (r) {
    try {
      const n = await r.incr(key);
      if (n === 1) await r.pexpire(key, windowMs);
      return;
    } catch { /* fail-safe → memory */ }
  }
  const kayit = memSayac.get(key);
  if (!kayit || suresiGecti(kayit.ilkIstek, windowMs)) {
    kapasite(memSayac);
    memSayac.set(key, { sayac: 1, ilkIstek: Date.now() });
    return;
  }
  kayit.sayac += 1;
}

// ----------------------------------------------------------------------------
// BENZERSIZ ÜYE KÜMESİ (ör. IP başına farklı telefon)
// ----------------------------------------------------------------------------

/** Üye zaten varsa VEYA küme boyutu max'ın altındaysa izin verir (artırmadan). */
export async function setUyeIzin(key, member, max, windowMs) {
  const r = getRedis();
  if (r) {
    try {
      if (await r.sismember(key, member)) return { izinVar: true };
      const c = await r.scard(key);
      return { izinVar: c < max };
    } catch { /* fail-safe → memory */ }
  }
  memTemizle();
  const kayit = memSet.get(key);
  if (!kayit || suresiGecti(kayit.ilkIstek, windowMs)) return { izinVar: true };
  if (kayit.uyeler.has(member)) return { izinVar: true };
  return { izinVar: kayit.uyeler.size < max };
}

/** Kümenin şu anki üye sayısını döndürür (mağdur-hedef breadth tespiti için). */
export async function setBoyut(key) {
  const r = getRedis();
  if (r) {
    try { return await r.scard(key); } catch { /* fail-safe → memory */ }
  }
  memTemizle();
  const kayit = memSet.get(key);
  return kayit ? kayit.uyeler.size : 0;
}

/** Üyeyi kümeye ekler (yeni küme ise TTL başlatır). */
export async function setUyeEkle(key, member, windowMs) {
  const r = getRedis();
  if (r) {
    try {
      await r.sadd(key, member);
      const ttl = await r.pttl(key);
      if (ttl < 0) await r.pexpire(key, windowMs);
      return;
    } catch { /* fail-safe → memory */ }
  }
  const kayit = memSet.get(key);
  if (!kayit || suresiGecti(kayit.ilkIstek, windowMs)) {
    kapasite(memSet);
    memSet.set(key, { uyeler: new Set([member]), ilkIstek: Date.now() });
    return;
  }
  kayit.uyeler.add(member);
}

// ----------------------------------------------------------------------------
// KV (TTL'li JSON kayıt — OTP deposu)
// ----------------------------------------------------------------------------

/** @returns {Promise<any|null>} */
export async function kvGetJson(key) {
  const r = getRedis();
  if (r) {
    try {
      const s = await r.get(key);
      return s ? JSON.parse(s) : null;
    } catch { /* fail-safe → memory */ }
  }
  memTemizle();
  const kayit = memKv.get(key);
  if (!kayit) return null;
  if (Date.now() > kayit.expireAt) { memKv.delete(key); return null; }
  try { return JSON.parse(kayit.val); } catch { return null; }
}

export async function kvSetJson(key, obj, ttlMs) {
  const s = JSON.stringify(obj);
  const r = getRedis();
  if (r) {
    try { await r.set(key, s, 'PX', ttlMs); return; } catch { /* fail-safe → memory */ }
  }
  kapasite(memKv);
  memKv.set(key, { val: s, expireAt: Date.now() + ttlMs });
}

/**
 * ATOMİK "yoksa-yaz" (SET NX). Anahtar YOKSA yazar ve true döner; VARSA hiçbir şey
 * yapmaz ve false döner. Yarış koşullarında tek-kazanan gerektiren yerler için:
 *   - webhook message-id idempotency (aynı mesaj iki kez işlenmesin),
 *   - nonce tek-kullanım kilidi (aynı nonce'un iki webhook'u çift şikayet açmasın),
 *   - kimlik-başına kısa kilit (aynı kişinin eşzamanlı iki isteği haftalık limiti aşmasın).
 * Redis'te `SET key val PX ttl NX` atomiktir; in-memory fallback'te tek-thread JS
 * içinde await'siz check-then-set atomiktir.
 * @returns {Promise<boolean>} yazıldıysa (kilit alındıysa) true.
 */
export async function kvSetNx(key, obj, ttlMs) {
  const s = JSON.stringify(obj);
  const r = getRedis();
  if (r) {
    try {
      const res = await r.set(key, s, 'PX', ttlMs, 'NX');
      return res === 'OK'; // NX başarısızsa (anahtar var) null döner
    } catch { /* fail-safe → memory */ }
  }
  // in-memory: bu blokta await YOK → tek-thread'de atomik.
  memTemizle();
  const kayit = memKv.get(key);
  if (kayit && Date.now() <= kayit.expireAt) return false; // var ve süresi dolmamış
  kapasite(memKv);
  memKv.set(key, { val: s, expireAt: Date.now() + ttlMs });
  return true;
}

/** Değeri, mevcut TTL'i KORUYARAK günceller (OTP deneme sayacını artırmak için). */
export async function kvSetJsonKeepTtl(key, obj) {
  const s = JSON.stringify(obj);
  const r = getRedis();
  if (r) {
    try { await r.set(key, s, 'KEEPTTL'); return; } catch { /* fail-safe → memory */ }
  }
  const kayit = memKv.get(key);
  if (kayit) kayit.val = s; // aynı expireAt korunur
}

export async function kvDel(key) {
  const r = getRedis();
  if (r) {
    try { await r.del(key); return; } catch { /* fail-safe → memory */ }
  }
  memKv.delete(key);
}
