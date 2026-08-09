'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Saha Konum Toplama Aracı (operatör içindir; vatandaş akışı DEĞİL)
 * =================================================================
 * Amaç: Sık dokulu (yan yana sokak) yerlerde vatandaşın anlık GPS'ine güvenmek
 * yerine, OPERATÖRÜN her tabelanın/sokağın önünde durup DOĞRU koordinatı bir kez
 * kaydetmesi. Telefonda açılır, gezerken her noktada: "Konum Al" → sokak adını yaz →
 * "Ekle". Sonunda "CSV İndir" → çıkan dosya doğrudan scripts/seed-sokaklar.js formatı
 * (Sokak_Adi,Enlem_Y,Boylam_X).
 *
 * Tamamen İSTEMCİ tarafı: sunucuya hiçbir şey yazmaz. Liste tarayıcıda (localStorage)
 * saklanır → sayfa yenilense/telefon uyusa bile kaybolmaz. Konum için sayfa HTTPS'ten
 * açılmalı (tarayıcı GPS'i yalnız güvenli origin'de verir).
 *
 * Doğruluk: tek fix yerine watchPosition ile birkaç saniye örnekleyip EN İYİ (en küçük
 * ±) okumayı tutar; hedefe (≈6 m) inince erken durur. Böylece "ilk kaba fix" sorunu yok.
 */

const ANAHTAR = 'konumTopla:liste:v1';
const HEDEF_DOGRULUK_M = 6;   // bu ±'ya inince yeterli say, erken dur
const MAKS_ORNEK_MS = 12000;  // en geç bu kadar örnekle, en iyiyi al

