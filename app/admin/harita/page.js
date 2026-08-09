'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  SikayetKategorileri,
  SikayetDurumlari,
  PersonelRolleri,
  sonrakiDurumlar,
  durumEtiketi,
  durumKapaliMi,
  HaritaYasKademeleri,
  HARITA_COZULDU_RENGI,
  haritaYasKademesi,
  gunFarki,
} from '@/lib/utils/constants';
// Veri-öncesi ilk kamera (yer tutucu). Gerçek görünüm, belediyenin DB kaydından
// (merkez/zoom veya sinir) gelen effect'lerle ANINDA ezilir; bu yalnız Leaflet'in
// ilk render'ı için tenant-nötr bir başlangıçtır (global config'e bağlı DEĞİL).
const VARSAYILAN_KAMERA_MERKEZ = [39.0, 35.0]; // Türkiye geneli
const VARSAYILAN_KAMERA_ZOOM = 6;

/**
 * Admin Harita Sayfası - Başkanın Şikayet Takip Ekranı
 *
 * Leaflet.js + Leaflet.markercluster ile harita üzerinde şikayetleri gösterir.
 *
 * Özellikler:
 * - Şikayetler konuma (sokağa) göre gruplanır → her sokak tek bir "ısı pini".
 * - Pin rengi açık şikayet sayısına göre kızarır (sarı → kırmızı). Tamamı çözülmüş
 *   noktalar yeşile döner. Renk skalası veriye göre ölçeklenir; en yoğun nokta
 *   her zaman tam kırmızı olur, böylece başkan en çok sorunlu bölgeyi anında görür.
 * - Pine tıklayınca o noktadaki TÜM şikayetler açılan baloncukta listelenir.
 * - Uzaklaştıkça birbirine yakın pinler tek bir kümede toplanır (toplam ısı + sayı
 *   ile), yaklaştıkça yine kendi yerlerine ayrılır.
 *
 * Performans (orta/alt seviye cihazlar için):
 * - Konuma göre gruplama marker sayısını minimumda tutar.
 * - markercluster: chunkedLoading + toplu addLayers + görünür alan dışını boşaltma.
 * - Pinler hafif divIcon; animasyonlar yalnızca GPU transform/opacity.
 */

function jsEkle(id, src) {
  return new Promise((resolve) => {
    const mevcut = document.getElementById(id);
    if (mevcut) {
      if (mevcut.dataset.loaded === 'true') resolve();
      else mevcut.addEventListener('load', () => resolve());
      return;
    }
    const el = document.createElement('script');
    el.id = id;
    el.src = src;
    el.addEventListener('load', () => {
      el.dataset.loaded = 'true';
      resolve();
    });
    document.head.appendChild(el);
  });
}

/** Kategori id → {etiket, ikon} hızlı erişim tablosu (Single Source of Truth). */
const KATEGORI_TABLOSU = Object.fromEntries(SikayetKategorileri.map((k) => [k.id, k]));

/** Sol panelin sıralama seçenekleri. */
const SIRALAMA_SECENEKLERI = Object.freeze([
  { id: 'acik-azalan', etiket: 'En çok şikayet önce (varsayılan)' },
  { id: 'yeni', etiket: 'En yeni şikayet önce' },
  { id: 'eski', etiket: 'En eski şikayet önce' },
  { id: 'ad-az', etiket: 'Sokak adı (A-Z)' },
]);

/** HTML kaçışı (popup içeriği DOM'a düz string olarak yazıldığı için – XSS savunması) */
function kacisHtml(metin) {
  return String(metin ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Şikayet sayısına göre ısı rengi: 1-3 sarı, 3-6 turuncu, 6-10 açık kırmızı, 10+ koyu kırmızı */
/**
 * Bir pinin rengi: o noktadaki EN ESKİ AÇIK kaydın yaşına göre (bkz. constants.
 * HaritaYasKademeleri). Açık kayıt kalmamışsa sonuçlanmış rengi döner.
 *
 * NEDEN ADET DEĞİL YAŞ: adet bazlı ısı haritasında kalabalık bir cadde bugün açılmış
 * 8 kayıtla "acil" görünürken, 3 haftadır bekleyen tek şikayet sakin kalıyordu.
 * Yöneticinin haritada görmesi gereken şey yığılma değil ihmaldir.
 *
 * @param {number|null} enEskiAcikMs - Noktadaki en eski AÇIK kaydın zaman damgası (ms).
 *   null → açık kayıt yok (sonuçlanmış nokta).
 */
function yasRengi(enEskiAcikMs, simdi) {
  if (enEskiAcikMs === null || enEskiAcikMs === undefined) return HARITA_COZULDU_RENGI;
  return haritaYasKademesi(gunFarki(enEskiAcikMs, simdi)).renk;
}

/** Pin boyutu sayıya göre hafifçe büyür (görsel hiyerarşi). */
function pinBoyutu(acikAdet, enYuksekAcik) {
  if (acikAdet <= 0) return 28;
  const oran = enYuksekAcik <= 1 ? 1 : Math.min(acikAdet, enYuksekAcik) / enYuksekAcik;
  return Math.round(30 + oran * 16); // 30..46 px
}

/** Pin/küme için iç HTML (parlak ısı dairesi). */
function pinIcerik(deger, renk, boyut, cozulduMu, kumeMi) {
  const ic = cozulduMu ? '✓' : deger;
  const fontSize = Math.max(12, Math.round(boyut * 0.42));
  const arkaplan = `radial-gradient(circle at 32% 28%, rgba(255,255,255,.5), rgba(255,255,255,0) 55%), ${renk}`;
  const golge = `0 0 0 2px rgba(255,255,255,.92), 0 0 14px ${renk}aa, 0 4px 10px rgba(0,0,0,.45)`;
  return `<div class="harita-pin${kumeMi ? ' harita-pin--kume' : ''}" style="width:${boyut}px;height:${boyut}px;font-size:${fontSize}px;background:${arkaplan};box-shadow:${golge}">${ic}</div>`;
}

/**
 * markercluster küme ikonu: çocukların açık sayısını TOPLAR (rakam/boyut için), rengi ise
 * çocukların EN ESKİ açık kaydından alır — kümedeki en ihmal edilmiş iş rengi belirlesin.
 */
function kumeIkonuOlustur(cluster) {
  const L = window.L;
  const enYuksek = cluster._group?._enYuksekAcik || 1;
  const simdi = cluster._group?._simdi || Date.now();
  let acik = 0;
  let enEskiAcikMs = null;
  for (const m of cluster.getAllChildMarkers()) {
    acik += m.options.acikSayisi || 0;
    const t = m.options.enEskiAcikMs;
    if (Number.isFinite(t) && (enEskiAcikMs === null || t < enEskiAcikMs)) enEskiAcikMs = t;
  }

  const cozulduMu = acik === 0;
  const boyut = pinBoyutu(acik, enYuksek) + 8; // küme biraz daha iri
  const renk = yasRengi(cozulduMu ? null : enEskiAcikMs, simdi);
  return L.divIcon({
    html: pinIcerik(acik, renk, boyut, cozulduMu, true),
    className: '',
    iconSize: [boyut, boyut],
    iconAnchor: [boyut / 2, boyut / 2],
  });
}

/** Şikayetleri koordinata (sokağa) göre gruplar (harita pini + sol panel grubu ortak). */
// HARİTA PİNLERİ için: KONUMA göre grupla (koordinat). Her fiziksel nokta = TEK pin →
// aynı noktadaki birden fazla şikayet tek pinde toplanır (çakışan pin olmaz), popup içinde
// sokağa göre bölümlenir. (Sol panel ise sokağa göre gruplanır — bkz. sokagaGoreGrupla.)
function konumaGoreGrupla(liste) {
  const tablo = new Map();
  for (const s of liste) {
    const anahtar = `${s.enlem},${s.boylam}`;
    let g = tablo.get(anahtar);
    if (!g) {
      // enEskiAcikMs: pin RENGİNİ belirleyen değer — noktadaki EN ESKİ AÇIK kaydın
      // zaman damgası (en kötü durum). Hiç açık kayıt yoksa null kalır → çözüldü rengi.
      g = { anahtar, sokakAdi: s.sokakAdi, enlem: s.enlem, boylam: s.boylam, sikayetler: [], acik: 0, cozuldu: 0, enEskiAcikMs: null };
      tablo.set(anahtar, g);
    }
    g.sikayetler.push(s);
    // "Açık" = SONUÇLANMAMIŞ. Kontrol tek bir duruma (cozuldu) değil, sözleşmedeki
    // durum SINIFINA bakar: öneri akışında "cozuldu" hiç oluşmaz, kapanış
    // "uygulanacak"/"uygun_gorulmedi"dir — eski "cozuldu değilse açıktır" mantığı
    // her kapanmış öneriyi sonsuza dek açık sayıp ölçeği bozardı.
    if (durumKapaliMi(s.durum)) {
      g.cozuldu += 1;
    } else {
      g.acik += 1;
      const t = new Date(s.olusturmaTarihi).getTime();
      if (Number.isFinite(t) && (g.enEskiAcikMs === null || t < g.enEskiAcikMs)) g.enEskiAcikMs = t;
    }
  }
  return Array.from(tablo.values());
}

// SOL PANEL için: SOKAK ADINA göre grupla. Her sokak = ayrı bir açılır grup (başlık). Aynı
// noktada kayıtsız sokak elle bildirilmişse (farklı ad, aynı koordinat) haritada tek pin ama
// panelde AYRI sokak grupları görünür — hiçbir ad diğerini "yutmaz". anahtar = sokakAdi;
// pin tıklanınca haritadanPaneleFokusla ilgili sokağı bu anahtarla bulur.
function sokagaGoreGrupla(liste) {
  const tablo = new Map();
  for (const s of liste) {
    const anahtar = s.sokakAdi;
    let g = tablo.get(anahtar);
    if (!g) {
      g = { anahtar, sokakAdi: s.sokakAdi, enlem: s.enlem, boylam: s.boylam, sikayetler: [], acik: 0, cozuldu: 0, enEskiAcikMs: null };
      tablo.set(anahtar, g);
    }
    g.sikayetler.push(s);
    if (durumKapaliMi(s.durum)) {
      g.cozuldu += 1; // bkz. konumaGoreGrupla'daki açıklama
    } else {
      g.acik += 1;
      const t = new Date(s.olusturmaTarihi).getTime();
      if (Number.isFinite(t) && (g.enEskiAcikMs === null || t < g.enEskiAcikMs)) g.enEskiAcikMs = t;
    }
  }
  return Array.from(tablo.values());
}

/** Bir sokak grubundaki en yeni ve en eski şikayet tarihi (ms) — sıralama seçenekleri için. */
function grupTarihAraligi(g) {
  let enYeni = null;
  let enEski = null;
  for (const s of g.sikayetler) {
    const t = new Date(s.olusturmaTarihi).getTime();
    if (enYeni === null || t > enYeni) enYeni = t;
    if (enEski === null || t < enEski) enEski = t;
  }
  return { enYeni: enYeni ?? 0, enEski: enEski ?? 0 };
}

function tarihFormatla(tarih) {
  return new Date(tarih).toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });
}

