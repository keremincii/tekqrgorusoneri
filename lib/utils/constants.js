/**
 * Uygulama genelinde kullanılan sabit değerler.
 * Tüm "sihirli sayılar" ve konfigürasyonlar tek merkezden yönetilir (DRY prensibi).
 */

/**
 * GENEL RED MESAJI — güvenlik/kötüye-kullanım katmanlarına (engelleme, haftalık limit,
 * IP/cihaz throttle, gönderim sınırı, cooldown, global kesici) takılan istekler için TEK
 * TİP belirsiz kullanıcı mesajı. Amaç: saldırgan hangi mekanizmaya (engelli mi? limit mi?
 * cihaz mı?) takıldığını AYIRT EDEMESİN → mekanizmayı çözüp yönlü saldırı yapamasın.
 * Girdi doğrulama hataları (geçersiz telefon/kod) bu KAPSAMDA DEĞİL — onlar dürüst
 * kullanıcının hatasını düzeltmesi için özgül kalır.
 */
export const GENEL_RED_MESAJI = 'Şu anda işleminizi gerçekleştiremiyoruz. Lütfen bir süre sonra tekrar deneyin.';

/** Şikayet durumları (enum benzeri sabit nesne, dışarıdan değiştirilemez) */
export const SikayetDurumu = Object.freeze({
  BEKLEMEDE: 'beklemede',
  INCELENIYOR: 'inceleniyor',
  COZULDU: 'cozuldu',
  SILINDI: 'silindi',
  /**
   * Küfür filtresine takıldı → İNSAN ONAYI BEKLİYOR. Kayıt vardır ama HİÇBİR YERDE
   * görünmez: haritaya/panele düşmez, saha personeline ve başkana Telegram bildirimi
   * GİTMEZ. Yalnız ayrı moderasyon botuna düşer; oradaki "normal şikayet olarak ilet"
   * butonu durumu `beklemede`ye çevirip normal bildirim akışını başlatır.
   * Vatandaş bunu bilmez — ona sıradan başarı yanıtı döner (filtre kalibre ettirilmez).
   */
  MODERASYONDA: 'moderasyonda',
});

/**
 * Durumun HAYAT DÖNGÜSÜ SINIFI. Kod hiçbir yerde durum değerlerini tek tek
 * saymasın diye tek otorite burasıdır: yeni bir durum eklendiğinde yalnız
 * DurumSiniflari güncellenir, listeleme/sayım/filtre mantığı kendiliğinden doğrulanır.
 * - ACIK    : henüz ele alınmadı (rozet/sayaçlarda "açık")
 * - ISLEMDE : ele alındı, sürüyor
 * - KAPALI  : sonuçlandı (çözüldü)
 * - GIZLI   : hiçbir listede görünmez (silinmiş / moderasyon bekleyen)
 */
export const DurumSinifi = Object.freeze({
  ACIK: 'acik',
  ISLEMDE: 'islemde',
  KAPALI: 'kapali',
  GIZLI: 'gizli',
});

/** durum değeri → DurumSinifi eşlemesi (tek otorite). */
export const DurumSiniflari = Object.freeze({
  [SikayetDurumu.BEKLEMEDE]: DurumSinifi.ACIK,
  [SikayetDurumu.INCELENIYOR]: DurumSinifi.ISLEMDE,
  [SikayetDurumu.COZULDU]: DurumSinifi.KAPALI,
  [SikayetDurumu.SILINDI]: DurumSinifi.GIZLI,
  [SikayetDurumu.MODERASYONDA]: DurumSinifi.GIZLI,
});

/** Hiçbir listede/haritada/bildirimde görünmeyen durumlar (SQL notInArray için). */
export const GORUNMEZ_DURUMLAR = Object.freeze([SikayetDurumu.SILINDI, SikayetDurumu.MODERASYONDA]);

/** Sonuçlanmış (artık "iş listesinde" olmayan) durumlar (SQL notInArray için). */
export const KAPALI_DURUMLAR = Object.freeze(
  Object.keys(DurumSiniflari).filter((d) => DurumSiniflari[d] === DurumSinifi.KAPALI)
);

/** Bir durum sonuçlanmış mı? (panel rozetleri, "açık iş" sayımı) */
export function durumKapaliMi(durum) {
  return DurumSiniflari[durum] === DurumSinifi.KAPALI;
}

/**
 * ===================== BAŞVURU TÜRÜ — ÜRÜNÜN TEK EKSENİ =====================
 *
 * Bu üründe vatandaşa KATEGORİ SORULMAZ. Tek merkezî QR olduğu için "hangi sokak"
 * sorusunun anlamı olmadığı gibi, 7 başlıklı bir kategori listesi de vatandaşı
 * gereksiz bir sınıflandırma kararına zorluyordu: yazacağı şey zaten konuyu söylüyor.
 * Geriye TEK bir ayrım kalır — başvurunun NİTELİĞİ:
 *
 *   şikayet → aksayan bir durum var, düzeltilmesi bekleniyor
 *   görüş   → bir konudaki düşüncesi; aksiyon şart değil
 *   öneri   → ilçe için bir fikir
 *
 * Üçü de AYNI akışı ve aynı tabloyu kullanır (`sikayetler.tur`); ayrım yalnız
 * başkanın panelinde sekme/rozet olarak görünür. Tür whitelist'i hem burada hem
 * DB'de (CHECK kısıtı, bkz. drizzle/0000_init.sql) uygulanır → uygulama katmanı
 * atlansa bile tutarsız tür yazılamaz.
 *
 * Yeni bir tür eklemek: buraya bir satır + DB CHECK kısıtının güncellenmesi.
 * Frontend, API, validator ve panel bu listeden okur (Single Source of Truth).
 */
