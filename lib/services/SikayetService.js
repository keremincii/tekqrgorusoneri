import { aciklamaGecerliMi, uuidGecerliMi, kategoriGecerliMi, telefonuStandartlastir, telefonGecerliMi } from '@/lib/utils/validators.js';
import {
  RateLimitKurallari, SikayetDurumu, GENEL_RED_MESAJI,
  KisiselVeriSabitleri, durumGecerliMi, durumKapaliMi,
} from '@/lib/utils/constants.js';
import { sirSifrele, sifrelemeHazir } from '@/lib/security/sifreleme.js';
import { sha256Hashle } from '@/lib/security/hmac.js';
import { kufurIceriyorMu } from '@/lib/security/kufurFiltresi.js';
import { kvSetNx, kvDel } from '@/lib/infrastructure/redis/store.js';

/**
 * Kimlik-başına şikayet kilidinin ömrü (ms). Kilit yalnızca "haftalık-limiti-say →
 * kaydet" kritik bölümünü (birkaç ms) serileştirir; TTL, süreç ortada çökerse kilidin
 * asılı kalmaması için güvenlik ağıdır.
 */
const SIKAYET_KIMLIK_KILIT_MS = 15_000;

/**
 * SikayetService - Şikayet İş Mantığı Servisi
 * 
 * Single Responsibility: Sadece şikayet oluşturma/güncelleme iş kurallarını yönetir.
 * Dependency Inversion: Repository'leri constructor'dan alır (test edilebilirlik).
 * 
 * Defense in Depth: İş kuralları burada uygulanır (API katmanındaki kontrole ek olarak).
 * - 1 hafta bekleme kuralı
 * - Sokak varlık kontrolü
 * - Kategori whitelist kontrolü
 * - Metin temizleme
 */
export class SikayetService {
  /**
   * @param {import('../../infrastructure/repositories/SikayetRepository.js').SikayetRepository} sikayetRepo
   * @param {import('../../infrastructure/repositories/SokakRepository.js').SokakRepository} sokakRepo
   */
  constructor(sikayetRepo, sokakRepo) {
    this.sikayetRepo = sikayetRepo;
    this.sokakRepo = sokakRepo;
  }

