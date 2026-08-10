import { uuidGecerliMi } from '@/lib/utils/validators.js';

/**
 * BirimService - Birim (departman) yönetimi (Başkan tarafı)
 *
 * Birim, saha personelini GRUPLAYAN bir etikettir: başkan panelde bir başvuruyu
 * atarken kişileri birimlerine göre görür ("Fen İşleri → Ahmet Y.").
 *
 * BİRİM ARTIK BİR YÖNLENDİRME KURALI DEĞİLDİR. Eskiden her birim bir kategori kümesini
 * kapsıyor, yeni şikayet o kategorinin birimine otomatik düşüyordu. Kategori ekseni
 * kalkınca (vatandaşa sorulmuyor) eşleşmenin sol tarafı da kalmadı: iş dağıtımı artık
 * yönetimin ATAMA kararıdır. `birim_kategoriler` tablosu migration 0001 ile düştü.
 *
 * Single Responsibility: Sadece birim yönetimi (ekle / listele / kaldır).
 */
export class BirimService {
  /**
   * @param {import('../infrastructure/repositories/BirimRepository.js').BirimRepository} birimRepo
   */
  constructor(birimRepo) {
    this.birimRepo = birimRepo;
  }

  /** Yeni birim ekler. */
  async birimEkle(tenantId, ad) {
    if (!tenantId) return { basarili: false, hata: 'Belediye belirlenemedi.' };
    const temiz = String(ad || '').trim();
    if (temiz.length < 2) return { basarili: false, hata: 'Birim adı en az 2 karakter olmalı.' };
    if (temiz.length > 120) return { basarili: false, hata: 'Birim adı çok uzun.' };
    const birim = await this.birimRepo.olustur(tenantId, temiz);
    return { basarili: true, birim: { id: birim.id, ad: birim.ad } };
  }

  /**
   * Belediyenin aktif birimlerini listeler.
   * @returns {Promise<Array<{id: string, ad: string}>>}
   */
  async birimListele(tenantId) {
    const birimListe = await this.birimRepo.tenantBirimleriGetir(tenantId, { sadeceAktif: true });
    return birimListe.map((b) => ({ id: b.id, ad: b.ad }));
  }

  /** Birimi pasifleştirir (soft delete). Personeller silinmez, birimsiz kalır. */
  async birimSil(tenantId, id) {
    if (!uuidGecerliMi(id)) return { basarili: false, hata: 'Geçersiz birim kimliği.' };
    const sonuc = await this.birimRepo.pasifYap(id, tenantId);
    if (!sonuc) return { basarili: false, hata: 'Birim bulunamadı.' };
    return { basarili: true };
  }
}