export const BasvuruTurleri = Object.freeze([
  Object.freeze({
    id: 'sikayet',
    etiket: 'Şikayet',
    // `iyelik` ("sizin ...-iniz" hâli) AYRI BİR ALANDIR, hesaplanmaz. Etikete ek
    // yapıştırmak (etiket + 'iniz') Türkçede ÇALIŞMAZ: ünlü uyumu ve ünlüyle biten
    // kökler yüzünden "Görüşiniz" ve "Öneriiniz" gibi bozuk sonuçlar üretir. Dil
    // kuralını koda gömmek yerine doğru biçimi tek otoritede yazıyoruz.
    iyelik: 'Şikayetiniz',
    ikon: '⚠️',
    renk: '#f43f5e',
    aciklama: 'Bozuk, eksik veya aksayan bir durum',
    ornek: 'Örn: Sokak lambası üç gündür yanmıyor.',
  }),
  Object.freeze({
    id: 'gorus',
    etiket: 'Görüş',
    iyelik: 'Görüşünüz',
    ikon: '💬',
    renk: '#38bdf8',
    aciklama: 'Bir konudaki düşünceniz',
    ornek: 'Örn: Pazar yerinin yeni düzeni çok daha kullanışlı oldu.',
  }),
  Object.freeze({
    id: 'oneri',
    etiket: 'Öneri',
    iyelik: 'Öneriniz',
    ikon: '💡',
    renk: '#fbbf24',
    aciklama: 'İlçe için bir fikriniz',
    ornek: 'Örn: Park girişine bisiklet park yeri yapılabilir.',
  }),
]);

/** Varsayılan tür (form ilk açıldığında seçili gelir; DB kolon varsayılanıyla aynı). */
export const VARSAYILAN_TUR = 'sikayet';

/** tür id → tür kaydı (hızlı erişim; panel ve bildirim metinleri bunu kullanır). */
export const TurTablosu = Object.freeze(
  Object.fromEntries(BasvuruTurleri.map((t) => [t.id, t]))
);

/** Tür whitelist kontrolü (istemciden sahte tür gelemez). */
export function turGecerliMi(turId) {
  return typeof turId === 'string' && Object.hasOwn(TurTablosu, turId);
}

/** Tür etiketi ("Şikayet"). Bilinmeyen türde id'nin kendisi döner. */
export function turEtiketi(turId) {
  return TurTablosu[turId]?.etiket || turId;
}

/** Tür etiketi ikonla ("⚠️ Şikayet") — Telegram/panel başlıkları için. */
export function turIkonluEtiket(turId) {
  const t = TurTablosu[turId];
  return t ? `${t.ikon} ${t.etiket}` : '📌 Başvuru';
}

/**
 * ===================== ŞİKAYET DURUM SÖZLEŞMESİ =====================
 * Şikayetin hayat döngüsü: Bekliyor → İnceleniyor → Çözüldü.
 *
 * SIRA ANLAMLIDIR: panelin durum butonları (sonrakiDurumlar) ve rozet metinleri
 * bu diziden TÜRETİLİR — durum makinesi hiçbir arayüzde ikinci kez yazılmaz.
 * Yeni bir durum eklenirse yalnız burası (+ DurumSiniflari) güncellenir.
 */
const DURUM_RENKLERI = Object.freeze({
  [DurumSinifi.ACIK]: '#dc2626',    // kırmızı — bekliyor
  [DurumSinifi.ISLEMDE]: '#d97706', // turuncu — sürüyor
  [DurumSinifi.KAPALI]: '#16a34a',  // yeşil — sonuçlandı
});

/** Bir durum listesi girdisi üretir (sınıf/renk DurumSiniflari'ndan çözülür). */
function durum(id, etiket) {
  const sinif = DurumSiniflari[id];
  return Object.freeze({ id, etiket, sinif, renk: DURUM_RENKLERI[sinif] });
}

/** Şikayetin durum sözlüğü — panelin gösterdiği sıra ve metinler. */
export const SikayetDurumlari = Object.freeze([
  durum(SikayetDurumu.BEKLEMEDE, 'Bekliyor'),
  durum(SikayetDurumu.INCELENIYOR, 'İnceleniyor'),
  durum(SikayetDurumu.COZULDU, 'Çözüldü'),
]);

/**
 * Bir kaydın MEVCUT durumundan gidilebilecek durumlar (panel butonları).
 *  - Sıradaki adım yalnız BİR tanedir → aşama atlanamaz ("Bekliyor"dan doğrudan
 *    "Çözüldü"ye geçilmez).
 *  - Kayıt zaten KAPANMIŞSA dizi boş döner → hiç buton çizilmez; sonuçlanmış bir
 *    kaydın kararı panelden geri alınmaz.
 */
export function sonrakiDurumlar(mevcutDurum) {
  const idx = SikayetDurumlari.findIndex((d) => d.id === mevcutDurum);
  if (idx < 0 || SikayetDurumlari[idx].sinif === DurumSinifi.KAPALI) return [];
  const sonraki = SikayetDurumlari[idx + 1];
  return sonraki ? [sonraki] : [];
}

/** Bir durum, sözlükte var mı? (panel/API durum güncelleme doğrulaması) */
export function durumGecerliMi(durumId) {
  return SikayetDurumlari.some((d) => d.id === durumId);
}

/** Durum etiketi (panelde gösterilen metin). Bulunamazsa durum id'si döner. */
export function durumEtiketi(durumId) {
  return SikayetDurumlari.find((d) => d.id === durumId)?.etiket || durumId;
}

/**
 * ===================== BEKLEME SÜRESİ (İHMAL GÖSTERGESİ) =====================
 * Yöneticinin panelde araması gereken şey YIĞILMA değil İHMAL'dir: bugün gelen on
 * başvuru, üç haftadır cevapsız bekleyen tek başvurudan daha az acildir. Bu yüzden
 * açık her kaydın kenarında, "ne kadar süredir bekliyor?" sorusunu tek bakışta
 * yanıtlayan bir yaş rozeti vardır ve rengi bu kademelerden gelir.
 *
 * Eşik ekleme/çıkarma yalnız bu listeyi değiştirmeyi gerektirir; kademeyi çözen
 * fonksiyon (yasKademesi) listeden türetildiği için kendiliğinden doğru kalır.
 */
export const YasKademeleri = Object.freeze([
  Object.freeze({ id: 'yeni', enAzGun: 0, etiket: 'Yeni', renk: '#38bdf8', aciklama: 'Son 5 gün içinde geldi' }),
  Object.freeze({ id: 'bekliyor', enAzGun: 5, etiket: '5 gün+', renk: '#fbbf24', aciklama: '5 günden uzun süredir açık' }),
  Object.freeze({ id: 'gecikti', enAzGun: 10, etiket: '10 gün+', renk: '#f43f5e', aciklama: '10 günden uzun süredir açık — geciken iş' }),
]);

/** Sonuçlanmış (kapanmış) kayıtların rozet rengi. */
export const KAPALI_RENGI = '#34d399';

/**
 * Açılışından bu yana geçen GÜN sayısına göre kademe. En büyük eşikten geriye taranır →
 * araya yeni bir kademe eklendiğinde bu fonksiyon değişmeden doğru kalır.
 */
