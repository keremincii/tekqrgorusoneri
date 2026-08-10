'use client';

import { useEffect } from 'react';

/**
 * Tam ekran fotoğraf görüntüleyici.
 *
 * Fotoğraf oturum korumalı bir uçtan (/api/admin/foto/[id]) gelir; R2 nesne anahtarı
 * istemciye HİÇ verilmez (bkz. /api/admin/sikayetler — yalnız `fotografVar` döner).
 * Açıkken Esc ile kapanır ve arka planın kaymasını durdurur.
 */
export default function FotoModal({ basvuruId, onKapat }) {
  useEffect(() => {
    if (!basvuruId) return;
    const esc = (e) => { if (e.key === 'Escape') onKapat(); };
    const eskiTasma = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = eskiTasma;
    };
  }, [basvuruId, onKapat]);

  if (!basvuruId) return null;

  return (
    <div className="foto-modal" onClick={onKapat} role="presentation">
      <div className="foto-modal-icerik" onClick={(e) => e.stopPropagation()} role="presentation">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/admin/foto/${basvuruId}`} alt="Başvuru fotoğrafı" />
        <button type="button" className="foto-modal-kapat" onClick={onKapat} aria-label="Kapat">✕</button>
      </div>
    </div>
  );
}
