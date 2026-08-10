'use client';

import { BasvuruTurleri, TurTablosu } from '@/lib/utils/constants';
import { ACIKLAMA_MAX } from '@/lib/utils/validators';

/**
 * ADIM 1 — "Görüş, şikayet veya öneri girin"
 * ===========================================
 *
 * TEK EKRAN, İKİ KARAR: üstte tür (şikayet / görüş / öneri), altta metin. Ayrı bir
 * "tür seç" sayfası yapılmadı çünkü ikisi tek bir düşüncenin parçası: vatandaş zaten
 * ne söyleyeceğini bilerek QR'ı okutuyor, türü de o cümleyi yazarken seçiyor. Ekranı
 * ikiye bölmek, tek karar için fazladan bir dokunuş ve bir bekleme demekti.
 *
 * KATEGORİ YOK: 7 başlıklı kategori listesi bu üründen kaldırıldı. Vatandaşın yazdığı
 * cümle konuyu zaten söylüyor; sınıflandırmayı ona yaptırmak, ekranı uzatan ve yanlış
 * seçime davet eden bir adımdı.
 *
 * Yalnız GÖRÜNÜM sorumluluğu taşır: doğrulama ve gönderim üst bileşendedir.
 */
export default function BasvuruAdimi({ tur, onTur, metin, onMetin, onDevam }) {
  const secili = TurTablosu[tur];
  const yazildi = metin.trim().length > 0;

  return (
    <>
      <div className="card-header" style={{ marginBottom: 20 }}>
        <h1 className="gradient-text" style={{ fontSize: 26 }}>Bize ne iletmek istersiniz?</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Önce türünü seçin, sonra yazın</p>
      </div>

      {/* --- Tür seçimi --- */}
      <div className="tur-grid" role="radiogroup" aria-label="Başvuru türü">
        {BasvuruTurleri.map((t) => {
          const aktif = t.id === tur;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={aktif}
              className={`tur-btn${aktif ? ' secili' : ''}`}
              // Seçili türün kendi rengi kenarlık/gölge olarak kullanılır: üç seçenek
              // birbirinden yalnız metinle değil renkle de ayrılsın (hızlı tanıma).
              style={aktif ? { '--tur-renk': t.renk } : undefined}
              onClick={() => onTur(t.id)}
            >
              <span className="tur-ikon" aria-hidden="true">{t.ikon}</span>
              <span className="tur-etiket">{t.etiket}</span>
            </button>
          );
        })}
      </div>

      {/* Seçilen türün ne anlama geldiği — vatandaş "hangisi benimki?" diye düşünmesin. */}
      {secili && <p className="tur-aciklama">{secili.aciklama}</p>}

      {/* --- Metin --- */}
      <label htmlFor="basvuruMetni" className="form-label" style={{ marginTop: 18 }}>
        {secili?.iyelik || 'Mesajınız'}
      </label>
      <textarea
        id="basvuruMetni"
        className="form-input form-textarea"
        placeholder={secili?.ornek || ''}
        value={metin}
        onChange={(e) => onMetin(e.target.value)}
        maxLength={ACIKLAMA_MAX}
        rows={6}
        style={{ minHeight: 150, fontSize: 16 }}
      />
      <div className="sayac-satiri">
        <span>{metin.length}/{ACIKLAMA_MAX}</span>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onDevam}
        disabled={!yazildi}
      >
        Devam Et →
      </button>
    </>
  );
}