  /**
   * Yeni şikayet oluşturur (tüm iş kurallarını uygular).
   * 
   * @param {Object} params
   * @param {number} params.tenantId - Şikayetin ait olduğu belediye (sunucuda çözülür)
   * @param {string} params.sokakId - QR koddan gelen sokak UUID'si
   * @param {string} params.kimlikHash - Doğrulama belirtecinden gelen kimlik hash'i
   *   (doğrulanmış telefon; NVİ açıkken ad+soyad+doğum+telefon. TC saklanmaz).
   *   1 hafta kuralı bununla işler.
   * @param {string} params.kategori - Kategori (whitelist kontrolü yapılır)
   * @param {string} params.aciklama - Şikayet açıklaması
   * @param {string|null} [params.fotografUrl] - Fotoğraf URL'si (ileride kullanılacak)
   * @param {string|null} [params.telefon] - SMS ile DOĞRULANMIŞ telefon (imzalı
   *   dogrulamaToken'dan gelir, istemci değiştiremez). Düz metin SAKLANMAZ; yalnız
   *   çözüm SMS'i için AES-GCM ile şifrelenip `telefon_enc`e yazılır ve amaç bitince
   *   imha edilir (KVKK v12).
   * @returns {Promise<{basarili: boolean, sikayet?: Object, hata?: string}>}
   */
  async olustur({ tenantId, sokakId, kimlikHash, kategori, aciklama, fotografUrl = null,
                  kvkkOnay = false, kvkkMetinSurumu = null,
                  bildirilenSokakAdi = null, telefon = null,
                  cozumSmsiAcik = false }) {
    // 0. Tenant kontrolü
    if (!tenantId) {
      return { basarili: false, hata: 'Belediye belirlenemedi.' };
    }

    // 1. Sokak ID doğrulaması
    if (!uuidGecerliMi(sokakId)) {
      return { basarili: false, hata: 'Geçersiz sokak kimliği.' };
    }

    // 2. Sokağın bu belediyede var olduğunu ve aktif olduğunu kontrol et
    const sokak = await this.sokakRepo.idIleGetir(sokakId, tenantId);
    if (!sokak || !sokak.aktif) {
      return { basarili: false, hata: 'Belirtilen sokak bulunamadı veya artık aktif değil.' };
    }

    // 3. Kategori doğrulaması (whitelist — istemciden sahte kategori gelemez)
    if (!kategoriGecerliMi(kategori)) {
      return { basarili: false, hata: 'Geçersiz kategori.' };
    }

    // 4. Açıklama doğrulaması (en fazla 280 karakter; ALT SINIR YOK, boş bırakılabilir —
    //    kategori tek başına anlamlı bir şikayet oluşturur).
    if (!aciklamaGecerliMi(aciklama)) {
      return { basarili: false, hata: 'Açıklama en fazla 280 karakter olabilir.' };
    }

    // 5. kimlikHash kontrolü (doğrulama belirtecinden gelir; 64 hex karakter)
    if (typeof kimlikHash !== 'string' || !/^[0-9a-f]{64}$/i.test(kimlikHash)) {
      return { basarili: false, hata: 'Kimlik doğrulaması eksik veya geçersiz.' };
    }

    // 6. KVKK açık rızası olmadan kişisel veri saklanmaz (defense in depth — API katmanı
    //    da kontrol eder). Rate-limit sorgularından ÖNCE: onaysız istek boşuna DB yormasın.
    if (kvkkOnay !== true) {
      return { basarili: false, hata: 'Kişisel veri işleme onayı (KVKK) gereklidir.' };
    }

    // 6.2 KARA LİSTE: başkanın engellediği kimlik (telefon hash'i) hiç şikayet gönderemez.
    // Belirsiz mesaj → engelli mi limit mi ayırt edilemez (mekanizma ifşa olmasın).
    if (await this.sikayetRepo.engelliMi(tenantId, kimlikHash)) {
      return { basarili: false, hata: GENEL_RED_MESAJI };
    }

    // 6.5 KİMLİK-BAŞINA ATOMİK KİLİT (TOCTOU guard): haftalık-limit "önce say, sonra
    //     ekle" akışı transaction/kilit olmadan çalıştığından, aynı kimliğin (aynı
    //     tekrar-kullanılabilir dogrulamaToken'ıyla) eşzamanlı N isteği hepsi count=0
    //     görüp N kayıt açabilirdi. Bu kilit o kritik bölümü kimlik başına serileştirir:
    //     yalnız biri geçer, diğerleri "işleniyor" alır.
    const kimlikKilit = `sikayet_kimlik_kilit:${tenantId}:${kimlikHash}`;
    if (!(await kvSetNx(kimlikKilit, { t: 1 }, SIKAYET_KIMLIK_KILIT_MS))) {
      return { basarili: false, hata: 'Şikayetiniz işleniyor; lütfen birkaç saniye sonra tekrar deneyin.' };
    }
    try {
      // 7. Kimlik başına pencere limiti — TEK OTORİTE: DB'deki pencere içi şikayet SAYISI.
      //    Eskiden bir in-memory sayaç insert'ten ÖNCE artırılıyordu; insert (ör. pool
      //    tükenmesi) başarısız olursa sayaç geri alınmadığından kullanıcı hiç kaydı
      //    olmadan yanlışça kilitleniyordu. DB sayımı restart-dayanıklı ve gerçek kaynak
      //    olduğundan yalnızca ona güveniyoruz (kimlikHash+tarih indeksiyle ucuz sorgu).
      const adet = RateLimitKurallari.SIKAYET_PENCERE_ADET;
      const pencereBaslangici = new Date(Date.now() - RateLimitKurallari.TC_BEKLEME_SURESI_MS);
      const mevcut = await this.sikayetRepo.pencereSikayetSayisiGetir(kimlikHash, tenantId, pencereBaslangici);

      if (mevcut >= adet) {
        // Limit MEŞRU kuraldır (engelleme gibi gizli mekanizma değil) → dürüst
        // vatandaşa kaç hak / ne zaman tekrar bilgisi verilir. "Kalan süre" DB'den
        // hesaplanır: penceredeki en eski kayda bakılır.
        const enEski = await this.sikayetRepo.enEskiPencereSikayetZamani(kimlikHash, tenantId, pencereBaslangici);
        const serbestKalma = enEski ? enEski.getTime() + RateLimitKurallari.TC_BEKLEME_SURESI_MS : Date.now();
        const kalanGun = Math.max(1, Math.ceil((serbestKalma - Date.now()) / (24 * 60 * 60 * 1000)));
        return { basarili: false, hata: `Bu dönemde en fazla ${adet} şikayet gönderebilirsiniz. Yaklaşık ${kalanGun} gün sonra tekrar deneyebilirsiniz.` };
      }

      // 8. Açıklama HAM (yalnız trim'lenmiş) olarak saklanır — HTML kaçışı YAPILMAZ.
      //
      //    NEDEN: kaçışın doğru yeri ÇIKIŞ katmanıdır ve orada zaten yapılıyor —
      //    panelde React (JSX), harita popup'ında kacisHtml(), Telegram/moderasyon
      //    mesajlarında htmlKacis(). Girişte bir kez daha kaçırmak ÇİFT KAÇIŞ üretir:
      //    vatandaş "Atatürk'ün caddesi" yazınca panelde "Atatürk&#x27;ün caddesi"
      //    görünürdü. Kaçışsız tek bir çıkış yolu yoktur (hepsi tek tek doğrulandı),
      //    dolayısıyla bu katman güvenlik EKLEMİYOR, yalnız metni bozuyordu.
      //
      //    Yan fayda: panelin arama kutusu ham metin üzerinde çalıştığı için artık
      //    kesme işareti içeren bir ifade ("Atatürk'ün") gerçekten eşleşir.
      const temizAciklama = typeof aciklama === 'string' ? aciklama.trim() : '';

      // 9. KÜFÜR FİLTRESİ — sunucu tarafı (istemci filtresi curl ile atlanır).
      //    Ham metne bakar; saklanan metin de artık ham olduğu için ikisi AYNI girdidir
      //    (eskiden saklanan sürüm HTML-kaçışlıydı ve '&#x27;' gibi entity'ler filtrenin
      //    normalizasyonunu bozabildiği için ayrım şarttı — bkz. 8. adım).
      //    Takılırsa kayıt SESSİZCE `moderasyonda` açılır: vatandaş sıradan başarı
      //    yanıtı alır (filtreyi kalibre edemesin), ama kayıt haritaya/panele düşmez
      //    ve saha personeline bildirim GİTMEZ — yalnız moderasyon botuna düşer.
      const kufur = kufurIceriyorMu(aciklama);

      // 9.5 ÇÖZÜM SMS'i için telefonu ŞİFRELİ hazırla (KVKK v12). İKİ KAPI birden açık olmalı:
      //   - TENANT BAYRAĞI (cozumSmsiAcik): belediye bu özelliği açmadıysa numara HİÇ
      //     saklanmaz. Numara saklamak yeni bir KVKK işleme faaliyetidir; hangi belediyenin
      //     bunu üstlendiği kararı tek tek verilir, varsayılan "saklama"dır.
      //   - Şifreleme anahtarı (SIR_SIFRELEME_ANAHTARI): yoksa numara SAKLANMAZ. Düz
      //     metne düşmek, DB dump'ı sızdığında tüm başvuranları ifşa ederdi. SMS
      //     gitmemesi, numaranın korumasız durmasından iyidir.
      let cozumTelefonu = null;
      if (cozumSmsiAcik && telefon && sifrelemeHazir()) {
        try {
          cozumTelefonu = sirSifrele(String(telefon));
        } catch (e) {
          console.error('çözüm telefonu şifrelenemedi, saklanmıyor:', e?.message);
        }
      }

      // 10. Şikayeti veritabanına kaydet. KVKK: TC saklanmaz; ad/soyad/telefon yalnızca
      //     açık rıza ile + onay zaman damgası/metin sürümüyle birlikte tutulur.
      const sikayet = await this.sikayetRepo.olustur({
        tenantId,
        sokakId,
        // Kayıtlı olmayan bir sokak seçildiyse adı; konum yine sokakId'nin (okutulan QR)
        // koordinatıdır, yalnız haritada/panelde gösterilecek ad bu olur. Yoksa null.
        bildirilenSokakAdi: bildirilenSokakAdi || null,
        kimlikHash,
        // KVKK veri minimizasyonu: ham ad/soyad/telefon SAKLANMAZ (yalnız kimlik_hash tutulur;
        // kötüye kullanımda başkan "Engelle" ile bu hash'i kara listeye ekler).
        ad: null,
        soyad: null,
        telefon: null,
        // ÇÖZÜM SMS'i için ŞİFRELİ telefon (bayrak kapalıysa null).
        telefonEnc: cozumTelefonu,
        kvkkOnay: true,
        kvkkOnayTarihi: new Date(),
        kvkkMetinSurumu,
        kategori,
        aciklama: temizAciklama,
        fotografUrl,
        durum: kufur.kufur ? SikayetDurumu.MODERASYONDA : SikayetDurumu.BEKLEMEDE,
        // Konum yazılmaz: şikayetin haritadaki yeri okutulan sokağın (QR'ın) sabit
        // koordinatıdır (repo sorguları sokaklar.enlem/boylam'ı okur).
      });

      // moderasyonda: çağıran route buna bakıp normal bildirim yerine moderasyon
      // botuna yönlendirir. kufurEslesme yalnız moderasyon mesajında gösterilir
      // (yanlış pozitifi tek bakışta anlamak için); vatandaşa ASLA sızmaz.
      return {
        basarili: true,
        sikayet,
        moderasyonda: kufur.kufur === true,
        kufurEslesme: kufur.eslesme || null,
        kufurTur: kufur.tur || null, // kufur | hakaret | isnat (moderasyon mesajı başlığı)
      };
    } finally {
      // Kritik bölüm bitti → kilidi hemen bırak (TTL'i bekleme; meşru tekrar denemeler
      // gereksiz "işleniyor" almasın). Kaybeden eşzamanlı istek zaten reddedilmişti.
      await kvDel(kimlikKilit);
    }
  }