export function yasKademesi(gun) {
  const g = Number.isFinite(gun) ? gun : 0;
  for (let i = YasKademeleri.length - 1; i >= 0; i--) {
    if (g >= YasKademeleri[i].enAzGun) return YasKademeleri[i];
  }
  return YasKademeleri[0];
}

/** İki zaman arasındaki TAM gün farkı (negatifse 0). */
export function gunFarki(tarih, simdi = Date.now()) {
  const t = new Date(tarih).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((simdi - t) / 86400000));
}

/**
 * Personel rolleri (Single Source of Truth).
 * - personel: saha ekibi; bir birime bağlıdır. Kategori ekseni kalktığı için OTOMATİK
 *   iş dağıtımı YOKTUR: personele bildirim ancak yönetim bir başvuruyu ona ATADIĞINDA
 *   gider ve yalnız kendisine atanmış işi çözebilir. Birim artık bir yönlendirme
 *   kuralı değil, panelde kimi seçeceğini kolaylaştıran bir GRUPLAMADIR.
 * - baskan / baskan_yardimcisi: birime bağlı DEĞİL; HER yeni başvurunun ve HER çözümün
 *   bilgi bildirimini alır (Telegram) ve her işi çözebilir.
 */
export const PersonelRolleri = Object.freeze({
  PERSONEL: 'personel',
  BASKAN: 'baskan',
  BASKAN_YARDIMCISI: 'baskan_yardimcisi',
});

/** Rate limiting kuralları */
export const RateLimitKurallari = Object.freeze({
  /**
   * Aynı IP'den UÇ BAŞINA dakikada max istek (geliştirmede rahat test için 100).
   *
   * NEDEN 30 (3 değil): Türk mobil operatörleri CGNAT kullanır — pik anda YÜZLERCE
   * meşru vatandaş tek CF-Connecting-IP arkasında görünür. 3/dk + tüm uçların aynı
   * 'ip:' sayacını paylaşması, QR kampanyası pikinde mahallenin işlem yapamamasına
   * yol açıyordu (tam akış baslat→sikayet→foto tek başına 3 hakkı tüketiyordu).
   * Sayaç artık UÇ BAZLI ('ip_baslat:', 'ip_sikayet:' ...) ayrıldı ve tavan kaba bir
   * üst sınır olarak 30'a çıktı. SMS bütçesini asıl koruyan katmanlar DEĞİŞMEDİ:
   * Turnstile bot kapısı, telefon cooldown, IP haftalık benzersiz-telefon seti,
   * mağdur-hedef susturma, global günlük kesici aynen yürürlükte.
   * Env ile geçersiz kılınabilir (yük testinde IP_DAKIKA_LIMIT=1000000 ile gevşet).
   */
  IP_DAKIKA_LIMIT: Number(process.env.IP_DAKIKA_LIMIT) || (process.env.NODE_ENV === 'production' ? 30 : 100),
  /** Kimlik başına şikayet limitinin ZAMAN PENCERESİ (ms). Bu pencere içinde en fazla
   *  SIKAYET_PENCERE_ADET şikayet gönderilebilir. Env ile ayarlanır (test için kısaltılabilir);
   *  varsayılan 1 hafta. */
  TC_BEKLEME_SURESI_MS: Number(process.env.SIKAYET_BEKLEME_MS) || 7 * 24 * 60 * 60 * 1000,
  /** Bir kimliğin (SMS-only modda doğrulanmış telefon; NVİ açıkken ad+soyad+doğum+
   *  telefon) yukarıdaki pencere içinde gönderebileceği max
   *  şikayet sayısı. Varsayılan 1; test/demo için env ile artırılır (ör. 7). */
  SIKAYET_PENCERE_ADET: Number(process.env.SIKAYET_HAFTALIK_ADET) || 1,
  /** Aynı QR koddan saatte max şikayet. Env ile ayarlanabilir (yük testi: QR_SAAT_LIMIT=1000000).
   *  50: bir sokağın QR'ından saatte 50 şikayet — kalabalık bir cadde/pazar yerinde bile
   *  meşru kullanımı kısmadan spam'i sınırlar (kullanıcı kararı, eski değer 5'ti). */
  QR_SAAT_LIMIT: Number(process.env.QR_SAAT_LIMIT) || 50,
  /**
   * Doğrulanmış tek kimliğin saatte max fotoğraf yükleme denemesi.
   * Foto endpoint'i (/api/sikayet/foto) haftalık şikayet kapısından (o kapı
   * /api/sikayet'te) BAĞIMSIZ vurulabildiği ve dogrulamaToken 10 dk geçerli/tekrar
   * kullanılabilir olduğu için, foto limiti doğrulanmış kimliğin tek throttle'ıdır.
   * Meşru kullanım = 1 fotoğraf + birkaç yeniden deneme; 4 bunu rahatça karşılar.
   */
  FOTO_SAAT_LIMIT: 4,
  /** SMS kodu yanlış deneme limiti */
  SMS_YANLIS_DENEME_LIMIT: 5,
  /** SMS yanlış deneme sonrası engel süresi (milisaniye) */
  SMS_ENGEL_SURESI_MS: 60 * 60 * 1000, // 1 saat
});

/**
 * SMS OTP kötüye kullanım koruması — katmanlı gönderim savunması.
 *
 * Tehdit: (1) saldırgan/bot farklı numaralar deneyip SMS kredisini bitirir,
 * (2) botlar OTP endpoint'ini yağmalar, (3) saldırgan başkasının numarasını
 * girip onu "bloklatmaya"/bombalamaya çalışır.
 *
 * Tasarım ilkeleri:
 * - Her SMS para. Katmanlı throttle: telefon boyutu + IP boyutu + global tavan.
 * - Cezalar KISA ve kendiliğinden sıfırlanan olsun; uzun ceza telefona (mağdurun
 *   varlığına) DEĞİL, IP + Turnstile başarısızlığına bağlanır. Böylece saldırgan
 *   bir başkasının numarasını kalıcı kilitleyemez (bkz. GÜVENLİK planı Açık 3/4).
 * - Değerler env ile geçersiz kılınabilir (belediye trafiğine göre ayar).
 *
 * Önemli: Turnstile bot kapısı + "önce ucuz kontrol" sıralaması (IP → Turnstile →
 * format → throttle → kesici → SMS) ile birlikte çalışır; SMS ancak hepsini geçince
 * üretilip gönderilir.
 */
