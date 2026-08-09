import { and, eq, desc, inArray, isNotNull, lt } from 'drizzle-orm';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { personeller, personelBaglantiKodlari, birimKategoriler } from '@/lib/infrastructure/database/schema.js';
import { GuvenlikSabitleri, PersonelRolleri } from '@/lib/utils/constants.js';

/**
 * PersonelRepository - Saha Ekibi + Telegram Bağlantı Kodu Veritabanı İşlemleri
 *
 * AdminRepository desenini izler. MULTI-TENANT: personel CRUD sorguları tenant_id
 * ile filtrelenir. TEK İSTİSNA: `chatIdIleBul` ve `baglantiKoduBul` global'dir —
 * çünkü Telegram webhook'unda Host/subdomain yoktur; tenant, bağlanan personel
 * kaydından (token veya chat_id ile) ÇÖZÜLÜR. Token/chat_id zaten kimliği taşır.
 *
 * KRİTİK: Tüm WHERE koşulları tek `.where(and(...))` içinde (zincirleme .where()
 * filtreyi ezer — bkz. AdminRepository.js:85).
 */
export class PersonelRepository {
  constructor() {
    this.db = getDb();
  }

  // ===== Personel CRUD =====

  /**
   * Yeni personel oluşturur.
   * @param {string} [rol='personel'] - constants.PersonelRolleri
   * @param {string|null} [birimId=null] - Saha personeli için birim (başkan/yardımcıda null)
   * @returns {Promise<Object>}
   */
  async olustur(tenantId, ad, soyad, telefon = null, rol = PersonelRolleri.PERSONEL, birimId = null) {
    const sonuc = await this.db
      .insert(personeller)
      .values({ tenantId, ad, soyad, telefon: telefon || null, rol, birimId: birimId || null })
      .returning();
    return sonuc[0];
  }

