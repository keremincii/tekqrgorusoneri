import { eq, desc, asc, and, notInArray, gte, lt, count, sql, isNotNull, inArray, ilike } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { sikayetler, sokaklar, personeller, engelliKimlikler } from '@/lib/infrastructure/database/schema.js';
import { ISikayetRepository } from '@/lib/domain/interfaces/ISikayetRepository.js';
import { SikayetDurumu, GORUNMEZ_DURUMLAR, KAPALI_DURUMLAR, durumKapaliMi } from '@/lib/utils/constants.js';

/**
 * LIKE joker karakterlerini (% _ \) kaçırır. Kaçırılmazsa "%" yazan bir arama tüm
 * tabloyu tarar ve "a_c" beklenmedik eşleşmeler döndürür — enjeksiyon değil (sorgu
 * parametrik) ama sorgu davranışını kullanıcı girdisine teslim etmek istemeyiz.
 * Kaçış karakteri ESCAPE ile açıkça bildirilir (bkz. panelListesiGetir).
 */
function likeKacis(metin) {
  return String(metin).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * SikayetRepository - Şikayet Veritabanı İşlemleri (Somut Implementasyon)
 *
 * ISikayetRepository arayüzünü implement eder (SOLID-D).
 * Parametrik sorgular kullanır → SQL Injection koruması (Defense in Depth).
 *
 * MULTI-TENANT: TÜM sorgular tenant_id ile filtrelenir/damgalanır. Bir WHERE
 * tenant_id unutulmaması için kontroller tek katmanda (burada) toplanmıştır.
 */
export class SikayetRepository extends ISikayetRepository {
  constructor() {
    super();
    this.db = getDb();
  }

  /**
   * Kara liste: kimlik_hash engelli mi? TENANT'TAN BAĞIMSIZDIR — bu dağıtımdaki
   * hiçbir belediyede, hangi belediye engellemiş olursa olsun, bu kimlik başvuru
   * gönderemez (bkz. schema.js engelliKimlikler açıklaması).
   * @returns {Promise<boolean>}
   */
  async engelliMi(kimlikHash) {
    if (!kimlikHash) return false;
    const r = await this.db
      .select({ id: engelliKimlikler.id })
      .from(engelliKimlikler)
      .where(eq(engelliKimlikler.kimlikHash, kimlikHash))
      .limit(1);
    return r.length > 0;
  }

  /**
   * Kara listeye ekler (idempotent — aynı hash zaten varsa yok sayılır). Global
   * kapsam nedeniyle tenantId ALINMAZ: hangi belediyeden tetiklenirse tetiklensin,
   * engel bu dağıtımın tamamına uygulanır.
   */
  async engelle(kimlikHash, sebep = null) {
    if (!kimlikHash) return false;
    await this.db
      .insert(engelliKimlikler)
      .values({ kimlikHash, sebep })
      .onConflictDoNothing();
    return true;
  }

  /** Bir şikayetin kimlik_hash'ini getirir (engelleme için; tenant izole). */
  async kimlikHashGetir(sikayetId, tenantId) {
    const r = await this.db
      .select({ kimlikHash: sikayetler.kimlikHash })
      .from(sikayetler)
      .where(and(eq(sikayetler.id, sikayetId), eq(sikayetler.tenantId, tenantId)))
      .limit(1);
    return r[0]?.kimlikHash || null;
  }

  /**
   * Yeni başvuru kaydeder.
   * @param {Object} veri - tenantId dahil. `durum` verilmezse `beklemede` yazılır;
   *   küfür filtresine takılan kayıtlar `moderasyonda` ile açılır (hiçbir listede/
   *   bildirimde görünmez, insan onayı bekler).
   * @returns {Promise<Object>} Kaydedilen başvuru
   */
  async olustur(veri) {
    const sonuc = await this.db
      .insert(sikayetler)
      .values({
        tenantId: veri.tenantId,
        // Başvuru türü: bu ürünün tek sınıflandırma ekseni (whitelist servis katmanında,
        // ayrıca DB'de CHECK kısıtıyla). `kategori` YAZILMAZ — vatandaşa sorulmuyor.
        tur: veri.tur,
        sokakId: veri.sokakId,
        kimlikHash: veri.kimlikHash,
        // KVKK veri minimizasyonu: ham ad/soyad/telefon saklanmaz (bkz. SikayetService).
        ad: veri.ad ?? null,
        soyad: veri.soyad ?? null,
        telefon: veri.telefon ?? null,
        // Çözüm SMS'i için şifreli telefon (yalnız belediye bayrağı açıksa dolu).
        telefonEnc: veri.telefonEnc ?? null,
        kvkkOnay: veri.kvkkOnay === true,
        kvkkOnayTarihi: veri.kvkkOnayTarihi ?? null,
        kvkkMetinSurumu: veri.kvkkMetinSurumu ?? null,
        aciklama: veri.aciklama,
        fotografUrl: veri.fotografUrl || null,
        // Konum yazılmaz: başvurunun yeri, ilişkili QR noktasının sabit koordinatıdır.
        // enlem/boylam/konum_* ve bildirilen_sokak_adi kolonları legacy → NULL/default.
        durum: veri.durum || SikayetDurumu.BEKLEMEDE,
      })
      .returning();

    return sonuc[0];
  }

  /**
   * ID ile şikayet getirir (yalnızca ilgili belediyeye ait olanı).
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @returns {Promise<Object|null>}
   */
  async idIleGetir(id, tenantId) {
    const sonuclar = await this.db
      .select()
      .from(sikayetler)
      .where(and(eq(sikayetler.id, id), eq(sikayetler.tenantId, tenantId)));

    return sonuclar[0] || null;
  }

  /**
   * Başkan panelinin gördüğü TEK kayıt biçimi (DTO). Hem liste hem de canlı akışta
   * (SSE) yollanan tekil kayıt bu şekli kullanır — iki ayrı `select` yazılsaydı, biri
   * güncellenip diğeri unutulduğunda panel "yenilenince değişen kart" hatası verirdi.
   * @private
   */
  _panelAlanlari(atanan, cozen) {
    return {
      id: sikayetler.id,
      tur: sikayetler.tur,
      aciklama: sikayetler.aciklama,
      fotografUrl: sikayetler.fotografUrl,
      durum: sikayetler.durum,
      olusturmaTarihi: sikayetler.olusturmaTarihi,
      // Okutulan QR noktasının adı. Tek QR'da hep aynıdır; kart altında küçük bir
      // bağlam satırı olarak durur. (coalesce: eski çok-QR kayıtlarında vatandaşın
      // bildirdiği ad varsa o gösterilir — bkz. schema.bildirilenSokakAdi.)
      noktaAdi: sql`coalesce(${sikayetler.bildirilenSokakAdi}, ${sokaklar.sokakAdi})`,
      // Atama/çözüm bilgisi (PERSONEL adları — vatandaş kimliği değil).
      atananPersonelId: sikayetler.atananPersonelId,
      atananPersonelAd: atanan.ad,
      atananPersonelSoyad: atanan.soyad,
      cozenPersonelAd: cozen.ad,
      cozenPersonelSoyad: cozen.soyad,
      cozulmeTarihi: sikayetler.cozulmeTarihi,
    };
  }

  /**
   * Panel listesi: silinmemiş/moderasyonda olmayan başvurular, en yeni önce.
   *
   * Filtreler SUNUCUDA uygulanır (istemcide değil): binlerce kayıt biriktiğinde
   * "hepsini indir, tarayıcıda filtrele" hem ağı hem düşük donanımlı bir tablette
   * paneli boğar. `sikayetler_tenant_tur_durum_tarih_idx` bu üç boyutu karşılar.
   *
   * @param {number} tenantId
   * @param {Object} [opts]
   * @param {string|null} [opts.tur] - Tek bir tür ('sikayet'|'gorus'|'oneri'); null = hepsi
   * @param {string[]|null} [opts.durumlar] - Gösterilecek durumlar; null = görünür olanların hepsi
   * @param {string} [opts.arama] - Başvuru metninde geçen ifade (ILIKE, jokerler kaçırılır)
   * @param {number} [opts.limit]
   * @param {number} [opts.offset]
   * @returns {Promise<Array>}
   */
  async panelListesiGetir(tenantId, { tur = null, durumlar = null, arama = '', limit = 200, offset = 0 } = {}) {
    // Aynı personeller tablosuna iki ayrı rol (atanan + çözen) için takma adlı
    // (aliased) LEFT JOIN. Panelde "kime atandı / kim çözdü" görünür.
    const atanan = alias(personeller, 'atanan');
    const cozen = alias(personeller, 'cozen');

    const kosullar = [
      eq(sikayetler.tenantId, tenantId),
      // MODERASYONDA olanlar panele DÜŞMEZ: küfür filtresine takılan kayıt yalnız
      // moderasyon botunda görünür, oradan onaylanınca `beklemede` olur ve buraya girer.
      notInArray(sikayetler.durum, GORUNMEZ_DURUMLAR),
    ];
    if (tur) kosullar.push(eq(sikayetler.tur, tur));
    if (durumlar?.length) kosullar.push(inArray(sikayetler.durum, durumlar));
    const q = String(arama || '').trim();
    if (q) kosullar.push(ilike(sikayetler.aciklama, sql`${'%' + likeKacis(q) + '%'} escape '\\'`));

    return await this.db
      .select(this._panelAlanlari(atanan, cozen))
      .from(sikayetler)
      .innerJoin(sokaklar, eq(sikayetler.sokakId, sokaklar.id))
      .leftJoin(atanan, eq(sikayetler.atananPersonelId, atanan.id))
      .leftJoin(cozen, eq(sikayetler.cozenPersonelId, cozen.id))
      .where(and(...kosullar))
      .orderBy(desc(sikayetler.olusturmaTarihi))
      .limit(limit)
      .offset(offset);
  }

  /**
   * TEK bir başvurunun panel DTO'su. Canlı akış (SSE) olayları bunu taşır: panel,
   * gelen kaydı listedekilerle aynı biçimde alır → yeniden yükleme gerekmez.
   * Tenant izolasyonu sorgunun içindedir.
   * @returns {Promise<Object|null>}
   */
  async panelKaydiGetir(id, tenantId) {
    const atanan = alias(personeller, 'atanan');
    const cozen = alias(personeller, 'cozen');

    const satirlar = await this.db
      .select(this._panelAlanlari(atanan, cozen))
      .from(sikayetler)
      .innerJoin(sokaklar, eq(sikayetler.sokakId, sokaklar.id))
      .leftJoin(atanan, eq(sikayetler.atananPersonelId, atanan.id))
      .leftJoin(cozen, eq(sikayetler.cozenPersonelId, cozen.id))
      .where(and(eq(sikayetler.id, id), eq(sikayetler.tenantId, tenantId)))
      .limit(1);

    return satirlar[0] || null;
  }

  /**
   * Panel rozetleri için (tür, durum) kırılımında SAYIM. Liste sayfalandığı için
   * sayaçlar yüklenen sayfadan hesaplanamaz: "3 bekleyen görüş" yazan bir rozetin,
   * ekranda o an 200 kayıt olsa da TÜM tabloyu yansıtması gerekir.
   * @returns {Promise<Array<{tur: string, durum: string, adet: number}>>}
   */
  async panelSayimlari(tenantId) {
    const satirlar = await this.db
      .select({ tur: sikayetler.tur, durum: sikayetler.durum, adet: count() })
      .from(sikayetler)
      .where(and(
        eq(sikayetler.tenantId, tenantId),
        notInArray(sikayetler.durum, GORUNMEZ_DURUMLAR),
      ))
      .groupBy(sikayetler.tur, sikayetler.durum);

    return satirlar.map((s) => ({ tur: s.tur, durum: s.durum, adet: Number(s.adet) || 0 }));
  }

  /**
   * Bir şikayeti bir personele atar (yalnızca ilgili belediyenin kaydını).
   * @returns {Promise<Object|null>}
   */
  async personelAta(sikayetId, tenantId, personelId) {
    const sonuc = await this.db
      .update(sikayetler)
      .set({ atananPersonelId: personelId })
      .where(and(eq(sikayetler.id, sikayetId), eq(sikayetler.tenantId, tenantId)))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * Bir şikayetin personel atamasını kaldırır.
   * @returns {Promise<Object|null>}
   */
  async personelAtamaKaldir(sikayetId, tenantId) {
    const sonuc = await this.db
      .update(sikayetler)
      .set({ atananPersonelId: null })
      .where(and(eq(sikayetler.id, sikayetId), eq(sikayetler.tenantId, tenantId)))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * ÇÖZÜM SMS'i İMHASI: sonuçlanmış ve üzerinden `esikTarih`ten fazla geçmiş kayıtların
   * şifreli telefonunu NULL'lar. KVKK: veri amacı bitince tutulmaz.
   *
   * Tenant filtresi YOKTUR (bilinçli): imha bir bakım görevidir ve TÜM belediyeler için
   * aynı anda çalışmalıdır; bir tenant'ı atlamak veriyi süresiz tutmak demek olurdu.
   * Sorgu, migration 0016'daki kısmi index'i (telefon_enc IS NOT NULL) kullanır.
   *
   * @param {Date} esikTarih - Bu tarihten ÖNCE sonuçlanmış kayıtlar temizlenir
   * @returns {Promise<number>} Temizlenen kayıt sayısı
   */
  async cozumTelefonlariniImhaEt(esikTarih) {
    const sonuc = await this.db
      .update(sikayetler)
      .set({ telefonEnc: null })
      .where(and(
        isNotNull(sikayetler.telefonEnc),
        isNotNull(sikayetler.cozulmeTarihi),
        lt(sikayetler.cozulmeTarihi, esikTarih),
      ))
      .returning({ id: sikayetler.id });
    return sonuc.length;
  }

  /**
   * PERİYODİK İMHA — 1/2: ANONİMLEŞTİRME.
   * Saklama süresi dolan başvurularda kimlik bağını koparır: kimlik_hash, şifreli
   * telefon ve fotoğraf referansı silinir. Kayıt SİLİNMEZ — tür/kategori/açıklama/
   * tarih/çözüm bilgisi belediyenin hizmet istatistiği olarak kalır, ama artık bir
   * kişiye bağlanamaz (kişisel veri olmaktan çıkar).
   *
   * Fotoğrafın kendisi R2'de durur; bu yüzden önce SİLİNECEK ANAHTARLAR döndürülür,
   * çağıran onları R2'den siler. Sıra bilinçli: DB'de referansı düşürüp R2'de dosyayı
   * bırakmak "silindi sanılan ama duran veri" üretir — en tehlikeli hâli.
   *
   * @param {Date} esikTarih - Bu tarihten ESKİ başvurular anonimleştirilir
   * @param {number} [limit=500] - Tek turda işlenecek en fazla kayıt (uzun kilit olmasın)
   * @returns {Promise<{adet: number, fotografAnahtarlari: string[]}>}
   */
  async anonimlestir(esikTarih, limit = 500) {
    const adaylar = await this.db
      .select({ id: sikayetler.id, fotografUrl: sikayetler.fotografUrl })
      .from(sikayetler)
      .where(and(
        isNotNull(sikayetler.kimlikHash),
        lt(sikayetler.olusturmaTarihi, esikTarih),
      ))
      .limit(limit);

    if (adaylar.length === 0) return { adet: 0, fotografAnahtarlari: [] };

    const idler = adaylar.map((a) => a.id);
    await this.db
      .update(sikayetler)
      .set({ kimlikHash: null, telefonEnc: null, fotografUrl: null, ad: null, soyad: null, telefon: null })
      .where(inArray(sikayetler.id, idler));

    return {
      adet: idler.length,
      fotografAnahtarlari: adaylar.map((a) => a.fotografUrl).filter(Boolean),
    };
  }

  /**
   * PERİYODİK İMHA — 2/2: KALICI SİLME.
   * Başkanın panelden sildiği (soft-delete) kayıtlar bugüne dek satır olarak
   * duruyordu. Bu süre sonunda satır ve fotoğrafı geri dönülemez biçimde silinir.
   *
   * @param {Date} esikTarih - Bu tarihten ÖNCE silinmiş kayıtlar kalıcı silinir
   * @returns {Promise<{adet: number, fotografAnahtarlari: string[]}>}
   */
  async silinenleriKaliciSil(esikTarih, limit = 500) {
    const adaylar = await this.db
      .select({ id: sikayetler.id, fotografUrl: sikayetler.fotografUrl })
      .from(sikayetler)
      .where(and(
        isNotNull(sikayetler.silinmeTarihi),
        lt(sikayetler.silinmeTarihi, esikTarih),
      ))
      .limit(limit);

    if (adaylar.length === 0) return { adet: 0, fotografAnahtarlari: [] };

    const idler = adaylar.map((a) => a.id);
    await this.db.delete(sikayetler).where(inArray(sikayetler.id, idler));

    return {
      adet: idler.length,
      fotografAnahtarlari: adaylar.map((a) => a.fotografUrl).filter(Boolean),
    };
  }

  /** PERİYODİK İMHA: yaşı dolan kara liste kayıtlarını siler (engel düşer). */
  async engellileriYaslandir(esikTarih) {
    const sonuc = await this.db
      .delete(engelliKimlikler)
      .where(lt(engelliKimlikler.olusturmaTarihi, esikTarih))
      .returning({ id: engelliKimlikler.id });
    return sonuc.length;
  }

  /**
   * Şikayeti "çözüldü" yapar VE çözen personeli + zamanı kaydeder (hesap
   * verebilirlik). cozen_personel_id bir kez yazılır.
   * @returns {Promise<Object|null>}
   */
  async cozenKaydet(sikayetId, tenantId, personelId, tarih) {
    const sonuc = await this.db
      .update(sikayetler)
      .set({
        durum: SikayetDurumu.COZULDU,
        cozenPersonelId: personelId,
        cozulmeTarihi: tarih,
      })
      .where(and(eq(sikayetler.id, sikayetId), eq(sikayetler.tenantId, tenantId)))
      .returning();
    return sonuc[0] || null;
  }

  /**
   * Bir personele atanmış AÇIK işleri (çözülmemiş/silinmemiş) sokak bilgisiyle
   * getirir. Telegram `/islerim` komutu kullanır.
   * @returns {Promise<Array>}
   */
  async personeleAtananAciklar(tenantId, personelId) {
    return await this.db
      .select({
        id: sikayetler.id,
        tur: sikayetler.tur,
        aciklama: sikayetler.aciklama,
        durum: sikayetler.durum,
        noktaAdi: sokaklar.sokakAdi,
        // Konum = QR noktasının CSV'den gelen sabit koordinatı.
        enlem: sokaklar.enlem,
        boylam: sokaklar.boylam,
      })
      .from(sikayetler)
      .innerJoin(sokaklar, eq(sikayetler.sokakId, sokaklar.id))
      .where(and(
        eq(sikayetler.tenantId, tenantId),
        eq(sikayetler.atananPersonelId, personelId),
        // Sonuçlanmış (KAPALI_DURUMLAR: cozuldu/uygulanacak/uygun_gorulmedi/iletildi)
        // ve görünmez (silindi/moderasyonda) kayıtlar "işlerim"de çıkmaz. Liste tek
        // otoriteden (constants.DurumSiniflari) türetilir → yeni bir kapanış durumu
        // eklendiğinde burası kendiliğinden doğru kalır.
        notInArray(sikayetler.durum, [...KAPALI_DURUMLAR, ...GORUNMEZ_DURUMLAR])
      ))
      .orderBy(desc(sikayetler.olusturmaTarihi));
  }

  /**
   * Küfür filtresine takılıp onay bekleyen (`moderasyonda`) kayıtları getirir.
   * Moderasyon botunun `/bekleyenler` komutu kullanır — özellikle bot sonradan
   * bağlandığında, o ana kadar birikmiş görünmez kayıtları kurtarmak için.
   *
   * TENANT FİLTRESİ YOK (bilinçli): moderasyon botu tek bir operatör sohbetine
   * hizmet eder ve o operatör sistemin sahibidir. Belediye başına ayrı moderasyon
   * sohbeti gerekirse buraya tenantId parametresi eklenmelidir.
   * @param {{limit?: number}} [opts]
   * @returns {Promise<Array>}
   */
  async moderasyondakileriGetir({ limit = 50 } = {}) {
    return await this.db
      .select({
        id: sikayetler.id,
        tenantId: sikayetler.tenantId,
        tur: sikayetler.tur,
        aciklama: sikayetler.aciklama,
        olusturmaTarihi: sikayetler.olusturmaTarihi,
        noktaAdi: sql`coalesce(${sikayetler.bildirilenSokakAdi}, ${sokaklar.sokakAdi})`,
      })
      .from(sikayetler)
      .innerJoin(sokaklar, eq(sikayetler.sokakId, sokaklar.id))
      .where(eq(sikayetler.durum, SikayetDurumu.MODERASYONDA))
      .orderBy(desc(sikayetler.olusturmaTarihi))
      .limit(limit);
  }

  /**
   * Şikayet durumunu günceller (yalnızca ilgili belediyenin kaydını).
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @param {string} yeniDurum - Yeni durum değeri
   * @returns {Promise<Object|null>}
   */
  async durumGuncelle(id, tenantId, yeniDurum) {
    // KAPANIŞ ZAMAN DAMGASI: Eskiden `cozulme_tarihi` yalnız Telegram'daki "Çözüldü"
    // butonu (cozenKaydet) tarafından yazılıyordu; PANELDEN kapatılan kayıtta boş
    // kalıyordu. Bu bir tutarsızlıktı ve artık gerçek bir soruna yol açar: çözüm
    // telefonunun ne zaman imha edileceği bu tarihe bakılarak belirleniyor — boş
    // kalırsa numara SONSUZA DEK durur. Kayıt tekrar açılırsa damga temizlenir.
    const kapaniyor = durumKapaliMi(yeniDurum);
    const sonuc = await this.db
      .update(sikayetler)
      .set({
        durum: yeniDurum,
        cozulmeTarihi: kapaniyor ? sql`coalesce(${sikayetler.cozulmeTarihi}, now())` : null,
      })
      .where(and(eq(sikayetler.id, id), eq(sikayetler.tenantId, tenantId)))
      .returning();

    return sonuc[0] || null;
  }

  /**
   * Belirli bir kimlik hash'inin son şikayet tarihini getirir (1 hafta kuralı).
   * @param {string} kimlikHash - doğrulanmış telefonun SHA-256 hash'i (NVİ açıkken
   *   ad+soyad+doğum+telefon kombinasyonu)
   * @param {number} tenantId
   * @returns {Promise<Date|null>} Son şikayet tarihi veya null
   */
  async sonSikayetTarihiniGetir(kimlikHash, tenantId) {
    const sonuclar = await this.db
      .select({ olusturmaTarihi: sikayetler.olusturmaTarihi })
      .from(sikayetler)
      .where(and(eq(sikayetler.kimlikHash, kimlikHash), eq(sikayetler.tenantId, tenantId)))
      .orderBy(desc(sikayetler.olusturmaTarihi))
      .limit(1);

    return sonuclar[0]?.olusturmaTarihi || null;
  }

  /**
   * Bir kimlik hash'inin verilen tarihten (pencere başlangıcı) bu yana attığı şikayet
   * sayısını döndürür. "Pencere başına en fazla N şikayet" limiti için (burst'e izin verir).
   *
   * DURUM FİLTRESİ YOK (bilinçli): `silindi` ve `moderasyonda` kayıtlar da kovayı
   * doldurur. Küfür filtresine takılan bir şikayet vatandaşın hakkını yakar — kötüye
   * kullanımın maliyetini kullanıcıya bindiren kasıtlı bir tercih. Aksi hâlde filtreyi
   * tetikleyen kişi sınırsız deneme hakkı kazanırdı.
   * @param {string} kimlikHash
   * @param {number} tenantId
   * @param {Date} pencereBaslangici - bu tarihten sonraki (dahil) kayıtlar sayılır
   * @returns {Promise<number>}
   */
  async pencereSikayetSayisiGetir(kimlikHash, tenantId, pencereBaslangici) {
    const sonuclar = await this.db
      .select({ adet: count() })
      .from(sikayetler)
      .where(and(
        eq(sikayetler.kimlikHash, kimlikHash),
        eq(sikayetler.tenantId, tenantId),
        gte(sikayetler.olusturmaTarihi, pencereBaslangici),
      ));

    return Number(sonuclar[0]?.adet || 0);
  }

  /**
   * Pencere içindeki EN ESKİ şikayetin tarihini döndürür. Limit dolduğunda kullanıcıya
   * doğru "ne zaman tekrar deneyebilir" süresini hesaplamak için: pencere, bu en eski
   * kayıt (en_eski + pencere_süresi) anında serbest kalır.
   * @param {string} kimlikHash
   * @param {number} tenantId
   * @param {Date} pencereBaslangici
   * @returns {Promise<Date|null>}
   */
  async enEskiPencereSikayetZamani(kimlikHash, tenantId, pencereBaslangici) {
    const sonuclar = await this.db
      .select({ olusturmaTarihi: sikayetler.olusturmaTarihi })
      .from(sikayetler)
      .where(and(
        eq(sikayetler.kimlikHash, kimlikHash),
        eq(sikayetler.tenantId, tenantId),
        gte(sikayetler.olusturmaTarihi, pencereBaslangici),
      ))
      .orderBy(asc(sikayetler.olusturmaTarihi))
      .limit(1);

    return sonuclar[0]?.olusturmaTarihi || null;
  }

  /**
   * Şikayeti soft-delete yapar (yalnızca ilgili belediyenin kaydını).
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @returns {Promise<Object|null>}
   */
  async softDelete(id, tenantId) {
    const sonuc = await this.db
      .update(sikayetler)
      .set({
        durum: SikayetDurumu.SILINDI,
        silinmeTarihi: new Date(),
      })
      .where(and(eq(sikayetler.id, id), eq(sikayetler.tenantId, tenantId)))
      .returning();

    return sonuc[0] || null;
  }
}
