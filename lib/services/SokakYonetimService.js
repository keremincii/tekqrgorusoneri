import { imzaOlustur } from '@/lib/security/hmac.js';
import { qrKodUret } from '@/lib/security/kod.js';
import { qrLinkiOlustur } from '@/lib/server/qr.js';
import { uuidGecerliMi } from '@/lib/utils/validators.js';
import { TenantRepository } from '@/lib/infrastructure/repositories/TenantRepository.js';

/**
 * SokakYonetimService - Sokak Ekleme/Çıkarma/Listeleme Servisi
 * 
 * Bu servis, geliştiricinin (Kerem) kolayca sokak ekleyip çıkarabilmesini sağlar.
 * 
 * Open/Closed: Yeni sokak ekleme yöntemi (API, CSV, manuel) eklenebilir.
 * Single Responsibility: Sadece sokak yönetimi.
 * 
 * Kullanım senaryoları:
 * 1. İlk kurulumda CSV'den 146 sokak toplu yükleme
 * 2. Sonradan tek tek sokak ekleme/çıkarma
 * 3. Sokak adını veya koordinatını güncelleme
 */
export class SokakYonetimService {
  /**
   * @param {import('../../infrastructure/repositories/SokakRepository.js').SokakRepository} sokakRepo
   */
  constructor(sokakRepo) {
    this.sokakRepo = sokakRepo;
  }

  /**
   * Tek bir sokak ekler ve otomatik HMAC imzası üretir.
   * 
   * @param {string} sokakAdi - Sokak adı (büyük harfe çevrilir)
   * @param {number} enlem - GPS enlem değeri
   * @param {number} boylam - GPS boylam değeri
   * @returns {Promise<{basarili: boolean, sokak?: Object, qrLinki?: string, hata?: string}>}
   */
  async sokakEkle(tenantId, sokakAdi, enlem, boylam) {
    try {
      // Geçici UUID oluştur (DB default'u kullanılacak ama imza için lazım)
      const { v4: uuidv4 } = await import('uuid');
      const yeniId = uuidv4();

      // HMAC imzası üret
      const hmacImza = imzaOlustur(yeniId);

      // QR'a basılacak kısa opak base62 kod. qr_kod global UNIQUE → çakışmada
      // (astronomik düşük) yeniden üret. birkaç deneme sonrası hatayı yukarı ver.
      let sokak = null;
      let sonHata = null;
      for (let deneme = 0; deneme < 5; deneme++) {
        try {
          sokak = await this.sokakRepo.ekle({
            id: yeniId,
            tenantId,
            sokakAdi: sokakAdi.toUpperCase().trim(),
            enlem,
            boylam,
            hmacImza,
            qrKod: qrKodUret(),
          });
          break;
        } catch (e) {
          sonHata = e;
          if (!/unique|duplicate|qr_kod/i.test(e.message || '')) throw e; // başka hata → hemen fırlat
        }
      }
      if (!sokak) throw sonHata || new Error('qr_kod üretilemedi.');

      // QR'a kalıcı yönlendirici adresi basılır (form adresi değil); bkz. lib/server/qr.js
      const qrLinki = qrLinkiOlustur(sokak.qrKod);

      return { basarili: true, sokak, qrLinki };
    } catch (err) {
      return { basarili: false, hata: err.message };
    }
  }

  /**
   * CSV verisinden toplu sokak ekler.
   * scripts/seed-sokaklar.js tarafından çağrılır.
   * 
   * @param {Array<{sokakAdi: string, enlem: number, boylam: number}>} sokakListesi
   * @returns {Promise<{basarili: boolean, eklenen: number, qrLinkleri: Array, hata?: string}>}
   */
  async topluSokakEkle(tenantId, sokakListesi) {
    try {
      const { v4: uuidv4 } = await import('uuid');

      // Parti içi qr_kod benzersizliği (DB UNIQUE index'e ek erken güvence).
      const kullanilanKodlar = new Set();
      const benzersizKod = () => {
        let k;
        do { k = qrKodUret(); } while (kullanilanKodlar.has(k));
        kullanilanKodlar.add(k);
        return k;
      };

      const hazirVeri = sokakListesi.map(s => {
        const id = uuidv4();
        const hmacImza = imzaOlustur(id);
        return {
          id,
          tenantId,
          sokakAdi: s.sokakAdi.toUpperCase().trim(),
          enlem: s.enlem,
          boylam: s.boylam,
          hmacImza,
          qrKod: benzersizKod(),
        };
      });

      const eklenenler = await this.sokakRepo.topluEkle(hazirVeri);

      // QR'a kalıcı yönlendirici adresi basılır (form adresi değil); bkz. lib/server/qr.js
      const qrLinkleri = eklenenler.map(s => ({
        sokakAdi: s.sokakAdi,
        qrLinki: qrLinkiOlustur(s.qrKod),
      }));

      return { basarili: true, eklenen: eklenenler.length, qrLinkleri };
    } catch (err) {
      return { basarili: false, eklenen: 0, qrLinkleri: [], hata: err.message };
    }
  }

