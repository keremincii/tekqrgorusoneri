'use client';

import { GuvenlikSabitleri } from '@/lib/utils/constants';

/**
 * ADIM 4 — SMS doğrulama kodu
 * ============================
 *
 * Kod doğrulanır doğrulanmaz başvuru OTOMATİK gönderilir; ayrı bir "gönder" adımı
 * yoktur. Vatandaş için akış burada biter.
 *
 * "Tekrar gönder" geri sayımlı: SMS operatör gecikmesiyle geç gelebilir, vatandaş
 * sayfayı yenilemeden yeni kod isteyebilmeli — ama art arda basıp SMS bütçesini
 * yakmamalı. Gönderim sınırına ulaşıldığında buton hiç gösterilmez.
 */
export default function KodAdimi({
  telefon, kod, onKod, yukleniyor, onDogrula,
  geriSayim, gonderLimiti, onTekrarGonder, onGeri,
}) {
  const uzunluk = GuvenlikSabitleri.SMS_KOD_UZUNLUGU;

  return (
    <form onSubmit={onDogrula}>
      <div className="card-header">
        <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden="true">📱</div>
        <h1 className="gradient-text">SMS Doğrulama</h1>
        <p>Telefonunuza gelen {uzunluk} haneli kodu girin</p>
      </div>

      <div className="alert alert-info">
        <span aria-hidden="true">📱</span>
        <span><strong>{telefon}</strong> numarasına doğrulama kodu gönderildi.</span>
      </div>

      <div className="form-group">
        <label htmlFor="smsKodu" className="form-label">Doğrulama Kodu</label>
        <input
          id="smsKodu"
          className="form-input sms-input"
          type="text"
          inputMode="numeric"
          // Tarayıcı/işletim sistemi SMS'teki kodu otomatik doldurabilsin.
          autoComplete="one-time-code"
          maxLength={uzunluk}
          placeholder={'• '.repeat(uzunluk).trim()}
          value={kod}
          onChange={(e) => onKod(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
        />
      </div>

      <button className="btn btn-primary" type="submit" disabled={yukleniyor || kod.length !== uzunluk}>
        {yukleniyor ? <span className="spinner" /> : 'Doğrula ve Gönder'}
      </button>

      <div className="tekrar-gonder">
        {gonderLimiti ? (
          <span>Şu anda işleminizi gerçekleştiremiyoruz. Lütfen bir süre sonra tekrar deneyin.</span>
        ) : geriSayim > 0 ? (
          <span>Kod gelmediyse <strong>{geriSayim} sn</strong> sonra tekrar gönderebilirsiniz</span>
        ) : (
          <button type="button" onClick={onTekrarGonder} disabled={yukleniyor}>
            Kodu tekrar gönder
          </button>
        )}
      </div>

      <button type="button" className="btn-back" onClick={onGeri}>← Geri</button>
    </form>
  );
}
