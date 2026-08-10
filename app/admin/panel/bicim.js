/**
 * Panel biçimlendirme yardımcıları (saf fonksiyonlar).
 *
 * Hepsi Europe/Istanbul saat diliminde biçimler: sunucu Almanya'da, tarayıcı ise
 * kullanıcının cihaz saatinde çalışır. Sabitlemezsek aynı kayıt panelde bir saat
 * kaymış görünebilir — "sabah 9'da geldi" diyen bir şikayet için bu gerçek bir hatadır.
 */

const ZAMAN_DILIMI = 'Europe/Istanbul';

/** "9 Ağustos 2026 14:32" */
export function tarihUzun(tarih) {
  return new Date(tarih).toLocaleString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: ZAMAN_DILIMI,
  });
}

/** "9 Ağu 14:32" — kart altı gibi dar yerler için. */
export function tarihKisa(tarih) {
  return new Date(tarih).toLocaleString('tr-TR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ZAMAN_DILIMI,
  });
}

/**
 * "az önce" / "12 dk" / "3 sa" / "5 gün" — göreli yaş.
 * Yöneticinin okuduğu asıl bilgi budur: bir başvurunun ne zaman geldiğinden çok
 * NE KADAR SÜREDİR beklediği önemlidir.
 */
export function goreliYas(tarih, simdi = Date.now()) {
  const t = new Date(tarih).getTime();
  if (!Number.isFinite(t)) return '';
  const saniye = Math.max(0, Math.floor((simdi - t) / 1000));
  if (saniye < 60) return 'az önce';
  const dakika = Math.floor(saniye / 60);
  if (dakika < 60) return `${dakika} dk`;
  const saat = Math.floor(dakika / 60);
  if (saat < 24) return `${saat} sa`;
  const gun = Math.floor(saat / 24);
  if (gun < 30) return `${gun} gün`;
  const ay = Math.floor(gun / 30);
  return `${ay} ay`;
}

/** "Ahmet Y." — personel kısa adı (soyadın tamamı panelde gereksiz yer kaplar). */
export function personelKisaAd(ad, soyad) {
  if (!ad) return '';
  return soyad ? `${ad} ${soyad.charAt(0)}.` : ad;
}
