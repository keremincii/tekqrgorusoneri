/**
 * Telegram Bot API İstemcisi
 * ==========================
 *
 * Saha ekibine (personele) bildirim gönderme ve gelen güncellemeleri (webhook)
 * yanıtlama için ince bir `fetch` sarmalayıcısı. Harici kütüphane KULLANMAZ —
 * projedeki SMS/R2 entegrasyonları gibi ham HTTP ile çalışır.
 *
 * Tasarım: Hiçbir metot exception FIRLATMAZ; her zaman `{ basarili, ... }` döner.
 * Böylece atama akışı (başkanın panelde iş ataması) Telegram tarafı çökse bile
 * bozulmaz — bildirim gitmese de atama kaydı veritabanına yazılır.
 *
 * Gerekli env: TELEGRAM_BOT_TOKEN (BotFather'dan).
 */

import { GuvenlikSabitleri } from '@/lib/utils/constants.js';

export class TelegramClient {
  /**
   * @param {string} [token] - Bot token (verilmezse env'den okunur)
   */
  constructor(token = process.env.TELEGRAM_BOT_TOKEN) {
    this.token = token || null;
    this.base = this.token ? `${GuvenlikSabitleri.TELEGRAM_API_BASE}/bot${this.token}` : null;
  }

  /** Bot token tanımlı mı? (değilse bildirim özelliği sessizce devre dışı) */
  yapilandirildi() {
    return Boolean(this.token);
  }

