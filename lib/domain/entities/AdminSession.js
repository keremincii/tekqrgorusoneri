/**
 * AdminSession Domain Entity
 * 
 * Magic Link ile oluşturulan admin oturumunu temsil eder.
 * Single Responsibility: Sadece oturum yönetimi mantığını barındırır.
 */
export class AdminSession {
  /**
   * @param {Object} params
   * @param {string} params.id - Oturum UUID'si
   * @param {string} params.tokenHash - Magic link tokeninin SHA-256 hash'i
   * @param {boolean} [params.aktif=true] - Oturumun aktif olup olmadığı
   * @param {Date} [params.olusturmaTarihi] - Oluşturulma tarihi
   * @param {Date} [params.sonErisimTarihi] - Son erişim tarihi
   */
  constructor({
    id,
    tokenHash,
    aktif = true,
    olusturmaTarihi = new Date(),
    sonErisimTarihi = new Date(),
  }) {
    this.id = id;
    this.tokenHash = tokenHash;
    this.aktif = aktif;
    this.olusturmaTarihi = olusturmaTarihi;
    this.sonErisimTarihi = sonErisimTarihi;
  }

  /** Oturumu iptal eder (logout) */
  iptalEt() {
    this.aktif = false;
  }

  /** Son erişim zamanını günceller */
  erisimKaydet() {
    this.sonErisimTarihi = new Date();
  }

  /** Oturum hala geçerli mi? */
  get gecerliMi() {
    return this.aktif;
  }

  toJSON() {
    return {
      id: this.id,
      aktif: this.aktif,
      olusturmaTarihi: this.olusturmaTarihi,
      sonErisimTarihi: this.sonErisimTarihi,
    };
  }
}
