/**
 * Eşzamanlılık Semaforu (Concurrency Semaphore)
 *
 * Defense in Depth: CPU/bellek yoğun işlemleri (ör. sharp ile resim yeniden kodlama)
 * aynı anda kaç tanesinin çalışabileceğini sınırlar. Rate-limit "kaç istek" derken,
 * semafor "aynı ANDA kaç işlem" der — paralel yükleme seli tek container'ın
 * CPU/belleğini patlatamaz (kaynak tükenmesi DoS koruması).
 *
 * Bellek içi, tek container içindir (mimaride tek app container var). Çok-instance'a
 * geçilirse her instance kendi tavanını uygular; bu yine güvenli (toplam = instance × tavan).
 */

class Semafor {
  /**
   * @param {number} maks - aynı anda izin verilen max işlem sayısı
   * @param {number} [maxKuyruk=Infinity] - kuyrukta bekleyebilecek max istek sayısı.
   *   Sınır olmadan yük patlamasında BINLERCE istek (her biri gövdesiyle birlikte)
   *   kuyrukta bellek tutar; sınır aşılınca `al()` beklemeden false döner → çağıran
   *   anında 503 verir (bellek birikimi yerine hızlı ret).
   */
  constructor(maks, maxKuyruk = Infinity) {
    this.maks = Math.max(1, maks | 0);
    this.maxKuyruk = maxKuyruk;
    this.aktif = 0;
    /** @type {Array<{cozumle: (v: boolean) => void, zamanlayici: any}>} */
    this.kuyruk = [];
  }

  /**
   * Bir yuva kapmaya çalışır. Boş yuva varsa hemen alır; yoksa kuyruğa girer ve
   * en fazla `timeoutMs` bekler. Yuva alırsa true, süre dolarsa (veya kuyruk
   * doluysa anında) false döner.
   *
   * ÖNEMLİ: Yalnızca `true` dönerse `birak()` çağrılmalıdır (false = yuva alınmadı).
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  al(timeoutMs) {
    if (this.aktif < this.maks) {
      this.aktif += 1;
      return Promise.resolve(true);
    }
    if (this.kuyruk.length >= this.maxKuyruk) {
      return Promise.resolve(false); // kuyruk dolu → bekletmeden hızlı ret
    }
    return new Promise((cozumle) => {
      const girdi = {
        cozumle,
        zamanlayici: setTimeout(() => {
          const i = this.kuyruk.indexOf(girdi);
          if (i !== -1) this.kuyruk.splice(i, 1);
          cozumle(false); // süre doldu, yuva alınamadı
        }, timeoutMs),
      };
      this.kuyruk.push(girdi);
    });
  }

  /**
   * Bir yuvayı serbest bırakır. Bekleyen varsa yuvayı doğrudan ona devreder
   * (aktif sayacı düşmez); yoksa aktif sayacı azalır.
   */
  birak() {
    const sonraki = this.kuyruk.shift();
    if (sonraki) {
      clearTimeout(sonraki.zamanlayici);
      sonraki.cozumle(true);
    } else {
      this.aktif = Math.max(0, this.aktif - 1);
    }
  }
}

export { Semafor };