  /**
   * KVKK İMHA GÖREVİ: sonuçlanmasının üzerinden KisiselVeriSabitleri.IMHA_GUN gün geçmiş
   * kayıtların şifreli telefonunu siler. Veri, amacı (çözüm bildirimi) gerçekleştikten
   * sonra tutulmaz.
   *
   * Periyodik çalışır (instrumentation.js) ve İDEMPOTENTTİR: aynı anda iki kez çalışsa
   * bile ikinci çağrı 0 kayıt bulur, zarar vermez.
   *
   * @returns {Promise<{silinen: number}>}
   */
  async cozumTelefonlariniImhaEt() {
    const esik = new Date(Date.now() - KisiselVeriSabitleri.IMHA_GUN * 86400000);
    const silinen = await this.sikayetRepo.cozumTelefonlariniImhaEt(esik);
    return { silinen };
  }

  /**
   * PERİYODİK İMHA (KVKK m.7 + Saklama ve İmha Yönetmeliği).
   * Aydınlatma metnindeki saklama süresi tablosunun KOD KARŞILIĞIDIR — metin ile
   * sistemin aynı şeyi söylemesi için süreler tek kaynaktan (KisiselVeriSabitleri)
   * okunur. "Yazıp yapmamak", denetimde hiç yazmamaktan daha kötüdür.
   *
   * Altı iş yapar:
   *  1. Çözüm SMS'i için tutulan şifreli telefonu siler (amaç gerçekleşti).
   *  2. Saklama süresi dolan başvuruların KİMLİK BAĞINI koparır (anonimleştirme):
   *     kayıt kalır, kişiye bağlanamaz. Fotoğrafı R2'den de siler.
   *  3. Soft-delete edilmiş kayıtları süresi dolunca GERÇEKTEN siler (+ fotoğraf).
   *  4. SMS güvenlik loglarını yaşlandırır.
   *  5. Kullanılmış/süresi dolmuş giriş belirteçlerini siler.
   *  6. Kara liste kayıtlarını yaşlandırır (süresiz engel = süresiz kişisel veri).
   *
   * İDEMPOTENT: ikinci çalıştırma 0 kayıt bulur. Her adım ayrı try/catch içinde —
   * biri patlarsa diğerleri yine çalışır (imha kısmen de olsa ilerlemelidir).
   * Adım başına LIMIT ile çalışır; kalan varsa bir sonraki turda toplanır.
   *
   * @param {{r2Sil?: (key: string) => Promise<any>, adminRepo?: object,
   *          personelRepo?: object, smsLogRepo?: object}} bagimliliklar
   * @returns {Promise<Object>} adım adım sayaçlar
   */
  async periyodikImha(bagimliliklar = {}) {
    const { r2Sil, adminRepo, personelRepo, smsLogRepo } = bagimliliklar;
    const S = KisiselVeriSabitleri;
    const gunOnce = (gun) => new Date(Date.now() - gun * 86400000);
    const sonuc = {
      telefon: 0, anonimlestirilen: 0, kaliciSilinen: 0,
      fotografSilinen: 0, smsLog: 0, belirtec: 0, engelli: 0, hatalar: [],
    };

    /** Bir adımı çalıştırır; patlarsa imhayı durdurmaz, hatayı toplar. */
    const adim = async (ad, fn) => {
      try { return await fn(); } catch (e) {
        sonuc.hatalar.push(`${ad}: ${e?.message || e}`);
        return null;
      }
    };

    /** Fotoğrafları R2'den siler (yapılandırılmamışsa sessizce atlanır). */
    const fotograflariSil = async (anahtarlar) => {
      if (!r2Sil || !anahtarlar?.length) return;
      for (const anahtar of anahtarlar) {
        try { await r2Sil(anahtar); sonuc.fotografSilinen++; }
        catch (e) { sonuc.hatalar.push(`foto ${anahtar}: ${e?.message || e}`); }
      }
    };

    // 1. Çözüm telefonu
    await adim('telefon', async () => {
      const r = await this.cozumTelefonlariniImhaEt();
      sonuc.telefon = r.silinen;
    });

    // 2. Anonimleştirme (+ fotoğraf)
    await adim('anonim', async () => {
      const r = await this.sikayetRepo.anonimlestir(gunOnce(S.BASVURU_ANONIM_GUN));
      sonuc.anonimlestirilen = r.adet;
      await fotograflariSil(r.fotografAnahtarlari);
    });

    // 3. Soft-delete edilmişlerin kalıcı silinmesi (+ fotoğraf)
    await adim('kalici-sil', async () => {
      const r = await this.sikayetRepo.silinenleriKaliciSil(gunOnce(S.SILINEN_KALICI_GUN));
      sonuc.kaliciSilinen = r.adet;
      await fotograflariSil(r.fotografAnahtarlari);
    });

    // 4. SMS güvenlik logları
    if (smsLogRepo) {
      await adim('sms-log', async () => {
        sonuc.smsLog = await smsLogRepo.eskileriSil(gunOnce(S.SMS_LOG_GUN));
      });
    }

    // 5. Belirteçler (magic link + personel bağlantı kodu)
    const belirtecEsigi = gunOnce(S.BELIRTEC_GUN);
    if (adminRepo) {
      await adim('magic-link', async () => {
        sonuc.belirtec += await adminRepo.eskiMagicLinkleriSil(belirtecEsigi);
      });
    }
    if (personelRepo) {
      await adim('personel-kodu', async () => {
        sonuc.belirtec += await personelRepo.eskiBaglantiKodlariniSil(belirtecEsigi);
      });
    }

    // 6. Kara liste yaşlandırma — 0 verilirse imha KAPALI (engel süresiz kalır)
    if (S.ENGELLI_GUN > 0) {
      await adim('engelli', async () => {
        sonuc.engelli = await this.sikayetRepo.engellileriYaslandir(gunOnce(S.ENGELLI_GUN));
      });
    }

    return sonuc;
  }

