import { SikayetDurumu } from '@/lib/utils/constants.js';

/**
 * Şikayet (Complaint) Domain Entity
 * 
 * Clean Architecture: Entity sınıfı hiçbir dış bağımlılığa sahip değildir.
 * Open/Closed: Yeni durumlar eklenebilir, mevcut mantık değişmez.
 * Single Responsibility: Sadece bir şikayeti temsil eder.
 */
export class Sikayet {
  /**
   * @param {Object} params
   * @param {string} params.id - UUID v4 formatında benzersiz kimlik
   * @param {string} params.sokakId - İlişkili sokağın UUID'si
   * @param {string} params.kimlikHash - doğrulanmış telefonun hash'i; NVİ açıkken
   *   ad+soyad+doğum+telefon kombinasyonu (TC saklanmaz)
   * @param {string} params.aciklama - Şikayet açıklaması
   * @param {string|null} [params.fotografUrl] - Yüklenen fotoğrafın URL'si
   * @param {string} [params.durum] - Şikayetin mevcut durumu
   * @param {Date} [params.olusturmaTarihi] - Şikayetin oluşturulma tarihi
   */
  constructor({
    id,
    sokakId,
    kimlikHash,
    aciklama,
    fotografUrl = null,
    durum = SikayetDurumu.BEKLEMEDE,
    olusturmaTarihi = new Date(),
  }) {
    this.#dogrula(aciklama, durum);

    this.id = id;
    this.sokakId = sokakId;
    this.kimlikHash = kimlikHash;
    this.aciklama = aciklama.trim();
    this.fotografUrl = fotografUrl;
    this.durum = durum;
    this.olusturmaTarihi = olusturmaTarihi;
  }

  /** @private */
  #dogrula(aciklama, durum) {
    // Alt karakter sınırı YOKTUR (bkz. validators.aciklamaGecerliMi): kısa ama anlaşılır
    // başvurular ("çöp alınmadı") geçerlidir. Boş metin yine reddedilir.
    if (!aciklama || typeof aciklama !== 'string' || aciklama.trim().length === 0) {
      throw new Error('Şikayet açıklaması boş olamaz.');
    }
    if (aciklama.trim().length > 280) {
      throw new Error('Şikayet açıklaması en fazla 280 karakter olabilir.');
    }
    const gecerliDurumlar = Object.values(SikayetDurumu);
    if (!gecerliDurumlar.includes(durum)) {
      throw new Error(`Geçersiz durum: ${durum}. Geçerli durumlar: ${gecerliDurumlar.join(', ')}`);
    }
  }

  /** Şikayetin durumunu günceller (State Machine mantığı) */
  durumGuncelle(yeniDurum) {
    const gecisler = {
      [SikayetDurumu.BEKLEMEDE]: [SikayetDurumu.INCELENIYOR, SikayetDurumu.COZULDU],
      [SikayetDurumu.INCELENIYOR]: [SikayetDurumu.COZULDU, SikayetDurumu.BEKLEMEDE],
      [SikayetDurumu.COZULDU]: [], // Çözüldüyse geri alınamaz
    };

    const izinliGecisler = gecisler[this.durum] || [];
    if (!izinliGecisler.includes(yeniDurum)) {
      throw new Error(
        `"${this.durum}" durumundan "${yeniDurum}" durumuna geçiş yapılamaz.`
      );
    }

    this.durum = yeniDurum;
  }

  /** Şikayet beklemede mi? */
  get beklemedeMi() {
    return this.durum === SikayetDurumu.BEKLEMEDE;
  }

  /** Şikayet çözüldü mü? */
  get cozulduMu() {
    return this.durum === SikayetDurumu.COZULDU;
  }

  /** Entity'yi düz nesneye çevirir */
  toJSON() {
    return {
      id: this.id,
      sokakId: this.sokakId,
      kimlikHash: this.kimlikHash,
      aciklama: this.aciklama,
      fotografUrl: this.fotografUrl,
      durum: this.durum,
      olusturmaTarihi: this.olusturmaTarihi,
    };
  }
}
