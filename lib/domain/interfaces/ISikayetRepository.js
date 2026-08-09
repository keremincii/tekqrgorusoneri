/**
 * ISikayetRepository - Şikayet Veritabanı İşlemleri Arayüzü
 * 
 * Dependency Inversion + Interface Segregation (SOLID).
 */
export class ISikayetRepository {
  /** Yeni şikayet kaydeder */
  async olustur(sikayet) {
    throw new Error('olustur() metodu implement edilmelidir.');
  }

  /** ID ile şikayet getirir */
  async idIleGetir(id) {
    throw new Error('idIleGetir() metodu implement edilmelidir.');
  }

  /** Tüm aktif (çözülmemiş) şikayetleri listeler */
  async aktiflerinTumunuGetir() {
    throw new Error('aktiflerinTumunuGetir() metodu implement edilmelidir.');
  }

  /** Şikayet durumunu günceller */
  async durumGuncelle(id, yeniDurum) {
    throw new Error('durumGuncelle() metodu implement edilmelidir.');
  }

  /** Belirli bir kimlik hash'inin son şikayet tarihini getirir (1 hafta kuralı için) */
  async sonSikayetTarihiniGetir(kimlikHash) {
    throw new Error('sonSikayetTarihiniGetir() metodu implement edilmelidir.');
  }

  /** Bir kimlik hash'inin verilen tarihten (pencere başlangıcı) bu yana attığı şikayet sayısı */
  async pencereSikayetSayisiGetir(kimlikHash, tenantId, pencereBaslangici) {
    throw new Error('pencereSikayetSayisiGetir() metodu implement edilmelidir.');
  }
}
