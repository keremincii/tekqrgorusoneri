'use client';

import { TurTablosu } from '@/lib/utils/constants';

/**
 * ADIM 5 — Başarı
 * ================
 *
 * Vatandaşın gördüğü son ekran. Ne gönderdiğini (tür) tekrar söyler — "acaba gitti mi,
 * doğru şeyi mi seçtim?" sorusunu kapatır — ve varsa başkanın adıyla imzalanır.
 */
export default function BasariAdimi({ tur, belediyeAdi, baskanAdi }) {
  const t = TurTablosu[tur];

  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <div className="success-icon">✓</div>
      <h1 className="gradient-text" style={{ fontSize: 30, marginBottom: 14 }}>
        {t?.iyelik || 'Başvurunuz'} alındı!
      </h1>
      <p style={{ color: 'var(--text-primary)', lineHeight: 1.7, fontSize: 18 }}>
        {t?.iyelik || 'Başvurunuz'} başarıyla iletildi.{' '}
        {belediyeAdi ? `${belediyeAdi} ekipleri` : 'Belediye ekiplerimiz'} en kısa sürede ilgilenecektir.
      </p>

      {baskanAdi && (
        <div className="basari-imza">
          <p className="basari-imza-ad">{baskanAdi}</p>
          <p className="basari-imza-unvan">Belediye Başkanı</p>
        </div>
      )}

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 20 }}>
        Teşekkür ederiz 🙏
      </p>
    </div>
  );
}
