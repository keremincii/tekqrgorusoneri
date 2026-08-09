import { uuidGecerliMi } from '@/lib/utils/validators.js';
import { SikayetKategorileri } from '@/lib/utils/constants.js';

const GECERLI_KATEGORILER = new Set(SikayetKategorileri.map((k) => k.id));

/**
 * BirimService - Birim (departman) yönetimi (Başkan tarafı)
 *
 * Başkan panelden birim oluşturur, birime hangi kategorilerin geleceğini seçer,
 * personelleri birime bağlar. Yeni şikayet gelince kategoriye bakılıp ilgili birimin
 * personellerine otomatik Telegram bildirimi gider (bkz. TelegramService.yeniSikayetBildir).
 *
 * Single Responsibility: Sadece birim + birim↔kategori yönetimi.
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
    return { basarili: true, birim: { id: birim.id, ad: birim.ad, kategoriler: [] } };
  }

  /**
   * Birimleri, her birinin kapsadığı kategorilerle listeler.
   * @returns {Promise<Array<{id, ad, kategoriler: string[]}>>}
   */
  async birimListele(tenantId) {
    const [birimListe, eslesmeler] = await Promise.all([
      this.birimRepo.tenantBirimleriGetir(tenantId, { sadeceAktif: true }),
      this.birimRepo.tenantKategoriEslesmeleri(tenantId),
    ]);
    const birimKategori = new Map();
    for (const e of eslesmeler) {
      if (!birimKategori.has(e.birimId)) birimKategori.set(e.birimId, []);
      birimKategori.get(e.birimId).push(e.kategori);
    }
    return birimListe.map((b) => ({
      id: b.id,
      ad: b.ad,
      kategoriler: birimKategori.get(b.id) || [],
    }));
  }

  /** Birimi pasifleştirir (kategori eşleşmeleri de silinir). */
  async birimSil(tenantId, id) {
    if (!uuidGecerliMi(id)) return { basarili: false, hata: 'Geçersiz birim kimliği.' };
    const sonuc = await this.birimRepo.pasifYap(id, tenantId);
    if (!sonuc) return { basarili: false, hata: 'Birim bulunamadı.' };
    return { basarili: true };
  }

  /**
   * Bir birimin kapsadığı kategori kümesini ayarlar (tam değiştirir). Geçersiz kategori
   * id'leri elenir. Aynı kategori başka birimlerde de kapsanabilir (çoklu atama) —
   * diğer birimlerin eşleşmelerine dokunulmaz.
   */
  async birimKategorileriAyarla(tenantId, birimId, kategoriler) {
    if (!uuidGecerliMi(birimId)) return { basarili: false, hata: 'Geçersiz birim kimliği.' };
    const birim = await this.birimRepo.idIleGetir(birimId, tenantId);
    if (!birim || !birim.aktif) return { basarili: false, hata: 'Birim bulunamadı.' };

    const gecerli = (Array.isArray(kategoriler) ? kategoriler : [])
      .filter((k) => GECERLI_KATEGORILER.has(k));
    await this.birimRepo.kategorileriAyarla(tenantId, birimId, gecerli);
    return { basarili: true, kategoriler: gecerli };
  }
}