  /**
   * Sokağı pasif yapar (soft delete). QR kod artık çalışmaz.
   * @param {string} id - Sokak UUID'si
   */
  async sokakCikar(id, tenantId) {
    const sonuc = await this.sokakRepo.pasifYap(id, tenantId);
    if (!sonuc) return { basarili: false, hata: 'Sokak bulunamadı.' };
    return { basarili: true };
  }

  /**
   * Sokak bilgilerini günceller (ad veya koordinat değişikliği).
   * @param {string} id - Sokak UUID'si
   * @param {number} tenantId
   * @param {Object} veriler - { sokakAdi?, enlem?, boylam? }
   */
  async sokakGuncelle(id, tenantId, veriler) {
    const guncellenecek = {};
    if (veriler.sokakAdi) guncellenecek.sokakAdi = veriler.sokakAdi.toUpperCase().trim();
    if (veriler.enlem) guncellenecek.enlem = veriler.enlem;
    if (veriler.boylam) guncellenecek.boylam = veriler.boylam;

    const sonuc = await this.sokakRepo.guncelle(id, tenantId, guncellenecek);
    if (!sonuc) return { basarili: false, hata: 'Sokak bulunamadı.' };
    return { basarili: true, sokak: sonuc };
  }

  /**
   * Bir belediyenin tüm aktif sokaklarını listeler.
   * @param {number} tenantId
   * @returns {Promise<Array>}
   */
  async tumSokaklariListele(tenantId) {
    return await this.sokakRepo.tumunuGetir(tenantId);
  }

  /**
   * Tek bir sokağı, YALNIZCA verilen belediyeye (tenant) aitse getirir.
   * Vatandaşın formda seçtiği sokağın bu belediyeye ait + aktif olduğunu doğrulamak
   * için kullanılır (çapraz-tenant sokak enjeksiyonuna karşı). Bulunamazsa null.
   * @param {string} id - Sokak UUID'si
   * @param {number} tenantId
   * @returns {Promise<Object|null>}
   */
  async sokakGetir(id, tenantId) {
    return await this.sokakRepo.idIleGetir(id, tenantId);
  }

  /**
   * QR yönlendiricisi (app/q/[id]) için: bir QR referansını (yeni base62 `qr_kod`
   * VEYA eski basılı UUID `id`), ait olduğu AKTİF belediyeyle birlikte çözer.
   * Tenant-bağımsızdır (QR'lar tek kök adreste durur).
   *
   * Geriye uyum: yeni QR'lar 8 haneli kod taşır; UUID biçimindeki referanslar
   * (halihazırda basılı eski QR'lar) hâlâ id ile çözülür → eski levhalar ölmez.
   *
   * @param {string} deger - Sokağın qr_kod'u veya UUID'si
   * @returns {Promise<{basarili: boolean, sokak?: Object, tenant?: Object, hata?: string}>}
   */
  async qrHedefBul(deger) {
    const sokak = uuidGecerliMi(deger)
      ? await this.sokakRepo.idIleGetirGlobal(deger)
      : await this.sokakRepo.kodIleGetirGlobal(deger);
    if (!sokak) return { basarili: false, hata: 'Sokak bulunamadı.' };

    const tenantRepo = new TenantRepository();
    const tenant = await tenantRepo.idIleGetir(sokak.tenantId);
    if (!tenant || !tenant.aktif) {
      return { basarili: false, hata: 'Belediye bulunamadı veya pasif.' };
    }

    return { basarili: true, sokak, tenant };
  }
}
