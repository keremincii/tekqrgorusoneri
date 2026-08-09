import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { sokaklar } from '@/lib/infrastructure/database/schema.js';
import { ISokakRepository } from '@/lib/domain/interfaces/ISokakRepository.js';

/**
 * SokakRepository - Sokak Veritabanı İşlemleri (Somut Implementasyon)
 * 
 * Liskov Substitution (SOLID-L): ISokakRepository arayüzünü implement eder.
 * Single Responsibility (SOLID-S): Sadece sokak CRUD işlemlerini yapar.
 * Dependency Inversion (SOLID-D): Servis katmanı bu sınıfı değil,
 *   ISokakRepository arayüzünü bilir.
 * 
 * Yeni sokak eklemek veya çıkarmak bu repository üzerinden yapılır.
 * Geliştirici (Kerem) scripts/seed-sokaklar.js ile toplu ekleme yapabilir,
 * veya tek tek bu sınıfın metotlarını kullanabilir.
 */
export class SokakRepository extends ISokakRepository {
  constructor() {
    super();
    this.db = getDb();
  }

  /**
   * Bir belediyenin tüm aktif sokaklarını listeler.
   * @param {number} tenantId
   * @returns {Promise<Array>} Aktif sokak listesi
   */
  async tumunuGetir(tenantId) {
    return await this.db
      .select()
      .from(sokaklar)
      .where(and(eq(sokaklar.tenantId, tenantId), eq(sokaklar.aktif, true)));
  }

  /**
   * ID ile tek bir sokak getirir (yalnızca ilgili belediyeninkini).
   * @param {string} id - Sokak UUID'si
   * @param {number} tenantId
   * @returns {Promise<Object|null>} Bulunan sokak veya null
   */
  async idIleGetir(id, tenantId) {
    const sonuclar = await this.db
      .select()
      .from(sokaklar)
      .where(and(eq(sokaklar.id, id), eq(sokaklar.tenantId, tenantId)));

    return sonuclar[0] || null;
  }

  /**
   * ID ile sokak getirir — TENANT FİLTRESİ OLMADAN (belediyeler arası).
   *
   * YALNIZCA QR yönlendiricisi (app/q/[id]) için. QR'lar tenant-bağımsız tek bir
   * kök adreste (qr.<domain>) barındığından, yönlendirici sokağı global UUID ile
   * bulup ait olduğu belediyenin subdomain'ine 302 atar. Güvenli: UUID tahmin
   * edilemez ve dönen tek bilgi zaten herkese açık form adresidir; şikayet kaydı
   * yine hedef subdomain'de Host'tan tenant çözülerek + imza doğrulanarak yapılır.
   *
   * Normal akışta ASLA bunu kullanma; tenant-filtreli idIleGetir(id, tenantId) kullan.
   *
   * @param {string} id - Sokak UUID'si
   * @returns {Promise<Object|null>} Bulunan aktif sokak veya null
   */
  async idIleGetirGlobal(id) {
    const sonuclar = await this.db
      .select()
      .from(sokaklar)
      .where(and(eq(sokaklar.id, id), eq(sokaklar.aktif, true)));

    return sonuclar[0] || null;
  }

  /**
   * QR KISA KODU ile sokak getirir — TENANT FİLTRESİ OLMADAN (belediyeler arası).
   *
   * idIleGetirGlobal'in base62 karşılığı: yeni QR'lar `/q/<qr_kod>` biçimindedir.
   * `qr_kod` global UNIQUE olduğundan tek satır döner. Yalnızca QR yönlendiricisi
   * (app/q/[id]) kullanır; normal akışta tenant-filtreli metotları kullan.
   *
   * @param {string} kod - Sokağın base62 qr_kod'u
   * @returns {Promise<Object|null>} Bulunan aktif sokak veya null
   */
  async kodIleGetirGlobal(kod) {
    const sonuclar = await this.db
      .select()
      .from(sokaklar)
      .where(and(eq(sokaklar.qrKod, kod), eq(sokaklar.aktif, true)));

    return sonuclar[0] || null;
  }

  /**
   * Yeni sokak ekler.
   * @param {Object} sokakVerisi - { tenantId, sokakAdi, enlem, boylam, hmacImza, qrKod }
   * @returns {Promise<Object>} Eklenen sokak
   */
  async ekle(sokakVerisi) {
    const sonuc = await this.db
      .insert(sokaklar)
      .values({
        tenantId: sokakVerisi.tenantId,
        sokakAdi: sokakVerisi.sokakAdi,
        enlem: sokakVerisi.enlem,
        boylam: sokakVerisi.boylam,
        hmacImza: sokakVerisi.hmacImza,
        qrKod: sokakVerisi.qrKod,
      })
      .returning();

    return sonuc[0];
  }

  /**
   * Birden fazla sokağı toplu ekler (CSV import için).
   * @param {Array<Object>} sokakListesi - Sokak verileri dizisi
   * @returns {Promise<Array>} Eklenen sokaklar
   */
  async topluEkle(sokakListesi) {
    if (!sokakListesi || sokakListesi.length === 0) return [];

    return await this.db
      .insert(sokaklar)
      .values(sokakListesi)
      .returning();
  }

  /**
   * Sokağı günceller (yalnızca ilgili belediyeninkini).
   * @param {string} id - Sokak UUID'si
   * @param {number} tenantId
   * @param {Object} veriler - Güncellenecek alanlar
   * @returns {Promise<Object>} Güncellenen sokak
   */
  async guncelle(id, tenantId, veriler) {
    const sonuc = await this.db
      .update(sokaklar)
      .set(veriler)
      .where(and(eq(sokaklar.id, id), eq(sokaklar.tenantId, tenantId)))
      .returning();

    return sonuc[0] || null;
  }

  /**
   * Sokağı pasif yapar (soft delete - veriyi silmez, sadece gizler).
   * @param {string} id - Sokak UUID'si
   * @param {number} tenantId
   * @returns {Promise<Object>} Pasif yapılan sokak
   */
  async pasifYap(id, tenantId) {
    return this.guncelle(id, tenantId, { aktif: false });
  }
}
