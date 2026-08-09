import { pgTable, uuid, varchar, doublePrecision, boolean, timestamp, text, integer, serial, bigint, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Drizzle ORM Veritabanı Şeması
 *
 * Çok-belediyeli (multi-tenant) tek-veritabanı modeli:
 * - `tenantlar` tablosu her belediyenin kimliği + görünür ayarlarını tutar.
 * - Veri tabloları (`sokaklar`, `sikayetler`) ve kimlik tabloları
 *   (`magic_linkler`, `admin_oturumlar`) `tenant_id` ile bir belediyeye bağlanır.
 * - Tenant ASLA istemciden gelen değerle belirlenmez; sunucuda istek host'undan
 *   (subdomain) çözülür (bkz. lib/server/tenant.js).
 *
 * Defense in Depth (DB katmanı):
 * - UUID primary key → ID tahmin edilemez
 * - NOT NULL + Foreign key → tutarsız/eksik veri giremez
 * - tenant_id indexleri → belediyeler arası izolasyon hem hızlı hem zorunlu
 */

// ==========================================
// TENANTLAR (BELEDİYELER) TABLOSU
// ==========================================
export const tenantlar = pgTable('tenantlar', {
  /** Tenant kimliği (diğer tablolardaki tenant_id buna referans verir) */
  id: serial('id').primaryKey(),

  /** Subdomain etiketi: gulsehir.sikayet.com → "gulsehir" (benzersiz) */
  slug: varchar('slug', { length: 50 }).notNull().unique(),

  /** Görünür belediye adı (UI başlıkları + SMS metni) */
  ad: varchar('ad', { length: 150 }).notNull(),

  /**
   * Belediye başkanının adı soyadı (her tenant'ta farklı).
   * Vatandaşın şikayet sonrası gördüğü başarı ekranında imza olarak gösterilir.
   * Nullable: girilmezse başarı ekranı genel (imzasız) metne düşer.
   */
  baskanAdi: varchar('baskan_adi', { length: 150 }),

  /** Harita başlangıç merkezi - enlem (boşsa sokaklara göre otomatik ortalanır) */
  haritaEnlem: doublePrecision('harita_enlem'),

  /** Harita başlangıç merkezi - boylam */
  haritaBoylam: doublePrecision('harita_boylam'),

  /** Harita başlangıç yakınlığı */
  haritaZoom: integer('harita_zoom').default(14).notNull(),

  /**
   * PER-TENANT sabit görünüm kutusu (admin haritası açılışta TAM bu kutuyu gösterir +
   * dışına kilitlenir: maxBounds + minZoom). Dört köşe de doluysa etkin; boşsa harita
   * tenant merkez/zoom'una (yoksa sokak-otofit'e) düşer. Eskiden bu kutu build-time
   * global env'deydi (lib/config/site.js) → tüm belediyeler için AYNIYDI; artık her
   * belediye kendi kutusunu DB'de tutar. GB = güneybatı köşe (min enlem/boylam),
   * KD = kuzeydoğu köşe (max enlem/boylam).
   */
  sinirGbEnlem: doublePrecision('sinir_gb_enlem'),
  sinirGbBoylam: doublePrecision('sinir_gb_boylam'),
  sinirKdEnlem: doublePrecision('sinir_kd_enlem'),
  sinirKdBoylam: doublePrecision('sinir_kd_boylam'),

  /**
   * LEGACY — belediyenin idari SINIR poligonu (GeoJSON). Cihaz GPS anti-spoof
   * denetimi için kullanılıyordu; o özellik kaldırıldı (konum artık sokağın sabit
   * koordinatından gelir). Kolon geriye dönük uyumluluk için kalır (kullanılmaz).
   */
  sinirGeojson: jsonb('sinir_geojson'),

  /**
   * PER-TENANT NETGSM (her belediyenin kendi SMS hesabı). Üçü de doluysa o belediyenin
   * OTP'leri bu hesaptan gönderilir; boşsa global NETGSM_* env'ine düşülür (geriye uyum).
   * - usercode + header: sır DEĞİL (hesap kodu + onaylı gönderici başlığı; header zaten
   *   her SMS'te görünür) → düz saklanır.
   * - sifreEnc: Netgsm API ŞİFRESİ, AES-256-GCM ile ŞİFRELİ (lib/security/sifreleme.js;
   *   anahtar SIR_SIFRELEME_ANAHTARI env'inde, DB'de DEĞİL) → DB sızsa bile çözülemez.
   */
  netgsmUsercode: varchar('netgsm_usercode', { length: 50 }),
  netgsmSifreEnc: text('netgsm_sifre_enc'),
  netgsmHeader: varchar('netgsm_header', { length: 20 }),

  /**
   * NOT — KALDIRILMIŞ KOLONLAR: `tur_secimi_acik`, `tek_qr_modu` (0015) ve `basit_mod`
   * (0019) başvuru türü ekseni + basit mod profili için vardı; o özellikler tek bir
   * belediye (Derinkuyu) içindi ve iş ayrı bir projeye taşınınca koddan söküldü.
   * Kolonlar `drizzle/0020_derinkuyu_temizlik.sql` ile veritabanından da DÜŞÜRÜLDÜ.
   */

  /**
   * ÇÖZÜM SMS'i (migration 0016). Açıkken: şikayet sonuçlandığında vatandaşa
   * "çözüldü" SMS'i gider; bunun için numarası ŞİFRELİ saklanır (sikayetler.telefon_enc)
   * ve amaç bitince otomatik imha edilir.
   *
   * VARSAYILAN KAPALI ve bu bilinçlidir: numara saklamak KVKK açısından yeni bir
   * işleme faaliyetidir. Bayrak kapalı belediyede numara HİÇ saklanmaz ve aydınlatma
   * metninde o madde GÖRÜNMEZ → o belediye bugünkü veri-minimizasyonu durumunu korur.
   * Belediye isterse tek komutla açılır: scripts/tenant-bayrak.js <slug> --cozum-smsi-ac
   */
  cozumSmsiAcik: boolean('cozum_smsi_acik').default(false).notNull(),

  /**
   * KVKK BAŞVURU KANALLARI (migration 0017) — aydınlatma metninin "Haklarınız" bölümünde
   * gösterilir. KVKK m.10, ilgili kişiye haklarını NEREYE başvurarak kullanacağını da
   * söylemeyi gerektirir; genel ifade ("belediyenin resmî kanalları") denetimde
   * "aydınlatma eksik" bulgusuna açıktır. Belediyeler bu bilgiyi kendi yayımladıkları
   * metinlerde somut verir (posta adresi + KEP), biz de aynısını göstermeliyiz.
   *
   * Hepsi NULLABLE: doldurulmamış belediyede metin genel ifadeye düşer (davranış bozulmaz).
   */
  kvkkAdres: text('kvkk_adres'),
  kvkkKep: varchar('kvkk_kep', { length: 150 }),
  kvkkEposta: varchar('kvkk_eposta', { length: 150 }),
  kvkkSite: varchar('kvkk_site', { length: 255 }),

  /** Belediye aktif mi? (aboneliği biterse pasife alınır) */
  aktif: boolean('aktif').default(true).notNull(),

  /** Kayıt tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),
});

// ==========================================
// SOKAKLAR TABLOSU
// ==========================================
export const sokaklar = pgTable('sokaklar', {
  /** Benzersiz kimlik (UUID v4 - tahmin edilemez) */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediyeye ait */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /** Sokağın resmi adı (büyük harflerle) */
  sokakAdi: varchar('sokak_adi', { length: 200 }).notNull(),

  /** Sabit konum enlem (latitude) — CSV'den yüklenir. Şikayet haritada BURAYA düşer. */
  enlem: doublePrecision('enlem').notNull(),

  /** Sabit konum boylam (longitude) — CSV'den yüklenir. */
  boylam: doublePrecision('boylam').notNull(),

  /**
   * QR linki için HMAC-SHA256 imzası (seed anında üretilip yazılır).
   * NOT: Doğrulamada ARTIK KULLANILMAZ — imza `/q` yönlendiricisinde çalışan
   * secret'la canlı türetilir (lib/server/qr.js), böylece secret dönse bile QR'lar
   * bozulmaz. Kolon geriye dönük uyumluluk için tutulur (NOT NULL kalır).
   */
  hmacImza: varchar('hmac_imza', { length: 128 }).notNull(),

  /**
   * QR'a BASILAN kısa opak kod (base62, 8 hane). QR yönlendiricisi artık
   * `https://qr.<domain>/q/<qr_kod>` biçimini kullanır (UUID yerine) → aynı fiziksel
   * boyutta daha az modül = daha kolay okunur QR. UUID `id` iç kullanımda (FK, admin)
   * kalır; `qr_kod` yalnızca dışa basılan opak referanstır. Global UNIQUE (aşağıdaki
   * index) — /q araması tenant-bağımsızdır. Kolon migration 0010 ile eklenir/backfill'lenir.
   * Eski basılı UUID-QR'lar geriye dönük uyum için /q'da hâlâ çalışır.
   */
  qrKod: varchar('qr_kod', { length: 12 }),

  /**
   * Fiziksel QR tabelasının üstünde BASILI numara (Nokta_No: '0','1',…,'830' +
   * 'TOKI1'..'TOKI6'). Yalnızca gerçek hayatta levhası basılan sokaklarda dolu;
   * sonradan boşluk-analiziyle eklenen SANAL sokaklarda (levhası yok) NULL kalır —
   * yani NULL = "fiziksel tabelası yok" bilgisinin kendisi. Amaç: numara↔QR(sokak)
   * eşleşmesinin DB-tarafı kalıcı yedeği (tek kaynak basılı levha + CSV olmasın).
   * TOKI etiketleri metinsel olduğu için integer değil varchar.
   */
  tabelaNo: varchar('tabela_no', { length: 20 }),

  /** Sokak aktif mi? (soft delete için) */
  aktif: boolean('aktif').default(true).notNull(),

  /** Kayıt tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),
}, (t) => [
  index('sokaklar_tenant_aktif_idx').on(t.tenantId, t.aktif),
  // QR yönlendiricisi kodu global UNIQUE ile arar (tenant-bağımsız). Index'i
  // migration 0010 kurar; burada ORM'in de bilmesi için tekrar bildirilir.
  uniqueIndex('sokaklar_qr_kod_key').on(t.qrKod),
]);

// ==========================================
// ŞİKAYETLER TABLOSU
// ==========================================
export const sikayetler = pgTable('sikayetler', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediyeye ait */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /**
   * NOT — KALDIRILMIŞ KOLONLAR: `tur`, `hedef_birim_id`, `konum_belirtilmedi` (0015)
   * başvuru türü ekseniyle gelmişti; eksen söküldüğünde kolonlar da düşürüldü
   * (`drizzle/0020_derinkuyu_temizlik.sql`). Düşürmeden önce doğrulandı: tüm kayıtlar
   * varsayılan değerdeydi (`tur='sikayet'`, diğer ikisi boş) → bilgi kaybı YOK.
   */

  /** İlişkili sokak (Foreign Key). Şikayetin haritadaki KONUMU her zaman bu sokağın
   *  sabit koordinatıdır. */
  sokakId: uuid('sokak_id').references(() => sokaklar.id).notNull(),

  /**
   * Vatandaşın BİLDİRDİĞİ sokak adı (opsiyonel). Vatandaş, okuttuğu QR'ın sokağı yerine
   * sistemde KAYITLI OLMAYAN bir sokak seçtiğinde (ör. numara ±10 önerisinden uydurma bir
   * "5047. SOKAK") doldurulur: şikayet okutulan QR'ın konumunda kalır (sokakId değişmez),
   * ama haritada/panelde sokak adı olarak BU değer gösterilir. Kayıtlı bir sokak seçilirse
   * NULL kalır ve gösterimde sokaklar.sokak_adi kullanılır. Yalnız 'NNNN. SOKAK' biçimi kabul edilir.
   */
  bildirilenSokakAdi: varchar('bildirilen_sokak_adi', { length: 120 }),

  /**
   * Kimlik hash'i: ad + soyad + doğum yılı + telefon kombinasyonunun SHA-256'sı.
   * KVKK: TC kimlik numarası ASLA saklanmaz; yalnızca NVİ doğrulaması sırasında
   * anlık kullanılır. Bu hash sadece "haftada 1 şikayet" kuralı için, aynı kişiyi
   * tekrar tanımaya yarar.
   *
   * NULL OLABİLİR (migration 0018): saklama süresi dolan kayıtlarda periyodik imha
   * görevi bu bağı KOPARIR (anonimleştirme). Kayıt silinmez — kategori/açıklama
   * hizmet istatistiği olarak kalır, ama artık bir kişiye bağlanamaz. Sayım sorguları
   * `kimlik_hash = $1` ile çalıştığından NULL satırlar hiçbir limite dahil olmaz.
   */
  kimlikHash: varchar('kimlik_hash', { length: 64 }),

  /**
   * Kategori id'si (constants.SikayetKategorileri — 7 sabit id). Kategori→birim
   * eşleşmesi `birim_kategoriler` üzerinden kurulur (saha yönlendirmesi).
   */
  kategori: varchar('kategori', { length: 50 }).notNull(),

  /** Şikayet açıklaması */
  aciklama: text('aciklama').notNull(),

  /**
   * Fotoğraf URL'si (opsiyonel).
   * Şu an kullanılmıyor ama ileride fotoğraf yükleme eklendiğinde
   * veritabanı migration'a gerek kalmadan kullanıma hazır.
   */
  fotografUrl: varchar('fotograf_url', { length: 500 }),

  /**
   * LEGACY (cihaz GPS modeli) — ARTIK YAZILMAZ. Şikayetin haritadaki yeri, okutulan
   * sokağın (QR'ın) `sokaklar.enlem/boylam` sabit koordinatıdır; listeleme sorguları
   * doğrudan sokak koordinatını okur. Bu kolonlar geriye dönük uyumluluk için kalır ve
   * yeni kayıtlarda daima NULL/false olur (migration ile silinmedi — eski veriyi korur).
   */
  enlem: doublePrecision('enlem'),
  boylam: doublePrecision('boylam'),
  konumDogruluk: doublePrecision('konum_dogruluk'),
  konumKaynak: varchar('konum_kaynak', { length: 20 }),
  konumSupheli: boolean('konum_supheli').default(false).notNull(),

  /**
   * Vatandaşın adı/soyadı ve doğrulanmış telefonu.
   * KVKK: Bu kişisel veriler YALNIZCA açık rıza (kvkkOnay) ile saklanır. Amaç:
   * başkanın vatandaşa ulaşması + kötüye kullanım (troll) hâlinde delil. Telefon
   * SMS ile doğrulandığı için asıl delil odur; ad/soyad beyana dayalıdır.
   * Nullable: rıza öncesi/eski kayıtlar ve anonimleştirme (saklama süresi sonu) için.
   */
  ad: varchar('ad', { length: 100 }),
  soyad: varchar('soyad', { length: 100 }),
  telefon: varchar('telefon', { length: 20 }),

  /**
   * ÇÖZÜM SMS'i için vatandaşın telefonu — AES-256-GCM ile ŞİFRELİ (migration 0016).
   * Düz metin `telefon` kolonu v9'da bilinçle boşaltılmıştı ve öyle kalır; numara
   * yeniden düz yazılsaydı bir DB dump'ı tüm başvuranların numarasını açığa çıkarırdı.
   * Çözme anahtarı DB'de DEĞİL env'dedir (SIR_SIFRELEME_ANAHTARI).
   *
   * YALNIZ saha akışındaki türlerde (şikayet/talep) yazılır — öneri/teşekkürde
   * "çözüldü" bildirimi anlamsızdır, dolayısıyla numara da saklanmaz.
   *
   * KVKK: amaca bağlıdır. Kayıt sonuçlandıktan KisiselVeriSabitleri.IMHA_GUN gün
   * sonra otomatik NULL'lanır (SikayetService.cozumTelefonlariniImhaEt).
   */
  telefonEnc: text('telefon_enc'),

  /** KVKK açık rızası verildi mi? (true olmadan şikayet kaydedilmez) */
  kvkkOnay: boolean('kvkk_onay').default(false).notNull(),

  /** Açık rızanın alındığı an (KVKK ispat yükümlülüğü) */
  kvkkOnayTarihi: timestamp('kvkk_onay_tarihi'),

  /** Onaylanan Aydınlatma Metni sürümü (metin değişirse hangi sürüme onay verildiği bilinsin) */
  kvkkMetinSurumu: varchar('kvkk_metin_surumu', { length: 20 }),

  /** Şikayet durumu: beklemede | inceleniyor | cozuldu | silindi */
  durum: varchar('durum', { length: 20 }).default('beklemede').notNull(),

  /**
   * Şu anda bu şikayetten sorumlu saha personeli (NULL = atanmamış).
   * Başkan panelden atar; atanınca personele Telegram bildirimi gider.
   * Yeniden atanabilir (değişken); kim çözdüğü ayrı kolonda sabitlenir.
   */
  atananPersonelId: uuid('atanan_personel_id').references(() => personeller.id),

  /**
   * "Çözüldü"ye fiilen basan personel (hesap verebilirlik). Bir kez yazılır,
   * sonradan değişmez (atama değişse bile çözen sabit kalır). Başkan panelden
   * çözdüyse NULL kalır (panelden kapatıldığı anlamına gelir).
   */
  cozenPersonelId: uuid('cozen_personel_id').references(() => personeller.id),

  /** Çözüldü olarak işaretlendiği an (Telegram veya panel) */
  cozulmeTarihi: timestamp('cozulme_tarihi'),

  /** Oluşturulma tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),

  /** Silinme tarihi (soft delete - başkan "sil" dediğinde burayı dolar) */
  silinmeTarihi: timestamp('silinme_tarihi'),
}, (t) => [
  // Admin haritası sorgusu: tenant + durum + tarihe göre sıralı listeleme
  index('sikayetler_tenant_durum_tarih_idx').on(t.tenantId, t.durum, t.olusturmaTarihi),
  // 1 hafta kuralı sorgusu: tenant + kimlikHash
  index('sikayetler_tenant_kimlik_idx').on(t.tenantId, t.kimlikHash),
  // Personele atanmış işleri çekme sorgusu
  index('sikayetler_personel_idx').on(t.tenantId, t.atananPersonelId),
]);

// ==========================================
// MAGIC LINK TABLOSU (Admin Giriş)
// ==========================================
export const magicLinkler = pgTable('magic_linkler', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediyenin admin girişi */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /** 128 karakterlik tokenin SHA-256 hash'i (token kendisi asla saklanmaz!) */
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),

  /** Token kullanıldı mı? (Tek kullanımlık) */
  kullanildi: boolean('kullanildi').default(false).notNull(),

  /** Son geçerlilik tarihi (bu tarihten sonra link kullanılamaz) */
  sonGecerlilikTarihi: timestamp('son_gecerlilik_tarihi').notNull(),

  /** Bu linkin sahibi/etiketi (ör. "Başkan", "Başkan Yardımcısı", "Admin"). Girişte
   *  oturuma taşınır → kişisel veriye (kimlik görüntüleme) kimin eriştiği loglanabilsin
   *  (KVKK hesap verebilirlik). Eski kayıtlarda NULL. */
  etiket: varchar('etiket', { length: 40 }),

  /** Oluşturulma tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),

  /** Kullanılma tarihi */
  kullanilmaTarihi: timestamp('kullanilma_tarihi'),
});