export const SmsGuvenlikSabitleri = Object.freeze({
  /**
   * Aynı telefona ardışık iki gönderim arası minimum bekleme (art arda çift
   * tıklama / hızlı tekrar koruması). NOT: telefon başına HAFTALIK bir sayı
   * limiti yoktur — şikayet zaten haftada 1 ile sınırlı olduğundan, meşru
   * tekrar denemeleri (yanlış numara yazma, kod gelmeme) haftaya yayılmaz.
   * Kısa pencerede ise sayı limiti VARDIR: SMS_GONDER_MAX (aşağıda; tc
   * route'unda uygulanır) aynı numaraya pencere başına kod adedini kapar.
   * Bombalamaya karşı asıl savunma: mağdur-hedef sessiz susturma (SMS_HEDEF_*)
   * + IP'nin haftalık toplam tavanı (aynı IP aynı numarayı tekrar tekrar
   * denerse kendi haftalık hakkını tüketir).
   */
  SMS_COOLDOWN_MS: Number(process.env.SMS_COOLDOWN_MS) || 60 * 1000, // 60 sn
  /** Bir IP'nin haftada tetikleyebileceği max FARKLI telefon (numara tarama koruması). */
  SMS_IP_HAFTA_BENZERSIZ_TELEFON: Number(process.env.SMS_IP_HAFTA_BENZERSIZ_TELEFON) || 3,
  /** Bir IP'nin haftada tetikleyebileceği max TOPLAM gönderim (aynı numaraya tekrarlar dahil). */
  SMS_IP_HAFTA_LIMIT: Number(process.env.SMS_IP_HAFTA_LIMIT) || 3,
  /**
   * Tek bir OTP için izin verilen yanlış kod denemesi. Aşılınca O KOD iptal edilir
   * (yeni gönderim gerekir) — telefona global ban DEĞİL, mağdur kilitlenmez.
   */
  SMS_KOD_DENEME_LIMIT: Number(process.env.SMS_KOD_DENEME_LIMIT) || 5,
  /**
   * Tüm sistemde bir günde gönderilebilecek max SMS (global bütçe devre kesici).
   * Aşılınca yeni gönderim durur ve ayrı Telegram uyarı botuyla bildirim gider.
   * Belediyenin beklenen günlük hacmine + SMS bütçesine göre ayarlanır.
   */
  SMS_GLOBAL_GUN_LIMIT: Number(process.env.SMS_GLOBAL_GUN_LIMIT) || 300,

  /**
   * Bir numaraya, penceresinde gönderilebilecek MAX SMS kodu (ilk gönderim + "tekrar
   * gönder"lerin toplamı). Aşılınca yeni kod gönderilmez → "yeniden gönder" spam'ini keser.
   */
  SMS_GONDER_MAX: Number(process.env.SMS_GONDER_MAX) || 5,
  /** SMS_GONDER_MAX sayacının zaman penceresi (ms). Varsayılan 1 saat. */
  SMS_GONDER_PENCERE_MS: Number(process.env.SMS_GONDER_PENCERE_MS) || 60 * 60 * 1000,

  // --- Cihaz parmak izi (FingerprintJS) — IP rotasyonuna karşı EK boyut ---
  // Saldırgan IP/çerez değiştirse bile tarayıcı parmak izi büyük ölçüde sabit kalır.
  // Parmak izi isteğe gelmezse (CDN engelli/JS kapalı) bu limitler atlanır; IP +
  // global + Turnstile + hedef-susturma katmanları yine geçerlidir (savunma-derinliği).
  // IP ile AYNI oranda: haftada 3 farklı numara, haftada 3 toplam.
  /** Bir cihaz parmak izinin haftada tetikleyebileceği max FARKLI telefon. */
  SMS_FP_HAFTA_BENZERSIZ_TELEFON: Number(process.env.SMS_FP_HAFTA_BENZERSIZ_TELEFON) || 3,
  /** Bir cihaz parmak izinin haftada tetikleyebileceği max toplam gönderim. */
  SMS_FP_HAFTA_LIMIT: Number(process.env.SMS_FP_HAFTA_LIMIT) || 3,

  // --- Mağdur-hedef tespiti + sessiz susturma (bombalama/DoS koruması) ---
  // Aynı numaraya KISA sürede ÇOK FARKLI kaynaktan (IP) istek gelmesi = o numaranın
  // hedef alındığının işareti. Eşik aşılınca o numaraya gönderim SESSİZCE susturulur
  // (saldırgan "kod gönderildi" görür ama SMS gitmez → ne bombalama ne limit sinyali).
  /** Bir numarayı "hedef" saymak için pencere içindeki farklı kaynak (IP) eşiği.
   *  3 → 6'ya yükseltildi: eşik düşükken 3 IP (VPN yeter) bir vatandaşı 2 saat
   *  susturabiliyordu (hedefli DoS). 6 farklı IP gerektirmek saldırgan maliyetini
   *  ikiye katlar; bombalamayı hâlâ IP haftalık tavanı + cooldown durdurur. */
  SMS_HEDEF_ESIK: Number(process.env.SMS_HEDEF_ESIK) || 6,
  /** Farklı kaynakları sayarken kullanılan zaman penceresi (ms). */
  SMS_HEDEF_PENCERE_MS: Number(process.env.SMS_HEDEF_PENCERE_MS) || 60 * 60 * 1000, // 1 saat
  /** Hedef tespit edilince numaranın susturulacağı süre (ms). */
  SMS_HEDEF_SUSTURMA_MS: Number(process.env.SMS_HEDEF_SUSTURMA_MS) || 2 * 60 * 60 * 1000, // 2 saat

  // --- Conversion (gönderilen/doğrulanan) izleme → savunma modu ---
  // Meşru kullanıcı gelen kodu DOĞRULAR; saldırgan gönderir ama doğrulamaz. Günlük
  // doğrulanan/gönderilen oranı düşerse (yeterli hacimde) sistem "savunma modu"na
  // geçer: gönderim limitleri sıkılaşır + ayrı Telegram botuyla uyarı gider.
  /** Oran kontrolünün devreye gireceği min günlük gönderim (az veride oran gürültülü). */
  SMS_CONV_MIN_HACIM: Number(process.env.SMS_CONV_MIN_HACIM) || 30,
  /** Altına düşülünce savunma moduna geçilen min doğrulanan/gönderilen oranı (0-1). */
  SMS_CONV_MIN_ORAN: Number(process.env.SMS_CONV_MIN_ORAN) || 0.15,
  /** Savunma modunun aktif kalacağı süre (ms); pencere sonunda kendiliğinden kalkar. */
  SMS_SAVUNMA_SURE_MS: Number(process.env.SMS_SAVUNMA_SURE_MS) || 3 * 60 * 60 * 1000, // 3 saat
  /** Savunma modunda sayaç-tabanlı limitlerin çarpanı (0.5 = yarıya indir). */
  SMS_SAVUNMA_CARPAN: Number(process.env.SMS_SAVUNMA_CARPAN) || 0.5,

  // --- Datacenter / VPN engelleme (Cloudflare edge header'ı ile) ---
  // Gerçek vatandaş residential/mobil ISP'dedir; botlar AWS/DigitalOcean/VPN'dedir.
  // Cloudflare'de bir Transform Rule datacenter ASN'lerinde bu header'ı set eder;
  // kod header truthy ise isteği daha SMS üretilmeden 403 ile keser. Header yoksa
  // (kural kurulmamışsa) hiçbir şey olmaz (güvenli varsayılan).
  /** Cloudflare'in datacenter/VPN isteklerine eklediği işaret header'ının adı (küçük harf). */
  SMS_DC_HEADER: (process.env.SMS_DC_HEADER || 'x-dc-block').toLowerCase(),
  /** Datacenter engellemesi açık mı (kill-switch). Varsayılan açık; header yoksa etkisiz. */
  SMS_DC_ENGELLE: process.env.SMS_DC_ENGELLE !== 'false',
});

