import { SikayetDurumu, VARSAYILAN_TUR, turGecerliMi, durumKapaliMi, sonrakiDurumlar } from '@/lib/utils/constants.js';
import { aciklamaGecerliMi, basvuruTuruGecerliMi, ACIKLAMA_MAX } from '@/lib/utils/validators.js';

/**
 * Başvuru (Şikayet / Görüş / Öneri) — Domain Entity
 * =================================================
 *
 * Clean Architecture: hiçbir altyapıya (DB, HTTP, Redis) bağımlı değildir; yalnız saf
 * sabitleri ve doğrulayıcıları kullanır. Bir başvurunun "geçerli olma" kuralları TEK
 * yerde, burada tanımlıdır — servis, API ucu ve panel bunu tekrar yazmaz.
 *
 * Single Responsibility : Yalnızca bir başvuruyu temsil eder ve kendi kurallarını bilir.
 * Open/Closed           : Yeni tür/durum eklemek constants.js'i değiştirmeyi gerektirir,
 *                         bu sınıfı DEĞİL (ikisi de listeden türetilir).
 *
 * HATA YERİNE SONUÇ: `dogrula()` istisna FIRLATMAZ, `{gecerli, hata}` döner. Geçersiz
 * kullanıcı girdisi istisnai bir durum değil, beklenen bir akıştır; try/catch ile
 * yönetmek hem hata mesajının özgüllüğünü kaybettirir hem de gerçek programlama
 * hatalarını (asıl istisnaları) girdi hatalarının içinde gizler.
 *
 * (Eski adı `Sikayet` idi. Ürün üç türü de aynı akışla aldığı için "şikayet" adı artık
 *  parçayı bütünün yerine koyuyordu: bir öneri de bu sınıfın örneğidir.)
 */
export class Basvuru {
  /**
   * @param {Object} p
   * @param {string} [p.id] - UUID (DB üretir; yeni nesnede boş olabilir)
   * @param {string} p.tur - constants.BasvuruTurleri id'si ('sikayet'|'gorus'|'oneri')
   * @param {string} p.sokakId - Okutulan QR noktasının UUID'si
   * @param {string} p.kimlikHash - Doğrulanmış telefonun SHA-256 özeti (TC saklanmaz)
   * @param {string} p.aciklama - Vatandaşın yazdığı metin (bu üründe ZORUNLU içerik)
   * @param {string|null} [p.fotografUrl] - R2 nesne anahtarı
   * @param {string} [p.durum]
   * @param {Date} [p.olusturmaTarihi]
   */
  constructor({
    id = null,
    tur = VARSAYILAN_TUR,
    sokakId,
    kimlikHash,
    aciklama,
    fotografUrl = null,
    durum = SikayetDurumu.BEKLEMEDE,
    olusturmaTarihi = new Date(),
  }) {
    this.id = id;
    this.tur = tur;
    this.sokakId = sokakId;
    this.kimlikHash = kimlikHash;
    this.aciklama = typeof aciklama === 'string' ? aciklama.trim() : '';
    this.fotografUrl = fotografUrl;
    this.durum = durum;
    this.olusturmaTarihi = olusturmaTarihi;
  }

  /**
   * Bir başvuru taslağını doğrular ve normalleştirir. Kurucudan AYRI bir statik
   * fabrikadır ki çağıran, geçersiz girdiyi istisna yakalamadan ele alabilsin.
   *
   * @param {Object} taslak - Kurucunun aldığı alanlar
   * @returns {{gecerli: boolean, basvuru?: Basvuru, hata?: string}}
   */
  static olustur(taslak) {
    const basvuru = new Basvuru(taslak);
    const sonuc = basvuru.dogrula();
    return sonuc.gecerli ? { gecerli: true, basvuru } : sonuc;
  }

  /**
   * Alan kurallarını sırayla uygular; ilk ihlalde durur.
   * Mesajlar VATANDAŞA gösterilebilecek düzeydedir (teknik ayrıntı sızdırmaz).
   * @returns {{gecerli: boolean, hata?: string}}
   */
  dogrula() {
    if (!basvuruTuruGecerliMi(this.tur)) {
      return { gecerli: false, hata: 'Lütfen başvuru türünü seçin.' };
    }
    // Metin ZORUNLUDUR: kategori sorulmadığı için başvurunun tek içeriği budur.
    if (!aciklamaGecerliMi(this.aciklama, true)) {
      return this.aciklama.length > ACIKLAMA_MAX
        ? { gecerli: false, hata: `Metin en fazla ${ACIKLAMA_MAX} karakter olabilir.` }
        : { gecerli: false, hata: 'Lütfen iletmek istediğinizi yazın.' };
    }
    if (!Object.values(SikayetDurumu).includes(this.durum)) {
      return { gecerli: false, hata: 'Geçersiz başvuru durumu.' };
    }
    return { gecerli: true };
  }

  /**
   * Durum geçişini uygular. İzinli geçişler constants.sonrakiDurumlar'dan gelir —
   * durum makinesi bu sınıfta İKİNCİ KEZ yazılmaz (eskiden burada elle tutulan geçiş
   * tablosu, panelin kullandığı sözlükle sessizce ayrışabiliyordu).
   * @param {string} yeniDurum
   * @returns {{gecerli: boolean, hata?: string}}
   */
  durumaGec(yeniDurum) {
    const izinli = sonrakiDurumlar(this.durum).some((d) => d.id === yeniDurum);
    if (!izinli) {
      return { gecerli: false, hata: `"${this.durum}" durumundan "${yeniDurum}" durumuna geçilemez.` };
    }
    this.durum = yeniDurum;
    return { gecerli: true };
  }

  /** Başvuru sonuçlandı mı? (durum SINIFINA bakar; tek tek durum saymaz) */
  get kapaliMi() {
    return durumKapaliMi(this.durum);
  }

  /** Tür geçerli mi? (dışarıdan hızlı kontrol) */
  get turGecerliMi() {
    return turGecerliMi(this.tur);
  }

  /** Kalıcı katmana yazılacak düz nesne. */
  toJSON() {
    return {
      id: this.id,
      tur: this.tur,
      sokakId: this.sokakId,
      kimlikHash: this.kimlikHash,
      aciklama: this.aciklama,
      fotografUrl: this.fotografUrl,
      durum: this.durum,
      olusturmaTarihi: this.olusturmaTarihi,
    };
  }
}
