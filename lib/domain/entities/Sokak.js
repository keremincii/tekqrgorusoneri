/**
 * Sokak (Street) Domain Entity
 * 
 * Clean Architecture: Entity sınıfı hiçbir dış bağımlılığa sahip değildir.
 * Kendi iç doğrulamasını (invariant) kendisi yapar.
 * Single Responsibility: Sadece bir sokağı temsil eder.
 */
export class Sokak {
  /**
   * @param {Object} params
   * @param {string} params.id - UUID v4 formatında benzersiz kimlik
   * @param {string} params.sokakAdi - Sokağın resmi adı
   * @param {number} params.enlem - GPS enlem değeri (latitude)
   * @param {number} params.boylam - GPS boylam değeri (longitude)
   * @param {string} params.hmacImza - QR linki için HMAC-SHA256 imzası
   * @param {string|null} [params.qrKod=null] - QR'a basılan kısa base62 kod (redirector referansı)
   * @param {string|null} [params.tabelaNo=null] - Fiziksel QR levhasındaki basılı numara (sanal sokakta null)
   * @param {boolean} [params.aktif=true] - Sokağın aktif/pasif durumu
   * @param {Date} [params.olusturmaTarihi] - Kayıt tarihi
   */
  constructor({ id, sokakAdi, enlem, boylam, hmacImza, qrKod = null, tabelaNo = null, aktif = true, olusturmaTarihi = new Date() }) {
    this.#dogrula(sokakAdi, enlem, boylam);

    this.id = id;
    this.sokakAdi = sokakAdi.toUpperCase().trim();
    this.enlem = enlem;
    this.boylam = boylam;
    this.hmacImza = hmacImza;
    this.qrKod = qrKod;
    this.tabelaNo = tabelaNo;
    this.aktif = aktif;
    this.olusturmaTarihi = olusturmaTarihi;
  }

  /**
   * Entity'nin iç doğrulaması (invariant kontrolü).
   * @private
   */
  #dogrula(sokakAdi, enlem, boylam) {
    if (!sokakAdi || typeof sokakAdi !== 'string' || sokakAdi.trim().length < 2) {
      throw new Error('Sokak adı en az 2 karakter olmalıdır.');
    }
    if (typeof enlem !== 'number' || enlem < 36 || enlem > 42) {
      throw new Error(`Enlem değeri Türkiye sınırları dışında: ${enlem}`);
    }
    if (typeof boylam !== 'number' || boylam < 26 || boylam > 45) {
      throw new Error(`Boylam değeri Türkiye sınırları dışında: ${boylam}`);
    }
  }

  /**
   * QR koduna basılacak KALICI yönlendirici adresini üretir.
   * Form adresi (/s/...?sig=...) DEĞİL; sabit qr kökü + /q/<qr_kod>. Böylece form
   * yolu/imza/subdomain değişse bile QR bozulmaz (bkz. lib/server/qr.js). qr_kod
   * yoksa (eski kayıt) UUID'ye düşer — geriye dönük uyum.
   * @param {string} qrBaseUrl - ör. "https://qr.sikayet.com"
   */
  qrLinki(qrBaseUrl) {
    return `${qrBaseUrl}/q/${this.qrKod || this.id}`;
  }

  /** Entity'yi düz nesneye (plain object) çevirir (serileştirme için) */
  toJSON() {
    return {
      id: this.id,
      sokakAdi: this.sokakAdi,
      enlem: this.enlem,
      boylam: this.boylam,
      qrKod: this.qrKod,
      tabelaNo: this.tabelaNo,
      aktif: this.aktif,
      olusturmaTarihi: this.olusturmaTarihi,
    };
  }
}