// ==========================================
// ADMIN OTURUMLARI TABLOSU
// ==========================================
export const adminOturumlar = pgTable('admin_oturumlar', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediyenin oturumu (oturum yalnızca kendi belediyesinde geçerli) */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /** Oturum tokeninin SHA-256 hash'i */
  oturumHash: varchar('oturum_hash', { length: 64 }).notNull().unique(),

  /** Oturum aktif mi? */
  aktif: boolean('aktif').default(true).notNull(),

  /** Oturum sahibinin etiketi (magic link'ten taşınır: "Başkan"/"Başkan Yardımcısı"/
   *  "Admin"). Kimlik görüntüleme logunda "kim baktı" olarak kullanılır. Eski oturumlarda NULL. */
  etiket: varchar('etiket', { length: 40 }),

  /** Oluşturulma tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),

  /** Son erişim tarihi */
  sonErisimTarihi: timestamp('son_erisim_tarihi').defaultNow().notNull(),
}, (t) => [
  index('admin_oturumlar_tenant_hash_idx').on(t.tenantId, t.oturumHash),
]);

// ==========================================
// SMS DOĞRULAMA KODLARI TABLOSU
// (Şu an kodlar bellek içinde tutuluyor; tablo ileride kalıcı saklama için hazır)
// ==========================================
export const smsKodlari = pgTable('sms_kodlari', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Telefon numarasının hash'i */
  telefonHash: varchar('telefon_hash', { length: 64 }).notNull(),

  /** 6 haneli doğrulama kodu (hash'lenmez, kısa ömürlü) */
  kod: varchar('kod', { length: 6 }).notNull(),

  /** Kod doğrulandı mı? */
  dogrulandi: boolean('dogrulandi').default(false).notNull(),

  /** Son geçerlilik tarihi */
  sonGecerlilikTarihi: timestamp('son_gecerlilik_tarihi').notNull(),

  /** Oluşturulma tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),
});

// ==========================================
// SMS GÖNDERİM AUDİT LOG TABLOSU
// (kötüye kullanım tespiti + adli iz — her gönderim denemesi kaydedilir)
// ==========================================
export const smsGonderimLog = pgTable('sms_gonderim_log', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediye (tenant). Nullable: tenant çözülemeden reddedilen istekler için. */
  tenantId: integer('tenant_id').references(() => tenantlar.id),

  /**
   * Telefon numarasının SHA-256 hash'i (KVKK: ham numara SAKLANMAZ). Aynı numarayı
   * tekrar tanımaya + anomali tespitine yarar. Nullable: geçersiz telefon denemesi.
   */
  telefonHash: varchar('telefon_hash', { length: 64 }),

  /**
   * İstemci IP'sinin SHA-256 hash'i (KVKK: ham IP saklanmaz; korelasyon için hash).
   * "Aynı IP birçok numara deniyor" gibi tarama saldırılarını tespit etmeye yarar.
   */
  ipHash: varchar('ip_hash', { length: 64 }),

  /** Sonuç: 'gonderildi' | 'throttle' | 'kesici' | 'turnstile' | 'gecersiz' | 'sms_hata' | 'hedef' | 'datacenter' */
  sonuc: varchar('sonuc', { length: 20 }).notNull(),

  /** Reddedilme sebebi (varsa): cooldown, ip_hafta_farkli, ip_hafta_toplam, global_kesici, hedef, ... */
  sebep: varchar('sebep', { length: 30 }),

  /** Kayıt zamanı */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),
}, (t) => [
  // Anomali/adli sorgular: tenant + zaman, ve IP + zaman (aynı IP'den seri deneme)
  index('sms_log_tenant_tarih_idx').on(t.tenantId, t.olusturmaTarihi),
  index('sms_log_ip_tarih_idx').on(t.ipHash, t.olusturmaTarihi),
]);

