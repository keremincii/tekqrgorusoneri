import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { tenantlar } from '@/lib/infrastructure/database/schema.js';

/**
 * TenantRepository - Belediye (tenant) kayıtları
 *
 * Tenant çözümlemesinin tek veri kaynağı. Subdomain → tenant_id eşlemesi
 * buradan yapılır; hiçbir yerde istemciden gelen tenant değerine güvenilmez.
 */
export class TenantRepository {
  constructor() {
    this.db = getDb();
  }

  /** Slug (subdomain) ile aktif tenant getirir. */
  async slugIleGetir(slug) {
    const sonuclar = await this.db
      .select()
      .from(tenantlar)
      .where(eq(tenantlar.slug, slug));

    return sonuclar[0] || null;
  }

  /** ID ile tenant getirir. */
  async idIleGetir(id) {
    const sonuclar = await this.db
      .select()
      .from(tenantlar)
      .where(eq(tenantlar.id, id));

    return sonuclar[0] || null;
  }

  /** Tüm tenantları listeler. */
  async hepsiniGetir() {
    return await this.db.select().from(tenantlar);
  }
}
