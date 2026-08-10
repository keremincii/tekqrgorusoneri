'use client';

import TurnstileWidget from '../TurnstileWidget';
import AlanHatasi from './AlanHatasi';

/**
 * ADIM 3 — Ad Soyad + Telefon + KVKK onayı
 * =========================================
 *
 * Buradan sonra SMS kodu gider, yani bu ekranın ötesi PARA harcar (her SMS bir
 * maliyettir). Bot kapısı (Cloudflare Turnstile) bu yüzden burada durur — kod
 * üretilmeden önceki son kapıdır.
 *
 * BUTON HİÇBİR ZAMAN PASİF DEĞİLDİR (bilinçli): pasif bir buton, kullanıcıya NEDEN
 * ilerleyemediğini söylemez — özellikle mobilde insan butona basar, bir şey olmaz ve
 * akıştan düşer. Bunun yerine buton hep basılabilir; eksik alan varsa gönderim
 * durdurulur ve o alanın ALTINDA, alanı işaret eden bir uyarı çıkar (bkz. AlanHatasi).
 *
 * ONAY TEK KUTUDUR (v17) ve bu bir ÜRÜN SAHİBİ KARARIDIR — hukuki bir iyileştirme
 * değildir. v13'te bu kutu, Kurul'un aydınlatma ile açık rızayı ayırma yönündeki
 * görüşü nedeniyle İKİYE bölünmüştü; şimdi tekrar birleştirildi. Aydınlatma metninin
 * KENDİSİ (/kvkk) değişmedi: yurt dışı aktarımı anlatan bölümler orada eksiksiz durur.
 * Ayrıntı ve kalıcı çözüm için bkz. constants.js → KvkkSabitleri (v17 notu).
 */
export default function KimlikAdimi({
  adSoyad, onAdSoyad,
  telefon, onTelefon,
  kvkkOnay, onKvkkOnay,
  turnstileSiteKey, turnstileNonce, onTurnstileToken,
  yukleniyor, onGonder, onGeri,
  alanHatasi, adSoyadRef, telefonRef, kvkkOnayRef,
}) {
  /** Bu alanın hatası mı gösteriliyor? */
  const hataliMi = (alan) => alanHatasi?.alan === alan;

  return (
    <form onSubmit={onGonder} noValidate>
      <div className="card-header">
        <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden="true">🛡️</div>
        <h1 className="gradient-text">Son adım: kimlik doğrulama</h1>
        <p>Başvurunuzu iletebilmemiz için telefonunuzu doğruluyoruz</p>
      </div>

      <div className="form-group">
        <label htmlFor="adSoyad" className="form-label">Ad Soyad</label>
        <input
          id="adSoyad"
          ref={adSoyadRef}
          className={`form-input${hataliMi('adSoyad') ? ' hatali' : ''}`}
          type="text"
          placeholder="Adınız ve soyadınız"
          value={adSoyad}
          onChange={(e) => onAdSoyad(e.target.value)}
          autoComplete="name"
          aria-invalid={hataliMi('adSoyad')}
          autoFocus
        />
        {hataliMi('adSoyad') && <AlanHatasi mesaj={alanHatasi.mesaj} />}
      </div>

      <div className="form-group">
        <label htmlFor="telefon" className="form-label">Telefon</label>
        <input
          id="telefon"
          ref={telefonRef}
          className={`form-input${hataliMi('telefon') ? ' hatali' : ''}`}
          type="tel"
          inputMode="tel"
          placeholder="05XX XXX XX XX"
          value={telefon}
          onChange={(e) => onTelefon(e.target.value)}
          autoComplete="tel"
          aria-invalid={hataliMi('telefon')}
        />
        {hataliMi('telefon') && <AlanHatasi mesaj={alanHatasi.mesaj} />}
      </div>

      <div className="form-group">
        <label className={`onay-satiri${hataliMi('kvkkOnay') ? ' hatali' : ''}`}>
          <input
            ref={kvkkOnayRef}
            type="checkbox"
            checked={kvkkOnay}
            onChange={(e) => onKvkkOnay(e.target.checked)}
            aria-invalid={hataliMi('kvkkOnay')}
          />
          <span>
            <a href="/kvkk" target="_blank" rel="noopener noreferrer">
              Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni
            </a>
            {'’ni okudum, anladım ve kabul ediyorum.'}
          </span>
        </label>
        {hataliMi('kvkkOnay') && <AlanHatasi mesaj={alanHatasi.mesaj} />}
      </div>

      {/* Bot kapısı: SMS üretilmeden önceki son kapı. */}
      <TurnstileWidget
        key={turnstileNonce}
        siteKey={turnstileSiteKey}
        onToken={onTurnstileToken}
      />
      {hataliMi('turnstile') && <AlanHatasi mesaj={alanHatasi.mesaj} />}

      {/* disabled YOK — gerekçe yukarıda. Yalnız istek uçarken kilitlenir ki
          çift tıklama iki SMS üretmesin. */}
      <button className="btn btn-primary" type="submit" disabled={yukleniyor}>
        {yukleniyor ? <span className="spinner" /> : 'Doğrulama Kodu Gönder'}
      </button>

      <button type="button" className="btn-back" onClick={onGeri}>← Geri</button>
    </form>
  );
}
