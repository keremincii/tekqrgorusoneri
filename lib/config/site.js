/**
 * Belediye / İlçe Yapılandırması (Multi-Tenant Config)
 *
 * Bu proje tek bir kod tabanından birden çok belediyeye hizmet verir.
 * Yeni bir ilçe için KOD DEĞİŞTİRİLMEZ; yalnızca aşağıdaki çevre değişkenleri
 * (Vercel → Project Settings → Environment Variables) ayarlanır:
 *
 *   NEXT_PUBLIC_BELEDIYE_ADI   → "Nevşehir Belediyesi" gibi (UI başlıkları, SMS metni)
 *   NEXT_PUBLIC_HARITA_ENLEM   → Harita başlangıç merkezi - enlem (latitude)
 *   NEXT_PUBLIC_HARITA_BOYLAM  → Harita başlangıç merkezi - boylam (longitude)
 *   NEXT_PUBLIC_HARITA_ZOOM    → Harita başlangıç yakınlığı (örn. 14)
 *
 * Sokak verileri (ad + enlem/boylam) ise o ilçenin kendi Neon veritabanında
 * tutulur ve `scripts/seed-sokaklar.js` ile CSV'den yüklenir.
 *
 * NOT: NEXT_PUBLIC_ önekli değişkenler build sırasında gömülür; her Vercel
 * projesi (her belediye) kendi değerleriyle derlenir. Önek olmadan istemci
 * tarafına ulaşmazlar.
 *
 * Harita merkezi AÇIKÇA verilmezse, admin haritası o ilçenin sokaklarına göre
 * kendini otomatik ortalar (bkz. app/admin/harita/page.js). Yani çoğu ilçe için
 * tek yapılması gereken doğru veritabanını ve belediye adını ayarlamaktır.
 */

/** Geçerli bir sayı ise onu, değilse varsayılanı döndürür. */
function sayiVeya(deger, varsayilan) {
  const n = Number(deger);
  return Number.isFinite(n) ? n : varsayilan;
}

const enlemEnv = process.env.NEXT_PUBLIC_HARITA_ENLEM;
const boylamEnv = process.env.NEXT_PUBLIC_HARITA_BOYLAM;

export const siteConfig = {
  /**
   * Bu dağıtımın (deployment) tenant kimliği.
   * Şu an her belediye AYRI veritabanı + AYRI Vercel projesi kullanır; bu yüzden
   * bu değerler yalnızca "bu kurulum kim?" bilgisidir (loglama, seed çıktısı vb.).
   *
   * İleride tek veritabanına geçilirse: tenant ASLA istemciden gelen bu değerle
   * belirlenmez; sunucuda istek host'undan (subdomain) çözülür. Detay: MULTI-TENANT.md
   */
  tenant: {
    slug: process.env.NEXT_PUBLIC_TENANT_SLUG || 'gulsehir',
    id: sayiVeya(process.env.NEXT_PUBLIC_TENANT_ID, 1),
  },

  /** Belediye/ilçe tam adı – tüm görünür başlıklarda ve SMS metninde kullanılır. */
  belediyeAdi: process.env.NEXT_PUBLIC_BELEDIYE_ADI || 'Gülşehir Belediyesi',

  harita: {
    /** Başlangıç kamera merkezi [enlem, boylam] (varsayılan: Gülşehir). */
    merkez: [sayiVeya(enlemEnv, 38.746), sayiVeya(boylamEnv, 34.62)],
    /** Başlangıç yakınlık seviyesi. */
    zoom: sayiVeya(process.env.NEXT_PUBLIC_HARITA_ZOOM, 14),
    /**
     * Merkez env ile açıkça verildi mi? Verilmediyse harita kendini
     * sokak verisine göre otomatik ortalar.
     */
    merkezAcikBelirtildi: Boolean(enlemEnv && boylamEnv),
    /**
     * Sabit görünüm dikdörtgeni: [[GB_enlem, GB_boylam], [KD_enlem, KD_boylam]]
     * (GB = güneybatı köşe = en küçük enlem/boylam, KD = kuzeydoğu köşe = en büyük).
     * Verildiğinde admin haritası açılışta TAM bu kutuyu gösterir; kullanıcı kutunun
     * dışına kaydıramaz ve daha fazla uzaklaşamaz (maxBounds + minZoom kilidi).
     * Env ile override edilebilir; verilmezse Gülşehir için elle belirlenen kutu kullanılır.
     */
    sinir: [
      [
        sayiVeya(process.env.NEXT_PUBLIC_HARITA_GB_ENLEM, 38.723567145996434),
        sayiVeya(process.env.NEXT_PUBLIC_HARITA_GB_BOYLAM, 34.59804069513773),
      ],
      [
        sayiVeya(process.env.NEXT_PUBLIC_HARITA_KD_ENLEM, 38.770425729253866),
        sayiVeya(process.env.NEXT_PUBLIC_HARITA_KD_BOYLAM, 34.66773520651327),
      ],
    ],
  },
};