/** Güvenlik sabitleri */
export const GuvenlikSabitleri = Object.freeze({
  /** HMAC algoritması */
  HMAC_ALGORITMASI: 'sha256',
  /** Admin oturum çerezinin adı */
  ADMIN_CEREZ_ADI: 'admin_oturum',
  /**
   * Admin oturumunun geçerlilik süresi (milisaniye) - 100 yıl (kullanıcı kararı:
   * idle-timeout istenmiyor, oturum fiilen kalıcı olsun). Kayan pencere olarak
   * uygulanır (her erişimde sonErisimTarihi güncellenir) ama süre o kadar uzun ki
   * pratikte hiç dolmaz.
   */
  ADMIN_OTURUM_SURESI_MS: 100 * 365 * 24 * 60 * 60 * 1000,
  /** Magic link giriş belirtecinin geçerlilik süresi (milisaniye) - 48 saat */
  MAGIC_LINK_SURESI_MS: 48 * 60 * 60 * 1000,
  /** SMS doğrulama kodunun geçerlilik süresi (milisaniye) */
  SMS_KOD_SURESI_MS: 5 * 60 * 1000, // 5 dakika
  /** SMS sonrası verilen doğrulama belirtecinin (şikayet gönderme izni) ömrü */
  DOGRULAMA_TOKEN_SURESI_MS: 10 * 60 * 1000, // 10 dakika
  /** SMS doğrulama kodu uzunluğu */
  SMS_KOD_UZUNLUGU: 6,
  /** Magic link token uzunluğu (byte cinsinden, hex'e çevrilince 2 katı karakter olur) */
  MAGIC_LINK_TOKEN_BYTE: 64, // 128 hex karakter

  /** Telegram Bot API kök adresi */
  TELEGRAM_API_BASE: 'https://api.telegram.org',
  /**
   * Telegram personel bağlantı kodunun (deep-link /start token'ı) geçerlilik
   * süresi. Magic link ile aynı: tek kullanımlık, 48 saat.
   */
  TELEGRAM_BAGLANTI_KODU_SURESI_MS: 48 * 60 * 60 * 1000,
  /**
   * "Çözüldü" inline butonunun callback_data ön eki. Format: `c:<sikayetId>`.
   * (Telegram callback_data 64 byte ile sınırlı; 2 + 36 = 38 byte, sığar.)
   */
  TELEGRAM_CALLBACK_PREFIX: 'c:',
  /**
   * "Bulunamadı / Çözülemedi" inline butonunun callback_data ön eki. Format: `b:<sikayetId>`.
   * Personel sahaya gidip sorunu bulamaz/çözemezse başkan+yardımcıya escalation bildirimi
   * gönderir; şikayet AÇIK kalır (durum değişmez) — yönetici yeniden atayabilir/kapatabilir.
   */
  TELEGRAM_BULUNAMADI_PREFIX: 'b:',
  /**
   * Moderasyon botundaki "Normal şikayet olarak ilet" butonunun callback_data ön eki.
   * Format: `n:<tenantId>:<sikayetId>`. Moderasyon botu tek bir sohbete hizmet ettiği
   * ve oraya bağlı bir personel kaydı olmadığı için tenant, personelden çözülemez →
   * callback_data'ya gömülür. (2 + ~4 + 1 + 36 ≈ 43 byte; Telegram sınırı 64.)
   */
  TELEGRAM_MODERASYON_PREFIX: 'n:',
  /**
   * Moderasyon botundaki "Gönereni engelle" butonunun ön eki. Format:
   * `x:<tenantId>:<sikayetId>`. Şikayetin kimlik_hash'i (telefonun tek yönlü özeti)
   * kara listeye eklenir — ham telefon gerekmez. Bu buton, `scripts/engelle.sh`
   * ile "son 20 şikayet içinde doğru id'yi bulma" adımını tamamen ortadan kaldırır:
   * mesaj zaten o şikayete aittir.
   */
  TELEGRAM_MODERASYON_ENGELLE_PREFIX: 'x:',

});

