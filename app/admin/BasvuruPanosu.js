'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBasvuruAkisi } from './panel/useBasvuruAkisi';
import PanoBasligi from './panel/PanoBasligi';
import BasvuruKarti from './panel/BasvuruKarti';
import EkipCekmecesi from './panel/EkipCekmecesi';
import FotoModal from './panel/FotoModal';

/** Arama kutusunda yazmayı bıraktıktan sonra sunucuya sorulana kadar beklenen süre (ms). */
const ARAMA_GECIKMESI_MS = 350;

/** Bir kartın "yeni geldi" vurgusunun ekranda kalma süresi (ms). */
const VURGU_SURESI_MS = 6000;

/**
 * Ekip verisini (personel + birim) çeker. SAF: state'e dokunmaz, yalnız veri döner.
 * Ayrı tutulması bilinçli — effect gövdesinde senkron setState çağırmamak için
 * güncellemeler her zaman `await`ten sonra yapılır.
 * @returns {Promise<{personeller: Array, birimler: Array}|null>}
 */
async function ekipVerisiGetir() {
  try {
    const [pRes, bRes] = await Promise.all([
      fetch('/api/admin/personel'),
      fetch('/api/admin/birim'),
    ]);
    return {
      personeller: pRes.ok ? (await pRes.json()).personeller || [] : [],
      birimler: bRes.ok ? (await bRes.json()).birimler || [] : [],
    };
  } catch {
    // Ekip verisi panelin OKUMA işlevini engellemez; sessizce geçilir.
    return null;
  }
}

/**
 * BasvuruPanosu — Başkanın ana ekranı
 * ====================================
 *
 * SORUMLULUK: filtre durumunu tutar, veri motorunu (useBasvuruAkisi) besler, yazma
 * işlemlerini uçlara gönderir. Görünüm parçaları ayrı bileşenlerde:
 *   PanoBasligi   → sayaçlar + filtreler
 *   BasvuruKarti  → tek başvuru (okuma + aksiyonlar)
 *   EkipCekmecesi → personel/birim yönetimi
 *
 * CANLI: /api/admin/akis (SSE) üzerinden gelen olaylar listeye yerinde işlenir —
 * başkanın ekrana bakarken sayfayı yenilemesi GEREKMEZ. Yeni gelen kayıtlar kısa
 * süre vurgulanır ki hangi kartın az önce düştüğü gözden kaçmasın.
 */
