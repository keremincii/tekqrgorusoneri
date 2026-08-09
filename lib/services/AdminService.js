import { rastgeleTokenUret, sha256Hashle } from '@/lib/security/hmac.js';
import { GuvenlikSabitleri } from '@/lib/utils/constants.js';

/**
 * Bir oturumun süresinin dolup dolmadığını kontrol eder (kayan pencere).
 * sonErisimTarihi + ADMIN_OTURUM_SURESI_MS geçmişse oturum geçersizdir.
 * @param {{sonErisimTarihi: Date|string}} oturum
 * @returns {boolean}
 */
function oturumSuresiDolduMu(oturum) {
  const sonErisim = new Date(oturum.sonErisimTarihi).getTime();
  return Date.now() - sonErisim > GuvenlikSabitleri.ADMIN_OTURUM_SURESI_MS;
}

/**
 * AdminService - Admin Giriş ve Oturum Yönetimi Servisi
 * 
 * Magic Link mantığı:
 * 1. Geliştirici (Kerem) → "magic link üret" komutu çalıştırır
 * 2. Sistem 128 hex karakterlik token üretir ve HASH'ini DB'ye yazar
 * 3. Kerem linki başkana WhatsApp'tan atar
 * 4. Başkan tıklar → Backend token hash'ini DB'de arar
 * 5. Bulursa ve kullanılmamışsa → "kullanıldı" işaretler, oturum çerezi verir
 * 6. Başkan artık sonsuza kadar giriş yapmış durumdadır
 * 
 * Single Responsibility: Sadece admin kimlik doğrulama işlemleri.
 */
export class AdminService {
  /**
   * @param {import('../../infrastructure/repositories/AdminRepository.js').AdminRepository} adminRepo
   */
  constructor(adminRepo) {
    this.adminRepo = adminRepo;
  }

  /**
   * Yeni magic link üretir (sadece geliştirici tarafından çağrılır).
   * 
   * @param {string} baseUrl - Uygulama URL'si (örn: https://sikayet.gulsehir.bel.tr)
   * @returns {Promise<{link: string, token: string}>}
   */
  async magicLinkUret(baseUrl, tenantId) {
    // 128 hex karakter (64 byte) uzunluğunda kriptografik token
    const token = rastgeleTokenUret(GuvenlikSabitleri.MAGIC_LINK_TOKEN_BYTE);

    // Token'ın kendisini DEĞİL, hash'ini veritabanına kaydet
    const tokenHash = sha256Hashle(token);
    await this.adminRepo.magicLinkOlustur(tokenHash, tenantId);

    // Linki oluştur (token sadece link içinde yaşar, DB'de hash var)
    const link = `${baseUrl}/api/admin/magic-link/${token}`;

    return { link, token };
  }

  /**
   * Magic link ile giriş yapar.
   *
   * @param {string} token - URL'den gelen 128 hex karakterlik token
   * @param {number} tenantId - İsteğin ait olduğu belediye (sunucuda çözülür)
   * @returns {Promise<{basarili: boolean, oturumTokeni?: string, hata?: string}>}
   */
  async magicLinkIleGiris(token, tenantId) {
    if (!token || typeof token !== 'string' || token.length < 64) {
      return { basarili: false, hata: 'Geçersiz giriş linki.' };
    }
    if (!tenantId) {
      return { basarili: false, hata: 'Belediye belirlenemedi.' };
    }

    // Token'ı hashle ve DB'de ara (yalnızca bu belediyenin linkleri arasında)
    const tokenHash = sha256Hashle(token);
    const magicLink = await this.adminRepo.magicLinkBul(tokenHash, tenantId);

    if (!magicLink) {
      return { basarili: false, hata: 'Geçersiz veya süresi dolmuş giriş linki.' };
    }

    if (magicLink.kullanildi) {
      return { basarili: false, hata: 'Bu giriş linki daha önce kullanılmış. Lütfen yeni bir link isteyin.' };
    }

    // Son geçerlilik kontrolü (süresi dolmuş link kabul edilmez)
    if (magicLink.sonGecerlilikTarihi && Date.now() > new Date(magicLink.sonGecerlilikTarihi).getTime()) {
      return { basarili: false, hata: 'Bu giriş linkinin süresi dolmuş. Lütfen yeni bir link isteyin.' };
    }

    // ATOMİK tek-kullanım: yalnızca kullanildi=false ise "kullanıldı" yapıp satırı döndürür.
    // Eşzamanlı iki istek yarışırsa yalnız BİRİ satırı alır (RETURNING), diğeri null → reddedilir.
    // (Yukarıdaki kullanildi kontrolü hızlı yol/dostane mesaj içindir; asıl garanti budur.)
    const claim = await this.adminRepo.magicLinkKullanildiIsaretle(magicLink.id);
    if (!claim) {
      return { basarili: false, hata: 'Bu giriş linki daha önce kullanılmış. Lütfen yeni bir link isteyin.' };
    }

    // Yeni oturum tokeni oluştur (çerez için), bu belediyeye bağlı. Magic link'in
    // etiketi (Başkan/Yardımcı/Admin) oturuma taşınır → kimlik görüntüleme logunda
    // "kim baktı" görünür (KVKK hesap verebilirlik).
    const oturumTokeni = rastgeleTokenUret(32); // 64 hex karakter
    const oturumHash = sha256Hashle(oturumTokeni);
    await this.adminRepo.oturumOlustur(oturumHash, tenantId, magicLink.etiket || null);

    return { basarili: true, oturumTokeni };
  }

