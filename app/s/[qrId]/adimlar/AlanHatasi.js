'use client';

/**
 * Tek bir form alanının ALTINDA çıkan doğrulama uyarısı.
 *
 * NEDEN ALAN BAŞINA (tek bir üst uyarı yerine): kartın en üstünde beliren genel bir
 * hata mesajı, telefonda çoğu zaman görüş alanının DIŞINDA kalır — kullanıcı butona
 * basar, hiçbir şey olmamış gibi görünür. Uyarıyı eksik alanın hemen altına koymak,
 * "nerede eksik?" sorusunu okumadan yanıtlar.
 *
 * `role="alert"` ile ekran okuyucular da uyarıyı anında duyurur; `aria-invalid`
 * ilgili alanın kendisinde işaretlidir (bkz. KimlikAdimi).
 */
export default function AlanHatasi({ mesaj }) {
  if (!mesaj) return null;
  return (
    <p className="alan-hatasi" role="alert">
      <span aria-hidden="true">⚠</span>
      <span>{mesaj}</span>
    </p>
  );
}
