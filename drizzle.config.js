import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit Konfigürasyonu
 * 
 * Bu dosya, veritabanı migration'larını yönetmek için kullanılır.
 * Komutlar:
 *   npx drizzle-kit generate  → SQL migration dosyalarını üretir
 *   npx drizzle-kit push      → Şemayı doğrudan veritabanına yansıtır (geliştirme)
 *   npx drizzle-kit migrate   → Migration dosyalarını veritabanına uygular (üretim)
 */
export default defineConfig({
  schema: './lib/infrastructure/database/schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