/** KVKK / kişisel veri sabitleri */
export const KvkkSabitleri = Object.freeze({
  /**
   * Yürürlükteki Aydınlatma Metni sürümü. Her şikayette, vatandaşın hangi sürüme
   * açık rıza verdiği kaydedilir (KVKK ispat yükümlülüğü). Metin değişirse bu artırılır.
   * v3: WhatsApp/Meta ile doğrulama + numaranın kötüye kullanım/hukuki amaçla saklanması eklendi.
   * v4: Vatandaşın (isteğe bağlı paylaştığı) anlık GPS konumunun şikayet yeri olarak işlenmesi eklendi.
   * v5: Cihaz konumu/GPS toplama TAMAMEN kaldırıldı — şikayet yeri, okutulan QR'ın (sokağın)
   *     sabit koordinatıdır; artık vatandaştan konum verisi işlenmez.
   * v6: Firebase (Google Phone Auth) ile telefon doğrulaması eklendi — numaranın Google'a
   *     (yurt dışı) aktarılmasına ilişkin aydınlatma/rıza maddesi (yalnız firebase modunda gösterilir).
   * v7: Saha ekibine iletilen şikayet konusu/konum/açıklama/fotoğrafın, yurt dışında
   *     barındırılan mesajlaşma servisi (Telegram) üzerinden iletilmesi nedeniyle KVKK m.9
   *     kapsamında yurt dışına aktarım teşkil ettiği açıkça belirtildi (ad/soyad/telefon
   *     yine saha ekibiyle paylaşılmaz). Onay metni sadeleştirildi.
   * v8: Hukuki sebep yeniden yapılandırıldı — ana işleme artık SADECE açık rızaya değil KVKK
   *     m.5/2 kanuni sebeplerine dayanıyor (rıza geri alınsa bile dayanak kalır); yurt dışı
   *     aktarım açık rızaya bağlı + geri alma hakkı belirtildi. Toplama yöntemi, otomatik karar
   *     alınmadığı, veri güvenliği (m.12) maddeleri ve başvuru kanalı/30 gün/Kurul'a şikayet
   *     hakkı eklendi.
   * v9: Ham ad/soyad/telefon SAKLANMA UYGULAMASI kaldırıldığından metin gerçeğe göre güncellendi:
   *     ad/soyad/telefon alınır ve telefon SMS ile doğrulanır AMA ham hâlde saklanmaz; yalnız
   *     telefonun tek yönlü (geri döndürülemez) hash'i tutulur (mükerrer/engelleme için). Kimlik
   *     ham saklanmadığından "sizinle iletişim" ve "hukuki takip" amaçları metinden çıkarıldı.
   * v10: WhatsApp (Meta) ve Firebase (Google) doğrulama seçenekleri koddan kaldırıldı →
   *      o iki yurt dışı aktarım maddesi metinden çıkarıldı. Doğrulama artık yalnız
   *      Türkiye'de yerleşik SMS sağlayıcısı (Netgsm) üzerinden yapılır; bu adımda yurt
   *      dışına aktarım YOKTUR. (Telegram üzerinden saha ekibine iletim maddesi — v7 —
   *      aynen geçerlidir.)
   * v11: Başvuru TÜRÜ ekseni eklendi (şikayet/talep/öneri/teşekkür). Metin artık
   *      yalnız "şikayet"i değil, dört başvuru türünün tamamını kapsayacak biçimde
   *      "başvuru" terimiyle yazıldı; teşekkür/önerinin de aynı esaslarla (telefonun
   *      tek yönlü hash'i, ham kimlik saklanmaz) işlendiği açıkça belirtildi. Öneri ve
   *      teşekkürde KONUM verisi hiç işlenmez; saha ekibine (Telegram) yalnız saha
   *      işi gerektiren türler (şikayet/talep) aktarılır — v7'deki yurt dışı aktarım
   *      maddesinin kapsamı bu türlerle sınırlandırıldı.
   *      (v15 ile GERİ ALINDI — aşağıya bakınız.)
   * v12: ÇÖZÜM SMS'i eklendi. Şikayet/talep sonuçlandığında vatandaşa bilgi SMS'i
   *      gönderilebilmesi için telefon numarası artık SAKLANIYOR — ham değil, AES-256-GCM
   *      ile ŞİFRELİ (çözme anahtarı veritabanında değil sunucu ortamında). Saklama amaca
   *      bağlıdır ve süresizdir DEĞİL: başvuru sonuçlandıktan KisiselVeriSabitleri.IMHA_GUN
   *      gün sonra numara otomatik olarak silinir. Öneri ve teşekkürde numara hiç saklanmaz
   *      (o türlerde "çözüldü" bildirimi yoktur). SMS, Türkiye'de yerleşik sağlayıcı
   *      (Netgsm) üzerinden gider — bu adımda yurt dışına aktarım YOKTUR.
   * v13: EKSİK AÇIKLAMALAR TAMAMLANDI (metin denetimi). Önceki sürümler yurt dışı
   *      aktarım olarak yalnız Telegram'ı sayıyordu; oysa (a) sistemin BARINDIRILDIĞI
   *      sunucu ve (b) fotoğrafların tutulduğu nesne depolama yurt dışındadır, (c)
   *      formdaki bot kapısı (Cloudflare Turnstile) başvuru gönderilmeden önce IP ve
   *      tarayıcı sinyallerini yurt dışındaki sağlayıcıya iletir. Üçü de metne eklendi.
   *      Ayrıca "veriler yalnızca ilgili belediye birimleriyle paylaşılır" cümlesi
   *      GERÇEĞE AYKIRIYDI: uygunsuz içerik filtresine takılan başvuru, belediye
   *      birimine değil VERİ İŞLEYENİN moderasyon ekibine düşer — bu açıkça yazıldı ve
   *      otomatik içerik filtresinin varlığı ilk kez açıklandı. Sonuç SMS'i açık olan
   *      belediyelerde numaranın gönderim anında yeniden SMS sağlayıcısına aktarıldığı
   *      belirtildi. Son olarak AYDINLATMA ile AÇIK RIZA formda tek onay kutusunda
   *      birleşikti; Kurul'un yerleşik görüşü uyarınca AYRILDI (iki ayrı kutu).
   * v14: ALICILAR İSİMLE YAZILDI. v13'te Telegram, Cloudflare ve Cloudflare R2 adıyla
   *      geçiyor, ama (a) verinin TAMAMINI barındıran sunucu sağlayıcısı ve (b) sistemi
   *      belediye adına işleten veri işleyen yalnızca "bir sunucu" / "bir veri işleyen"
   *      diye anılıyordu. Yurt dışı aktarımın dayanağı açık rıza olduğu sürece rızanın
   *      "bilgilendirmeye dayalı" sayılabilmesi için alıcının KİM olduğu bilinmelidir;
   *      üstelik başvuru metnini fiilen okuyan moderasyon ekibi de bu veri işleyenin
   *      ekibidir. İkisi de VERI_ISLEYEN / BARINDIRMA_SAGLAYICI ile isimlendirildi.
   * v15: BAŞVURU TÜRÜ EKSENİ KALDIRILDI (v11 geri alındı). Ürün yeniden yalnız
   *      ŞİKAYET alıyor; talep/öneri/teşekkür ve "basit mod" profili koddan çıktı.
   *      Metindeki "başvuru türüne göre değişir" ayrımları, öneri/teşekkürde konum
   *      işlenmediği kaydı ve türe göre daralan yurt dışı aktarım cümleleri kaldırıldı —
   *      artık TEK bir tür (şikayet) olduğundan hepsi tek koşulsuz cümleye indi.
   *      Metnin kapsamı DARALMADI, sadeleşti: her madde her şikayete uygulanır.
   * v16: TEK QR ÜRÜNÜ. İki değişiklik metne yansıtıldı:
   *      (a) KATEGORİ SORULMUYOR — vatandaştan artık "konu/kategori" verisi
   *          TOPLANMIYOR; işlenen içerik yalnız türü (şikayet/görüş/öneri) ile
   *          yazdığı metin ve varsa fotoğraftır. v13'ten beri metinde "konu/kategori"
   *          diye sayılan veri kalemi gerçekte toplanmadığı için ÇIKARILDI:
   *          toplanmayan bir veriyi aydınlatmada saymak, metni gerçeğe aykırı kılar.
   *      (b) BAŞVURU TÜRÜ eklendi (şikayet/görüş/öneri) — v11'deki dört türlü eksen
   *          DEĞİL, üç türlü ve KOŞULSUZ: üç tür de birebir aynı esaslarla işlenir
   *          (aynı saklama süreleri, aynı alıcılar, aynı yurt dışı aktarım). Bu yüzden
   *          v11'deki "türe göre daralan aktarım" cümleleri GERİ GELMEDİ.
   *      Saha ekibine otomatik dağıtım da kalktı (kategori yoktu, dayanağı kalmadı):
   *      başvuru saha ekibine ancak yönetim ATADIĞINDA iletilir. Yurt dışı aktarım
   *      maddesi (Telegram) aynen geçerlidir — yalnız "otomatik" nitelemesi düştü.
   *
   * TABAN SÜRÜMDÜR. Bayrağı açık belediyelerde sonuna harf eklenir (bkz.
   * aydinlatmaSurumu): 's' = çözüm SMS'i. Yani SMS'li belediyede yürürlükteki
   * sürüm '2026-08-v16s'tir.
   */
  AYDINLATMA_SURUMU: '2026-08-v16',

  /**
   * Aydınlatma metninde İSİMLE anılan taraflar (v14).
   *
   * NEDEN SABİT: bu adlar metnin gövdesine girer ve metin sürümlenir. Tek kaynaktan
   * gelmezlerse ileride bir yerde güncellenip başka bir yerde eski kalır — aydınlatma
   * metninin gerçeğe aykırı kalması KVKK'da en pahalı hata türüdür.
   *
   * NEDEN TENANT'A BAĞLI DEĞİL: veri SORUMLUSU her belediyede farklıdır (tenant.ad ile
   * çözülür), ama veri İŞLEYEN ve barındırma sağlayıcısı üç müşteride de aynıdır —
   * hepsi aynı altyapıda çalışır. Bir gün bir belediye kendi sunucusunda barındırılırsa
   * bunlar tenant kolonuna taşınmalı ve sürüm artmalıdır.
   *
   * DEĞİŞİRSE AYDINLATMA_SURUMU DA ARTMALI.
   */
  VERI_ISLEYEN: 'İncitek Bilgi ve İletişim Teknolojileri',
  BARINDIRMA_SAGLAYICI: 'netcup GmbH',
  BARINDIRMA_ULKE: 'Almanya',
});

