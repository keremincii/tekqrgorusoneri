/**
 * IOlayYayini — Canlı Olay Yayını Arayüzü (publish / subscribe)
 * ==============================================================
 *
 * Başkanın paneli, yeni bir başvuru geldiğinde SAYFAYI YENİLEMEDEN görmelidir. Bunun
 * için sunucu tarafında bir yayın kanalı gerekir: başvuruyu yazan istek "oldu" der,
 * o belediyenin açık panelleri anında haberdar olur.
 *
 * Neden bir ARAYÜZ (Dependency Inversion):
 *   - Tek konteynerde bellek içi bir EventEmitter yeter (BellekOlayYayini).
 *   - Uygulama birden çok kopyaya ölçeklenirse, A kopyasına düşen başvuruyu B
 *     kopyasındaki panelin de görmesi gerekir → Redis pub/sub (RedisOlayYayini).
 * Servisler ve API uçları hangisinin kullanıldığını BİLMEZ; yalnız bu sözleşmeyi bilir.
 *
 * TENANT İZOLASYONU SÖZLEŞMENİN PARÇASIDIR: her yayın ve her abonelik bir tenantId'ye
 * bağlıdır. Bir belediyenin olayı, başka bir belediyenin paneline ASLA ulaşmamalıdır;
 * bu, uygulamanın filtrelemesine bırakılan bir ayrıntı değil, kanalın kendi kuralıdır.
 *
 * @typedef {Object} BasvuruOlayi
 * @property {'yeni'|'guncelleme'|'silindi'} tip - Ne olduğu
 * @property {string} id - İlgili başvurunun UUID'si
 * @property {Object} [basvuru] - Panel DTO'su (silindi'de bulunmaz)
 * @property {string} zaman - ISO-8601 zaman damgası
 */
export class IOlayYayini {
  /**
   * Bir olayı, o belediyenin tüm abonelerine ulaştırır.
   * ASLA FIRLATMAZ: yayın en iyi çabadır — kanal çökse bile başvuruyu yazan istek
   * başarılı sayılmalıdır (panel en kötü ihtimalle yedek yoklamayla tazelenir).
   * @param {number} tenantId
   * @param {BasvuruOlayi} olay
   * @returns {Promise<void>}
   */
  async yayinla(tenantId, olay) {
    throw new Error('yayinla() metodu implement edilmelidir.');
  }

  /**
   * Bir belediyenin olaylarına abone olur.
   * @param {number} tenantId
   * @param {(olay: BasvuruOlayi) => void} dinleyici
   * @returns {() => void} Aboneliği sonlandıran fonksiyon (MUTLAKA çağrılmalı;
   *   çağrılmazsa kapanan her SSE bağlantısı bir dinleyici sızdırır).
   */
  abone(tenantId, dinleyici) {
    throw new Error('abone() metodu implement edilmelidir.');
  }

  /**
   * Bir belediyede o an açık abone (panel) sayısı. SSE ucu bunu bağlantı tavanı
   * için kullanır: yetkili bir oturum bile sınırsız akış açıp belleği tüketememeli.
   * @param {number} tenantId
   * @returns {number}
   */
  aboneSayisi(tenantId) {
    throw new Error('aboneSayisi() metodu implement edilmelidir.');
  }
}