// ==========================================
// PERSONELLER (SAHA EKİBİ) TABLOSU
// ==========================================
export const personeller = pgTable('personeller', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediyenin personeli */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /** Personelin adı (başkanın panelde gördüğü; vatandaşa gösterilmez) */
  ad: varchar('ad', { length: 100 }).notNull(),

  /** Personelin soyadı */
  soyad: varchar('soyad', { length: 100 }).notNull(),

  /** İletişim telefonu (opsiyonel; bilgi amaçlı) */
  telefon: varchar('telefon', { length: 20 }),

  /**
   * Rol (constants.PersonelRolleri): 'personel' (saha ekibi, bir birime bağlı) |
   * 'baskan' | 'baskan_yardimcisi'. Başkan/yardımcı birime bağlı DEĞİL; HER yeni
   * şikayetin ve HER çözümün bilgi bildirimini alır. Migration 0011 ile eklendi.
   */
  rol: varchar('rol', { length: 20 }).default('personel').notNull(),

  /**
   * Bağlı olduğu birim (yalnızca rol='personel' için anlamlı). Şikayet kategorisi bu
   * birimin kapsadığı kategorilerden biriyse personele otomatik bildirim gider.
   * NULL = başkan/yardımcı (birim yok) veya henüz birime atanmamış personel.
   */
  birimId: uuid('birim_id'),

  /**
   * Telegram kullanıcı/sohbet kimliği. /start <token> ile bot'a bağlanınca dolar.
   * NULL = personel henüz Telegram'a bağlanmadı → bildirim gönderilemez.
   * Tek bot tüm belediyelere hizmet ettiği için global benzersiz: bir Telegram
   * kullanıcısı yalnızca tek personel kaydına bağlanabilir.
   * Telegram ID'leri en fazla 52 bit (JS Number güvenli aralığında).
   */
  telegramChatId: bigint('telegram_chat_id', { mode: 'number' }).unique(),

  /** Personel aktif mi? (soft delete / işten ayrılma) */
  aktif: boolean('aktif').default(true).notNull(),

  /** Kayıt tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),
}, (t) => [
  index('personeller_tenant_aktif_idx').on(t.tenantId, t.aktif),
]);

// ==========================================
// PERSONEL BAĞLANTI KODLARI (Telegram /start onboarding)
// (magic_linkler deseninin personel karşılığı — tek kullanımlık, süreli, hash'li)
// ==========================================
export const personelBaglantiKodlari = pgTable('personel_baglanti_kodlari', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediyenin kodu */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /** Hangi personeli Telegram'a bağlayacak */
  personelId: uuid('personel_id').references(() => personeller.id).notNull(),

  /** Token'ın SHA-256 hash'i (token kendisi asla saklanmaz — derin linkte yaşar) */
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),

  /** Kod kullanıldı mı? (tek kullanımlık) */
  kullanildi: boolean('kullanildi').default(false).notNull(),

  /** Son geçerlilik tarihi (48 saat) */
  sonGecerlilikTarihi: timestamp('son_gecerlilik_tarihi').notNull(),

  /** Oluşturulma tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),

  /** Kullanılma tarihi */
  kullanilmaTarihi: timestamp('kullanilma_tarihi'),
});

