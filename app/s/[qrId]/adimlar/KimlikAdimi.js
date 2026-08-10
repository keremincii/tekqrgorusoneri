'use client';

import TurnstileWidget from '../TurnstileWidget';

/**
 * ADIM 3 — Ad Soyad + Telefon + KVKK onayları
 * ============================================
 *
 * Buradan sonra SMS kodu gider, yani bu ekranın ötesi PARA harcar (her SMS bir
 * maliyettir). Bot kapısı (Cloudflare Turnstile) bu yüzden burada durur — kod
 * üretilmeden önceki son kapıdır.
 *
 * KVKK ONAYLARI AYRI İKİ KUTUDUR ve bu birleştirilebilir bir ayrıntı DEĞİLDİR:
 * Kurul'un yerleşik görüşü aydınlatma ile açık rızanın ayrı alınmasıdır. Burada risk
 * teorik de değil — sunucu yurt dışında olduğu için aktarımın TEK hukuki dayanağı
 * açık rızadır; rıza sakatsa aktarım dayanaksız kalır. Tek kutuya İNDİRMEYİN.
 */
export default function KimlikAdimi({
  adSoyad, onAdSoyad,
  telefon, onTelefon,
  aydinlatmaOkundu, onAydinlatma,
  kvkkOnay, onKvkkOnay,
  turnstileSiteKey, turnstileNonce, onTurnstileToken, turnstileToken,
  yukleniyor, onGonder, onGeri,
}) {
  const turnstileGerekli = Boolean(turnstileSiteKey);
  const gonderilebilir =
    !yukleniyor && aydinlatmaOkundu && kvkkOnay && (!turnstileGerekli || Boolean(turnstileToken));

  return (
    <form onSubmit={onGonder}>
      <div className="card-header">
        <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden="true">🛡️</div>
        <h1 className="gradient-text">Son adım: kimlik doğrulama</h1>
        <p>Başvurunuzu iletebilmemiz için telefonunuzu doğruluyoruz</p>
      </div>

      <div className="form-group">
        <label htmlFor="adSoyad" className="form-label">Ad Soyad</label>
        <input
          id="adSoyad"
          className="form-input"
          type="text"
          placeholder="Adınız ve soyadınız"
          value={adSoyad}
          onChange={(e) => onAdSoyad(e.target.value)}
          autoComplete="name"
          required
          autoFocus
        />
      </div>

      <div className="form-group">
        <label htmlFor="telefon" className="form-label">Telefon</label>
        <input
          id="telefon"
          className="form-input"
          type="tel"
          inputMode="tel"
          placeholder="05XX XXX XX XX"
          value={telefon}
          onChange={(e) => onTelefon(e.target.value)}
          autoComplete="tel"
          required
        />
      </div>

      {/*
        KVKK onayları — İKİ AYRI KUTU, ikisi de zorunlu. Ayrılma gerekçesi yukarıda
        (bileşen açıklamasında). Tek kutuda birleştirmeye GERİ DÖNMEYİN.
      */}
      <div className="form-group onay-kutulari">
        <label className="onay-satiri">
          <input
            type="checkbox"
            checked={aydinlatmaOkundu}
            onChange={(e) => onAydinlatma(e.target.checked)}
          />
          <span>
            <a href="/kvkk" target="_blank" rel="noopener noreferrer">Aydınlatma Metni</a>
            {'’ni okudum.'}
          </span>
        </label>
        <label className="onay-satiri">
          <input
            type="checkbox"
            checked={kvkkOnay}
            onChange={(e) => onKvkkOnay(e.target.checked)}
          />
          <span>
            Başvurumun işlenebilmesi için verilerimin, Aydınlatma Metni&rsquo;nde açıklandığı
            şekilde <strong>yurt dışına aktarılmasına açık rıza veriyorum.</strong>
          </span>
        </label>
      </div>

      {/* Bot kapısı: SMS üretilmeden önceki son kapı. */}
      <TurnstileWidget
        key={turnstileNonce}
        siteKey={turnstileSiteKey}
        onToken={onTurnstileToken}
      />

      <button className="btn btn-primary" type="submit" disabled={!gonderilebilir}>
        {yukleniyor ? <span className="spinner" /> : 'Doğrulama Kodu Gönder'}
      </button>

      <button type="button" className="btn-back" onClick={onGeri}>← Geri</button>
    </form>
  );
}
