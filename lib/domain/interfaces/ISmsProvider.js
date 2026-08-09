/**
 * ISmsProvider - SMS Gönderim Servisi Arayüzü
 * 
 * Open/Closed Principle (SOLID-O): SMS sağlayıcısı değiştiğinde
 * (Netgsm → İleti Merkezi → Twilio) sadece yeni bir implementasyon yazılır.
 * Mevcut servis kodu hiç değişmez.
 * 
 * Liskov Substitution Principle (SOLID-L): Tüm SMS sağlayıcıları
 * bu arayüzü implement ettiği sürece birbirleriyle yer değiştirebilir.
 */
export class ISmsProvider {
  /**
   * Belirtilen telefon numarasına SMS gönderir.
   * @param {string} telefon - Standart formatta telefon numarası (05XXXXXXXXX)
   * @param {string} mesaj - Gönderilecek SMS mesajı
   * @returns {Promise<{basarili: boolean, hata?: string}>}
   */
  async smsGonder(telefon, mesaj) {
    throw new Error('smsGonder() metodu implement edilmelidir.');
  }
}