// ==========================================
// BİRİMLER (DEPARTMANLAR) TABLOSU
// ==========================================
// Otomatik atama için: her birim bir veya birden çok şikayet kategorisini kapsar
// (birim_kategoriler). Yeni şikayet gelince kategoriye bakılıp ilgili birimin
// personellerine otomatik Telegram bildirimi gider. Migration 0011 ile eklendi.
export const birimler = pgTable('birimler', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediyenin birimi */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /** Birim adı (ör. "Temizlik İşleri", "Fen İşleri", "Zabıta") */
  ad: varchar('ad', { length: 120 }).notNull(),

  /** Birim aktif mi? (soft delete) */
  aktif: boolean('aktif').default(true).notNull(),

  /** Kayıt tarihi */
  olusturmaTarihi: timestamp('olusturma_tarihi').defaultNow().notNull(),
}, (t) => [
  index('birimler_tenant_aktif_idx').on(t.tenantId, t.aktif),
]);

// ==========================================
// BİRİM ↔ KATEGORİ EŞLEŞMESİ
// ==========================================
// Hangi şikayet kategorisi hangi birime yönlenir. Bir kategori birden ÇOK birime
// atanabilir (ör. "Yol" hem Fen İşleri hem Zabıta) → bildirim o kategoriyi kapsayan
// tüm birimlerin personeline gider. Unique yalnız aynı birimde tekrarı engeller.
export const birimKategoriler = pgTable('birim_kategoriler', {
  /** Benzersiz kimlik */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Hangi belediye */
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),

  /** Hangi birim */
  birimId: uuid('birim_id').references(() => birimler.id).notNull(),

  /** Kategori id'si (constants.SikayetKategorileri'nden) */
  kategori: varchar('kategori', { length: 50 }).notNull(),
}, (t) => [
  // Aynı birimde aynı kategori bir kez (farklı birimlerde tekrarı serbest).
  uniqueIndex('birim_kategori_tenant_birim_kategori_key').on(t.tenantId, t.birimId, t.kategori),
  // Kategoriye göre birim arama (yönlendirme/yetki) — birden çok satır dönebilir.
  index('birim_kategori_tenant_kategori_idx').on(t.tenantId, t.kategori),
  index('birim_kategori_birim_idx').on(t.birimId),
]);

/**
 * Engelli kimlikler (kara liste). Başkan bir şikayette "Engelle" derse, o şikayetin
 * kimlik_hash'i (telefonun tek yönlü SHA-256 hash'i) buraya eklenir → o numara bir daha
 * SMS kodu / şikayet gönderemez. Ham telefon/isim SAKLANMAZ; engelleme yalnız hash iledir
 * (KVKK veri minimizasyonu). Migration: drizzle/0013_engelli_kimlikler.sql (elle/idempotent).
 */
export const engelliKimlikler = pgTable('engelli_kimlikler', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').references(() => tenantlar.id).notNull(),
  kimlikHash: varchar('kimlik_hash', { length: 64 }).notNull(),
  sebep: varchar('sebep', { length: 200 }),
  olusturmaTarihi: timestamp('olusturma_tarihi').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('engelli_kimlikler_tenant_hash_uniq').on(t.tenantId, t.kimlikHash),
]);
