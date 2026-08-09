import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { magicLinkler, adminOturumlar } from '@/lib/infrastructure/database/schema.js';
import { GuvenlikSabitleri } from '@/lib/utils/constants.js';

/**
 * AdminRepository - Admin Oturum ve Magic Link Veritabanı İşlemleri
 * 
 * Single Responsibility: Sadece admin kimlik doğrulama verileriyle ilgilenir.
 */
export class AdminRepository {
  constructor() {
    this.db = getDb();
  }

  /**
   * Yeni magic link kaydeder.
   * @param {string} tokenHash - Tokenin SHA-256 hash'i
   * @returns {Promise<Object>}
   */
  async magicLinkOlustur(tokenHash, tenantId, etiket = null) {
    const sonGecerlilikTarihi = new Date(Date.now() + GuvenlikSabitleri.MAGIC_LINK_SURESI_MS);
    const sonuc = await this.db
      .insert(magicLinkler)
      .values({ tenantId, tokenHash, sonGecerlilikTarihi, etiket })
      .returning();

    return sonuc[0];
  }

  /**
   * Token hash'ine göre magic link'i bulur (yalnızca ilgili belediyeninkini).
   * @param {string} tokenHash
   * @param {number} tenantId
   * @returns {Promise<Object|null>}
   */
  async magicLinkBul(tokenHash, tenantId) {
    const sonuclar = await this.db
      .select()
      .from(magicLinkler)
      .where(and(eq(magicLinkler.tokenHash, tokenHash), eq(magicLinkler.tenantId, tenantId)));

    return sonuclar[0] || null;
  }

  /**
   * Magic link'i ATOMİK olarak "kullanıldı" yapar (tek kullanımlık garantisi).
   * WHERE'e `kullanildi=false` şartı eklidir: yalnızca HENÜZ kullanılmamışsa günceller
   * ve satırı döndürür. Eşzamanlı iki istekte tek biri satır alır (RETURNING boş dönerse
   * link zaten tüketilmiş → çağıran reddeder). TOCTOU (oku-sonra-yaz) yarışını kapatır.
   * @param {string} id - Magic link UUID'si
   * @returns {Promise<Object|null>} Claim başarılıysa satır, aksi halde null
   */
  async magicLinkKullanildiIsaretle(id) {
    const sonuc = await this.db
      .update(magicLinkler)
      .set({
        kullanildi: true,
        kullanilmaTarihi: new Date(),
      })
      .where(and(eq(magicLinkler.id, id), eq(magicLinkler.kullanildi, false)))
      .returning();

    return sonuc[0] || null;
  }

  /**
   * Yeni admin oturumu oluşturur.
   * @param {string} oturumHash - Oturum tokeninin SHA-256 hash'i
   * @returns {Promise<Object>}
   */
  async oturumOlustur(oturumHash, tenantId, etiket = null) {
    const sonuc = await this.db
      .insert(adminOturumlar)
      .values({ oturumHash, tenantId, etiket })
      .returning();

    return sonuc[0];
  }

  /**
   * Oturum hash'ine göre aktif oturumu bulur (yalnızca ilgili belediyede).
   * @param {string} oturumHash
   * @param {number} tenantId
   * @returns {Promise<Object|null>}
   */
  async aktifOturumBul(oturumHash, tenantId) {
    // KRİTİK: Koşullar TEK bir .where() içinde and() ile birleştirilmeli.
    // Zincirleme .where().where() kullanılırsa Drizzle ikinci koşulu ilkinin
    // ÜZERİNE yazar (filtre düşer) → kimlik doğrulama / tenant bypass'ı.
    const sonuclar = await this.db
      .select()
      .from(adminOturumlar)
      .where(and(
        eq(adminOturumlar.oturumHash, oturumHash),
        eq(adminOturumlar.tenantId, tenantId),
        eq(adminOturumlar.aktif, true)
      ));

    return sonuclar[0] || null;
  }

  /**
   * Son erişim tarihini günceller.
   * @param {string} id - Oturum UUID'si
   */
  async sonErisimiGuncelle(id) {
    await this.db
      .update(adminOturumlar)
      .set({ sonErisimTarihi: new Date() })
      .where(eq(adminOturumlar.id, id));
  }

  /**
   * Oturumu iptal eder (aktif=false). Çıkış (logout) ve süresi dolan
   * oturumların geçersiz kılınması için kullanılır.
   * @param {string} id - Oturum UUID'si
   */
  async oturumIptalEt(id) {
    await this.db
      .update(adminOturumlar)
      .set({ aktif: false })
      .where(eq(adminOturumlar.id, id));
  }

  /**
   * PERİYODİK İMHA: kullanılmış ya da süresi dolmuş magic link kayıtlarını siler.
   * Belirteç işe yaramaz hâle geldikten sonra saklamanın amacı yoktur; kayıt
   * hangi etiketin (Başkan/Yardımcı/Admin) ne zaman giriş yaptığını da taşır.
   * @param {Date} esikTarih - Bu tarihten ESKİ üretilmiş kayıtlar silinir
   * @returns {Promise<number>}
   */
  async eskiMagicLinkleriSil(esikTarih) {
    const sonuc = await this.db
      .delete(magicLinkler)
      .where(lt(magicLinkler.olusturmaTarihi, esikTarih))
      .returning({ id: magicLinkler.id });
    return sonuc.length;
  }
}
