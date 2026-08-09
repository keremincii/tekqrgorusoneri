import { gunlukTekSefer } from '@/lib/security/rateLimit.js';
import { metniTemizle } from '@/lib/utils/validators.js';

/**
 * AlarmService — Operasyonel Uyarı Bildirimleri (AYRI Telegram botu)
 * =================================================================
 *
 * Yönetici/operatöre kritik sistem olaylarını (şimdilik: SMS bütçe kesicisinin
 * devreye girmesi) anında bildirir.
 *
 * ÖNEMLİ: Bu bot, personel (saha ekibi) botundan ve başkan botundan AYRIDIR.
 * Kendi token'ı (TELEGRAM_ALARM_BOT_TOKEN) ve hedef sohbeti (TELEGRAM_ALARM_CHAT_ID)
 * vardır; böylece uyarılar operasyonel bildirimlere karışmaz. Bot ve chat kullanıcı
 * tarafından ayrıca @BotFather'da kurulur.
 *
 * Tasarım (TelegramClient gibi): exception FIRLATMAZ; yapılandırılmamışsa sessizce
 * devre dışı kalır (uyarı gitmese de ana akış — SMS gönderimi/kesici — bozulmaz).
 */
export class AlarmService {
  /**
   * @param {import('../infrastructure/telegram/TelegramClient.js').TelegramClient} telegramClient
   *   Alarm botu token'ıyla oluşturulmuş istemci.
   * @param {string|number} [chatId] - Uyarıların gideceği sohbet (TELEGRAM_ALARM_CHAT_ID)
   */
  constructor(telegramClient, chatId) {
    this.telegramClient = telegramClient;
    this.chatId = chatId || null;
  }

  /** Alarm botu + hedef sohbet tanımlı mı? */
  yapilandirildi() {
    return Boolean(this.telegramClient?.yapilandirildi() && this.chatId);
  }

  /**
   * SMS günlük bütçe kesicisi devreye girdiğinde uyarır.
   * Günde EN FAZLA 1 kez gönderir (kesici tetiklendiğinde her istekte spam olmasın).
   *
   * @param {{limit: number, belediye?: string}} bilgi
   * @returns {Promise<{basarili: boolean, atlandi?: boolean, hata?: string}>}
   */
  async smsButcesiUyar({ limit, belediye } = {}) {
    if (!this.yapilandirildi()) {
      console.warn(
        '⚠ SMS bütçe kesicisi devreye girdi ama alarm botu yapılandırılmamış ' +
        '(TELEGRAM_ALARM_BOT_TOKEN / TELEGRAM_ALARM_CHAT_ID). Bildirim gönderilemedi.'
      );
      return { basarili: false, hata: 'alarm-yapilandirilmamis' };
    }

    // Günde tek uyarı: kesici tetiklendiğinde binlerce istek gelebilir.
    if (!(await gunlukTekSefer('alarm_sms_global'))) {
      return { basarili: true, atlandi: true };
    }

    const yer = belediye ? ` (${metniTemizle(belediye)})` : '';
    const mesaj =
      `🚨 <b>SMS BÜTÇE KESİCİSİ DEVREDE</b>${yer}\n\n` +
      `Bugünkü global SMS gönderim limiti (<b>${Number(limit) || '?'}</b>) doldu.\n` +
      `Yeni doğrulama SMS'leri <b>geçici olarak durduruldu</b> (cüzdan koruması).\n\n` +
      `• Olağan bir yoğunluk mu, yoksa saldırı mı olduğunu kontrol edin.\n` +
      `• Gerekirse SMS_GLOBAL_GUN_LIMIT değerini artırın veya saldırıyı engelleyin.\n` +
      `• Limit yarına (24 saatlik pencere) kendiliğinden sıfırlanır.`;

    return this.telegramClient.sendMessage(this.chatId, mesaj);
  }

  /**
   * Conversion (gönderilen/doğrulanan) oranı düşüp SAVUNMA MODU'na geçilince uyarır.
   * Düşük oran, SMS'lerin gönderilip doğrulanmadığını gösterir → olası kredi tüketme
   * saldırısı. Günde EN FAZLA 1 kez gönderir.
   *
   * @param {{oran?: number, gonderilen?: number, dogrulanan?: number, belediye?: string}} bilgi
   * @returns {Promise<{basarili: boolean, atlandi?: boolean, hata?: string}>}
   */
  async konversiyonUyar({ oran, gonderilen, dogrulanan, belediye } = {}) {
    if (!this.yapilandirildi()) {
      console.warn(
        '⚠ SMS savunma modu devreye girdi (düşük doğrulama oranı) ama alarm botu ' +
        'yapılandırılmamış. Bildirim gönderilemedi.'
      );
      return { basarili: false, hata: 'alarm-yapilandirilmamis' };
    }

    if (!(await gunlukTekSefer('alarm_conversion'))) {
      return { basarili: true, atlandi: true };
    }

    const yer = belediye ? ` (${metniTemizle(belediye)})` : '';
    const yuzde = typeof oran === 'number' ? `%${Math.round(oran * 100)}` : '?';
    const mesaj =
      `⚠️ <b>SMS SAVUNMA MODU DEVREDE</b>${yer}\n\n` +
      `Doğrulama oranı düştü: gönderilen <b>${Number(gonderilen) || '?'}</b>, ` +
      `doğrulanan <b>${Number(dogrulanan) || '?'}</b> (oran <b>${yuzde}</b>).\n` +
      `Bu, SMS'lerin gönderilip kodun girilmemesi = olası <b>kredi tüketme saldırısı</b> işaretidir.\n\n` +
      `• Gönderim limitleri otomatik olarak SIKILAŞTIRILDI (geçici).\n` +
      `• Audit log'dan (sms_gonderim_log) kaynakları inceleyin.\n` +
      `• Mod, pencere sonunda kendiliğinden kalkar.`;

    return this.telegramClient.sendMessage(this.chatId, mesaj);
  }
}
