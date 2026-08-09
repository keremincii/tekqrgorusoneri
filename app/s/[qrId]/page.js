import { Suspense } from 'react';
import SikayetFormu from './SikayetFormu';

/**
 * QR Okutma Sayfası — SUNUCU kabuğu
 * =================================
 *
 * Yalnızca Suspense sınırını kuran ince bir kabuktur; asıl sihirbaz ./SikayetFormu.js
 * içindedir. Sunucuda çözülen bir karar YOKTUR (tenant'a bağlı davranış bayrakları
 * kaldırıldı) — form her belediyede aynı akışı işletir: kategori → sokak → açıklama →
 * fotoğraf → özet → doğrulama.
 */

/**
 * Suspense yedeği. useSearchParams (?sig=...) prerender sırasında en yakın Suspense
 * sınırına kadarki istemci ağacını CSR'a düşürür; sınır olmadan üretim derlemesi
 * "Missing Suspense boundary with useSearchParams" ile kırılır. Yedek, formun kart
 * çerçevesini taklit eder → hidrasyon anında zıplama olmaz.
 */
function FormIskeleti() {
  return (
    <div className="page-container">
      <div className="card">
        <div className="steps">
          <div className="step-dot active" />
          <div className="step-dot" />
          <div className="step-dot" />
        </div>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <span className="spinner" />
        </div>
      </div>
    </div>
  );
}

export default function QrSikayetSayfasi() {
  return (
    <Suspense fallback={<FormIskeleti />}>
      <SikayetFormu />
    </Suspense>
  );
}