  /**
   * Tüm aktif (silinmemiş) şikayetleri getirir (başkanın haritası için).
   * @param {number} tenantId - Belediye (sunucuda çözülür)
   * @param {{limit?: number, offset?: number}} [opts]
   * @returns {Promise<Array>}
   */
  async aktifSikayetleriGetir(tenantId, opts = {}) {
    return await this.sikayetRepo.aktiflerinTumunuGetir(tenantId, opts);
  }

  /**
   * Bir şikayetin fotoğraf anahtarını (R2 key) getirir — yalnızca o belediyenin
   * kaydı için. Başkanın yetkili fotoğraf görüntüleme route'u kullanır.
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @returns {Promise<string|null>} R2 anahtarı veya null
   */
  async fotografKeyGetir(id, tenantId) {
    if (!uuidGecerliMi(id)) return null;
    const sikayet = await this.sikayetRepo.idIleGetir(id, tenantId);
    return sikayet?.fotografUrl || null;
  }

  /**
   * SMS/doğrulama GÖNDERİLMEDEN ÖNCE haftalık limit ön-kontrolü. Telefon→kimlikHash
   * (`sha256('tel:'+std)`) → pencere içi şikayet sayısı.
   * Limit doluysa {dolu:true} döner → arayan SMS ÜRETMEDEN kullanıcıyı durdurur (boşa
   * SMS parası gitmesin). Bu bir OPTİMİZASYONDUR; asıl otorite yine olustur() içindeki
   * DB sayımıdır (yarış/edge). Telefon geçersizse bloklama yapmaz (asıl doğrulama sonra).
   * @param {string} telefon
   * @param {number} tenantId
   * @returns {Promise<{dolu: boolean, kalanGun?: number, adet?: number}>}
   */
  async telefonHaftalikDolu(telefon, tenantId) {
    const std = telefonuStandartlastir(String(telefon || ''));
    if (!telefonGecerliMi(std)) return { dolu: false };
    const kimlikHash = sha256Hashle(`tel:${std}`);
    const adet = RateLimitKurallari.SIKAYET_PENCERE_ADET;
    const pencereBaslangici = new Date(Date.now() - RateLimitKurallari.TC_BEKLEME_SURESI_MS);
    const mevcut = await this.sikayetRepo.pencereSikayetSayisiGetir(kimlikHash, tenantId, pencereBaslangici);
    if (mevcut < adet) return { dolu: false };
    const enEski = await this.sikayetRepo.enEskiPencereSikayetZamani(kimlikHash, tenantId, pencereBaslangici);
    const serbestKalma = enEski ? enEski.getTime() + RateLimitKurallari.TC_BEKLEME_SURESI_MS : Date.now();
    const kalanGun = Math.max(1, Math.ceil((serbestKalma - Date.now()) / (24 * 60 * 60 * 1000)));
    return { dolu: true, kalanGun, adet };
  }