/**
 * Bir belediyede yürürlükte olan aydınlatma metni sürümü.
 *
 * Metin tenant bayraklarına göre değiştiği için sürüm de tenant'a göre çözülür; iki
 * farklı metni aynı sürüm dizesiyle sunmak "vatandaş hangi metne rıza verdi?" sorusunu
 * cevapsız bırakır ve KVKK ispat yükümlülüğünü zayıflatır.
 *
 * Sürüm BİLEŞİKTİR: taban sürüm + her bayrağın harfi. Bayrak sayısı ileride artarsa
 * sabit dizeleri tek tek yazmak (v15, v15s, ...) her yeni bayrakta ikiye katlanırdı.
 *   s = çözüm SMS'i (telefon şifreli saklanır)
 * Harf sırası SABİTTİR — aynı yapılandırma her zaman aynı dizeyi üretmelidir.
 * Bayraksız belediyede sonuç tabanın kendisidir.
 */
export function aydinlatmaSurumu(tenant) {
  let surum = KvkkSabitleri.AYDINLATMA_SURUMU;
  if (tenant?.cozumSmsiAcik === true) surum += 's';
  return surum;
}

/**
 * Kişisel veri saklama/imha sabitleri.
 *
 * Çözüm SMS'i için tutulan ŞİFRELİ telefon, amacı gerçekleştikten sonra tutulmaz:
 * başvuru sonuçlandıktan IMHA_GUN gün sonra otomatik silinir. Süre sıfır değil çünkü
 * (a) SMS gönderimi başarısız olursa yeniden denenebilmeli, (b) vatandaş "bana bilgi
 * gelmedi" derse kısa bir süre içinde teyit edilebilmeli. 15 gün bu iki ihtiyacı
 * karşılayan en kısa süredir; uzatmak KVKK ölçülülük ilkesine aykırı olur.
 */