  /**
   * Oturumu doğrular VE sahibinin etiketini döndürür (kimlik görüntüleme logu için
   * "kim baktı"). oturumDogrula ile aynı geçerlilik/kayan-pencere mantığı; farkı yalnız
   * etiketi de döndürmesi.
   * @param {string} oturumTokeni
   * @param {number} tenantId
   * @returns {Promise<{gecerli: boolean, etiket?: string|null}>}
   */
  async oturumBilgisiGetir(oturumTokeni, tenantId) {
    if (!oturumTokeni || typeof oturumTokeni !== 'string' || !tenantId) return { gecerli: false };
    const oturumHash = sha256Hashle(oturumTokeni);
    const oturum = await this.adminRepo.aktifOturumBul(oturumHash, tenantId);
    if (!oturum) return { gecerli: false };
    if (oturumSuresiDolduMu(oturum)) {
      await this.adminRepo.oturumIptalEt(oturum.id);
      return { gecerli: false };
    }
    await this.adminRepo.sonErisimiGuncelle(oturum.id);
    return { gecerli: true, etiket: oturum.etiket || null };
  }

  /**
   * Oturum çerezini doğrular (her admin sayfası isteğinde çağrılır).
   * 
   * @param {string} oturumTokeni - Çerezden gelen oturum tokeni
   * @returns {Promise<boolean>} Oturum geçerli mi?
   */
  async oturumDogrula(oturumTokeni, tenantId) {
    if (!oturumTokeni || typeof oturumTokeni !== 'string' || !tenantId) return false;

    const oturumHash = sha256Hashle(oturumTokeni);
    const oturum = await this.adminRepo.aktifOturumBul(oturumHash, tenantId);

    if (!oturum) return false;

    // Kayan pencere: çok uzun süredir kullanılmayan oturumu geçersiz say + iptal et
    if (oturumSuresiDolduMu(oturum)) {
      await this.adminRepo.oturumIptalEt(oturum.id);
      return false;
    }

    // Son erişim zamanını güncelle
    await this.adminRepo.sonErisimiGuncelle(oturum.id);
    return true;
  }

  /**
   * Oturumu sonlandırır (çıkış). Çerezdeki token'ın oturumunu iptal eder.
   * @param {string} oturumTokeni - Çerezden gelen oturum tokeni
   * @param {number} tenantId
   * @returns {Promise<boolean>} İşlem yapıldı mı?
   */
  async cikisYap(oturumTokeni, tenantId) {
    if (!oturumTokeni || typeof oturumTokeni !== 'string' || !tenantId) return false;

    const oturumHash = sha256Hashle(oturumTokeni);
    const oturum = await this.adminRepo.aktifOturumBul(oturumHash, tenantId);
    if (!oturum) return false;

    await this.adminRepo.oturumIptalEt(oturum.id);
    return true;
  }
}