  /**
   * Telefon (→ kimlik hash) kara listede mi? on-kontrol (SMS öncesi) için — engellenmiş
   * numaraya SMS gönderilmesin (kredi yanmasın). Geçersiz telefonda false (asıl kapı olustur).
   */
  async telefonEngelliMi(telefon, tenantId) {
    const std = telefonuStandartlastir(String(telefon || ''));
    if (!telefonGecerliMi(std)) return false;
    return this.sikayetRepo.engelliMi(tenantId, sha256Hashle(`tel:${std}`));
  }

  /**
   * Bir şikayeti (kimlik_hash'i üzerinden) kara listeye ekler — başkanın "Engelle"
   * butonundan çağrılır. Ham telefon gerekmez; hash zaten şikayette saklı.
   */
  async sikayetiEngelle(sikayetId, tenantId) {
    const kimlikHash = await this.sikayetRepo.kimlikHashGetir(sikayetId, tenantId);
    if (!kimlikHash) return { basarili: false, hata: 'Şikayet bulunamadı.' };
    await this.sikayetRepo.engelle(tenantId, kimlikHash, 'admin');
    return { basarili: true };
  }

  /**
   * Başkanın (admin) kötüye kullanım/trol şikayeti için TALEP ÜZERİNE çektiği kimlik.
   * KVKK: ad/soyad/telefon toplu listede AKMAZ; yalnız bu metotla, yetkili uçtan, tek
   * şikayet için döner (erişim ayrıca loglanır — bkz. route). Yalnız o belediyenin kaydı.
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @returns {Promise<{ad: string|null, soyad: string|null, telefon: string|null, olusturmaTarihi: Date}|null>}
   */
  async kimlikGetir(id, tenantId) {
    if (!uuidGecerliMi(id)) return null;
    const s = await this.sikayetRepo.idIleGetir(id, tenantId);
    if (!s) return null;
    return {
      ad: s.ad || null,
      soyad: s.soyad || null,
      telefon: s.telefon || null,
      olusturmaTarihi: s.olusturmaTarihi,
    };
  }

