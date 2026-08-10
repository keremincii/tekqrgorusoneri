import { and, eq, asc } from 'drizzle-orm';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { birimler } from '@/lib/infrastructure/database/schema.js';

/**
 * BirimRepository - Birim (departman) veritabanı işlemleri
 *
 * Birim, saha personelini gruplayan bir etikettir. Kategori↔birim yönlendirme
 * eşleşmesi (`birim_kategoriler`) migration 0001 ile kaldırıldı — kategori ekseni
 * olmayan bir üründe eşleşmenin sol tarafı yoktu (bkz. BirimService).
 *
 * MULTI-TENANT: tüm sorgular tenant_id ile filtrelidir.
 * KRİTİK: Tüm WHERE koşulları tek `.where(and(...))` içinde.
 */
export class BirimRepository {
  constructor() {
    this.db = getDb();
  }

  /** Yeni birim oluşturur. */
  async olustur(tenantId, ad) {
    const sonuc = await this.db
      .insert(birimler)
      .values({ tenantId, ad })
      .returning();
    return sonuc[0];
  }

  /**
   * Bir belediyenin birimlerini listeler. Sıralama ADA GÖREDİR (eklenme tarihine
   * göre değil): panelde atama yaparken başkan birimi adıyla arar, listenin her
   * yeni birim eklendiğinde yer değiştirmesi aramayı zorlaştırırdı.
   */
  async tenantBirimleriGetir(tenantId, { sadeceAktif = true } = {}) {
    const kosul = sadeceAktif
      ? and(eq(birimler.tenantId, tenantId), eq(birimler.aktif, true))
      : eq(birimler.tenantId, tenantId);
    return await this.db
      .select()
      .from(birimler)
      .where(kosul)
      .orderBy(asc(birimler.ad));
  }

  /** ID ile birim getirir (tenant filtreli). */
  async idIleGetir(id, tenantId) {
    const sonuclar = await this.db
      .select()
      .from(birimler)
      .where(and(eq(birimler.id, id), eq(birimler.tenantId, tenantId)));
    return sonuclar[0] || null;
  }

  /**
   * Birimi pasifleştirir (soft delete). Personel kayıtları SİLİNMEZ; birimi kalkan
   * personel panelde "birimsiz" olarak görünmeye devam eder ve atama alabilir.
   */
  async pasifYap(id, tenantId) {
    const sonuc = await this.db
      .update(birimler)
      .set({ aktif: false })
      .where(and(eq(birimler.id, id), eq(birimler.tenantId, tenantId)))
      .returning();
    return sonuc[0] || null;
  }
}