  /** Personelin birimini değiştirir (yeniden atama). */
  async birimAta(id, tenantId, birimId) {
    const sonuc = await this.db
      .update(personeller)
      .set({ birimId: birimId || null })
      .where(and(eq(personeller.id, id), eq(personeller.tenantId, tenantId)))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * BİLDİRİM HEDEFLEME: Bir kategorinin şikayeti geldiğinde bildirilecek AKTİF +
   * Telegram'a BAĞLI saha personellerini döndürür. Personelin birimi, bu kategoriyi
   * kapsıyorsa (birim_kategoriler) hedeftir. Başkan/yardımcı BURAYA dahil DEĞİL (onlar
   * ayrı, her kategoriyi alır — rolPersonelleriGetir).
   * @returns {Promise<Array>} telegramChatId dolu personel kayıtları
   */
  async kategoriPersonelleriGetir(tenantId, kategori) {
    return await this.db
      .select({
        id: personeller.id,
        tenantId: personeller.tenantId,
        ad: personeller.ad,
        soyad: personeller.soyad,
        rol: personeller.rol,
        birimId: personeller.birimId,
        telegramChatId: personeller.telegramChatId,
      })
      .from(personeller)
      .innerJoin(
        birimKategoriler,
        and(
          eq(birimKategoriler.birimId, personeller.birimId),
          eq(birimKategoriler.tenantId, personeller.tenantId),
        ),
      )
      .where(and(
        eq(personeller.tenantId, tenantId),
        eq(personeller.aktif, true),
        eq(personeller.rol, PersonelRolleri.PERSONEL),
        isNotNull(personeller.telegramChatId),
        eq(birimKategoriler.kategori, kategori),
      ));
  }

  /**
   * BİLDİRİM HEDEFLEME: Verilen roldeki (başkan/yardımcı) AKTİF + Telegram'a BAĞLI
   * personelleri döndürür. Her yeni şikayet ve her çözüm bunlara bilgi olarak gider.
   * @param {string[]} roller
   */
  async rolPersonelleriGetir(tenantId, roller) {
    if (!roller || roller.length === 0) return [];
    return await this.db
      .select()
      .from(personeller)
      .where(and(
        eq(personeller.tenantId, tenantId),
        eq(personeller.aktif, true),
        inArray(personeller.rol, roller),
        isNotNull(personeller.telegramChatId),
      ));
  }

  /**
   * Bir belediyenin personellerini listeler.
   * @param {number} tenantId
   * @param {{sadeceAktif?: boolean}} [opts]
   * @returns {Promise<Array>}
   */
  async tenantPersonelleriGetir(tenantId, { sadeceAktif = true } = {}) {
    const kosul = sadeceAktif
      ? and(eq(personeller.tenantId, tenantId), eq(personeller.aktif, true))
      : eq(personeller.tenantId, tenantId);

    return await this.db
      .select()
      .from(personeller)
      .where(kosul)
      .orderBy(desc(personeller.olusturmaTarihi));
  }

  /**
   * ID ile personel getirir (yalnızca ilgili belediyeninkini).
   * @returns {Promise<Object|null>}
   */
  async idIleGetir(id, tenantId) {
    const sonuclar = await this.db
      .select()
      .from(personeller)
      .where(and(eq(personeller.id, id), eq(personeller.tenantId, tenantId)));
    return sonuclar[0] || null;
  }

  /**
   * Personeli pasifleştirir (soft delete). Telegram bağlantısını da koparır
   * (chat_id null) — pasif personel artık bildirim alamaz / işlem yapamaz.
   * @returns {Promise<Object|null>}
   */
  async pasifYap(id, tenantId) {
    const sonuc = await this.db
      .update(personeller)
      .set({ aktif: false, telegramChatId: null })
      .where(and(eq(personeller.id, id), eq(personeller.tenantId, tenantId)))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * Bir personele Telegram chat_id bağlar (/start onboarding sonrası).
   * Global benzersizlik nedeniyle, chat_id başka kayda bağlıysa DB unique
   * ihlali fırlatır — çağıran (TelegramService) yakalar.
   * @returns {Promise<Object|null>}
   */
  async chatIdBagla(personelId, chatId) {
    const sonuc = await this.db
      .update(personeller)
      .set({ telegramChatId: chatId })
      .where(eq(personeller.id, personelId))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * Telegram chat_id ile AKTİF personeli bulur (callback/komut çözümü için, global).
   * tenant_id dahil tüm kaydı döndürür → tenant bu kayıttan çözülür.
   * @returns {Promise<Object|null>}
   */
  async chatIdIleBul(chatId) {
    const sonuclar = await this.db
      .select()
      .from(personeller)
      .where(and(eq(personeller.telegramChatId, chatId), eq(personeller.aktif, true)));
    return sonuclar[0] || null;
  }

  // ===== Bağlantı kodu (Telegram /start) =====

  /**
   * Yeni bağlantı kodu kaydeder (tek kullanımlık, 48 saat).
   * @returns {Promise<Object>}
   */
  async baglantiKoduOlustur(tokenHash, tenantId, personelId) {
    const sonGecerlilikTarihi = new Date(Date.now() + GuvenlikSabitleri.TELEGRAM_BAGLANTI_KODU_SURESI_MS);
    const sonuc = await this.db
      .insert(personelBaglantiKodlari)
      .values({ tenantId, personelId, tokenHash, sonGecerlilikTarihi })
      .returning();
    return sonuc[0];
  }

  /**
   * Token hash'ine göre bağlantı kodunu bulur (global — token kimliği taşır,
   * tenant koddan çözülür; Host yok).
   * @returns {Promise<Object|null>}
   */
  async baglantiKoduBul(tokenHash) {
    const sonuclar = await this.db
      .select()
      .from(personelBaglantiKodlari)
      .where(eq(personelBaglantiKodlari.tokenHash, tokenHash));
    return sonuclar[0] || null;
  }

  /**
   * Bağlantı kodunu ATOMİK olarak "kullanıldı" yapar (tek-kullanımlık garantisi).
   * WHERE'e `kullanildi=false` eklidir: yalnız henüz kullanılmamışsa günceller ve satırı
   * döndürür. Eşzamanlı iki /start yarışırsa yalnız biri satır alır (RETURNING boş dönerse
   * kod zaten tüketilmiş → çağıran reddeder). magic-link'teki aynı TOCTOU düzeltmesiyle hizalı.
   * @returns {Promise<Object|null>} Claim başarılıysa satır, aksi halde null
   */
  async baglantiKoduKullanildiIsaretle(id) {
    const sonuc = await this.db
      .update(personelBaglantiKodlari)
      .set({ kullanildi: true, kullanilmaTarihi: new Date() })
      .where(and(eq(personelBaglantiKodlari.id, id), eq(personelBaglantiKodlari.kullanildi, false)))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * PERİYODİK İMHA: kullanılmış ya da süresi dolmuş personel bağlantı kodlarını siler.
   * Kod tek kullanımlık ve 48 saatlik; sonrasında saklamanın amacı yoktur.
   * @param {Date} esikTarih
   * @returns {Promise<number>}
   */
  async eskiBaglantiKodlariniSil(esikTarih) {
    const sonuc = await this.db
      .delete(personelBaglantiKodlari)
      .where(lt(personelBaglantiKodlari.olusturmaTarihi, esikTarih))
      .returning({ id: personelBaglantiKodlari.id });
    return sonuc.length;
  }
}