  /**
   * Şikayet durumunu günceller (başkan tarafından, yalnızca kendi belediyesinde).
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @param {string} yeniDurum - Yeni durum (beklemede | inceleniyor | cozuldu)
   * @returns {Promise<{basarili: boolean, hata?: string}>}
   */
  async durumGuncelle(id, tenantId, yeniDurum) {
    if (!uuidGecerliMi(id)) {
      return { basarili: false, hata: 'Geçersiz şikayet kimliği.' };
    }

    const sikayet = await this.sikayetRepo.idIleGetir(id, tenantId);
    if (!sikayet) {
      return { basarili: false, hata: 'Şikayet bulunamadı.' };
    }

    // Durum sözlüğü tek otoriteden okunur (constants.SikayetDurumlari):
    // beklemede → inceleniyor → cozuldu.
    if (!durumGecerliMi(yeniDurum)) {
      return { basarili: false, hata: 'Geçersiz durum değeri.' };
    }

    // Çağıran (admin ucu) çözüm SMS'inin gönderilip gönderilmeyeceğine buna bakarak
    // karar verir: kayıt ZATEN sonuçlanmışsa yeni bir bildirim üretilmemeli
    // (aynı düğmeye ikinci kez basmak ya da 'cozuldu' → 'uygulanacak' geçişi).
    const zatenKapaliydi = durumKapaliMi(sikayet.durum);
    const guncellenen = await this.sikayetRepo.durumGuncelle(id, tenantId, yeniDurum);
    return { basarili: true, sikayet: guncellenen, zatenKapaliydi };
  }

