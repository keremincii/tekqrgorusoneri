/**
 * ISokakRepository - Sokak Veritabanı İşlemleri Arayüzü (Interface)
 * 
 * Dependency Inversion Principle (SOLID-D): Servis katmanı bu arayüze bağımlıdır,
 * somut veritabanı implementasyonuna değil. Bu sayede veritabanı değişse bile
 * servis katmanı hiç değişmez.
 * 
 * Interface Segregation Principle (SOLID-I): Sadece sokakla ilgili metotlar.
 * 
 * Not: JavaScript'te gerçek interface yoktur. Bu sınıf "sözleşme" görevi görür.
 * Alt sınıflar bu metotları implement etmezse hata fırlatır.
 */
export class ISokakRepository {
  /** Tüm aktif sokakları listeler */
  async tumunuGetir() {
    throw new Error('tumunuGetir() metodu implement edilmelidir.');
  }

  /** ID ile tek bir sokak getirir */
  async idIleGetir(id) {
    throw new Error('idIleGetir() metodu implement edilmelidir.');
  }

  /** Yeni sokak ekler */
  async ekle(sokak) {
    throw new Error('ekle() metodu implement edilmelidir.');
  }

  /** Sokağı günceller */
  async guncelle(id, veriler) {
    throw new Error('guncelle() metodu implement edilmelidir.');
  }

  /** Sokağı pasif yapar (silmez, sadece deaktif eder - soft delete) */
  async pasifYap(id) {
    throw new Error('pasifYap() metodu implement edilmelidir.');
  }
}
