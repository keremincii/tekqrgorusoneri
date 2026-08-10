'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Bir sayfada çekilecek kayıt sayısı ("Daha fazla" her basışta bir sayfa ekler). */
const SAYFA_BOYU = 100;

/**
 * YEDEK TAZELEME aralığı (ms). Canlı akış (SSE) ASIL yoldur; bu yalnız ağ/vekil
 * kaynaklı sessiz kopmalara karşı emniyet kemeridir. Uzun tutuldu (2 dk) çünkü akış
 * çalışırken sunucuyu yormanın anlamı yok; akış koptuğunda tarayıcı zaten kendi
 * yeniden bağlanır ve bu tazeleme aradaki boşluğu kapatır.
 */
const YEDEK_TAZELEME_MS = 120_000;

/**
 * Sunucudan bir sayfa çeker. SAF: hiçbir state'e dokunmaz, yalnız veri döner.
 *
 * State'ten ayrı tutulması bilinçli — React 19'da bir effect'in gövdesinde SENKRON
 * setState çağırmak "cascading render" üretir ve derleyici bunu hata sayar. Getirme
 * saf olunca, state güncellemeleri her zaman `await`ten SONRA (asenkron devamda)
 * yapılabilir.
 *
 * @returns {Promise<Object|null>} Yanıt gövdesi; hata durumunda null.
 */
