'use client';

/**
 * Cihaz Parmak İzi (FingerprintJS — açık kaynak, CDN UMD, npm bağımlılığı YOK)
 * ===========================================================================
 *
 * Tarayıcıdan (canvas, WebGL, font, ekran…) türetilen, çerez temizlemeye/gizli
 * sekmeye büyük ölçüde DAYANIKLI bir `visitorId` üretir. Bu id, /api/dogrulama/tc'ye
 * `fingerprint` olarak gider ve orada hash'lenip bir throttle boyutu olur — böylece
 * saldırgan IP/çerez değiştirse bile aynı cihaz yakalanır.
 *
 * Tasarım: TurnstileWidget ile aynı desen — script bir kez CDN'den yüklenir, global
 * (window.FingerprintJS) üzerinden çalışılır. Yüklenemezse (ağ/adblock) SESSİZCE boş
 * döner; backend parmak izsiz devam eder (IP + telefon + global katmanları korur).
 *
 * KVKK: ham parmak izi saklanmaz; sunucuda yalnız hash'i throttle anahtarı olur.
 */

const SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@4/dist/fp.umd.min.js';

let _scriptSozu = null; // script yükleme sözü (tek sefer)
let _visitorSozu = null; // visitorId sözü (tek sefer; sonuç önbelleklenir)

/** FingerprintJS UMD script'ini bir kez yükler; window.FingerprintJS hazır olunca resolve. */
function scriptYukle() {
  if (_scriptSozu) return _scriptSozu;
  _scriptSozu = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no-window'));
    if (window.FingerprintJS) return resolve(window.FingerprintJS);

    const mevcut = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (mevcut) {
      mevcut.addEventListener('load', () => resolve(window.FingerprintJS));
      mevcut.addEventListener('error', () => reject(new Error('fp-script-hata')));
      const t = setInterval(() => {
        if (window.FingerprintJS) { clearInterval(t); resolve(window.FingerprintJS); }
      }, 50);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve(window.FingerprintJS);
    s.onerror = () => reject(new Error('fp-script-hata'));
    document.head.appendChild(s);
  });
  return _scriptSozu;
}

/**
 * Cihazın visitorId'sini döndürür (hesaplama önbelleklenir). Hata olursa '' döner.
 * @returns {Promise<string>}
 */
export function cihazParmakIziAl() {
  if (_visitorSozu) return _visitorSozu;
  _visitorSozu = (async () => {
    try {
      const FP = await scriptYukle();
      const agent = await FP.load();
      const sonuc = await agent.get();
      return sonuc?.visitorId || '';
    } catch {
      return ''; // parmak izsiz devam
    }
  })();
  return _visitorSozu;
}
