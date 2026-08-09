import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@/lib/infrastructure/database/schema.js';

const { Pool } = pg;

/**
 * PostgreSQL Bağlantı Yöneticisi (Connection Pool)
 *
 * VPS'te kendi PostgreSQL'ine (Docker container) bağlanır. Neon'un serverless
 * HTTP driver'ı yerine standart `pg` connection pool kullanılır:
 * - Tek uzun ömürlü process'te bağlantılar yeniden kullanılır (her sorgu için yeni
 *   HTTP roundtrip YOK) → düşük gecikme.
 * - Havuz boyutu env ile ayarlanır.
 *
 * SSL:
 * - Yerel Postgres (Docker, aynı ağ): SSL gerekmez (varsayılan kapalı).
 * - Yönetilen Postgres (Neon/Supabase gibi): DATABASE_SSL=true ile aç.
 *
 * Defense in Depth: Bağlantı dizesi yalnızca çevre değişkeninden okunur.
 */

/** @type {ReturnType<typeof drizzle> | null} */
let _db = null;
/** @type {Pool | null} */
let _pool = null;

/**
 * Veritabanı bağlantısını (Drizzle) döndürür (lazy singleton).
 * @returns {ReturnType<typeof drizzle>}
 * @throws {Error} DATABASE_URL tanımlı değilse
 */
export function getDb() {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL çevre değişkeni tanımlı değil. ' +
      '.env.local dosyasını veya çalışma ortamının değişkenlerini kontrol edin.'
    );
  }

  // SSL: açıkça DATABASE_SSL=true ise veya bağlantı dizesinde sslmode=require varsa
  const sslIstendi =
    process.env.DATABASE_SSL === 'true' || /sslmode=require/i.test(connectionString);

  _pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX) || 10,
    min: 1, // havuz boşta tamamen boşalmasın → ilk istekte soğuk bağlantı gecikmesi olmaz
    idleTimeoutMillis: 30_000,
    // Havuz doygunken bekleyen istek hızlı başarısız olsun (10 sn kuyruk birikimi yerine).
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 3_000,
    // Asılı sorgu bağlantıyı süresiz rehin almasın: sunucu tarafı 5 sn'de keser,
    // istemci tarafı 6 sn'de vazgeçer (statement_timeout ÖNCE tetiklenmeli).
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 5_000,
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS) || 6_000,
    // Yarı açık TCP (DB restart/ağ kopması) bağlantıyı sessizce rehin almasın.
    keepAlive: true,
    ssl: sslIstendi ? { rejectUnauthorized: false } : undefined,
  });

  // KRİTİK: idle bağlantı hata verdiğinde (Postgres restart, TCP reset) pg-pool
  // 'error' EMIT eder; dinleyici yoksa Node uncaughtException ile TÜM PROCESS ÇÖKER.
  // pg bozuk bağlantıyı havuzdan zaten çıkarır — burada yalnızca event'i dinleyip
  // loglamak yeterli (RedisClient'taki korumanın pg karşılığı).
  _pool.on('error', (err) => {
    console.error('PG pool idle bağlantı hatası (havuzdan çıkarıldı):', err?.code, err?.message);
  });

  _db = drizzle(_pool, { schema });
  return _db;
}

/**
 * Bağlantı havuzunu kapatır (graceful shutdown / test temizliği için).
 * @returns {Promise<void>}
 */
export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}
