'use client';

import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile Widget (vanilla — npm bağımlılığı YOK)
 * ==========================================================
 *
 * Bot kapısı: kullanıcı SMS kodu istemeden önce isteğin gerçek bir tarayıcıdan
 * geldiğini kanıtlar. Ürettiği token, /api/dogrulama/tc'ye `turnstileToken` olarak
 * gider ve orada Cloudflare siteverify ile doğrulanır.
 *
 * Kullanım:
 *   <TurnstileWidget key={nonce} siteKey={SITE_KEY} onToken={setToken} />
 * - Yeni bir challenge (token) gerektiğinde `key` prop'unu değiştirerek remount et
 *   (Turnstile token'ları TEK KULLANIMLIKTIR; başarısız denemeden sonra tazele).
 * - siteKey boşsa (geliştirme) hiçbir şey render etmez; backend de doğrulamayı atlar.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Turnstile script'ini bir kez yükler; window.turnstile hazır olunca resolve eder. */
function turnstileScriptYukle() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no-window'));
    if (window.turnstile) return resolve();

    const mevcut = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (mevcut) {
      mevcut.addEventListener('load', () => resolve());
      mevcut.addEventListener('error', () => reject(new Error('turnstile-script-hata')));
      // Zaten yüklenmiş olabilir ama global henüz set edilmemiş olabilir → kısa poll.
      const t = setInterval(() => {
        if (window.turnstile) { clearInterval(t); resolve(); }
      }, 50);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile-script-hata'));
    document.head.appendChild(s);
  });
}

export default function TurnstileWidget({ siteKey, onToken }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  // onToken'ı ref'te tut: effect'i yeniden çalıştırmadan güncel callback'i kullan.
  // (Ref render sırasında değil, effect içinde güncellenir — react-hooks/refs.)
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return;
    let iptal = false;

    turnstileScriptYukle()
      .then(() => {
        if (iptal || !window.turnstile || !containerRef.current) return;
        if (widgetIdRef.current !== null) return; // çift render koruması (strict mode)
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current?.(token),
          'expired-callback': () => onTokenRef.current?.(''),
          'error-callback': () => onTokenRef.current?.(''),
          'timeout-callback': () => onTokenRef.current?.(''),
        });
      })
      .catch(() => {
        /* Script yüklenemedi (ör. ağ/adblock) → token boş kalır. Backend fail-open;
           SMS'i asıl koruyan katmanlı throttle + global kesici zaten devrede. */
      });

    return () => {
      iptal = true;
      if (widgetIdRef.current !== null && typeof window !== 'undefined' && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* yut */ }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }} />;
}
