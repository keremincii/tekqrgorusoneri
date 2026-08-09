import crypto from 'crypto';

/**
 * Uygulama-katmanı gizli-veri şifreleme (AES-256-GCM)
 * ===================================================
 *
 * Amaç: DB'de saklanan üçüncü-taraf ENTEGRASYON SIRLARINI (ör. her belediyenin kendi
 * Netgsm SMS şifresi) at-rest şifrelemek. Şifre-çözme anahtarı DB'de DEĞİL env'dedir
 * (`SIR_SIFRELEME_ANAHTARI`) → veritabanı/yedek sızsa bile (SQL injection dump, Neon
 * snapshot sızıntısı) şifreler çözülemez; saldırganın ayrıca host env'ini de ele
 * geçirmesi gerekir.
 *
 * Anahtar ayrımı (domain separation): HMAC_SECRET'ten AYRI bir env kullanılır — imza/
 * token anahtarıyla aynı sırrı birden çok amaçta kullanmamak için (güvenlik denetimi notu).
 *
 * Biçim: "v1.<iv_b64>.<tag_b64>.<ct_b64>" (sürümlü → ileride algoritma değişimine açık).
 * GCM auth-tag ⇒ kurcalama (tamper) tespiti; yanlış anahtar/bozuk veri → çözümde null.
 */

let _anahtarCache = null;

/** Env sırrından 32-baytlık AES anahtarı türetir (SHA-256). Yoksa/kısa ise throw. */
function anahtar() {
  if (_anahtarCache) return _anahtarCache;
  const s = process.env.SIR_SIFRELEME_ANAHTARI;
  if (!s || s.length < 16) {
    throw new Error(
      'SIR_SIFRELEME_ANAHTARI tanımlı değil veya çok kısa (≥16 karakter, güçlü rastgele bir değer olmalı).'
    );
  }
  _anahtarCache = crypto.createHash('sha256').update(s, 'utf8').digest(); // 32 byte
  return _anahtarCache;
}

/** Şifreleme kullanılabilir mi? (anahtar tanımlı mı) — throw etmeden kontrol. */
export function sifrelemeHazir() {
  const s = process.env.SIR_SIFRELEME_ANAHTARI;
  return Boolean(s && s.length >= 16);
}

/**
 * Düz metni AES-256-GCM ile şifreler.
 * @param {string} duz
 * @returns {string} "v1.<iv>.<tag>.<ct>" (base64 parçalar)
 */
export function sirSifrele(duz) {
  if (typeof duz !== 'string' || duz.length === 0) {
    throw new Error('Şifrelenecek değer boş veya geçersiz.');
  }
  const iv = crypto.randomBytes(12); // GCM için 96-bit IV (standart)
  const cipher = crypto.createCipheriv('aes-256-gcm', anahtar(), iv);
  const ct = Buffer.concat([cipher.update(duz, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

/**
 * `sirSifrele` çıktısını çözer. Yanlış anahtar/bozuk/kurcalanmış veri → null (çağıran
 * güvenli tarafta fallback'e düşer; exception fırlatmaz).
 * @param {string} enc
 * @returns {string|null}
 */
export function sirCoz(enc) {
  if (typeof enc !== 'string') return null;
  const p = enc.split('.');
  if (p.length !== 4 || p[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(p[1], 'base64');
    const tag = Buffer.from(p[2], 'base64');
    const ct = Buffer.from(p[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', anahtar(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