export default function BasvuruPanosu() {
  // --- Filtreler ---
  const [tur, setTur] = useState(null);
  const [durumlar, setDurumlar] = useState([]);
  const [aramaGirdi, setAramaGirdi] = useState('');
  const [arama, setArama] = useState('');

  // --- Yan yüzeyler ---
  const [ekipAcik, setEkipAcik] = useState(false);
  const [fotoId, setFotoId] = useState(null);

  // --- Ekip verisi ---
  const [personeller, setPersoneller] = useState([]);
  const [birimler, setBirimler] = useState([]);

  // --- Canlı vurgu ---
  const [vurgulular, setVurgulular] = useState(() => new Set());
  const gorulenIdlerRef = useRef(new Set());
  /** Vurgu zamanlayıcıları — bileşen sökülürken hepsi temizlenir (sızıntı olmasın). */
  const vurguZamanlayicilariRef = useRef(new Set());

  // Arama kutusu her tuşta sunucuya gitmesin: yazmayı bırakınca bir kez sorulur.
  useEffect(() => {
    const t = setTimeout(() => setArama(aramaGirdi), ARAMA_GECIKMESI_MS);
    return () => clearTimeout(t);
  }, [aramaGirdi]);

  // `durumlar` her render'da yeni bir dizi referansı olursa veri motoru sonsuz döngüye
  // girer (useCallback bağımlılığı). İçeriğe göre sabitlenir.
  const durumAnahtari = durumlar.join(',');
  const durumlarSabit = useMemo(() => (durumAnahtari ? durumAnahtari.split(',') : []), [durumAnahtari]);

  const {
    basvurular, sayimlar, belediye, yukleniyor, dahaYukleniyor,
    devamVar, hata, akisDurumu, gizliYeniAdet, dahaYukle, tazele,
  } = useBasvuruAkisi({ tur, durumlar: durumlarSabit, arama });

  // Listeye YENİ giren kayıtları kısa süre vurgula. İlk yüklemede tüm liste "yeni"
  // sayılmamalı → ilk turda yalnızca görülenler kaydedilir, vurgu yapılmaz.
  const ilkYuklemeBittiRef = useRef(false);
  useEffect(() => {
    if (yukleniyor) return;
    const gorulen = gorulenIdlerRef.current;

    if (!ilkYuklemeBittiRef.current) {
      basvurular.forEach((b) => gorulen.add(b.id));
      ilkYuklemeBittiRef.current = true;
      return;
    }

    const yeniler = basvurular.filter((b) => !gorulen.has(b.id)).map((b) => b.id);
    if (yeniler.length === 0) return;
    yeniler.forEach((id) => gorulen.add(id));
    setVurgulular((onceki) => new Set([...onceki, ...yeniler]));

    const zamanlayici = setTimeout(() => {
      setVurgulular((onceki) => {
        const kalan = new Set(onceki);
        yeniler.forEach((id) => kalan.delete(id));
        return kalan;
      });
      vurguZamanlayicilariRef.current.delete(zamanlayici);
    }, VURGU_SURESI_MS);
    vurguZamanlayicilariRef.current.add(zamanlayici);
  }, [basvurular, yukleniyor]);

  // Bileşen sökülürken bekleyen vurgu zamanlayıcılarını temizle.
  useEffect(() => {
    const zamanlayicilar = vurguZamanlayicilariRef.current;
    return () => {
      zamanlayicilar.forEach(clearTimeout);
      zamanlayicilar.clear();
    };
  }, []);

  // ===================== Ekip verisi =====================

  const ekibiYukle = useCallback(async () => {
    const veri = await ekipVerisiGetir();
    if (!veri) return;
    setPersoneller(veri.personeller);
    setBirimler(veri.birimler);
  }, []);

  // İlk yükleme. State güncellemeleri `await`ten SONRA yapılır: effect gövdesi senkron
  // olarak hiçbir setState çağırmaz (React 19 "cascading render" kuralı).
  useEffect(() => {
    let iptal = false;
    (async () => {
      const veri = await ekipVerisiGetir();
      if (iptal || !veri) return;
      setPersoneller(veri.personeller);
      setBirimler(veri.birimler);
    })();
    return () => { iptal = true; };
  }, []);

  /**
   * Atama listesinde gösterilecek saha personeli (birim adıyla zenginleştirilmiş).
   * Başkan/yardımcı atama listesinde YOKTUR: onlar iş yapan değil, bilgi alan taraftır.
   */
  const atanabilirler = useMemo(() => {
    const birimAdlari = new Map(birimler.map((b) => [b.id, b.ad]));
    return personeller
      .filter((p) => p.rol === 'personel')
      .map((p) => ({ ...p, birimAdi: p.birimId ? birimAdlari.get(p.birimId) || null : null }));
  }, [personeller, birimler]);

  // ===================== Yazma işlemleri =====================
  //
  // Hiçbiri listeyi elle güncellemez: her uç, işlem başarılı olduğunda canlı akışa bir
  // olay yayınlar ve kart oradan gelen GERÇEK kayıtla tazelenir. İyimser güncelleme
  // yapılsaydı, sunucunun uyguladığı yan etkiler (ör. atamanın durumu "İnceleniyor"a
  // çekmesi) ekranda görünmez, iki kaynak birbirinden ayrışırdı.

  const durumGuncelle = useCallback(async (sikayetId, yeniDurum) => {
    const res = await fetch('/api/admin/sikayetler', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sikayetId, yeniDurum }),
    });
    if (!res.ok) {
      const veri = await res.json().catch(() => ({}));
      alert(veri.hata || 'Güncelleme başarısız.');
    }
  }, []);

  const personelAta = useCallback(async (sikayetId, personelId) => {
    const res = await fetch('/api/admin/sikayetler/ata', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sikayetId, personelId }),
    });
    const veri = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(veri.hata || 'Atama başarısız.');
      return;
    }
    // Personel Telegram'a bağlı değilse atama YAPILIR ama bildirim gitmez — bunu
    // sessizce geçmek, başkanın "haber verdim" sanmasına yol açar.
    if (personelId && veri.bildirimGonderildi === false) {
      alert('Atama yapıldı, ancak bu kişi Telegram\'a bağlı olmadığı için bildirim gönderilemedi. Ekip panelinden bağlantı linki oluşturabilirsiniz.');
    }
  }, []);

  const basvuruSil = useCallback(async (sikayetId) => {
    if (!window.confirm('Bu başvuruyu listeden kaldırmak istediğinize emin misiniz?')) return;
    const res = await fetch('/api/admin/sikayetler', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sikayetId }),
    });
    if (!res.ok) {
      const veri = await res.json().catch(() => ({}));
      alert(veri.hata || 'Silme başarısız.');
    }
  }, []);

  // ===================== Ekip işlemleri =====================

  const personelEkle = useCallback(async (ad, soyad, telefon, opts = {}) => {
    try {
      const res = await fetch('/api/admin/personel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad, soyad, telefon, rol: opts.rol, birimId: opts.birimId }),
      });
      const veri = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, hata: veri.hata };
      await ekibiYukle();
      return { ok: true };
    } catch {
      return { ok: false, hata: 'Bağlantı hatası.' };
    }
  }, [ekibiYukle]);

  const personelSil = useCallback(async (personelId) => {
    if (!window.confirm('Bu kişiyi ekipten kaldırmak istediğinize emin misiniz?')) return;
    const res = await fetch('/api/admin/personel', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personelId }),
    });
    if (res.ok) await ekibiYukle();
  }, [ekibiYukle]);

  const birimEkle = useCallback(async (ad) => {
    try {
      const res = await fetch('/api/admin/birim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad }),
      });
      const veri = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, hata: veri.hata };
      await ekibiYukle();
      return { ok: true };
    } catch {
      return { ok: false, hata: 'Bağlantı hatası.' };
    }
  }, [ekibiYukle]);

  const birimSil = useCallback(async (birimId) => {
    if (!window.confirm('Bu birimi kaldırmak istediğinize emin misiniz? (Kişiler silinmez, birimsiz kalır.)')) return;
    const res = await fetch('/api/admin/birim', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ birimId }),
    });
    if (res.ok) await ekibiYukle();
  }, [ekibiYukle]);

  const baglantiLinki = useCallback(async (personelId) => {
    try {
      const res = await fetch(`/api/admin/personel/${personelId}/baglanti-linki`, { method: 'POST' });
      const veri = await res.json().catch(() => ({}));
      if (!res.ok || !veri.link) {
        alert(veri.hata || 'Link oluşturulamadı.');
        return;
      }
      try { await navigator.clipboard.writeText(veri.link); } catch { /* pano yoksa prompt yeter */ }
      window.prompt('Telegram bağlantı linki (panoya kopyalandı). 48 saat geçerli, tek kullanımlık:', veri.link);
    } catch {
      alert('Link oluşturulamadı.');
    }
  }, []);

  // ===================== Görünüm =====================

  const filtreVar = Boolean(tur) || durumlarSabit.length > 0 || Boolean(arama);

  return (
    <div className="pano">
      <PanoBasligi
        belediye={belediye}
        akisDurumu={akisDurumu}
        sayimlar={sayimlar}
        tur={tur}
        onTur={setTur}
        durumlar={durumlarSabit}
        onDurum={setDurumlar}
        arama={aramaGirdi}
        onArama={setAramaGirdi}
        ekipAcik={ekipAcik}
        onEkip={() => setEkipAcik((v) => !v)}
      />

      {/* Aktif filtre yüzünden GÖRÜNMEYEN yeni başvurular geldiyse haber ver — başkan
          "bir şey gelmedi" sanmasın. Tıklayınca filtreler temizlenir. */}
      {gizliYeniAdet > 0 && (
        <button
          type="button"
          className="pano-yeni-uyari"
          onClick={() => { setTur(null); setDurumlar([]); setAramaGirdi(''); }}
        >
          ⬆ {gizliYeniAdet} yeni başvuru var (mevcut filtrenin dışında) — tümünü göster
        </button>
      )}

      <main className="pano-liste">
        {hata && (
          <div className="alert alert-error" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{hata}</span>
            <button type="button" className="bk-btn" onClick={() => tazele()}>Tekrar dene</button>
          </div>
        )}

        {yukleniyor && basvurular.length === 0 && (
          <div className="pano-bos"><span className="spinner" /></div>
        )}

        {!yukleniyor && basvurular.length === 0 && (
          <div className="pano-bos">
            <div className="pano-bos-ikon" aria-hidden="true">{filtreVar ? '🔍' : '📭'}</div>
            <p>{filtreVar ? 'Bu filtreye uyan başvuru yok.' : 'Henüz başvuru yok. Yeni gelenler burada anında görünecek.'}</p>
          </div>
        )}

        {basvurular.map((b) => (
          <BasvuruKarti
            key={b.id}
            basvuru={b}
            personeller={atanabilirler}
            vurgulu={vurgulular.has(b.id)}
            onDurum={durumGuncelle}
            onAta={personelAta}
            onSil={basvuruSil}
            onFoto={setFotoId}
          />
        ))}

        {devamVar && (
          <button type="button" className="pano-daha" onClick={dahaYukle} disabled={dahaYukleniyor}>
            {dahaYukleniyor ? 'Yükleniyor…' : 'Daha fazla yükle'}
          </button>
        )}
      </main>

      <EkipCekmecesi
        acik={ekipAcik}
        onKapat={() => setEkipAcik(false)}
        personeller={personeller}
        birimler={birimler}
        onPersonelEkle={personelEkle}
        onPersonelSil={personelSil}
        onLink={baglantiLinki}
        onBirimEkle={birimEkle}
        onBirimSil={birimSil}
      />

      <FotoModal basvuruId={fotoId} onKapat={() => setFotoId(null)} />
    </div>
  );
}
