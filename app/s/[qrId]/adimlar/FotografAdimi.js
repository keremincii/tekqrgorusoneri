'use client';

/**
 * ADIM 2 — Fotoğraf (İSTEĞE BAĞLI)
 * =================================
 *
 * "Geç" seçeneği, "ekle" kadar görünür durur: fotoğraf gerçekten opsiyoneldir ve
 * vatandaşın zorunlu sanıp akıştan düşmesi, elde edilecek fotoğraftan pahalıdır.
 *
 * İstemci tarafı ön kontrol (tür + boyut) yalnız HIZLI GERİ BİLDİRİM içindir; asıl
 * kapı sunucudadır (/api/sikayet/foto: magic-byte beyaz listesi, yeniden kodlama,
 * decompression-bomb koruması). Buradaki kontrolü aşan bir dosya orada durur.
 */
export default function FotografAdimi({ onizleme, onSec, onKaldir, onDevam, onGeri, maxByte }) {
  const mb = Math.round(maxByte / (1024 * 1024));

  return (
    <>
      <div className="card-header" style={{ marginBottom: 20 }}>
        <h1 className="gradient-text" style={{ fontSize: 26 }}>Fotoğraf eklemek ister misiniz?</h1>
        <p style={{ color: 'var(--text-secondary)' }}>İsteğe bağlı — göstermek işi hızlandırır</p>
      </div>

      {!onizleme ? (
        <label htmlFor="foto" className="foto-birak">
          <span className="foto-birak-ikon" aria-hidden="true">📷</span>
          <span className="foto-birak-baslik">Fotoğraf Çek / Seç</span>
          <span className="foto-birak-not">JPEG, PNG veya HEIC · en fazla {mb} MB</span>
          <input
            id="foto"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onSec}
            style={{ display: 'none' }}
          />
        </label>
      ) : (
        <div className="foto-onizleme-sarmal">
          {/* next/image kullanılmıyor: kaynak, tarayıcıda üretilen geçici bir
              object URL (blob:) — optimizasyon yapılacak uzak bir varlık değil. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={onizleme} alt="Eklediğiniz fotoğrafın önizlemesi" className="foto-onizleme" />
          <button
            type="button"
            onClick={onKaldir}
            aria-label="Fotoğrafı kaldır"
            className="foto-kaldir"
          >
            ✕
          </button>
        </div>
      )}

      <button type="button" className="btn btn-primary" style={{ marginTop: 20 }} onClick={onDevam}>
        {onizleme ? 'Devam Et →' : 'Fotoğrafsız devam et →'}
      </button>
      <button type="button" className="btn-back" onClick={onGeri}>← Geri</button>
    </>
  );
}