async function sayfaGetir({ tur, durumlar, arama, offset, sayimlar }) {
  const p = new URLSearchParams();
  if (tur) p.set('tur', tur);
  if (durumlar?.length) p.set('durum', durumlar.join(','));
  if (arama) p.set('q', arama);
  p.set('limit', String(SAYFA_BOYU));
  p.set('offset', String(offset));
  if (sayimlar) p.set('sayimlar', '1');

  try {
    const res = await fetch(`/api/admin/sikayetler?${p.toString()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Filtre kümesini tek bir dizeye indirger (hangi filtrenin verisi yüklendi?). */
function filtreAnahtari({ tur, durumlar, arama }) {
  return `${tur || ''}|${(durumlar || []).join(',')}|${arama || ''}`;
}

/**
 * useBasvuruAkisi — Panelin veri motoru
 * ======================================
 *
 * Üç şeyi tek yerde toplar ve dışarıya sade bir arayüz verir:
 *   1. FİLTRELİ LİSTE  : sunucudan sayfalı çeker (tür / durum / arama sunucu tarafında).
 *   2. CANLI AKIŞ      : /api/admin/akis (SSE) ile gelen olayları listeye işler —
 *                        SAYFA YENİLENMEZ, kart yerinde güncellenir.
 *   3. YEDEK TAZELEME  : akış sessizce koparsa listeyi periyodik tazeler.
 *
 * NEDEN AYRI BİR HOOK: pano bileşeni "ne gösterileceğine" karar verir; "verinin nasıl
 * tazelendiği" ayrı bir sorumluluktur. Ayrıca akış mantığı (abonelik, temizlik, filtre
 * uyumu) gözden kaçması kolay ayrıntılar içerir — tek yerde durması gerekir.
 *
 * FİLTRE UYUMU (kritik ayrıntı): Sunucu filtreli liste döndürür ama canlı akış
 * FİLTRESİZDİR — tenant'ın her olayı gelir. Gelen kaydı körlemesine listeye eklemek,
 * "yalnız Şikayet" sekmesinde bir Görüş'ün belirmesine yol açardı. Bu yüzden her olay
 * yereldeki filtreye göre süzülür; filtreye uymayan YENİ kayıt listeye girmez ama
 * "yeni var" sayacına yansır (başkan sekmeyi değiştirince görür).
 */
export function useBasvuruAkisi({ tur, durumlar, arama }) {
  const [basvurular, setBasvurular] = useState([]);
  const [sayimlar, setSayimlar] = useState([]);
  const [belediye, setBelediye] = useState(null);
  const [dahaYukleniyor, setDahaYukleniyor] = useState(false);
  const [devamVar, setDevamVar] = useState(false);
  const [hata, setHata] = useState('');
  /** 'baglaniyor' | 'canli' | 'kopuk' — panelin sağ üstündeki göstergeyi besler. */
  const [akisDurumu, setAkisDurumu] = useState('baglaniyor');
  /** Aktif filtreye UYMAYAN, akıştan gelmiş yeni kayıt sayısı (rozet). */
  const [gizliYeniAdet, setGizliYeniAdet] = useState(0);

  const anahtar = filtreAnahtari({ tur, durumlar, arama });

  /**
   * Verisi ekranda olan filtrenin anahtarı. "Yükleniyor" bundan TÜRETİLİR:
   * filtre değişir değişmez (render sırasında) anahtarlar ayrışır → gösterge yanar;
   * o filtrenin verisi gelince eşitlenir → söner. Ayrı bir `yukleniyor` state'i
   * tutmak, effect gövdesinde senkron setState gerektirir ve iki state'in
   * ayrışabildiği (gösterge takılı kalması) bir hata sınıfı doğurur.
   */
  const [yuklenenAnahtar, setYuklenenAnahtar] = useState(null);
  const yukleniyor = yuklenenAnahtar !== anahtar;

  /**
   * Filtrelerin GÜNCEL değerinin aynası. SSE dinleyicisi bir kez kurulur ve uzun süre
   * yaşar; closure'da yakaladığı filtreler bayatlar. Dinleyiciyi her filtre
   * değişiminde yeniden kurmak ise bağlantıyı koparıp yeniden açardı (gereksiz ve
   * olay kaybına açık) — bu yüzden dinleyici filtreleri ref'ten OKUR.
   */
  const filtreRef = useRef({ tur, durumlar, arama });
  // Ref RENDER SIRASINDA yazılmaz (React'in kuralı: ref'e erişim render dışındadır).
  // Effect, render tamamlandıktan hemen sonra çalışır; SSE dinleyicisi ve zamanlayıcı
  // da ancak o noktadan sonra tetiklenebileceği için ref her zaman günceldir.
  useEffect(() => {
    filtreRef.current = { tur, durumlar, arama };
  }, [tur, durumlar, arama]);

  /** Bir kaydın aktif filtreye uyup uymadığı (akıştan gelen olaylar için). */
  const filtreyeUyuyorMu = useCallback((b) => {
    const f = filtreRef.current;
    if (f.tur && b.tur !== f.tur) return false;
    if (f.durumlar?.length && !f.durumlar.includes(b.durum)) return false;
    if (f.arama) {
      const q = f.arama.trim().toLocaleLowerCase('tr');
      if (q && !String(b.aciklama || '').toLocaleLowerCase('tr').includes(q)) return false;
    }
    return true;
  }, []);

  /** Gelen yanıtı state'e yazar (yalnız `await`ten sonra çağrılır). */
  const yanitiUygula = useCallback((veri, yuklenen) => {
    setBasvurular(veri.basvurular || []);
    setSayimlar(veri.sayimlar || []);
    setDevamVar(Boolean(veri.devamVar));
    if (veri.belediye) setBelediye(veri.belediye);
    setGizliYeniAdet(0);
    setHata('');
    setYuklenenAnahtar(yuklenen);
  }, []);

  /**
   * Listeyi baştan çeker. Yalnızca OLAY işleyicilerinden çağrılır (zamanlayıcı,
   * sekmeye dönüş, "tekrar dene") — effect gövdesinden değil.
   */
  const tazele = useCallback(async ({ sessiz = false } = {}) => {
    const suanki = filtreRef.current;
    const veri = await sayfaGetir({ ...suanki, offset: 0, sayimlar: true });
    if (!veri) {
      if (!sessiz) setHata('Veriler yüklenemedi.');
      return;
    }
    yanitiUygula(veri, filtreAnahtari(suanki));
  }, [yanitiUygula]);

  /** Bir sonraki sayfayı listenin SONUNA ekler ("Daha fazla yükle"). */
  const dahaYukle = useCallback(async () => {
    if (dahaYukleniyor) return;
    setDahaYukleniyor(true);
    try {
      const veri = await sayfaGetir({ ...filtreRef.current, offset: basvurular.length });
      if (!veri) return;
      const yeniler = veri.basvurular || [];
      setBasvurular((onceki) => {
        // Canlı akış bu arada listeye kayıt eklemiş olabilir → offset kayar ve aynı
        // kayıt iki kez gelebilir. Kimliğe göre tekilleştirme bunu görünmez kılar.
        const varolan = new Set(onceki.map((b) => b.id));
        return [...onceki, ...yeniler.filter((b) => !varolan.has(b.id))];
      });
      setDevamVar(Boolean(veri.devamVar));
    } finally {
      setDahaYukleniyor(false);
    }
  }, [dahaYukleniyor, basvurular.length]);

  /**
   * Tek bir kaydı yerinde günceller/ekler/çıkarır. Panelin YENİDEN YÜKLENMEDEN
   * canlı kalmasının çekirdeği burasıdır. Yalnız SSE geri çağrısından çalışır.
   */
  const olayIsle = useCallback((olay) => {
    if (olay?.tip === 'silindi') {
      setBasvurular((onceki) => onceki.filter((b) => b.id !== olay.id));
      return;
    }
    const gelen = olay?.basvuru;
    if (!gelen?.id) return;

    setBasvurular((onceki) => {
      const idx = onceki.findIndex((b) => b.id === gelen.id);
      const uyuyor = filtreyeUyuyorMu(gelen);

      // Zaten listedeyse: filtreye hâlâ uyuyorsa yerinde güncelle, uymuyorsa çıkar
      // (ör. "Bekleyenler" filtresindeyken bir kayıt çözüldü → listeden düşmeli).
      if (idx >= 0) {
        if (!uyuyor) return onceki.filter((b) => b.id !== gelen.id);
        const kopya = [...onceki];
        kopya[idx] = gelen;
        return kopya;
      }

      // Listede değilse ve filtreye uymuyorsa dokunma (rozet sayacı ayrıca artar).
      if (!uyuyor) return onceki;

      // Yeni kayıt: en üste. Liste "en yeni önce" sıralı olduğu için doğru yer burası.
      return [gelen, ...onceki];
    });

    if (olay.tip === 'yeni' && !filtreyeUyuyorMu(gelen)) {
      setGizliYeniAdet((n) => n + 1);
    }

    // Rozet sayaçları TÜM tabloyu yansıtır; olaydan hesaplanamaz (silinen/durum
    // değişen kayıtların hangi kovadan çıktığı burada bilinmez). Ucuz bir sorgu
    // olduğu için sunucudan tazeleriz — ama listeyi yeniden çekmeden.
    fetch('/api/admin/sikayetler?limit=1&sayimlar=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (v?.sayimlar) setSayimlar(v.sayimlar); })
      .catch(() => { /* sayaç tazelenemedi → bir sonraki olayda düzelir */ });
  }, [filtreyeUyuyorMu]);

  // --- İlk yükleme + filtre değişimi ---
  // State güncellemeleri `await`ten SONRA yapılır: effect gövdesi senkron olarak
  // hiçbir setState çağırmaz (React 19 "cascading render" kuralı).
  useEffect(() => {
    let iptal = false;
    (async () => {
      const veri = await sayfaGetir({ tur, durumlar, arama, offset: 0, sayimlar: true });
      if (iptal) return; // filtre bu arada değişti → bayat yanıtı yazma
      if (!veri) {
        setHata('Veriler yüklenemedi.');
        return;
      }
      yanitiUygula(veri, anahtar);
    })();
    return () => { iptal = true; };
    // `anahtar` filtrelerin tamamını temsil eder; tur/durumlar/arama ondan türetilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anahtar, yanitiUygula]);

  // --- CANLI AKIŞ (SSE) ---
  useEffect(() => {
    // EventSource kopan bağlantıyı KENDİ yeniden kurar (sunucu `retry:` ile aralığı
    // söyler) → burada elle yeniden bağlanma döngüsü yazmıyoruz.
    const kaynak = new EventSource('/api/admin/akis');

    const acildi = () => setAkisDurumu('canli');
    const koptu = () => setAkisDurumu('kopuk');
    const olayAl = (e) => {
      try {
        olayIsle(JSON.parse(e.data));
      } catch {
        /* bozuk gövde → yok say */
      }
    };

    kaynak.addEventListener('hazir', acildi);
    kaynak.addEventListener('yeni', olayAl);
    kaynak.addEventListener('guncelleme', olayAl);
    kaynak.addEventListener('silindi', olayAl);
    kaynak.onerror = koptu;

    return () => {
      kaynak.removeEventListener('hazir', acildi);
      kaynak.removeEventListener('yeni', olayAl);
      kaynak.removeEventListener('guncelleme', olayAl);
      kaynak.removeEventListener('silindi', olayAl);
      kaynak.close();
    };
  }, [olayIsle]);

  // --- YEDEK TAZELEME (akış sessizce koparsa) ---
  useEffect(() => {
    const id = setInterval(() => {
      // Sekme arka plandayken istek atma: görünmeyen bir ekranı tazelemek boşuna yük.
      // Öne geldiğinde aşağıdaki 'visibilitychange' zaten bir kez tazeler.
      if (typeof document !== 'undefined' && document.hidden) return;
      tazele({ sessiz: true });
    }, YEDEK_TAZELEME_MS);
    return () => clearInterval(id);
  }, [tazele]);

  // Sekmeye geri dönüldüğünde bir kez tazele: arka plandayken kaçan olaylar (tarayıcı
  // uyuyan sekmelerde SSE'yi askıya alabilir) böylece kapanır.
  useEffect(() => {
    const geriDon = () => {
      if (!document.hidden) tazele({ sessiz: true });
    };
    document.addEventListener('visibilitychange', geriDon);
    return () => document.removeEventListener('visibilitychange', geriDon);
  }, [tazele]);

  return {
    basvurular,
    sayimlar,
    belediye,
    yukleniyor,
    dahaYukleniyor,
    devamVar,
    hata,
    akisDurumu,
    gizliYeniAdet,
    dahaYukle,
    tazele,
  };
}
