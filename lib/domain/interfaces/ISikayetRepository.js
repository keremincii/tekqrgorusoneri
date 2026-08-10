/**
 * ISikayetRepository - Başvuru (şikayet/görüş/öneri) Veritabanı İşlemleri Arayüzü
 *
 * Dependency Inversion + Interface Segregation (SOLID): servis katmanı somut
 * SikayetRepository'yi değil, bu sözleşmeyi bilir. Test ortamında sahte (mock) bir
 * uygulama enjekte edilebilir.
 *
 * Burada YALNIZCA servis katmanının çağırdığı metotlar bildirilir; bakım/imha
 * görevlerinin dahili yardımcıları somut sınıfta kalır (arayüzü şişirmemek için).
 */
export class ISikayetRepository {
  /** Yeni başvuru kaydeder (tur dahil). */
  async olustur(veri) {
    throw new Error('olustur() metodu implement edilmelidir.');
  }

  /** ID ile başvurunun ham satırını getirir (tenant izole). */
  async idIleGetir(id, tenantId) {
    throw new Error('idIleGetir() metodu implement edilmelidir.');
  }

  /** Panel listesi: tür/durum/arama filtreli, sayfalı DTO listesi. */
  async panelListesiGetir(tenantId, opts) {
    throw new Error('panelListesiGetir() metodu implement edilmelidir.');
  }

  /** TEK başvurunun panel DTO'su (canlı akış olaylarının taşıdığı biçim). */
  async panelKaydiGetir(id, tenantId) {
    throw new Error('panelKaydiGetir() metodu implement edilmelidir.');
  }

  /** Panel rozetleri için (tür, durum) kırılımında sayım. */
  async panelSayimlari(tenantId) {
    throw new Error('panelSayimlari() metodu implement edilmelidir.');
  }

  /** Başvuru durumunu günceller. */
  async durumGuncelle(id, tenantId, yeniDurum) {
    throw new Error('durumGuncelle() metodu implement edilmelidir.');
  }

  /** Bir kimlik hash'inin verilen pencerede attığı başvuru sayısı (limit kuralı). */
  async pencereSikayetSayisiGetir(kimlikHash, tenantId, pencereBaslangici) {
    throw new Error('pencereSikayetSayisiGetir() metodu implement edilmelidir.');
  }

  /** Penceredeki EN ESKİ başvurunun zamanı ("ne zaman tekrar deneyebilirim?"). */
  async enEskiPencereSikayetZamani(kimlikHash, tenantId, pencereBaslangici) {
    throw new Error('enEskiPencereSikayetZamani() metodu implement edilmelidir.');
  }

  /** Kimlik (telefon özeti) kara listede mi? Global — tenant almaz (bkz. schema.js). */
  async engelliMi(kimlikHash) {
    throw new Error('engelliMi() metodu implement edilmelidir.');
  }
}
