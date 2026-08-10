/**
 * BasvuruAkisServisi — Panelin Canlı Akışını Besleyen Servis
 * ===========================================================
 *
 * Bir başvuru oluştuğunda / durumu değiştiğinde / silindiğinde, başkanın açık
 * panellerine olay gönderir. Panel böylece SAYFA YENİLEMEDEN güncellenir.
 *
 * Single Responsibility: "olayı hazırla ve yayınla" — başka hiçbir iş yapmaz.
 * Dependency Inversion : Somut Redis/EventEmitter'ı değil, IOlayYayini sözleşmesini
 *                        ve repository'yi kurucudan alır.
 *
 * NEDEN AYRI BİR SERVİS (API ucu doğrudan yayınlasa olmaz mıydı?):
 *   - Olay yükü (payload) panelin liste kaydıyla AYNI biçimde olmalıdır. Bu biçim
 *     repository'de tek yerde tanımlı; onu her uçta elle kurmak, biri güncellenip
 *     diğeri unutulduğunda paneli bozar. Burada tek bir yerden okunur.
 *   - Başvuru dört ayrı yoldan değişebilir (vatandaş kaydı, panel durum güncellemesi,
 *     panel ataması, Telegram'daki "Çözüldü" butonu, moderasyon onayı). Hepsinin aynı
 *     olay sözleşmesini üretmesi gerekir.
 *
 * ASLA FIRLATMAZ: canlı bildirim bir KOLAYLIKTIR. Yayın başarısız olsa bile başvurunun
 * kaydı/güncellemesi geçerlidir; panel yedek yoklamayla kendini toparlar.
 */
export class BasvuruAkisServisi {
  /**
   * @param {Object} bagimliliklar
   * @param {import('@/lib/domain/interfaces/IOlayYayini.js').IOlayYayini} bagimliliklar.olayYayini
   * @param {import('../infrastructure/repositories/SikayetRepository.js').SikayetRepository} bagimliliklar.sikayetRepo
   */
  constructor({ olayYayini, sikayetRepo }) {
    this.olayYayini = olayYayini;
    this.sikayetRepo = sikayetRepo;
  }

  /**
   * Bir başvurunun GÜNCEL panel kaydını okuyup olay olarak yayınlar.
   * @private
   * @param {'yeni'|'guncelleme'} tip
   * @param {string} id
   * @param {number} tenantId
   */
  async _kaydiYayinla(tip, id, tenantId) {
    try {
      const basvuru = await this.sikayetRepo.panelKaydiGetir(id, tenantId);
      // Kayıt panelde GÖRÜNMÜYORSA (moderasyonda/silindi) olay da gitmez: panelin
      // görmemesi gereken bir kaydı canlı akışla göndermek, listeleme sorgusundaki
      // gizleme kuralını arkadan dolanmak olurdu.
      if (!basvuru) return;
      await this.olayYayini.yayinla(tenantId, {
        tip,
        id,
        basvuru,
        zaman: new Date().toISOString(),
      });
    } catch (e) {
      console.error('başvuru akış olayı yayınlanamadı:', e?.message);
    }
  }

  /** Yeni başvuru geldi → panelde listenin başına düşer + bildirim rozeti. */
  async yeniBasvuru(id, tenantId) {
    await this._kaydiYayinla('yeni', id, tenantId);
  }

  /** Durum/atama değişti → paneldeki kart yerinde güncellenir. */
  async basvuruGuncellendi(id, tenantId) {
    await this._kaydiYayinla('guncelleme', id, tenantId);
  }

  /**
   * Başvuru silindi → panelden kaldırılır. Kayıt artık okunamayacağı için DTO
   * gönderilmez; yalnız kimlik yeter.
   */
  async basvuruSilindi(id, tenantId) {
    try {
      await this.olayYayini.yayinla(tenantId, {
        tip: 'silindi',
        id,
        zaman: new Date().toISOString(),
      });
    } catch (e) {
      console.error('başvuru silme olayı yayınlanamadı:', e?.message);
    }
  }
}
