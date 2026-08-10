import BasvuruPanosu from './BasvuruPanosu';

/**
 * /admin — Başkanın Başvuru Panosu (SUNUCU kabuğu)
 * =================================================
 *
 * Erişim kapısı burada DEĞİLDİR: `/admin` ön ekindeki her yol proxy.js tarafından
 * oturum çerezi olmadan geçilemez; veriyi döndüren uçlar ise çerezi ayrıca DOĞRULAR
 * (adminOturumKontrol). Bu sayfa yalnız istemci panosunu monte eder.
 *
 * ESKİ HARİTA SAYFASI KALDIRILDI (/admin/harita): tek merkezî QR'lı bir üründe tüm
 * başvurular aynı koordinata düşüyordu — harita her zaman tek bir pin gösteriyordu,
 * yani ekranın yarısı hiçbir bilgi taşımıyordu. Yerini, başvuru METNİNİ öne çıkaran
 * ve yenilenmeden canlı kalan bu liste panosu aldı.
 */
export const metadata = {
  title: 'Başvuru Panosu',
  // Panel içeriği kişisel/kuruma özeldir: arama motorlarına kapalı.
  robots: { index: false, follow: false },
};

export default function AdminPanoSayfasi() {
  return <BasvuruPanosu />;
}