  /**
   * Bir şikayeti bir personele atar (başkan tarafından).
   * Atama yapılınca, durum `beklemede` ise `inceleniyor`'a çekilir.
   *
   * NOT: Personelin bu belediyeye ait ve aktif olduğu doğrulaması, çağıran
   * route'ta PersonelService.personelGetir ile yapılır (orada personel kaydı
   * zaten Telegram bildirimi için gerekiyor). Burada şikayet tarafı doğrulanır.
   *
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @param {string} personelId - Atanacak personel UUID'si
   * @returns {Promise<{basarili: boolean, sikayet?: Object, hata?: string}>}
   */
  async personelAta(id, tenantId, personelId) {
    if (!uuidGecerliMi(id) || !uuidGecerliMi(personelId)) {
      return { basarili: false, hata: 'Geçersiz kimlik.' };
    }

    const sikayet = await this.sikayetRepo.idIleGetir(id, tenantId);
    if (!sikayet) {
      return { basarili: false, hata: 'Şikayet bulunamadı.' };
    }

    let guncel = await this.sikayetRepo.personelAta(id, tenantId, personelId);
    // Atama, işin ele alındığını gösterir: bekleyen şikayeti "inceleniyor"a çek
    if (sikayet.durum === SikayetDurumu.BEKLEMEDE) {
      guncel = await this.sikayetRepo.durumGuncelle(id, tenantId, SikayetDurumu.INCELENIYOR);
    }

    return { basarili: true, sikayet: guncel };
  }

  /**
   * Bir şikayetin personel atamasını kaldırır (başkan tarafından).
   * @returns {Promise<{basarili: boolean, hata?: string}>}
   */
  async personelAtamaKaldir(id, tenantId) {
    if (!uuidGecerliMi(id)) {
      return { basarili: false, hata: 'Geçersiz şikayet kimliği.' };
    }
    const sikayet = await this.sikayetRepo.idIleGetir(id, tenantId);
    if (!sikayet) {
      return { basarili: false, hata: 'Şikayet bulunamadı.' };
    }
    await this.sikayetRepo.personelAtamaKaldir(id, tenantId);
    return { basarili: true };
  }

  /**
   * Şikayeti soft-delete ile siler (başkan tarafından, yalnızca kendi belediyesinde).
   *
   * @param {string} id - Şikayet UUID'si
   * @param {number} tenantId
   * @returns {Promise<{basarili: boolean, hata?: string}>}
   */
  async sil(id, tenantId) {
    if (!uuidGecerliMi(id)) {
      return { basarili: false, hata: 'Geçersiz şikayet kimliği.' };
    }

    const sikayet = await this.sikayetRepo.idIleGetir(id, tenantId);
    if (!sikayet) {
      return { basarili: false, hata: 'Şikayet bulunamadı.' };
    }

    if (sikayet.durum === SikayetDurumu.SILINDI) {
      return { basarili: false, hata: 'Bu şikayet zaten silinmiş.' };
    }

    await this.sikayetRepo.softDelete(id, tenantId);
    return { basarili: true };
  }
}