export const KisiselVeriSabitleri = Object.freeze({
  /** Başvuru sonuçlandıktan kaç gün sonra şifreli telefon silinsin. */
  IMHA_GUN: Number(process.env.KISISEL_VERI_IMHA_GUN) || 15,
  /** İmha görevinin çalışma sıklığı (ms). Uygulama açılışında bir kez de çalışır. */
  IMHA_ARALIK_MS: Number(process.env.KISISEL_VERI_IMHA_ARALIK_MS) || 6 * 60 * 60 * 1000,

  // ===================== SAKLAMA SÜRELERİ (gün) =====================
  // KVKK m.4/2-d ve m.7: veri, işlendiği amaç için gerekli süreden fazla tutulamaz;
  // amaç ortadan kalkınca SİLİNİR. Aşağıdaki süreler hem aydınlatma metnindeki
  // tabloyu hem periyodik imha görevini besler — metin ile sistemin AYNI şeyi
  // söylemesi için tek kaynak buradadır. (Metinde yazıp yapmamak, denetimde
  // hiç yazmamaktan daha kötüdür.)

  /**
   * Başvurunun KİMLİK BAĞININ koparılacağı süre. Kayıt SİLİNMEZ, ANONİMLEŞTİRİLİR:
   * kimlik_hash + şifreli telefon + fotoğraf silinir, geriye tür/kategori/açıklama/
   * tarih/çözüm bilgisi kalır. Neden silmiyoruz: başvuru içeriği belediyenin hizmet
   * kaydıdır (kaç şikayet geldi, ne kadar sürede çözüldü) ve kimlik bağı koptuktan
   * sonra kişisel veri olmaktan çıkar. 2 yıl, hizmet istatistiği için makul üst sınır.
   */
  BASVURU_ANONIM_GUN: Number(process.env.SAKLAMA_BASVURU_GUN) || 730,

  /**
   * Başkan panelden "sil" dediğinde kayıt yalnız işaretleniyordu (soft delete) ve
   * sonsuza dek duruyordu. Artık bu süre sonunda satır ve fotoğrafı GERÇEKTEN silinir.
   * 90 gün: yanlışlıkla silmenin geri alınabileceği makul pencere.
   */
  SILINEN_KALICI_GUN: Number(process.env.SAKLAMA_SILINEN_GUN) || 90,

  /**
   * SMS gönderim audit logu (telefon ve IP'nin tek yönlü özetleri). Amaç kötüye
   * kullanım tespiti; o amaç kısa vadelidir. 6 ay, Çankaya Belediyesi'nin de aynı
   * veri için ilan ettiği süredir.
   */
  SMS_LOG_GUN: Number(process.env.SAKLAMA_SMS_LOG_GUN) || 180,

  /**
   * Kullanılmış ya da süresi dolmuş giriş/bağlantı belirteçleri (magic link,
   * personel Telegram kodu). İşe yaramaz hâle geldikten sonra tutmanın amacı yok.
   */
  BELIRTEC_GUN: Number(process.env.SAKLAMA_BELIRTEC_GUN) || 30,

  /**
   * Engelli kimlik (kara liste) kaydı. Süresiz engel, süresiz kişisel veri demektir.
   * 2 yıl sonunda engel düşer; kötüye kullanım sürerse kayıt yeniden oluşur.
   * 0 verilirse imha KAPANIR (engel süresiz kalır) — bilinçli bir tercih olmalı.
   */
  ENGELLI_GUN: Number(process.env.SAKLAMA_ENGELLI_GUN) || 730,
});

/**
 * Aydınlatma metnindeki SAKLAMA SÜRESİ TABLOSU. Süreler yukarıdaki sabitlerden
 * okunur → biri değişince metin kendiliğinden doğru kalır.
 * @param {{cozumSmsiAcik?: boolean}|null} tenant
 */
export function saklamaTablosu(tenant) {
  const S = KisiselVeriSabitleri;
  const yil = (gun) => (gun % 365 === 0 ? `${gun / 365} yıl` : `${gun} gün`);
  const satirlar = [
    { veri: 'Ad ve soyad', sure: 'Saklanmaz', aciklama: 'Doğrulama bittiği anda tutulmaz.' },
    {
      veri: 'Telefon numarası (doğrulama sırasında)',
      sure: '5 dakika',
      aciklama: 'Yalnız SMS kodu geçerliyken tutulur, sonra kendiliğinden silinir.',
    },
  ];
  if (tenant?.cozumSmsiAcik === true) {
    satirlar.push({
      veri: 'Telefon numarası (sonuç SMS’i için, şifreli)',
      sure: `Başvuru sonuçlandıktan sonra ${S.IMHA_GUN} gün`,
      aciklama: 'Süre sonunda otomatik silinir.',
    });
  }
  satirlar.push(
    {
      veri: 'Telefon numarasının tek yönlü özeti',
      sure: yil(S.BASVURU_ANONIM_GUN),
      aciklama: 'Mükerrer başvuru sınırı ve kötüye kullanımın engellenmesi için.',
    },
    {
      // "Konu/kategori" BİLEREK yazmıyoruz: bu üründe vatandaştan kategori
      // İSTENMEZ (bkz. BasvuruTurleri). Toplanmayan veriyi saklama tablosunda
      // saymak aydınlatma metnini gerçeğe aykırı kılar.
      veri: 'Başvuru içeriği (tür ve yazdığınız metin)',
      sure: `${yil(S.BASVURU_ANONIM_GUN)} sonra kimlik bağı koparılır`,
      aciklama: 'İçerik hizmet istatistiği olarak anonim biçimde kalır.',
    },
    {
      veri: 'Fotoğraf',
      sure: yil(S.BASVURU_ANONIM_GUN),
      aciklama: 'Süre sonunda kalıcı olarak silinir.',
    },
    {
      veri: 'Güvenlik kayıtları (IP ve telefonun özetleri)',
      sure: `${S.SMS_LOG_GUN} gün`,
      aciklama: 'Kötüye kullanım tespiti amacıyla.',
    },
    {
      veri: 'Silinen başvurular',
      sure: `${S.SILINEN_KALICI_GUN} gün`,
      aciklama: 'Bu sürenin sonunda kayıt ve fotoğrafı geri dönülemez biçimde silinir.',
    },
  );
  return satirlar;
}

/** Fotoğraf işleme sabitleri */
export const FotografSabitleri = Object.freeze({
  /** Maksimum dosya boyutu (byte) */
  MAX_BOYUT_BYTE: 15 * 1024 * 1024, // 15 MB
  /** Yeniden boyutlandırma sonrası max genişlik (piksel) */
  MAX_GENISLIK_PX: 1920,
  /** Yeniden boyutlandırma sonrası max yükseklik (piksel) */
  MAX_YUKSEKLIK_PX: 1080,
  /** JPEG kalitesi (1-100) */
  JPEG_KALITESI: 80,
  /**
   * Aynı anda işlenebilecek max fotoğraf sayısı (sharp/libvips eşzamanlılık tavanı).
   * 2 vCPU / 4GB tek container'da, paralel yükleme seli CPU+belleği patlatabilir;
   * bu yuva (semafor) sayısı işlemeyi sıraya sokar. Env ile geçersiz kılınabilir.
   */
  ESZAMANLI_ISLEME_LIMIT: Number(process.env.FOTO_ESZAMANLI_LIMIT) || 3,
  /** Bir isteğin işleme yuvası için bekleyeceği max süre (ms); aşılırsa 503 döner */
  ISLEME_BEKLEME_TIMEOUT_MS: 5000,
});

/** Uygulama meta bilgileri */
export const UygulamaBilgileri = Object.freeze({
  AD: `${process.env.NEXT_PUBLIC_BELEDIYE_ADI || 'Belediye'} Görüş ve Öneri Sistemi`,
  VERSIYON: '1.0.0',
});