export default function KonumToplaSayfasi() {
  const [liste, setListe] = useState([]);
  const [anlik, setAnlik] = useState(null);   // {enlem, boylam, dogruluk}
  const [durum, setDurum] = useState('bekliyor'); // bekliyor|aliniyor|alindi|reddedildi|hata|desteklenmiyor
  const [sokakAdi, setSokakAdi] = useState('');
  const watchRef = useRef(null);
  const timerRef = useRef(null);
  const adInputRef = useRef(null);

  // localStorage'dan yükle (mount sonrası — SSR/hydration uyumsuzluğunu önlemek için ertelenir).
  useEffect(() => {
    const z = setTimeout(() => {
      try {
        const s = localStorage.getItem(ANAHTAR);
        if (s) setListe(JSON.parse(s));
      } catch { /* yoksay */ }
    }, 0);
    return () => clearTimeout(z);
  }, []);

  // Liste değişince kaydet.
  useEffect(() => {
    try { localStorage.setItem(ANAHTAR, JSON.stringify(liste)); } catch { /* kota dolu vb. */ }
  }, [liste]);

  // Bileşen kaldırılırsa açık watch/timer'ı temizle.
  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current);
    if (timerRef.current != null) clearTimeout(timerRef.current);
  }, []);

  function watchKapat() {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function konumAl() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setDurum('desteklenmiyor');
      return;
    }
    watchKapat();
    setAnlik(null);
    setDurum('aliniyor');

    let enIyi = null;
    const baslangic = Date.now();

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const a = pos.coords.accuracy;
        if (!enIyi || a < enIyi.dogruluk) {
          enIyi = { enlem: pos.coords.latitude, boylam: pos.coords.longitude, dogruluk: a };
          setAnlik(enIyi); // canlı: kullanıcı ±'nın düştüğünü görür
        }
        if (a <= HEDEF_DOGRULUK_M) {   // yeterince iyi → erken bitir
          watchKapat();
          setDurum('alindi');
        }
      },
      (err) => {
        watchKapat();
        setDurum(err && err.code === 1 ? 'reddedildi' : 'hata');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: MAKS_ORNEK_MS }
    );

    // Süre dolunca: o ana kadarki EN İYİ okumayı kabul et.
    timerRef.current = setTimeout(() => {
      watchKapat();
      setDurum(enIyi ? 'alindi' : 'hata');
    }, MAKS_ORNEK_MS + 500);
  }

  function ekle() {
    const ad = sokakAdi.replace(/,/g, ' ').trim(); // virgül CSV'yi bozar → boşluğa çevir
    if (!ad || !anlik) return;
    setListe((eski) => [
      ...eski,
      { ad, enlem: Number(anlik.enlem.toFixed(6)), boylam: Number(anlik.boylam.toFixed(6)), dogruluk: Math.round(anlik.dogruluk) },
    ]);
    setSokakAdi('');
    setAnlik(null);
    setDurum('bekliyor');
    adInputRef.current?.focus();
  }

  function sil(i) {
    setListe((eski) => eski.filter((_, idx) => idx !== i));
  }

  function temizle() {
    if (liste.length && !window.confirm(`${liste.length} kayıt silinsin mi? (Önce CSV indirdin mi?)`)) return;
    setListe([]);
  }

  function csvIndir() {
    if (!liste.length) return;
    const baslik = 'Sokak_Adi,Enlem_Y,Boylam_X';
    const satirlar = liste.map((s) => `${s.ad},${s.enlem},${s.boylam}`);
    const icerik = [baslik, ...satirlar].join('\n');
    const blob = new Blob([icerik], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sokaklar.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const ekleAktif = Boolean(anlik) && sokakAdi.trim().length > 0;
  const dogrulukRenk = anlik ? (anlik.dogruluk <= 10 ? '#22c55e' : anlik.dogruluk <= 25 ? '#f59e0b' : '#ef4444') : '#888';

  return (
    <div className="page-container">
      <div className="card" style={{ maxWidth: 520, textAlign: 'left' }}>
        <div className="card-header" style={{ textAlign: 'left' }}>
          <h1 className="gradient-text" style={{ fontSize: 22 }}>📍 Saha Konum Toplama</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
            Her tabelanın önünde dur → <b>Konum Al</b> → sokak adını yaz → <b>Ekle</b>. Sonunda{' '}
            <b>CSV İndir</b> ile dosyayı al, <code>seed-sokaklar.js</code>&apos;e ver.
          </p>
        </div>

        {/* 1) Konum al */}
        <button
          type="button"
          onClick={konumAl}
          className="form-input"
          disabled={durum === 'aliniyor'}
          style={{ width: '100%', cursor: 'pointer', fontWeight: 600, marginBottom: 10 }}
        >
          {durum === 'aliniyor' ? '⏳ En iyi konum bekleniyor…' : '📍 Konum Al'}
        </button>

        {/* Anlık okuma / durum */}
        {anlik && (
          <div style={{ fontSize: 14, marginBottom: 10 }}>
            <span style={{ color: dogrulukRenk, fontWeight: 700 }}>±{Math.round(anlik.dogruluk)} m</span>
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}· {anlik.enlem.toFixed(6)}, {anlik.boylam.toFixed(6)}
              {durum === 'aliniyor' ? ' · iyileşiyor…' : durum === 'alindi' ? ' · hazır ✓' : ''}
            </span>
          </div>
        )}
        {durum === 'reddedildi' && <p style={{ color: '#ef4444', fontSize: 13 }}>Konum izni reddedildi. Tarayıcı ayarından izin ver.</p>}
        {durum === 'hata' && <p style={{ color: '#ef4444', fontSize: 13 }}>Konum alınamadı. Açık alanda tekrar dene.</p>}
        {durum === 'desteklenmiyor' && <p style={{ color: '#ef4444', fontSize: 13 }}>Bu cihaz/tarayıcı konumu desteklemiyor.</p>}

        {/* 2) Sokak adı + ekle */}
        <input
          ref={adInputRef}
          type="text"
          value={sokakAdi}
          onChange={(e) => setSokakAdi(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ekleAktif) ekle(); }}
          placeholder="Sokak / tabela adı"
          className="form-input"
          style={{ width: '100%', marginBottom: 10 }}
        />
        <button
          type="button"
          onClick={ekle}
          disabled={!ekleAktif}
          className="form-input"
          style={{ width: '100%', cursor: ekleAktif ? 'pointer' : 'not-allowed', fontWeight: 600, opacity: ekleAktif ? 1 : 0.5, background: ekleAktif ? 'var(--accent-blue, #2563eb)' : undefined, color: ekleAktif ? '#fff' : undefined }}
        >
          ➕ Listeye Ekle
        </button>

        {/* 3) Liste */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 8px' }}>
          <b style={{ fontSize: 15 }}>Toplanan: {liste.length}</b>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={csvIndir} disabled={!liste.length} style={{ background: 'none', border: 'none', color: liste.length ? 'var(--accent-blue, #2563eb)' : '#888', cursor: liste.length ? 'pointer' : 'default', fontSize: 14, fontWeight: 600, textDecoration: 'underline' }}>⬇️ CSV İndir</button>
            <button type="button" onClick={temizle} disabled={!liste.length} style={{ background: 'none', border: 'none', color: liste.length ? '#ef4444' : '#888', cursor: liste.length ? 'pointer' : 'default', fontSize: 14 }}>🗑 Temizle</button>
          </div>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 320, overflowY: 'auto' }}>
          {liste.map((s, i) => (
            <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border, #333)', fontSize: 13 }}>
              <span style={{ overflow: 'hidden' }}>
                <b>{i + 1}. {s.ad}</b>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>{s.enlem}, {s.boylam} · ±{s.dogruluk} m</span>
              </span>
              <button type="button" onClick={() => sil(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, flexShrink: 0 }} aria-label="Sil">✕</button>
            </li>
          ))}
          {!liste.length && <li style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Henüz kayıt yok.</li>}
        </ul>

        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
          İpucu: <b>±10 m altını</b> (yeşil) bekle; kötüyse (kırmızı) birkaç adım açık alana çıkıp tekrar
          &quot;Konum Al&quot;. Liste tarayıcında saklanır; işin bitince mutlaka <b>CSV İndir</b>.
        </p>
      </div>
    </div>
  );
}
