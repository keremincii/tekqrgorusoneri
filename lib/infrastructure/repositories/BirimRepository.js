import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { birimler, birimKategoriler } from '@/lib/infrastructure/database/schema.js';

/**
 * BirimRepository - Birim (departman) + birim↔kategori eşleşmesi veritabanı işlemleri
 *
 * MULTI-TENANT: tüm sorgular tenant_id ile filtrelidir. Bir kategori birden ÇOK birime
 * atanabilir (bkz. migration 0014) → aynı kategoriyi kapsayan her birimin personeli
 * bildirim alır ve şikayeti çözebilir. Unique yalnız (tenant, birim, kategori).
 *
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

  /** Bir belediyenin birimlerini listeler (aktif). */
  async tenantBirimleriGetir(tenantId, { sadeceAktif = true } = {}) {
    const kosul = sadeceAktif
      ? and(eq(birimler.tenantId, tenantId), eq(birimler.aktif, true))
      : eq(birimler.tenantId, tenantId);
    return await this.db
      .select()
      .from(birimler)
      .where(kosul)
      .orderBy(desc(birimler.olusturmaTarihi));
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
   * Birimi pasifleştirir (soft delete) + kategori eşleşmelerini SİLER (o kategoriler
   * bu birim üzerinden yönlendirilmez; aynı kategori başka birimlerdeyse orada kalır,
   * o birimlerin personeli bildirim almaya devam eder). Personelin birim_id'si kalır
   * ama kategori eşleşmesi olmadığı için o personele artık otomatik iş düşmez.
   */
  async pasifYap(id, tenantId) {
    await this.db
      .delete(birimKategoriler)
      .where(and(eq(birimKategoriler.birimId, id), eq(birimKategoriler.tenantId, tenantId)));
    const sonuc = await this.db
      .update(birimler)
      .set({ aktif: false })
      .where(and(eq(birimler.id, id), eq(birimler.tenantId, tenantId)))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * Bir kategoriyi hangi birimler kapsıyor (birden çok olabilir). Yönlendirme ve
   * çözüm-yetkisi kontrolünde kullanılır. Yoksa boş dizi.
   * @returns {Promise<string[]>} birimId listesi
   */
  async kategoriBirimleriGetir(tenantId, kategori) {
    const satirlar = await this.db
      .select({ birimId: birimKategoriler.birimId })
      .from(birimKategoriler)
      .where(and(eq(birimKategoriler.tenantId, tenantId), eq(birimKategoriler.kategori, kategori)));
    return satirlar.map((s) => s.birimId);
  }

  /** Bir birimin kapsadığı kategori id'lerini döndürür. */
  async kategorileriGetir(birimId, tenantId) {
    const satirlar = await this.db
      .select({ kategori: birimKategoriler.kategori })
      .from(birimKategoriler)
      .where(and(eq(birimKategoriler.birimId, birimId), eq(birimKategoriler.tenantId, tenantId)));
    return satirlar.map((s) => s.kategori);
  }

  /** Tüm birim↔kategori eşleşmelerini (tenant) döndürür → UI'da hangi birim hangi kategori. */
  async tenantKategoriEslesmeleri(tenantId) {
    return await this.db
      .select({ birimId: birimKategoriler.birimId, kategori: birimKategoriler.kategori })
      .from(birimKategoriler)
      .where(eq(birimKategoriler.tenantId, tenantId));
  }

  /**
   * Bir birimin kategori kümesini AYARLAR (tam değiştirir). YALNIZ bu birimin
   * eşleşmelerine dokunur — aynı kategori başka birimlerde de duruyorsa orada kalır
   * (bir kategori birden çok birime atanabilir).
   * @param {string[]} kategoriler - Geçerli kategori id'leri (çağıran doğrular)
   */
  async kategorileriAyarla(tenantId, birimId, kategoriler) {
    // Bu birimin mevcut eşleşmelerini temizle
    await this.db
      .delete(birimKategoriler)
      .where(and(eq(birimKategoriler.birimId, birimId), eq(birimKategoriler.tenantId, tenantId)));

    if (!kategoriler || kategoriler.length === 0) return;

    const benzersiz = [...new Set(kategoriler)];
    await this.db
      .insert(birimKategoriler)
      .values(benzersiz.map((kategori) => ({ tenantId, birimId, kategori })));
  }
}
