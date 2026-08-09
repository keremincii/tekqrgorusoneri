import { rastgeleTokenUret, sha256Hashle } from '@/lib/security/hmac.js';
import { adGecerliMi, telefonGecerliMi, telefonuStandartlastir, uuidGecerliMi } from '@/lib/utils/validators.js';
import { PersonelRolleri } from '@/lib/utils/constants.js';

const GECERLI_ROLLER = Object.values(PersonelRolleri);

/**
 * PersonelService - Saha Ekibi Yönetimi (Başkan tarafı)
 *
 * Başkanın panelden personel ekleme/listeleme/pasifleştirme ve her personel için
 * tek-kullanımlık Telegram bağlantı linki üretme işlemleri.
 *
 * Telegram /start onboarding (magic-link deseninin Telegram karşılığı):
 * 1. Başkan panelden "bağlantı linki oluştur" → 64 karakterlik token üretilir,
 *    SHA-256 hash'i DB'ye yazılır (token kendisi yalnızca linkte yaşar).
 * 2. Başkan linki personele WhatsApp'tan gönderir: https://t.me/<bot>?start=<token>
 * 3. Personel tıklar → bot /start <token> alır → token doğrulanır → personelin
 *    Telegram chat_id'si kaydına bağlanır (bkz. TelegramService).
 *
 * Single Responsibility: Sadece personel yönetimi + bağlantı kodu üretimi.
 */
export class PersonelService {
  /**
   * @param {import('../infrastructure/repositories/PersonelRepository.js').PersonelRepository} personelRepo
   */
  constructor(personelRepo) {
    this.personelRepo = personelRepo;
  }

  /**
   * Yeni personel ekler (saha personeli, başkan veya başkan yardımcısı).
   * @param {{rol?: string, birimId?: string|null}} [opts]
   * @returns {Promise<{basarili: boolean, personel?: Object, hata?: string}>}
   */
  async personelEkle(tenantId, ad, soyad, telefon, { rol = PersonelRolleri.PERSONEL, birimId = null } = {}) {
    if (!tenantId) return { basarili: false, hata: 'Belediye belirlenemedi.' };
    if (!adGecerliMi(ad)) return { basarili: false, hata: 'Geçerli bir ad girin (en az 2 harf).' };
    if (!adGecerliMi(soyad)) return { basarili: false, hata: 'Geçerli bir soyad girin (en az 2 harf).' };
    if (!GECERLI_ROLLER.includes(rol)) return { basarili: false, hata: 'Geçersiz rol.' };

    let temizTelefon = null;
    if (telefon && String(telefon).trim()) {
      if (!telefonGecerliMi(telefon)) {
        return { basarili: false, hata: 'Telefon numarası geçersiz (05XX XXX XX XX).' };
      }
      temizTelefon = telefonuStandartlastir(String(telefon));
    }

    // Başkan/yardımcı birime bağlı DEĞİL; yalnız saha personelinde birim anlamlı.
    let temizBirimId = null;
    if (rol === PersonelRolleri.PERSONEL && birimId) {
      if (!uuidGecerliMi(birimId)) return { basarili: false, hata: 'Geçersiz birim.' };
      temizBirimId = birimId;
    }

    const personel = await this.personelRepo.olustur(
      tenantId, ad.trim(), soyad.trim(), temizTelefon, rol, temizBirimId,
    );
    return { basarili: true, personel };
  }

  /** Bir personelin birimini değiştirir (yalnız saha personeli). */
  async personelBirimAta(tenantId, id, birimId) {
    if (!uuidGecerliMi(id)) return { basarili: false, hata: 'Geçersiz personel kimliği.' };
    if (birimId && !uuidGecerliMi(birimId)) return { basarili: false, hata: 'Geçersiz birim.' };
    const sonuc = await this.personelRepo.birimAta(id, tenantId, birimId || null);
    if (!sonuc) return { basarili: false, hata: 'Personel bulunamadı.' };
    return { basarili: true, personel: sonuc };
  }

  /**
   * Bir belediyenin aktif personellerini listeler (panel için sadeleştirilmiş).
   * chat_id ham olarak SIZDIRILMAZ; yalnızca "Telegram'a bağlandı mı" bilgisi döner.
   * @returns {Promise<Array<{id, ad, soyad, telefon, telegramBagli}>>}
   */
  async personelListele(tenantId) {
    const liste = await this.personelRepo.tenantPersonelleriGetir(tenantId, { sadeceAktif: true });
    return liste.map((p) => ({
      id: p.id,
      ad: p.ad,
      soyad: p.soyad,
      telefon: p.telefon,
      rol: p.rol,
      birimId: p.birimId,
      telegramBagli: Boolean(p.telegramChatId),
    }));
  }

  /**
   * Tek bir personeli getirir (tam kayıt; atama akışı için — chat_id dahil).
   * @returns {Promise<Object|null>}
   */
  async personelGetir(id, tenantId) {
    if (!uuidGecerliMi(id)) return null;
    return await this.personelRepo.idIleGetir(id, tenantId);
  }

  /**
   * Personeli pasifleştirir (Telegram bağlantısı da koparılır).
   * @returns {Promise<{basarili: boolean, hata?: string}>}
   */
  async personelPasifYap(tenantId, id) {
    if (!uuidGecerliMi(id)) return { basarili: false, hata: 'Geçersiz personel kimliği.' };
    const sonuc = await this.personelRepo.pasifYap(id, tenantId);
    if (!sonuc) return { basarili: false, hata: 'Personel bulunamadı.' };
    return { basarili: true };
  }

  /**
   * Bir personel için tek-kullanımlık Telegram bağlantı linki üretir.
   *
   * @param {number} tenantId
   * @param {string} personelId
   * @param {string} botUsername - TELEGRAM_BOT_USERNAME (@'siz)
   * @returns {Promise<{basarili: boolean, link?: string, hata?: string}>}
   */
  async baglantiKoduUret(tenantId, personelId, botUsername) {
    if (!uuidGecerliMi(personelId)) return { basarili: false, hata: 'Geçersiz personel kimliği.' };
    if (!botUsername) {
      return { basarili: false, hata: 'TELEGRAM_BOT_USERNAME tanımlı değil (sunucu yapılandırması).' };
    }

    // Personelin bu belediyeye ait ve aktif olduğunu doğrula
    const personel = await this.personelRepo.idIleGetir(personelId, tenantId);
    if (!personel || !personel.aktif) {
      return { basarili: false, hata: 'Personel bulunamadı veya aktif değil.' };
    }

    // Telegram deep-link start parametresi en fazla 64 karakter olabilir.
    // 32 byte → 64 hex karakter ([0-9a-f], izinli küme) → tam sığar.
    const token = rastgeleTokenUret(32);
    const tokenHash = sha256Hashle(token);
    await this.personelRepo.baglantiKoduOlustur(tokenHash, tenantId, personelId);

    const link = `https://t.me/${botUsername}?start=${token}`;
    return { basarili: true, link };
  }
}
