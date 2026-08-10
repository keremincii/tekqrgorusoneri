'use client';

import { BasvuruTurleri, SikayetDurumlari } from '@/lib/utils/constants';

/** Canlı akış göstergesinin metni ve rengi. */
const AKIS_GORUNUMU = Object.freeze({
  canli: { etiket: 'Canlı', sinif: 'canli', baslik: 'Yeni başvurular anında düşüyor — sayfayı yenilemenize gerek yok' },
  baglaniyor: { etiket: 'Bağlanıyor', sinif: 'baglaniyor', baslik: 'Canlı akış kuruluyor' },
  kopuk: { etiket: 'Bağlantı yok', sinif: 'kopuk', baslik: 'Canlı akış koptu — liste periyodik olarak tazeleniyor' },
});

/**
 * PanoBasligi — Sabit üst şerit: sayaçlar, tür sekmeleri, durum ve arama filtreleri.
 *
 * TÜR SEKMELERİ HEM FİLTRE HEM ÖZETTİR: her sekmede o türün AÇIK (sonuçlanmamış)
 * sayısı bir rozet olarak durur. Başkanın panele bakınca soracağı ilk soru "kaç işim
 * var?"dır; bunu ayrı bir istatistik bölümüne saklamak yerine filtrenin üzerine yazmak
 * hem yer kazandırır hem de tıklanacak yeri işaret eder.
 *
 * Sayaçlar sunucudan (tüm tabloyu kapsayan) gelir — ekrandaki sayfadan hesaplanmaz.
 */
export default function PanoBasligi({
  belediye, akisDurumu, sayimlar,
  tur, onTur, durumlar, onDurum, arama, onArama,
  ekipAcik, onEkip,
}) {
  const akis = AKIS_GORUNUMU[akisDurumu] || AKIS_GORUNUMU.baglaniyor;

  /** Bir türün (ya da tümünün) AÇIK kayıt sayısı. */
  const acikSayi = (turId) => sayimlar
    .filter((s) => (!turId || s.tur === turId) && s.durum !== 'cozuldu')
    .reduce((t, s) => t + s.adet, 0);

  /** Bir türün (ya da tümünün) toplam kayıt sayısı. */
  const toplamSayi = (turId) => sayimlar
    .filter((s) => !turId || s.tur === turId)
    .reduce((t, s) => t + s.adet, 0);

  /** Durum çipi aç/kapat (çoklu seçim; hiçbiri seçili değilse "hepsi"). */
  function durumToggle(id) {
    onDurum(durumlar.includes(id) ? durumlar.filter((d) => d !== id) : [...durumlar, id]);
  }

  return (
    <header className="pano-baslik">
      <div className="pano-ust">
        <div className="pano-kimlik">
          <h1>{belediye?.ad || 'Başvuru Panosu'}</h1>
          {belediye?.baskanAdi && <p>{belediye.baskanAdi}</p>}
        </div>

        <div className="pano-ust-sag">
          <span className={`akis-rozet akis-${akis.sinif}`} title={akis.baslik}>
            <span className="akis-nokta" aria-hidden="true" />
            {akis.etiket}
          </span>
          <button
            type="button"
            className={`pano-ekip-btn${ekipAcik ? ' acik' : ''}`}
            onClick={onEkip}
            aria-expanded={ekipAcik}
          >
            👷 Ekip
          </button>
        </div>
      </div>

      {/* --- Tür sekmeleri (aynı zamanda özet) --- */}
      <nav className="tur-sekmeler" aria-label="Başvuru türü filtresi">
        <button
          type="button"
          className={`tur-sekme${!tur ? ' aktif' : ''}`}
          onClick={() => onTur(null)}
          aria-pressed={!tur}
        >
          <span className="tur-sekme-ad">Tümü</span>
          <span className="tur-sekme-sayi">{toplamSayi(null)}</span>
          {acikSayi(null) > 0 && <span className="tur-sekme-acik">{acikSayi(null)} açık</span>}
        </button>

        {BasvuruTurleri.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tur-sekme${tur === t.id ? ' aktif' : ''}`}
            style={{ '--tur-renk': t.renk }}
            onClick={() => onTur(tur === t.id ? null : t.id)}
            aria-pressed={tur === t.id}
          >
            <span className="tur-sekme-ad">
              <span aria-hidden="true">{t.ikon}</span> {t.etiket}
            </span>
            <span className="tur-sekme-sayi">{toplamSayi(t.id)}</span>
            {acikSayi(t.id) > 0 && <span className="tur-sekme-acik">{acikSayi(t.id)} açık</span>}
          </button>
        ))}
      </nav>

      {/* --- Durum + arama --- */}
      <div className="pano-filtre">
        <div className="durum-cipleri" role="group" aria-label="Durum filtresi">
          {SikayetDurumlari.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`durum-cip${durumlar.includes(d.id) ? ' aktif' : ''}`}
              style={{ '--durum-renk': d.renk }}
              onClick={() => durumToggle(d.id)}
              aria-pressed={durumlar.includes(d.id)}
            >
              {d.etiket}
            </button>
          ))}
          {durumlar.length > 0 && (
            <button type="button" className="durum-cip-temizle" onClick={() => onDurum([])}>
              Temizle
            </button>
          )}
        </div>

        <input
          type="search"
          className="pano-arama"
          placeholder="Başvuru metinlerinde ara…"
          value={arama}
          onChange={(e) => onArama(e.target.value)}
          aria-label="Başvuru metinlerinde ara"
        />
      </div>
    </header>
  );
}
