'use client';

import { useState } from 'react';
import {
  TurTablosu, durumEtiketi, durumKapaliMi, sonrakiDurumlar,
  yasKademesi, gunFarki, KAPALI_RENGI,
} from '@/lib/utils/constants';
import { tarihUzun, goreliYas, personelKisaAd } from './bicim';

/**
 * BasvuruKarti — Panelin okunabilirlik birimi
 * ============================================
 *
 * TASARIM KARARI: metin KAHRAMANDIR. Vatandaşın yazdığı cümle en büyük, en yüksek
 * kontrastlı ve en geniş satır aralıklı öğedir; rozetler, tarih ve butonlar onun
 * etrafında ikincil kalır. Bu üründe kategori yok — yönetimin okuyacağı tek içerik
 * o metin; onu küçük punto bir "açıklama" satırına sıkıştırmak paneli işlevsiz kılardı.
 *
 * Metin KIRPILMAZ (satır sınırı yok). "2 satır göster + devamını oku" kalıbı, uzun bir
 * şikayeti okumayı iki tıklamalık bir işe çevirir ve yönetici çoğu zaman o ikinci
 * tıklamayı yapmaz. Uzunluk sınırı zaten girişte var (1000 karakter).
 *
 * Kart, KENDİ aksiyon durumunu (`islemde`) taşır: bir kartın butonuna basılması diğer
 * kartları kilitlemez ve üst bileşende kart-başına state tutmaya gerek kalmaz.
 */
export default function BasvuruKarti({
  basvuru, personeller, onDurum, onAta, onSil, onFoto, vurgulu,
}) {
  const [islemde, setIslemde] = useState(false);
  const [atamaAcik, setAtamaAcik] = useState(false);

  const tur = TurTablosu[basvuru.tur];
  const kapali = durumKapaliMi(basvuru.durum);
  const yas = gunFarki(basvuru.olusturmaTarihi);
  const kademe = yasKademesi(yas);
  // Sonuçlanmış kayıtta "kaç gündür bekliyor" bilgisi anlamsızdır → yeşil kapanış rengi.
  const yasRengi = kapali ? KAPALI_RENGI : kademe.renk;

  /** Bir aksiyonu çalıştırırken kartı kilitler (çift tıklama → çift istek olmasın). */
  async function calistir(fn) {
    if (islemde) return;
    setIslemde(true);
    try {
      await fn();
    } finally {
      setIslemde(false);
    }
  }

  const atanan = basvuru.atananPersonelId
    ? personelKisaAd(basvuru.atananPersonelAd, basvuru.atananPersonelSoyad)
    : null;
  const cozen = basvuru.cozenPersonelAd
    ? personelKisaAd(basvuru.cozenPersonelAd, basvuru.cozenPersonelSoyad)
    : null;

  return (
    <article
      className={`bk${vurgulu ? ' bk--yeni' : ''}${islemde ? ' bk--islemde' : ''}`}
      // Tür rengi kartın sol kenarına şerit olarak düşer: uzun bir listede türler
      // okumadan ayırt edilebilsin.
      style={{ '--tur-renk': tur?.renk || 'var(--accent-blue)' }}
      aria-busy={islemde}
    >
      <header className="bk-ust">
        <span className="bk-tur">
          <span aria-hidden="true">{tur?.ikon || '📌'}</span>
          {tur?.etiket || 'Başvuru'}
        </span>

        <span className={`bk-durum durum-${basvuru.durum}`}>{durumEtiketi(basvuru.durum)}</span>

        <span className="bk-yas" style={{ color: yasRengi }} title={tarihUzun(basvuru.olusturmaTarihi)}>
          {kapali ? '✓ sonuçlandı' : goreliYas(basvuru.olusturmaTarihi)}
        </span>
      </header>

      {/* ASIL İÇERİK — kartın en büyük ve en okunaklı parçası. */}
      <p className="bk-metin">{basvuru.aciklama}</p>

      {basvuru.fotografVar && (
        <button
          type="button"
          className="bk-foto-btn"
          onClick={() => onFoto(basvuru.id)}
          title="Fotoğrafı büyüt"
        >
          {/* Fotoğraf yetkili uçtan gelir (R2 anahtarı istemciye hiç verilmez).
              next/image kullanılmıyor: kaynak oturum korumalı bir API ucu. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/admin/foto/${basvuru.id}`} alt="Başvuruya eklenen fotoğraf" loading="lazy" />
          <span className="bk-foto-buyut" aria-hidden="true">⤢</span>
        </button>
      )}

      <div className="bk-meta">
        <span title={tarihUzun(basvuru.olusturmaTarihi)}>{tarihUzun(basvuru.olusturmaTarihi)}</span>
        {basvuru.noktaAdi && <span className="bk-nokta">📍 {basvuru.noktaAdi}</span>}
        {atanan && <span className="bk-atanan">👷 {atanan}</span>}
        {kapali && cozen && <span className="bk-cozen">✔️ Çözen: {cozen}</span>}
      </div>

      <footer className="bk-aksiyon">
        {/* Durum butonları sözlükten türetilir (constants.SikayetDurumlari): aşama
            atlanamaz ve sonuçlanmış kayıtta hiç buton çıkmaz. */}
        {sonrakiDurumlar(basvuru.durum).map((d) => (
          <button
            key={d.id}
            type="button"
            className={`bk-btn${durumKapaliMi(d.id) ? ' bk-btn--onay' : ''}`}
            disabled={islemde}
            onClick={() => calistir(() => onDurum(basvuru.id, d.id))}
          >
            {durumKapaliMi(d.id) ? `✓ ${d.etiket}` : d.etiket}
          </button>
        ))}

        {/* Atama: saha ekibine iş düşmesinin TEK yolu (otomatik dağıtım yok). */}
        {!kapali && personeller.length > 0 && (
          <div className="bk-atama">
            <button
              type="button"
              className="bk-btn"
              disabled={islemde}
              onClick={() => setAtamaAcik((v) => !v)}
              aria-expanded={atamaAcik}
            >
              {atanan ? '↻ Yeniden ata' : '👷 Ata'}
            </button>
            {atamaAcik && (
              <div className="bk-atama-liste" role="menu">
                {personeller.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className="bk-atama-secenek"
                    disabled={islemde}
                    onClick={() => { setAtamaAcik(false); calistir(() => onAta(basvuru.id, p.id)); }}
                  >
                    {p.ad} {p.soyad}
                    {p.birimAdi ? <span className="bk-atama-birim">{p.birimAdi}</span> : null}
                    {!p.telegramBagli && <span className="bk-atama-uyari" title="Telegram'a bağlı değil — bildirim gitmez">○</span>}
                  </button>
                ))}
                {atanan && (
                  <button
                    type="button"
                    role="menuitem"
                    className="bk-atama-secenek bk-atama-kaldir"
                    disabled={islemde}
                    onClick={() => { setAtamaAcik(false); calistir(() => onAta(basvuru.id, null)); }}
                  >
                    ✕ Atamayı kaldır
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="bk-btn bk-btn--sil"
          disabled={islemde}
          onClick={() => calistir(() => onSil(basvuru.id))}
          title="Başvuruyu listeden kaldır"
        >
          Sil
        </button>
      </footer>
    </article>
  );
}
