import { ISmsProvider } from '@/lib/domain/interfaces/ISmsProvider.js';

/**
 * NetgsmSmsProvider — Netgsm üzerinden gerçek SMS gönderir.
 *
 * Liskov (SOLID-L): ISmsProvider'ı implement eder; DogrulamaService hiç değişmez.
 * Sadece `lib/services/index.js`'te MockSmsProvider yerine bu enjekte edilir.
 *
 * Netgsm REST v2 API (JSON + HTTP Basic Auth):
 *   POST https://api.netgsm.com.tr/sms/rest/v2/send
 *
 * Gerekli env değişkenleri:
 *   NETGSM_USERCODE  → Netgsm üyelik/kullanıcı kodu (genelde başlayan 0'sız numara)
 *   NETGSM_PASSWORD  → Netgsm API/SMS şifresi (panelden ayrı API şifresi önerilir)
 *   NETGSM_HEADER    → Onaylı gönderici başlığı (ör. GULSEHIR) — Netgsm'de tanımlı olmalı
 *
 * NOT (İYS): Doğrulama/OTP mesajları ticari ileti değildir, İYS izni gerektirmez.
 * Gönderici başlığının Netgsm panelinde ONAYLI olması şarttır, aksi halde kod 40 döner.
 */

const NETGSM_ENDPOINT = 'https://api.netgsm.com.tr/sms/rest/v2/send';
const ISTEK_ZAMAN_ASIMI_MS = 10_000;

/**
 * Telefonu Netgsm biçimine getirir: sadece rakam, ülke kodu (90) ve baştaki 0 atılır.
 *   "05301234567" → "5301234567" ; "+905301234567" → "5301234567"
 * @param {string} telefon
 * @returns {string}
 */
function netgsmNumara(telefon) {
  let d = String(telefon).replace(/\D/g, '');
  if (d.startsWith('90')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

export class NetgsmSmsProvider extends ISmsProvider {
  /**
   * @param {{usercode?: string, password?: string, header?: string}} [opts]
   */
  constructor(opts = {}) {
    super();
    this.usercode = opts.usercode || process.env.NETGSM_USERCODE;
    this.password = opts.password || process.env.NETGSM_PASSWORD;
    this.header = opts.header || process.env.NETGSM_HEADER;

    if (!this.usercode || !this.password || !this.header) {
      throw new Error(
        'Netgsm kimlik bilgileri eksik: NETGSM_USERCODE, NETGSM_PASSWORD ve ' +
        'NETGSM_HEADER ortam değişkenleri tanımlı olmalı.'
      );
    }
  }

  /**
   * @param {string} telefon - Standart formatta telefon (05XXXXXXXXX)
   * @param {string} mesaj   - Gönderilecek SMS metni
   * @returns {Promise<{basarili: boolean, hata?: string}>}
   */
  async smsGonder(telefon, mesaj) {
    const no = netgsmNumara(telefon);
    const govde = {
      msgheader: this.header,
      encoding: 'TR', // Türkçe karakter desteği
      messages: [{ msg: mesaj, no }],
    };

    const ctrl = new AbortController();
    const zamanlayici = setTimeout(() => ctrl.abort(), ISTEK_ZAMAN_ASIMI_MS);

    try {
      const yetki = Buffer.from(`${this.usercode}:${this.password}`).toString('base64');
      const yanit = await fetch(NETGSM_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${yetki}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(govde),
        signal: ctrl.signal,
      });

      const metin = await yanit.text();

      // Yanıt JSON ({"code":"00","jobid":"..."}) ya da düz metin ("00 123456") olabilir.
      let kod = null;
      try {
        kod = JSON.parse(metin)?.code;
      } catch {
        kod = (metin || '').trim().split(/\s+/)[0];
      }

      // Netgsm "00" = görev başarıyla oluşturuldu. Diğer tüm kodlar hatadır.
      if (yanit.ok && String(kod) === '00') {
        return { basarili: true };
      }

      // Hassas veri (telefon/mesaj) loglanmaz; yalnızca hata kodu.
      console.error(`Netgsm SMS başarısız — kod: ${kod} (HTTP ${yanit.status})`);
      return {
        basarili: false,
        hata: `SMS gönderilemedi (Netgsm kodu: ${kod ?? yanit.status}).`,
      };
    } catch (err) {
      const sebep = err?.name === 'AbortError' ? 'zaman aşımı' : (err?.message || 'bilinmeyen hata');
      console.error('Netgsm SMS isteği başarısız:', sebep);
      return { basarili: false, hata: 'SMS servisine ulaşılamadı.' };
    } finally {
      clearTimeout(zamanlayici);
    }
  }
}