function tarihKisa(tarih) {
  return new Date(tarih).toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });
}

/** Sol paneldeki TEK şikayet kartı. */
function SikayetKarti({ s, secili, onOdak, onFoto, onDurum }) {
  const kat = KATEGORI_TABLOSU[s.kategori];
  const baslik = kat ? `${kat.ikon} ${kat.etiket}` : '📌 Şikayet';

  return (
    <div
      className={`sikayet-card sikayet-card--grup${secili ? ' secili' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOdak(s)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOdak(s); } }}
    >
      <div className="sikayet-card-header">
        <h3>{baslik}</h3>
        <span className={`durum-badge durum-${s.durum}`}>
          {durumEtiketi(s.durum)}
        </span>
      </div>

      {/* Açıklama: kompaktta 2 satıra kırpılır, seçilince tam açılır (CSS) */}
      {s.aciklama && <p>{s.aciklama}</p>}

      {/* Fotoğraf önizleme: kart içinde her zaman görünür (seçilince büyür). Tıkla → tam ekran. */}
      {s.fotografVar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="sikayet-foto-onizleme"
          src={`/api/admin/foto/${s.id}`}
          alt="Şikayet fotoğrafı"
          loading="lazy"
          onClick={(e) => { e.stopPropagation(); onFoto(s.id); }}
        />
      )}

      <div className="sikayet-card-meta">
        <span className="tarih">{tarihFormatla(s.olusturmaTarihi)}</span>
      </div>

      {/* Şikayetçi engelleme, panelde YOKTUR — yalnız sistem operatörü
          sunucudan (scripts/engelle.sh) yapar. Başkan/yardımcı engelleyemez. */}

      {/* Durum güncelleme butonları — durum sözlüğünden üretilir (constants.SikayetDurumlari).
          Kapanmış kayıtta hiç buton çıkmaz. */}
      {sonrakiDurumlar(s.durum).map((d) => {
        const kapanis = durumKapaliMi(d.id);
        return (
          <button
            key={d.id}
            className={`btn ${kapanis ? 'btn-success' : 'btn-primary'}`}
            style={{ marginTop: 10, padding: '10px 16px', fontSize: 12 }}
            onClick={(e) => { e.stopPropagation(); onDurum(s.id, d.id); }}
          >
            {kapanis ? `✓ ${d.etiket} İşaretle` : `${d.etiket} Olarak İşaretle`}
          </button>
        );
      })}

      {durumKapaliMi(s.durum) && s.cozenPersonelAd && (
        <div className="atama-cozen" onClick={(e) => e.stopPropagation()}>
          ✔️ Çözen: <strong>{s.cozenPersonelAd}{s.cozenPersonelSoyad ? ' ' + s.cozenPersonelSoyad.charAt(0) + '.' : ''}</strong>
          {s.cozulmeTarihi ? ` • ${tarihKisa(s.cozulmeTarihi)}` : ''}
        </div>
      )}
    </div>
  );
}

/**
 * Saha ekibi yönetim paneli (başkanın sidebar'ında açılır bölüm).
 * Personel ekleme/listeleme/kaldırma + her personel için Telegram bağlantı linki.
 * Kendi form state'ini taşır (üst bileşeni gereksiz render etmemek için).
 */
/** Tek bir personel satırı (Telegram rozet + link + sil). */
function PersonelSatir({ p, etiket, onSil, onLink }) {
  return (
    <div className="personel-item">
      <div className="personel-item-bilgi">
        <span className="personel-ad">{p.ad} {p.soyad}{etiket ? ` · ${etiket}` : ''}</span>
        <span className={`personel-rozet ${p.telegramBagli ? 'bagli' : 'baglideg'}`}>
          {p.telegramBagli ? '✓ Telegram bağlı' : '○ Bağlı değil'}
        </span>
      </div>
      <div className="personel-item-aksiyon">
        <button type="button" className="personel-mini-btn" onClick={() => onLink(p.id)} title="Telegram bağlantı linki oluştur">🔗 Link</button>
        <button type="button" className="personel-mini-btn sil" onClick={() => onSil(p.id)} title="Kaldır">✕</button>
      </div>
    </div>
  );
}

/** Ad/soyad/telefon ekleme formu (birim personeli veya başkan/yardımcı için). */
function KisiEkleForm({ onEkle, rolSecici = false, butonMetni = '+ Ekle' }) {
  const [ad, setAd] = useState('');
  const [soyad, setSoyad] = useState('');
  const [telefon, setTelefon] = useState('');
  const [rol, setRol] = useState(PersonelRolleri.BASKAN);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);

  async function ekle(e) {
    e.preventDefault();
    setHata('');
    setYukleniyor(true);
    const sonuc = await onEkle(ad.trim(), soyad.trim(), telefon.trim(), rolSecici ? { rol } : {});
    setYukleniyor(false);
    if (sonuc.ok) { setAd(''); setSoyad(''); setTelefon(''); }
    else setHata(sonuc.hata || 'Eklenemedi.');
  }

  return (
    <form onSubmit={ekle} className="personel-form">
      <div className="personel-form-satir">
        <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Ad" className="personel-input" />
        <input value={soyad} onChange={(e) => setSoyad(e.target.value)} placeholder="Soyad" className="personel-input" />
      </div>
      <input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="Telefon" className="personel-input" />
      {rolSecici && (
        <select value={rol} onChange={(e) => setRol(e.target.value)} className="personel-input">
          <option value={PersonelRolleri.BASKAN}>Başkan</option>
          <option value={PersonelRolleri.BASKAN_YARDIMCISI}>Başkan Yardımcısı</option>
        </select>
      )}
      <button type="submit" className="btn btn-primary" disabled={yukleniyor} style={{ padding: '8px', fontSize: 13 }}>
        {yukleniyor ? 'Ekleniyor...' : butonMetni}
      </button>
      {hata && <p className="personel-hata">{hata}</p>}
    </form>
  );
}

/** Tek bir birim kartı: kategori seçimi + o birimin personelleri + kişi ekleme. */
function BirimKarti({ birim, personeller, kategoriBirimleri, onSil, onKategori, onPersonelEkle, onPersonelSil, onLink }) {
  const seciliSet = new Set(birim.kategoriler);
  const [katAcik, setKatAcik] = useState(false); // "Kapsadığı kategoriler" açılır liste (kapalıyken yer kaplamaz)

  function kategoriToggle(katId) {
    const yeni = seciliSet.has(katId)
      ? birim.kategoriler.filter((k) => k !== katId)
      : [...birim.kategoriler, katId];
    onKategori(birim.id, yeni);
  }

  return (
    <div style={{ border: '1px solid var(--kenar, #e2e8f0)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>🏢 {birim.ad}</strong>
        <button type="button" className="personel-mini-btn sil" onClick={() => onSil(birim.id)} title="Birimi kaldır">✕</button>
      </div>

      <button
        type="button"
        onClick={() => setKatAcik((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 12, padding: '6px 8px', marginBottom: 8, borderRadius: 6, cursor: 'pointer',
          border: '1px solid #cbd5e1', background: 'transparent', color: '#fff',
        }}
      >
        <span>Kapsadığı kategoriler{seciliSet.size > 0 ? ` (${seciliSet.size})` : ''}</span>
        <span>{katAcik ? '▲' : '▼'}</span>
      </button>
      {katAcik && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {/* YALNIZCA saha kategorileri (SikayetKategorileri). Öneri konuları ayrı bir
              listede ('oneri-' önekli) tutulduğu için buraya kendiliğinden girmez —
              zaten girmemeli: öneri akışı birime düşmez, başkan/yardımcıya gider.
              Aksi halde başkan bir öneri konusunu birime atar, ama bildirim gitmezdi. */}
          {SikayetKategorileri.map((k) => {
            const secili = seciliSet.has(k.id);
            // Aynı kategori başka birimlerde de olabilir → yalnız bilgi amaçlı gösterilir
            const digerBirimler = (kategoriBirimleri[k.id] || []).filter((b) => b.id !== birim.id);
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => kategoriToggle(k.id)}
                title={digerBirimler.length > 0
                  ? `Bu kategori ayrıca şu birimlerde: ${digerBirimler.map((b) => b.ad).join(', ')}`
                  : ''}
                style={{
                  fontSize: 11, padding: '3px 7px', borderRadius: 12, cursor: 'pointer',
                  border: secili ? '1px solid #2563eb' : '1px solid #cbd5e1',
                  background: secili ? '#2563eb' : 'transparent',
                  color: secili ? '#fff' : 'inherit',
                }}
              >
                {k.ikon} {k.etiket}
                {digerBirimler.length > 0 && (
                  <span style={{ opacity: 0.7, marginLeft: 3 }}>+{digerBirimler.length}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="personel-liste" style={{ marginBottom: 6 }}>
        {personeller.length === 0 && <p className="personel-bos">Bu birime henüz kişi eklenmedi.</p>}
        {personeller.map((p) => (
          <PersonelSatir key={p.id} p={p} onSil={onPersonelSil} onLink={onLink} />
        ))}
      </div>

      <KisiEkleForm
        onEkle={(ad, soyad, telefon) => onPersonelEkle(ad, soyad, telefon, { rol: PersonelRolleri.PERSONEL, birimId: birim.id })}
        butonMetni="+ Bu birime kişi ekle"
      />
    </div>
  );
}

function PersonelYonetimi({ personeller, birimler, onPersonelEkle, onPersonelSil, onLink, onBirimEkle, onBirimSil, onBirimKategori }) {
  const [birimAdi, setBirimAdi] = useState('');
  const [birimHata, setBirimHata] = useState('');
  const [birimYukleniyor, setBirimYukleniyor] = useState(false);

  const sahaPersonel = personeller.filter((p) => p.rol === PersonelRolleri.PERSONEL);
  const yoneticiler = personeller.filter(
    (p) => p.rol === PersonelRolleri.BASKAN || p.rol === PersonelRolleri.BASKAN_YARDIMCISI,
  );
  const birimsizPersonel = sahaPersonel.filter((p) => !p.birimId);

  // kategori id → o kategoriyi kapsayan birimler (bir kategori birden çok birimde olabilir)
  const kategoriBirimleri = {};
  for (const b of birimler) {
    for (const k of b.kategoriler) {
      (kategoriBirimleri[k] ||= []).push({ id: b.id, ad: b.ad });
    }
  }

  async function birimFormGonder(e) {
    e.preventDefault();
    setBirimHata('');
    setBirimYukleniyor(true);
    const sonuc = await onBirimEkle(birimAdi.trim());
    setBirimYukleniyor(false);
    if (sonuc.ok) setBirimAdi('');
    else setBirimHata(sonuc.hata || 'Eklenemedi.');
  }

  const baslikStil = { fontSize: 13, fontWeight: 700, margin: '14px 0 8px', color: '#fff', borderTop: '1px solid #e2e8f0', paddingTop: 12 };
  const rolEtiket = { [PersonelRolleri.BASKAN]: 'Başkan', [PersonelRolleri.BASKAN_YARDIMCISI]: 'Başkan Yrd.' };

  return (
    <div className="personel-panel">
      {/* ===== BİRİMLER ===== */}
      <div style={{ ...baslikStil, marginTop: 4, borderTop: 'none', paddingTop: 0, color: '#fff' }}>🏢 Birimler & Saha Ekibi</div>
      <form onSubmit={birimFormGonder} className="personel-form">
        <input value={birimAdi} onChange={(e) => setBirimAdi(e.target.value)} placeholder='Birim adı (ör. "Temizlik İşleri")' className="personel-input" />
        <button type="submit" className="btn btn-primary" disabled={birimYukleniyor} style={{ padding: '8px', fontSize: 13 }}>
          {birimYukleniyor ? 'Ekleniyor...' : '+ Birim Ekle'}
        </button>
        {birimHata && <p className="personel-hata">{birimHata}</p>}
      </form>

      <div style={{ marginTop: 10 }}>
        {birimler.length === 0 && <p className="personel-bos">Henüz birim yok. Yukarıdan bir birim oluşturun.</p>}
        {birimler.map((b) => (
          <BirimKarti
            key={b.id}
            birim={b}
            personeller={sahaPersonel.filter((p) => p.birimId === b.id)}
            kategoriBirimleri={kategoriBirimleri}
            onSil={onBirimSil}
            onKategori={onBirimKategori}
            onPersonelEkle={onPersonelEkle}
            onPersonelSil={onPersonelSil}
            onLink={onLink}
          />
        ))}
      </div>

      {/* Birimsiz kalan saha personeli (birim silinince oluşabilir) — görünür kalsın */}
      {birimsizPersonel.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: '#b45309', margin: '0 0 4px' }}>⚠️ Birime bağlı olmayan personel (iş almazlar):</div>
          <div className="personel-liste">
            {birimsizPersonel.map((p) => (
              <PersonelSatir key={p.id} p={p} onSil={onPersonelSil} onLink={onLink} />
            ))}
          </div>
        </div>
      )}

      {/* ===== BAŞKAN / YARDIMCI ===== */}
      <div style={baslikStil}>👔 Başkan & Başkan Yardımcısı</div>
      <p style={{ fontSize: 12, color: '#fff', margin: '0 0 8px' }}>
        Buraya eklenenlere HER yeni şikayet ve HER çözüm Telegram’dan bilgi olarak düşer.
      </p>
      <KisiEkleForm onEkle={onPersonelEkle} rolSecici butonMetni="+ Başkan/Yardımcı Ekle" />
      <div className="personel-liste">
        {yoneticiler.length === 0 && <p className="personel-bos">Henüz eklenmedi.</p>}
        {yoneticiler.map((p) => (
          <PersonelSatir key={p.id} p={p} etiket={rolEtiket[p.rol]} onSil={onPersonelSil} onLink={onLink} />
        ))}
      </div>
    </div>
  );
}

export default function AdminHaritaSayfasi() {
  const [sikayetler, setSikayetler] = useState([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState('');
  const [haritaHazir, setHaritaHazir] = useState(false);
  const [seciliSikayet, setSeciliSikayet] = useState(null);
  const [fotoModalId, setFotoModalId] = useState(null); // açık fotoğraf modalının şikayet id'si
  const [belediye, setBelediye] = useState(null); // {ad, merkez:[enlem,boylam]|null, zoom} — tenant'tan
  const [personeller, setPersoneller] = useState([]); // tüm personel (saha + başkan/yardımcı)
  const [birimler, setBirimler] = useState([]); // birimler + kapsadıkları kategoriler
  const [personelPanelAcik, setPersonelPanelAcik] = useState(false);
  const [kategoriFiltreSet, setKategoriFiltreSet] = useState(() => new Set()); // boş = tüm kategoriler
  const [filtrePopoverAcik, setFiltrePopoverAcik] = useState(false);
  const [siralama, setSiralama] = useState('acik-azalan'); // başkanın seçtiği sıralama (bkz. SIRALAMA_SECENEKLERI)
  const [siralamaPopoverAcik, setSiralamaPopoverAcik] = useState(false);
  const [arama, setArama] = useState('');
  const [acikGruplar, setAcikGruplar] = useState(null); // null = henüz dokunulmadı → varsayılan: en sorunlu grup açık; Set = kullanıcının açtığı gruplar
  // Harita üstündeki "Çözülenleri göster" anahtarı. Varsayılan KAPALI: harita öncelikle
  // "yapılacak iş" ekranıdır; çözülenler açılınca yeşil ✓ pin olarak eklenir.
  const [cozulenleriGoster, setCozulenleriGoster] = useState(false);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const clusterGroupRef = useRef(null);
  const markersByLocationRef = useRef({});
  const ilkCizimRef = useRef(true);
  const merkezAyarlandiRef = useRef(false); // tenant merkezine odaklandık mı? (autofit'leri ezmesin)
  const filtreSiralaRef = useRef(null); // Filtrele/Sırala popover'larının dışına tıklamayı yakalamak için
  const grupRefleriRef = useRef({}); // sokak anahtarı → grup DOM elemanı (haritadan panele kaydırma için)
  const scrollHedefiRef = useRef(null); // panelde kaydırılacak grup anahtarı (harita→panel odak)
  const enSicakAnahtarRef = useRef(null); // en sorunlu grup anahtarı (güncel değer aynası)
  const sikayetImzaRef = useRef(''); // son yüklenen listenin imzası (poll'de gereksiz yeniden çizimi önler)
  const belediyeAyarlandiRef = useRef(false); // belediye (tenant) bilgisi bir kez ayarlandı mı?
  const personelImzaRef = useRef(''); // son yüklenen personel listesinin imzası (poll re-render önler)

  // Kategori bazlı sayılar (filtre çiplerindeki rozetler için)
  const kategoriSayilari = useMemo(() => {
    const t = {};
    for (const s of sikayetler) t[s.kategori] = (t[s.kategori] || 0) + 1;
    return t;
  }, [sikayetler]);

  // Kategori filtresi (çoklu seçim) + arama uygulanmış görünen liste (hem harita hem sol panel bunu kullanır)
  const gorunenSikayetler = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase('tr');
    return sikayetler.filter((s) => {
      if (kategoriFiltreSet.size > 0 && !kategoriFiltreSet.has(s.kategori)) return false;
      if (q) {
        const kat = KATEGORI_TABLOSU[s.kategori];
        const havuz = `${s.sokakAdi || ''} ${s.aciklama || ''} ${kat ? kat.etiket : ''}`.toLocaleLowerCase('tr');
        if (!havuz.includes(q)) return false;
      }
      return true;
    });
  }, [sikayetler, kategoriFiltreSet, arama]);

  /**
   * Haritaya çizilecek kayıtlar. Koordinat sonluluğu doğrulanır: L.marker([null, null])
   * Leaflet'te "Invalid LatLng" fırlatır ve TEK pin değil TÜM çizim yarıda kesilir
   * (ekranda boş harita kalır).
   *
   * Sonuçlanmış kayıtlar VARSAYILAN OLARAK gizlidir (harita "yapılacak işler" ekranıdır).
   * "Çözülenleri göster" anahtarı açıkken listeye katılır ve yeşil ✓ pinle çizilirler —
   * böylece başkan "burada ne yaptık" görünümüne geçebilir. Anahtar yalnız HARİTAYI
   * etkiler; sol paneldeki liste ve sayaçlar değişmez.
   */
  const haritaSikayetleri = useMemo(() => {
    return gorunenSikayetler.filter(
      (s) =>
        (cozulenleriGoster || !durumKapaliMi(s.durum)) &&
        Number.isFinite(s.enlem) &&
        Number.isFinite(s.boylam)
    );
  }, [gorunenSikayetler, cozulenleriGoster]);

  // Harita + markercluster kütüphanelerini yükle ve haritayı kur
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let iptal = false;

    const cssEkle = (id, href) => {
      if (document.getElementById(id)) return;
      const el = document.createElement('link');
      el.id = id;
      el.rel = 'stylesheet';
      el.href = href;
      document.head.appendChild(el);
    };

    // Leaflet + markercluster: dış CDN (unpkg) YERİNE kendi origin'imizden (public/vendor).
    // Böylece harita çalışırken hiçbir dış sunucuya bağımlı değiliz.
    cssEkle('leaflet-css', '/vendor/leaflet/leaflet.css');
    cssEkle('leaflet-mc-css', '/vendor/leaflet/MarkerCluster.css');

    (async () => {
      // markercluster, Leaflet'e bağımlı → sırayla yükle
      await jsEkle('leaflet-js', '/vendor/leaflet/leaflet.js');
      await jsEkle('leaflet-mc-js', '/vendor/leaflet/markercluster.js');
      if (!iptal) haritayiBaslat();
    })();

    function haritayiBaslat() {
      const L = window.L;
      if (mapInstanceRef.current || !mapRef.current || !L || !L.markerClusterGroup) return;

      const map = L.map(mapRef.current, {
        zoomControl: false,
        preferCanvas: true,
        minZoom: 12,
      }).setView(VARSAYILAN_KAMERA_MERKEZ, VARSAYILAN_KAMERA_ZOOM);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      // "Leaflet" ön ekini kaldır — bunun yerine tileLayer'daki attribution İNCİTEK
      // linkini gösterir (bkz. aşağıdaki tileLayer).
      map.attributionControl.setPrefix(false);
      // Tile'lar dış CDN'den DEĞİL, kendi sunucumuzdan gelir (/api/tiles → tenant'ın
      // bbox'ı için önceden indirilmiş kareler). maxNativeZoom: indirilen en yüksek
      // seviye; ötesinde Leaflet kareyi büyüterek gösterir (boş ekran olmaz).
      L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
        attribution: '<a href="https://incitek.com.tr" target="_blank" rel="noopener noreferrer">İNCİTEK tarafından yapılmıştır</a>',
        maxNativeZoom: 18,
        maxZoom: 20,
      }).addTo(map);

      const cluster = L.markerClusterGroup({
        chunkedLoading: true,          // büyük listede UI'ı kilitlemeden ekle
        showCoverageOnHover: false,    // sade görünüm
        spiderfyOnMaxZoom: false,
        maxClusterRadius: 48,
        disableClusteringAtZoom: 18,   // yakınlaşınca pinler tam kendi yerlerine döner
        iconCreateFunction: kumeIkonuOlustur,
      });
      map.addLayer(cluster);

      mapInstanceRef.current = map;
      clusterGroupRef.current = cluster;

      // Leaflet'in konteyner boyutunu tam hesaplaması için kısa gecikme.
      // NOT: Sabit görünüm kutusu (sinir) artık GLOBAL env'den DEĞİL, bu belediyenin
      // DB kaydından gelir → veri yüklenince ayrı bir effect (aşağıda) uygular. Buradaki
      // setView yalnız ilk (veri-öncesi) yer tutucu kameradır; per-tenant görünüm onu ezer.
      setTimeout(() => {
        map.invalidateSize();
        setHaritaHazir(true);
      }, 100);
    }

    return () => {
      iptal = true;
    };
  }, []);

  // Verileri yükle
  useEffect(() => {
    sikayetleriYukle();
    personelleriYukle();
    birimleriYukle();
  }, []);

  // Otomatik tazeleme: yeni şikayet gelince başkan sayfayı yenilemeden görsün.
  // Her 15 sn'de bir sessizce veriyi çeker; yalnız değişiklik varsa haritayı/paneli günceller.
  // Sekme arka plandayken (document.hidden) istek atmaz → boşuna sunucu yükü olmaz.
  useEffect(() => {
    const ARALIK_MS = 15000;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      sikayetleriYukle({ sessiz: true });
      personelleriYukle();
    }, ARALIK_MS);
    return () => clearInterval(id);
  }, []);

  // En sorunlu grup anahtarının güncel değerini ref'te tut (harita pin işleyicisi bunu okur)
  useEffect(() => {
    enSicakAnahtarRef.current = enSicakAnahtar;
  });

  // Harita→panel odak: bir grup açılınca (veya hedef değişince) o gruba kaydır
  useEffect(() => {
    const hedef = scrollHedefiRef.current;
    if (!hedef) return;
    const el = grupRefleriRef.current[hedef];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      scrollHedefiRef.current = null;
    }
  }, [acikGruplar, gorunenSikayetler]);

  // Popup içindeki "göz" butonuna tıklamayı yakala (popup HTML'i düz string olduğu
  // için event delegation kullanılır) → fotoğraf modalını aç.
  useEffect(() => {
    function tikla(e) {
      const btn = e.target.closest?.('.hp-foto-btn');
      if (btn?.dataset.fotoId) {
        e.preventDefault();
        setFotoModalId(btn.dataset.fotoId);
      }
    }
    document.addEventListener('click', tikla);
    return () => document.removeEventListener('click', tikla);
  }, []);

  // Modal açıkken Esc ile kapat
  useEffect(() => {
    if (!fotoModalId) return;
    function esc(e) { if (e.key === 'Escape') setFotoModalId(null); }
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [fotoModalId]);

  // Filtrele/Sırala popover'larının dışına tıklayınca kapat
  useEffect(() => {
    if (!filtrePopoverAcik && !siralamaPopoverAcik) return;
    function disaTikla(e) {
      if (filtreSiralaRef.current && !filtreSiralaRef.current.contains(e.target)) {
        setFiltrePopoverAcik(false);
        setSiralamaPopoverAcik(false);
      }
    }
    document.addEventListener('mousedown', disaTikla);
    return () => document.removeEventListener('mousedown', disaTikla);
  }, [filtrePopoverAcik, siralamaPopoverAcik]);

  // Veri, filtre veya harita hazır olduğunda pinleri çiz (yalnızca çözülmemişler)
  useEffect(() => {
    if (haritaHazir && clusterGroupRef.current && window.L) {
      pinleriCiz(haritaSikayetleri);
    }
  }, [haritaSikayetleri, haritaHazir]);

  // 1) PER-TENANT sabit görünüm kutusu (sinir): bu belediyenin DB'deki dört köşesi varsa
  //    açılışta TAM bu kutuyu göster + dışına çıkışı kilitle. Otoriter kaynak subdomain→
  //    tenant kaydıdır (global build-time env DEĞİL) → her belediye kendi kutusuna kilitlenir.
  useEffect(() => {
    if (!haritaHazir || !belediye?.sinir) return;
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L) return;
    const kutu = L.latLngBounds(belediye.sinir);
    map.setMaxBounds(kutu);
    map.options.maxBoundsViscosity = 1.0;
    map.fitBounds(kutu);
    map.setMinZoom(map.getZoom()); // kutudan daha fazla uzaklaşmayı engelle
    merkezAyarlandiRef.current = true; // tenant-merkez/otofit efektleri bu görünümü ezmesin
    ilkCizimRef.current = false; // pin sığdırması da ezmesin
  }, [haritaHazir, belediye]);

  // 2) Sinir YOKSA: haritayı bu belediyenin DB'deki merkez/zoom değerlerine odakla
  //    (merkez etrafında sabit bir pay kutusuyla kilitle).
  useEffect(() => {
    if (belediye?.sinir) return; // per-tenant sinir varsa (1) hallediyor
    if (!haritaHazir || !belediye?.merkez) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setView(belediye.merkez, belediye.zoom || 14);
    const latPad = 0.07;
    const lonPad = 0.11;
    map.setMaxBounds([
      [belediye.merkez[0] - latPad, belediye.merkez[1] - lonPad],
      [belediye.merkez[0] + latPad, belediye.merkez[1] + lonPad],
    ]);
    map.options.maxBoundsViscosity = 1.0;
    merkezAyarlandiRef.current = true;
    ilkCizimRef.current = false; // şikayet sığdırması bu görünümü ezmesin
  }, [haritaHazir, belediye]);

  // Tenant merkezi YOKSA (eski/eksik kayıt), haritayı o ilçenin sokaklarına göre
  // otomatik çerçevele (yedek davranış).
  useEffect(() => {
    if (belediye?.sinir) return; // per-tenant sinir varsa otofit devre dışı
    if (!haritaHazir || merkezAyarlandiRef.current || belediye?.merkez) return;
    let iptal = false;
    (async () => {
      try {
        const res = await fetch('/api/sokaklar');
        if (!res.ok) return;
        const data = await res.json();
        const noktalar = (data.sokaklar || [])
          .filter((s) => Number.isFinite(s.enlem) && Number.isFinite(s.boylam))
          .map((s) => [s.enlem, s.boylam]);

        const L = window.L;
        const map = mapInstanceRef.current;
        // Yalnızca henüz şikayet odaklı bir sığdırma yapılmadıysa sokaklara göre çerçevele
        if (!iptal && L && map && noktalar.length > 0 && ilkCizimRef.current) {
          map.fitBounds(L.latLngBounds(noktalar), { padding: [60, 60], maxZoom: 16 });
        }
      } catch {
        /* sessizce yoksay: varsayılan merkez zaten ayarlı */
      }
    })();
    return () => {
      iptal = true;
    };
  }, [haritaHazir, belediye]);

  async function sikayetleriYukle(opts = {}) {
    // sessiz=true → arka plan tazeleme (polling): hata mesajı gösterme, yalnız veri değiştiyse güncelle.
    const { sessiz = false } = opts;
    try {
      const res = await fetch('/api/admin/sikayetler');
      if (!res.ok) {
        if (!sessiz) setHata('Veriler yüklenemedi.');
        return;
      }
      const data = await res.json();
      const liste = data.sikayetler || [];
      // İmza: yalnız ekranı etkileyen alanlar (yeni şikayet, durum, atama, çözen) değişince
      // state güncellenir. Aksi halde her poll'de pinler silinip yeniden çizilir → açık popup
      // kapanır, harita titrer. Değişiklik yoksa hiç dokunma (React re-render tetiklenmez).
      const imza = liste
        .map((s) => `${s.id}:${s.durum}:${s.atananPersonelId || ''}:${s.cozenPersonelAd || ''}`)
        .join('|');
      if (imza !== sikayetImzaRef.current) {
        sikayetImzaRef.current = imza;
        setSikayetler(liste);
      }
      // Belediye (tenant) bilgisi değişmez; bir kez ayarla (poll'de gereksiz re-render olmasın).
      if (data.belediye && !belediyeAyarlandiRef.current) {
        belediyeAyarlandiRef.current = true;
        setBelediye(data.belediye);
      }
    } catch {
      if (!sessiz) setHata('Bağlantı hatası.');
    } finally {
      setYukleniyor(false);
    }
  }

  /** Tek bir şikayetin popup <li> HTML'i. */
  function popupSikayetSatiri(s) {
    const kat = KATEGORI_TABLOSU[s.kategori] || { ikon: '📌', etiket: s.kategori };
    const aciklama = s.aciklama ? `<p class="hp-aciklama">${kacisHtml(s.aciklama)}</p>` : '';
    // Fotoğraf varsa "göz" butonu — tıklanınca yetkili route'tan fotoğraf açılır
    const fotoBtn = s.fotografVar
      ? `<button class="hp-foto-btn" data-foto-id="${kacisHtml(s.id)}" title="Fotoğrafı gör" aria-label="Fotoğrafı gör">👁</button>`
      : '';
    // Salt-okunur atama/çözen bilgisi (etkileşim kenar çubuğundan yapılır)
    const kisalt = (a, soyad) => `${kacisHtml(a)}${soyad ? ' ' + kacisHtml(soyad.charAt(0)) + '.' : ''}`;
    let atamaSatiri = '';
    if (durumKapaliMi(s.durum) && s.cozenPersonelAd) {
      atamaSatiri = `<span class="hp-atama">✔️ Çözen: ${kisalt(s.cozenPersonelAd, s.cozenPersonelSoyad)}</span>`;
    }
    // Pin rengi bekleme süresine göre olduğuna göre, süre popup'ta da YAZILI olmalı:
    // yönetici "neden kırmızı?" diye sormak zorunda kalmasın. Yalnız AÇIK kayıtlarda.
    const bekleme = durumKapaliMi(s.durum)
      ? ''
      : ` · ${gunFarki(s.olusturmaTarihi)} gündür bekliyor`;
    return `<li class="hp-item">
      <div class="hp-item-ust">
        <span class="hp-kat">${kat.ikon} ${kacisHtml(kat.etiket)}</span>
        <span class="hp-item-sag">
          ${fotoBtn}
          <span class="durum-badge durum-${s.durum}">${kacisHtml(durumEtiketi(s.durum))}</span>
        </span>
      </div>
      ${aciklama}
      ${atamaSatiri}
      <span class="hp-tarih">${tarihKisa(s.olusturmaTarihi)}${bekleme}</span>
    </li>`;
  }

  /** Bir konumdaki (tek pin) tüm şikayetleri listeleyen popup HTML'i. Aynı noktada birden
   *  fazla SOKAK adı olabilir (kayıtsız sokak elle bildirilmiş) → HER SOKAK AYRI BAŞLIK +
   *  kendi şikayet listesi olarak gösterilir (biri diğerini "yutmaz"). */
  function popupIcerik(g) {
    // Şikayetleri sokak adına göre böl (ilk görülme sırası korunur).
    const sokakGruplari = new Map(); // sokakAdi -> { sokakAdi, sikayetler, acik, cozuldu }
    for (const s of g.sikayetler) {
      let sg = sokakGruplari.get(s.sokakAdi);
      if (!sg) { sg = { sokakAdi: s.sokakAdi, sikayetler: [], acik: 0, cozuldu: 0 }; sokakGruplari.set(s.sokakAdi, sg); }
      sg.sikayetler.push(s);
      if (durumKapaliMi(s.durum)) sg.cozuldu += 1; else sg.acik += 1;
    }
    const bolumler = Array.from(sokakGruplari.values()).map((sg) => {
      const ozet = sg.cozuldu > 0 ? `${sg.acik} açık · ${sg.cozuldu} çözüldü` : `${sg.acik} açık şikayet`;
      return `<div class="hp-baslik"><strong>${kacisHtml(sg.sokakAdi)}</strong><span class="hp-ozet">${ozet}</span></div>
        <ul class="hp-liste">${sg.sikayetler.map(popupSikayetSatiri).join('')}</ul>`;
    }).join('');
    return `<div class="hp">${bolumler}</div>`;
  }

  /** Pinleri (yeniden) çizer. */
  function pinleriCiz(liste) {
    const L = window.L;
    const cluster = clusterGroupRef.current;
    const map = mapInstanceRef.current;
    if (!L || !cluster) return;

    cluster.clearLayers();
    markersByLocationRef.current = {};

    const gruplar = konumaGoreGrupla(liste);
    const enYuksekAcik = Math.max(1, ...gruplar.map((g) => g.acik));
    // "Şimdi" tek bir kez alınır ve tüm pinlerle küme ikonlarında AYNI kullanılır:
    // her pin kendi Date.now()'ını çağırsaydı aynı çizimde eşiğin iki yanına düşen
    // kayıtlar tutarsız renklenebilirdi.
    const simdi = Date.now();
    cluster._enYuksekAcik = enYuksekAcik; // küme ikonu boyut skalasını buradan alır
    cluster._simdi = simdi;

    const markerlar = gruplar.map((g) => {
      const cozulduMu = g.acik === 0;
      const boyut = pinBoyutu(g.acik, enYuksekAcik);
      // RENK: adete değil, noktadaki en eski AÇIK kaydın yaşına göre.
      const renk = yasRengi(cozulduMu ? null : g.enEskiAcikMs, simdi);
      const icon = L.divIcon({
        html: pinIcerik(cozulduMu ? g.cozuldu : g.acik, renk, boyut, cozulduMu, false),
        className: '',
        iconSize: [boyut, boyut],
        iconAnchor: [boyut / 2, boyut / 2],
        popupAnchor: [0, -boyut / 2],
      });
      const marker = L.marker([g.enlem, g.boylam], { icon, acikSayisi: g.acik, enEskiAcikMs: g.enEskiAcikMs });
      marker.bindPopup(popupIcerik(g), { minWidth: 340, maxWidth: 420, className: 'harita-popup-wrap' });
      // Pine tıklayınca (popup açılırken) sol panelde ilgili SOKAK grubunu aç + oraya kaydır.
      // Sol panel sokağa göre gruplandığı için anahtar = sokakAdi (pin koordinatının birincil sokağı).
      marker.on('click', () => haritadanPaneleFokusla(g.sokakAdi));
      markersByLocationRef.current[g.anahtar] = marker; // marker anahtarı KOORDİNAT (sikayeteOdaklan bununla bulur)
      return marker;
    });

    cluster.addLayers(markerlar); // toplu ekleme (performanslı)

    // Görünümü yalnızca ilk çizimde sığdır (durum güncellemesi sonrası ekran zıplamasın).
    // Tenant merkezi ayarlandıysa bu sığdırmayı yapma — başkan hep o ilçeye odaklı kalsın.
    if (ilkCizimRef.current && !merkezAyarlandiRef.current && markerlar.length > 0 && map) {
      const bounds = L.latLngBounds(gruplar.map((g) => [g.enlem, g.boylam]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
      ilkCizimRef.current = false;
    }
  }

  function sikayeteOdaklan(sikayet) {
    setSeciliSikayet(sikayet);
    const cluster = clusterGroupRef.current;
    const map = mapInstanceRef.current;
    const anahtar = `${sikayet.enlem},${sikayet.boylam}`;
    const marker = markersByLocationRef.current[anahtar];

    if (cluster && marker) {
      // Pin bir kümenin içindeyse önce onu görünür yap, sonra popup'ı aç
      cluster.zoomToShowLayer(marker, () => marker.openPopup());
    } else if (map) {
      map.setView([sikayet.enlem, sikayet.boylam], 17, { animate: true });
    }
  }

  /** Haritadaki pine tıklanınca: sol panelde o sokak grubunu aç ve oraya kaydır (harita → panel odak). */
  function haritadanPaneleFokusla(anahtar) {
    scrollHedefiRef.current = anahtar;
    setAcikGruplar((prev) => {
      const taban = prev === null
        ? new Set(enSicakAnahtarRef.current ? [enSicakAnahtarRef.current] : [])
        : new Set(prev);
      taban.add(anahtar); // yeni referans → grup zaten açıksa bile kaydırma effect'i tetiklenir
      return taban;
    });
  }

  async function durumGuncelle(sikayetId, yeniDurum) {
    try {
      const res = await fetch('/api/admin/sikayetler', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sikayetId, yeniDurum }),
      });

      if (res.ok) {
        sikayetleriYukle(); // Listeyi yenile (effect pinleri yeniden çizer)
        setSeciliSikayet(null);
      }
    } catch {
      alert('Güncelleme başarısız.');
    }
  }

  // ===== Saha ekibi (personel) =====

  async function personelleriYukle() {
    try {
      const res = await fetch('/api/admin/personel');
      if (!res.ok) return;
      const data = await res.json();
      const liste = data.personeller || [];
      // Poll'de gereksiz re-render olmasın: yalnız personel/Telegram/rol/birim değiştiyse güncelle.
      const imza = liste.map((p) => `${p.id}:${p.telegramBagli ? 1 : 0}:${p.rol}:${p.birimId || ''}`).join('|');
      if (imza !== personelImzaRef.current) {
        personelImzaRef.current = imza;
        setPersoneller(liste);
      }
    } catch {
      /* sessizce yoksay */
    }
  }

  /** Yeni personel ekler (saha personeli / başkan / yardımcı). opts: { rol, birimId } */
  async function personelEkle(ad, soyad, telefon, opts = {}) {
    try {
      const res = await fetch('/api/admin/personel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad, soyad, telefon, rol: opts.rol, birimId: opts.birimId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        personelleriYukle();
        return { ok: true };
      }
      return { ok: false, hata: data.hata };
    } catch {
      return { ok: false, hata: 'Bağlantı hatası.' };
    }
  }

  // ===== Birimler (departmanlar) =====

  async function birimleriYukle() {
    try {
      const res = await fetch('/api/admin/birim');
      if (!res.ok) return;
      const data = await res.json();
      setBirimler(data.birimler || []);
    } catch {
      /* sessizce yoksay */
    }
  }

  async function birimEkle(ad) {
    try {
      const res = await fetch('/api/admin/birim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { birimleriYukle(); return { ok: true }; }
      return { ok: false, hata: data.hata };
    } catch {
      return { ok: false, hata: 'Bağlantı hatası.' };
    }
  }

  async function birimSil(birimId) {
    if (!window.confirm('Bu birimi kaldırmak istediğinize emin misiniz? (Personeller silinmez, sadece birim ve kategori eşleşmeleri kaldırılır.)')) return;
    try {
      const res = await fetch('/api/admin/birim', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ birimId }),
      });
      if (res.ok) { birimleriYukle(); personelleriYukle(); }
    } catch {
      alert('İşlem başarısız.');
    }
  }

  /** Bir birimin kapsadığı kategori kümesini tam olarak ayarlar. */
  async function birimKategoriAyarla(birimId, kategoriler) {
    try {
      const res = await fetch('/api/admin/birim', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ birimId, kategoriler }),
      });
      if (res.ok) birimleriYukle();
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.hata || 'Kategori kaydedilemedi.');
      }
    } catch {
      alert('İşlem başarısız.');
    }
  }

  /** Personeli kaldırır (pasifleştirir). */
  async function personelSil(id) {
    if (!window.confirm('Bu personeli kaldırmak istediğinize emin misiniz?')) return;
    try {
      const res = await fetch('/api/admin/personel', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personelId: id }),
      });
      if (res.ok) personelleriYukle();
    } catch {
      alert('İşlem başarısız.');
    }
  }

  /** Personel için tek-kullanımlık Telegram bağlantı linki üretir ve panoya kopyalar. */
  async function baglantiLinkiOlustur(id) {
    try {
      const res = await fetch(`/api/admin/personel/${id}/baglanti-linki`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.link) {
        try { await navigator.clipboard.writeText(data.link); } catch { /* clipboard yoksa prompt yeter */ }
        window.prompt('Telegram bağlantı linki (kopyalandı). Personele WhatsApp\'tan gönderin — 48 saat geçerli, tek kullanımlık:', data.link);
      } else {
        alert(data.hata || 'Link oluşturulamadı.');
      }
    } catch {
      alert('Link oluşturulamadı.');
    }
  }

  // (tarihFormatla / tarihKisa modül düzeyine taşındı — SikayetKarti de kullanıyor.)

  // Sol panel: görünen şikayetleri sokağa göre grupla. Sıralama başkanın seçimine göre değişir;
  // varsayılan ('acik-azalan') ilk açılışta en çok açık şikayetli sokağı en üste koyar.
  const aramaVar = arama.trim() !== '';
  const gruplar = sokagaGoreGrupla(gorunenSikayetler); // sol panel: her sokak ayrı grup (pinler koordinata göre)
  gruplar.sort((a, b) => {
    if (siralama === 'ad-az') return a.sokakAdi < b.sokakAdi ? -1 : a.sokakAdi > b.sokakAdi ? 1 : 0;
    if (siralama === 'yeni' || siralama === 'eski') {
      const ta = grupTarihAraligi(a);
      const tb = grupTarihAraligi(b);
      return siralama === 'yeni' ? tb.enYeni - ta.enYeni : ta.enEski - tb.enEski;
    }
    return (b.acik - a.acik) || (a.sokakAdi < b.sokakAdi ? -1 : 1); // acik-azalan (varsayılan)
  });
  const enSicakAnahtar = gruplar[0]?.anahtar; // varsayılan açık grup (en çok açık şikayetli sokak)

  // Bir grup açık mı? Arama varken hepsi açık; kullanıcı hiç dokunmadıysa (acikGruplar === null)
  // yalnızca en sıcak grup açık; dokununca açık/kapalıyı yalnızca Set belirler.
  function grupAcikMi(anahtar) {
    if (aramaVar) return true;
    if (acikGruplar === null) return anahtar === enSicakAnahtar;
    return acikGruplar.has(anahtar);
  }

  /** Grup aç/kapat. İlk dokunuşta varsayılan açık (en sıcak) grubu koruyarak Set'e geçer. */
  function grupToggle(anahtar) {
    setAcikGruplar((prev) => {
      const taban = prev === null ? new Set(enSicakAnahtar ? [enSicakAnahtar] : []) : new Set(prev);
      if (taban.has(anahtar)) taban.delete(anahtar);
      else taban.add(anahtar);
      return taban;
    });
  }

  /** Kategori filtresini aç/kapat (çoklu seçim — tik işareti). */
  function kategoriToggle(id) {
    setKategoriFiltreSet((prev) => {
      const yeni = new Set(prev);
      if (yeni.has(id)) yeni.delete(id);
      else yeni.add(id);
      return yeni;
    });
  }

  const siralamaListesi = SIRALAMA_SECENEKLERI;
  const siralamaEtiketi = siralamaListesi.find((s) => s.id === siralama)?.etiket || '';

  const filtreKategorileri = SikayetKategorileri;

  // Stat chip'leri durum sözlüğünden üretilir: ilk iki durum + toplam
  // (Bekliyor / İnceleniyor / Toplam).
  const chipDurumlari = SikayetDurumlari.slice(0, 2);
  const chipRenkleri = ['var(--accent-rose)', 'var(--accent-amber)'];

  return (
    <div className="admin-layout">
      {/* Sol Panel */}
      <div className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="stat-chips">
            {chipDurumlari.map((d, i) => (
              <div className="stat-chip" key={d.id}>
                <span className="value" style={{ color: chipRenkleri[i] }}>
                  {sikayetler.filter((s) => s.durum === d.id).length}
                </span>
                <span className="label">{d.etiket}</span>
              </div>
            ))}
            <div className="stat-chip">
              <span className="value" style={{ color: 'var(--accent-green)' }}>{sikayetler.length}</span>
              <span className="label">Toplam</span>
            </div>
          </div>

          {/* Kategori filtresi (çoklu tik) + sıralama seçimi — küçük dropdown butonları */}
          <div className="filtre-sirala-satir" ref={filtreSiralaRef}>
            <div className="mini-dropdown-wrap">
              <button
                type="button"
                className={`mini-dropdown-btn${kategoriFiltreSet.size > 0 ? ' aktif' : ''}`}
                onClick={() => { setFiltrePopoverAcik((v) => !v); setSiralamaPopoverAcik(false); }}
              >
                🔍 Filtrele{kategoriFiltreSet.size > 0 ? ` (${kategoriFiltreSet.size})` : ''} {filtrePopoverAcik ? '▲' : '▼'}
              </button>
              {filtrePopoverAcik && (
                <div className="mini-popover">
                  {filtreKategorileri.map((k) => (
                    <label key={k.id} className="mini-popover-item">
                      <input
                        type="checkbox"
                        checked={kategoriFiltreSet.has(k.id)}
                        onChange={() => kategoriToggle(k.id)}
                      />
                      <span className="mini-popover-ikon">{k.ikon}</span>
                      <span className="mini-popover-etiket">{k.etiket}</span>
                      <span className="mini-popover-say">{kategoriSayilari[k.id] || 0}</span>
                    </label>
                  ))}
                  {kategoriFiltreSet.size > 0 && (
                    <button type="button" className="mini-popover-temizle" onClick={() => setKategoriFiltreSet(new Set())}>
                      Tümünü temizle
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mini-dropdown-wrap">
              <button
                type="button"
                className="mini-dropdown-btn"
                onClick={() => { setSiralamaPopoverAcik((v) => !v); setFiltrePopoverAcik(false); }}
                title={siralamaEtiketi}
              >
                ↕ Sırala {siralamaPopoverAcik ? '▲' : '▼'}
              </button>
              {siralamaPopoverAcik && (
                <div className="mini-popover">
                  {siralamaListesi.map((sec) => (
                    <label key={sec.id} className="mini-popover-item">
                      <input
                        type="radio"
                        name="siralama"
                        checked={siralama === sec.id}
                        onChange={() => { setSiralama(sec.id); setSiralamaPopoverAcik(false); }}
                      />
                      <span className="mini-popover-etiket">{sec.etiket}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

        <div className="admin-sidebar-content">
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%', padding: '8px', fontSize: 13, marginBottom: 12 }}
            onClick={() => setPersonelPanelAcik((v) => !v)}
          >
            👷 Saha Ekibi & Birimler {personelPanelAcik ? '▲' : '▼'}
          </button>
          {personelPanelAcik && (
            <PersonelYonetimi
              personeller={personeller}
              birimler={birimler}
              onPersonelEkle={personelEkle}
              onPersonelSil={personelSil}
              onLink={baglantiLinkiOlustur}
              onBirimEkle={birimEkle}
              onBirimSil={birimSil}
              onBirimKategori={birimKategoriAyarla}
            />
          )}
          <input
            className="sidebar-arama"
            type="text"
            placeholder="🔎 Sokak veya şikayet ara…"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />

          {yukleniyor && <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Yükleniyor...</p>}
          {hata && <div className="alert alert-error"><span>⚠️</span><span>{hata}</span></div>}

          {gruplar.map((g) => {
            const acikMi = grupAcikMi(g.anahtar);
            // Sol panelde sokak başlığındaki nokta da haritayla AYNI dili konuşur:
            // renk bekleme süresine göre (adete göre değil), açık kayıt yoksa yeşil.
            const noktaRenk = yasRengi(g.acik === 0 ? null : g.enEskiAcikMs, Date.now());
            return (
              <div
                className="sokak-grup"
                key={g.anahtar}
                ref={(el) => { grupRefleriRef.current[g.anahtar] = el; }}
              >
                <button
                  type="button"
                  className={`sokak-grup-baslik${acikMi ? ' acik' : ''}`}
                  onClick={() => grupToggle(g.anahtar)}
                >
                  <span className="sokak-grup-nokta" style={{ background: noktaRenk }} />
                  <span className="sokak-grup-ad">{g.sokakAdi}</span>
                  <span className="sokak-grup-ozet">
                    {g.acik > 0 ? `${g.acik} açık` : 'çözüldü'}{g.cozuldu > 0 && g.acik > 0 ? ` · ${g.cozuldu}✓` : ''}
                  </span>
                  <span className="sokak-grup-ok">{acikMi ? '▲' : '▼'}</span>
                </button>

                {acikMi && (
                  <div className="sokak-grup-icerik">
                    {g.sikayetler.map((s) => (
                      <SikayetKarti
                        key={s.id}
                        s={s}
                        secili={seciliSikayet?.id === s.id}
                        onOdak={sikayeteOdaklan}
                        onFoto={setFotoModalId}
                        onDurum={durumGuncelle}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!yukleniyor && sikayetler.length > 0 && gorunenSikayetler.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
              <p>Filtreye/aramaya uygun şikayet yok.</p>
            </div>
          )}

          {!yukleniyor && sikayetler.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
              <p>Aktif şikayet bulunmuyor!</p>
            </div>
          )}
        </div>
      </div>

      {/* Harita */}
      <div className="admin-map-container">
        <div ref={mapRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: '#0c0d0f' }} />

        {/* Harita üstü kontrol kutusu: renk açıklaması + "çözülenleri göster".
            Leaflet katmanlarının üstünde kalmalı (Leaflet kendi panellerini 400-700
            arasında konumlandırır) ama sayfa modallarının (10000) altında. */}
        <div className="harita-kontrol">
          <div className="harita-kontrol-baslik">Bekleme süresi</div>
          {HaritaYasKademeleri.map((k) => (
            <div key={k.id} className="harita-kontrol-satir" title={k.aciklama}>
              <span className="harita-kontrol-nokta" style={{ background: k.renk }} />
              {k.etiket}
            </div>
          ))}
          <label className="harita-kontrol-anahtar">
            <input
              type="checkbox"
              checked={cozulenleriGoster}
              onChange={(e) => setCozulenleriGoster(e.target.checked)}
            />
            <span className="harita-kontrol-nokta" style={{ background: HARITA_COZULDU_RENGI }} />
            Çözülenleri göster
          </label>
        </div>
      </div>

      {/* Fotoğraf Modalı */}
      {fotoModalId && (
        <div
          onClick={() => setFotoModalId(null)}
          role="presentation"
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,.82)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} role="presentation" style={{ position: 'relative', maxWidth: '92vw', maxHeight: '88vh' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/foto/${fotoModalId}`}
              alt="Şikayet fotoğrafı"
              style={{ maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 12, display: 'block' }}
            />
            <button
              type="button"
              onClick={() => setFotoModalId(null)}
              aria-label="Kapat"
              style={{
                position: 'absolute', top: -14, right: -14, width: 40, height: 40,
                borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: '#fff', color: '#111', fontSize: 20, lineHeight: 1,
                boxShadow: '0 2px 10px rgba(0,0,0,.4)',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