  /**
   * JSON gövdeli bir Bot API metodunu çağırır.
   * @param {string} method - API metodu (örn: 'sendMessage')
   * @param {Object} govde - JSON gövdesi
   * @returns {Promise<{basarili: boolean, sonuc?: any, hata?: string}>}
   * @private
   */
  async _cagir(method, govde, timeoutMs = 10_000) {
    if (!this.base) return { basarili: false, hata: 'TELEGRAM_BOT_TOKEN tanımlı değil.' };
    // Timeout: Telegram yavaşlarsa webhook/atama akışı askıda kalmasın; süre dolunca
    // AbortError catch'e düşer → { basarili: false } (mevcut hata yolu).
    const ctrl = new AbortController();
    const zamanlayici = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(govde),
        signal: ctrl.signal,
      });
      const veri = await res.json().catch(() => ({}));
      if (!res.ok || !veri.ok) {
        return { basarili: false, hata: veri.description || `HTTP ${res.status}` };
      }
      return { basarili: true, sonuc: veri.result };
    } catch (err) {
      return { basarili: false, hata: err?.message || 'Ağ hatası.' };
    } finally {
      clearTimeout(zamanlayici);
    }
  }

  /**
   * Metin mesajı gönderir.
   * @param {number|string} chatId
   * @param {string} metin - parse_mode=HTML (çağıran HTML-escape etmeli)
   * @param {Object} [inlineKeyboard] - reply_markup.inline_keyboard yapısı
   * @returns {Promise<{basarili: boolean, sonuc?: any, hata?: string}>}
   */
  async sendMessage(chatId, metin, inlineKeyboard = null) {
    const govde = {
      chat_id: chatId,
      text: metin,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (inlineKeyboard) govde.reply_markup = { inline_keyboard: inlineKeyboard };
    return this._cagir('sendMessage', govde);
  }

  /**
   * Fotoğraflı mesaj gönderir (foto R2'den çekilip multipart olarak yüklenir).
   * @param {number|string} chatId
   * @param {Buffer} fotoBuffer
   * @param {string} caption - parse_mode=HTML
   * @param {Array} [inlineKeyboard]
   * @returns {Promise<{basarili: boolean, sonuc?: any, hata?: string}>}
   */
  async sendPhoto(chatId, fotoBuffer, caption, inlineKeyboard = null) {
    if (!this.base) return { basarili: false, hata: 'TELEGRAM_BOT_TOKEN tanımlı değil.' };
    try {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      if (inlineKeyboard) form.append('reply_markup', JSON.stringify({ inline_keyboard: inlineKeyboard }));
      form.append('photo', new Blob([fotoBuffer], { type: 'image/jpeg' }), 'sikayet.jpg');

      // Multipart foto yüklemesi metin mesajından yavaştır → daha geniş 20 sn tavan.
      const ctrl = new AbortController();
      const zamanlayici = setTimeout(() => ctrl.abort(), 20_000);
      try {
        const res = await fetch(`${this.base}/sendPhoto`, { method: 'POST', body: form, signal: ctrl.signal });
        const veri = await res.json().catch(() => ({}));
        if (!res.ok || !veri.ok) {
          return { basarili: false, hata: veri.description || `HTTP ${res.status}` };
        }
        return { basarili: true, sonuc: veri.result };
      } finally {
        clearTimeout(zamanlayici);
      }
    } catch (err) {
      return { basarili: false, hata: err?.message || 'Ağ hatası.' };
    }
  }

  /**
   * Native konum pini gönderir. Telegram haritasında tıklanabilir bir işaret olarak
   * görünür; tek dokunuşla telefonun harita uygulamasında açılıp navigasyon başlar.
   * Saha ekibinin şikayetin TAM noktasına (vatandaşın anlık GPS'i) gitmesi için.
   * @param {number|string} chatId
   * @param {number} enlem - latitude
   * @param {number} boylam - longitude
   * @returns {Promise<{basarili: boolean, sonuc?: any, hata?: string}>}
   */
  async sendLocation(chatId, enlem, boylam) {
    return this._cagir('sendLocation', {
      chat_id: chatId,
      latitude: enlem,
      longitude: boylam,
    });
  }

  /**
   * Inline buton tıklamasına yanıt verir (kullanıcıya küçük bildirim/toast gösterir).
   * @param {string} callbackQueryId
   * @param {string} [metin]
   * @param {boolean} [uyariGoster=false] - true ise modal uyarı, false ise toast
   */
  async answerCallbackQuery(callbackQueryId, metin = '', uyariGoster = false) {
    return this._cagir('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: metin,
      show_alert: uyariGoster,
    });
  }

  /**
   * Var olan bir fotoğraflı mesajın caption'ını günceller (çözülünce buton kaldırılır).
   * @param {number|string} chatId
   * @param {number} messageId
   * @param {string} yeniCaption - parse_mode=HTML
   * @param {Array} [inlineKeyboard] - boş [] verilirse buton kaldırılır
   */
  async editMessageCaption(chatId, messageId, yeniCaption, inlineKeyboard = []) {
    return this._cagir('editMessageCaption', {
      chat_id: chatId,
      message_id: messageId,
      caption: yeniCaption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  }

  /**
   * Bir metin mesajının metnini günceller (fotosuz bildirimler için).
   */
  async editMessageText(chatId, messageId, yeniMetin, inlineKeyboard = []) {
    return this._cagir('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: yeniMetin,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  }

  /**
   * Webhook'u ayarlar (kurulum scripti kullanır). secret_token, gelen her update
   * isteğinin gerçekten Telegram'dan geldiğini doğrulamak için header'da geri döner.
   * @param {string} url - Tam webhook URL'si (https)
   * @param {string} secretToken
   */
  async setWebhook(url, secretToken) {
    return this._cagir('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
  }

  /** getUpdates (yalnızca yerel geliştirme polling fallback'i için). */
  async getUpdates(offset = 0, timeout = 25) {
    // DİKKAT: Bu bir LONG-POLL — Telegram yanıtı bilerek `timeout` sn bekletir.
    // Varsayılan 10 sn'lik fetch timeout'u onu keserdi; long-poll süresi + 10 sn ver.
    return this._cagir('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message', 'callback_query'],
    }, (timeout + 10) * 1000);
  }
}
