import { ISmsProvider } from '@/lib/domain/interfaces/ISmsProvider.js';

/**
 * MockSmsProvider - Geliştirme Ortamı İçin Sahte SMS Sağlayıcı
 * 
 * Gerçek SMS göndermek yerine konsola yazdırır.
 * SMS sağlayıcısı belirlenene kadar bu kullanılır.
 * 
 * Liskov Substitution (SOLID-L): ISmsProvider arayüzünü implement eder.
 * Gerçek sağlayıcı (Netgsm, Twilio) geldiğinde sadece bu dosya değişir,
 * DogrulamaService hiç değişmez.
 */
export class MockSmsProvider extends ISmsProvider {
  /**
   * SMS'i gerçekten göndermez, konsola yazdırır.
   * @param {string} telefon
   * @param {string} mesaj
   * @returns {Promise<{basarili: boolean}>}
   */
  async smsGonder(telefon, mesaj) {
    // GÜVENLİK: Telefon + doğrulama kodu yalnızca geliştirme ortamında loglanır.
    // Üretimde (NODE_ENV=production) hassas veri loglara YAZILMAZ ve zaten gerçek
    // bir sağlayıcı (Netgsm/Twilio) enjekte edilmelidir.
    if (process.env.NODE_ENV !== 'production') {
      console.log('═══════════════════════════════════════════');
      console.log('📱 [MOCK SMS] Gerçek SMS gönderilmedi!');
      console.log(`   Alıcı:  ${telefon}`);
      console.log(`   Mesaj:  ${mesaj}`);
      console.log('═══════════════════════════════════════════');
    }
    return { basarili: true };
  }
}
