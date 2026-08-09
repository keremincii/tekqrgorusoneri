'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { SikayetKategorileri } from '@/lib/utils/constants';
import TurnstileWidget from './TurnstileWidget';
import { cihazParmakIziAl } from './cihazParmakIzi';

/**
 * Cloudflare Turnstile site anahtarı (bot kapısı). Build zamanında inline edilir.
 * Boşsa (geliştirme) widget gösterilmez ve backend doğrulamayı atlar.
 */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

// Doğrulama TEK YOLLUDUR: Netgsm SMS OTP + Turnstile bot kapısı + katmanlı throttle.
// (WhatsApp reverse-OTP ve Firebase Phone Auth alternatifleri kaldırıldı.)

/** "Sokağı değiştir" panelinde gösterilecek en yakın sokak sayısı. */
const EN_YAKIN_SOKAK_ADET = 10;

/**
 * Sihirbazın alt adımları (sıra ANLAMLIDIR). Sabit dizidir; ilerleme, "Geri" ve
 * özetteki "Değiştir" bağlantıları hep buradan indekslenir.
 */
const ADIMLAR = Object.freeze(['kategori', 'konum', 'aciklama', 'foto', 'ozet']);

/**
 * Sokak seçim sheet'inin platform görünümünü belirler ('ios' | 'android').
 * Yalnız GÖRÜNÜM içindir — hiçbir iş kuralı buna bağlı değildir.
 * iPadOS 13+ kendini "Macintosh" olarak tanıttığından dokunma noktası sayısına da bakılır.
 * Sonuç modül düzeyinde önbelleklenir: useSyncExternalStore anlık görüntüsünün her
 * çağrıda AYNI değeri döndürmesi gerekir (aksi halde React sonsuz render'a girer).
 */
let _platform = null;
function platformOku() {
  if (_platform === null) {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
    const iosGibi = /iPad|iPhone|iPod/.test(ua)
      || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
    _platform = iosGibi ? 'ios' : 'android';
  }
  return _platform;
}
/** Platform oturum içinde değişmez → abone olacak bir şey yok (boş çözümleyici). */
function platformAbone() {
  return () => {};
}

/**
 * İki koordinat arası kabaca mesafe (metre). Equirectangular yaklaşımı — kasaba
 * ölçeğinde "en yakın sokak" sıralaması için yeterince doğru ve ucuz (haversine gerekmez).
 */
function mesafeMetre(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * R;
}

/** Modal içindeki ikincil (çerçeveli) buton görünümü — birden çok yerde kullanılır. */
const IKINCIL_BUTON_STIL = {
  width: '100%', marginTop: 10, padding: '13px', borderRadius: 'var(--radius-sm, 12px)',
  // Eski hâli (şeffaf zemin + %14 beyaz border) üstündeki dolu CTA'nın yanında neredeyse
  // görünmüyordu. Marka mavisiyle çerçeveli ikincil buton: CTA ile çakışmıyor (o dolu
  // gradient), ama artık net görünür ve tıklanabilir duruyor.
  border: '1px solid rgba(56, 189, 248, 0.45)', cursor: 'pointer',
  background: 'rgba(56, 189, 248, 0.08)', color: 'var(--accent-blue, #38bdf8)',
  fontSize: 15, fontWeight: 600,
};

/**
 * QR Okutma Sayfası — Vatandaş Şikayet Formu (istemci sihirbazı)
 *
 * "Kapıya Ayak Koyma" UX tekniği ile 3 ÜST adım:
 * 1. Sihirbaz (kategori → konum → açıklama → foto → özet) → Kullanıcı emek harcasın
 * 2. Ad + Soyad + Telefon + KVKK açık rıza → SMS kodu gönder
 *    (NVİ public servisi kapandı; kimlik güvencesi SMS OTP ile. Kurumsal KPS
 *     bağlanırsa NVI_DOGRULAMA=acik ile TC doğrulaması yeniden eklenir.)
 * 3. SMS kodu → Doğrulanırsa şikayet otomatik kaydedilir
 * 4. Başarı ekranı
 *
 * Defense in Depth: Şikayet sunucuya SADECE SMS doğrulandıktan sonra gönderilir.
 * Kategori id'si backend'de whitelist kontrolünden geçer.
 */
export default function SikayetFormu() {
  const params = useParams();
  const searchParams = useSearchParams();
  const qrId = params.qrId;
  const sig = searchParams.get('sig');

  const [adim, setAdim] = useState(1);
  // Adım 1 kendi içinde adım adım bir sihirbazdır (vatandaş tek seferde tek karar
  // versin, kafası karışmasın). 1..N = `ADIMLAR` dizisindeki alt adımlar (1 tabanlı).
  const [altAdim, setAltAdim] = useState(1);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState('');

  // Form verileri (tüm veriler client-side'da tutulur, sunucuya sadece SMS sonrası gider)
  const [kategori, setKategori] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [foto, setFoto] = useState(null);          // seçilen dosya (opsiyonel)
  const [fotoOnizleme, setFotoOnizleme] = useState(''); // önizleme için object URL
  // Tek alan: "Ad Soyad". Vatandaş iki ayrı kutuya tıklamasın diye birleşik alındı;
  // sunucuya gönderilirken adSoyadAyir() ile ad/soyad'a bölünür (API sözleşmesi aynı).
  const [adSoyad, setAdSoyad] = useState('');
  const [telefon, setTelefon] = useState('');
  const [smsKodu, setSmsKodu] = useState('');
  /**
   * KVKK onayları AYRI İKİ KUTUDUR (v13). Kurul'un yerleşik görüşü, aydınlatma ile açık
   * rızanın birbirinden ayrı alınmasıdır; tek kutuda birleştirmek açık rızayı sakatlar.
   * Burada bu risk teoriden ibaret değil: yurt dışı aktarımın (sunucu Almanya'da) TEK
   * hukuki dayanağı açık rızadır — rıza sakatsa aktarım dayanaksız kalır.
   *
   * `kvkkOnay` = AÇIK RIZA. Sunucuda `sikayetler.kvkk_onay` + `kvkk_onay_tarihi` olarak
   * saklanan budur. Aydınlatmanın yapıldığının ispatı ise ayrı bir kolon gerektirmez:
   * kayda yazılan `kvkk_metin_surumu`, vatandaşa HANGİ metnin gösterildiğini zaten belgeler.
   */
  const [aydinlatmaOkundu, setAydinlatmaOkundu] = useState(false); // Aydınlatma metni okundu (zorunlu)
  const [kvkkOnay, setKvkkOnay] = useState(false); // Yurt dışı aktarıma AÇIK RIZA (zorunlu)
  const [turnstileToken, setTurnstileToken] = useState(''); // Turnstile bot doğrulama token'ı
  const [turnstileNonce, setTurnstileNonce] = useState(0);  // widget'ı tazelemek için (tek kullanımlık token)
  const [fingerprint, setFingerprint] = useState('');       // cihaz parmak izi (FingerprintJS visitorId)
  // SMS "tekrar gönder" için geri sayım (saniye). SMS gönderilince 30'a set edilir,
  // her saniye 1 azalır; 0 olunca tekrar gönder butonu aktifleşir. Böylece vatandaş
  // hem gereksiz spam yapmaz hem de ne zaman tekrar isteyebileceğini saniye saniye görür.
  const [geriSayim, setGeriSayim] = useState(0);
  // Kod gönderim sınırına (SMS_GONDER_MAX) ulaşıldı mı → "tekrar gönder" gizlenir.
  const [gonderLimiti, setGonderLimiti] = useState(false);
  // Başarı ekranı için tenant'a özel bilgiler (doğrulama/şikayet yanıtından gelir)
  const [belediyeAdi, setBelediyeAdi] = useState('');
  const [baskanAdi, setBaskanAdi] = useState('');
  // NOT: Vatandaştan cihaz GPS'i / konum izni ALINMAZ. Başvurunun haritadaki yeri,
  // okutulan QR'ın (sokağın) CSV'den gelen sabit enlem/boylam'ıdır (sunucuda çözülür).

  // Sokak seçimi: QR'ın sokağı formda seçili gelir; vatandaş yanlış QR okuttuysa ya da
  // sorun komşu sokaktaysa "en yakın sokaklar"dan birini seçerek değiştirebilir. Seçilen
  // sokak, başvurunun kaydedileceği (ve haritada görüneceği) konumu belirler.
  const [sokaklar, setSokaklar] = useState([]);              // tenant'ın sokakları: {id, sokakAdi, enlem, boylam}
  const [seciliSokakId, setSeciliSokakId] = useState(qrId);  // kaydedilecek KONUM sokağı; başlangıç = okutulan QR
  // Vatandaş sistemde KAYITLI OLMAYAN bir sokak (numara ±10 önerisinden uydurma) seçtiyse
  // adı buraya yazılır; konum okutulan QR'da kalır (seciliSokakId=qrId), sadece ad değişir.
  // Kayıtlı sokak seçilirse null olur.
  const [seciliSokakAdi, setSeciliSokakAdi] = useState(null);
  const [serbestSokakGirdi, setSerbestSokakGirdi] = useState(''); // "başka sokak yaz" metin kutusu
  // Sokağı değiştir modalı: konum alt-adımında "Sokağı değiştir" ile açılır (yakın
  // sokaklar / numaralı / elle yaz). Sihirbazda "Devam" zaten onay yerine geçtiğinden
  // ayrı bir "onaylandı" bayrağı YOK — ilerlemek konumu kabul etmek demektir.
  const [konumOnayAcik, setKonumOnayAcik] = useState(false);       // sokak değiştir modalı açık mı
  /**
   * Sokak seçim sheet'inin platform görünümü: 'ios' → başlık ortada + "İptal" solda
   * (Cupertino), diğer her şey → başlık solda + ✕ sağda (Material 3).
   *
   * useSyncExternalStore kullanılıyor çünkü bu bir TARAYICI GERÇEĞİ okumasıdır:
   * sunucu anlık görüntüsü boş ('') döner, istemci anlık görüntüsü platformu döner →
   * hydration uyuşmazlığı olmadan, efekt içinde setState etmeden çözülür.
   * (useEffect + setState React 19'da bu iş için doğru araç değil.)
   */
  const platform = useSyncExternalStore(platformAbone, platformOku, () => '');

  // Cihaz parmak izini arka planda (sayfa açılınca) hesapla. Kullanıcıyı bekletmez;
  // hazır olduğunda state'e yazılır ve SMS isteğine eklenir. Yüklenemezse boş kalır
  // (backend parmak izsiz devam eder — IP + telefon katmanları korur).
  useEffect(() => {
    let iptal = false;
    cihazParmakIziAl().then((fp) => { if (!iptal) setFingerprint(fp); });
    return () => { iptal = true; };
  }, []);

  // Sokak sheet'i açıkken: Esc ile kapat + arkadaki sayfanın kaymasını durdur.
  // (Sheet kendi içinde kaydırılır; arka planın da kayması "kaybolmuş" hissi verir.)
  useEffect(() => {
    if (!konumOnayAcik) return;
    const kapat = (e) => { if (e.key === 'Escape') setKonumOnayAcik(false); };
    const eskiTasma = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', kapat);
    return () => {
      window.removeEventListener('keydown', kapat);
      document.body.style.overflow = eskiTasma;
    };
  }, [konumOnayAcik]);

  // SMS "tekrar gönder" geri sayımı: geriSayim > 0 iken her saniye 1 azalır.
  // 0'a inince tekrar gönder butonu aktifleşir (aşağıdaki adım 3 arayüzünde).
  useEffect(() => {
    if (geriSayim <= 0) return;
    const t = setTimeout(() => setGeriSayim((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [geriSayim]);

  // Sokak listesini çek (QR'ın sokağını göstermek + en yakınlardan değiştirebilmek için).
  // Progressive enhancement: hata olursa sessizce geçilir; form yine çalışır (sunucu
  // secilenSokakId gönderilmezse okutulan QR'a düşer).
  useEffect(() => {
    let iptal = false;
    fetch('/api/sokaklar')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!iptal && d?.sokaklar) setSokaklar(d.sokaklar); })
      .catch(() => { /* sessizce geç */ });
    return () => { iptal = true; };
  }, []);

  /**
   * Sihirbazın alt adımları. Sabit dizidir; ilerleme çubuğu, "Geri" ve özetteki
   * "Değiştir" bağlantıları hep buradan indekslenir (hiçbir yerde çıplak adım
   * numarası yoktur).
   */
  const adimlar = ADIMLAR;

  const MAX_FOTO_BYTE = 15 * 1024 * 1024; // 15MB

  /** Fotoğraf seçimi (opsiyonel). Sadece resim + max 15MB; client tarafı ön kontrol. */
  function fotoSec(e) {
    const dosya = e.target.files?.[0];
    if (!dosya) return;
    if (!dosya.type.startsWith('image/')) {
      setHata('Lütfen bir resim dosyası seçin.');
      e.target.value = '';
      return;
    }
    if (dosya.size > MAX_FOTO_BYTE) {
      setHata('Fotoğraf çok büyük. Lütfen daha düşük çözünürlükte çekin.');
      e.target.value = '';
      return;
    }
    setHata('');
    if (fotoOnizleme) URL.revokeObjectURL(fotoOnizleme);
    setFoto(dosya);
    setFotoOnizleme(URL.createObjectURL(dosya));
  }

  function fotoKaldir() {
    if (fotoOnizleme) URL.revokeObjectURL(fotoOnizleme);
    setFoto(null);
    setFotoOnizleme('');
  }

  function getStepClass(step) {
    if (adim > step) return 'done';
    if (adim === step) return 'active';
    return '';
  }

  // --- Alt adım gezinmesi (hepsi `adimlar` dizisinden; sabit numara YOK) ---
  /** Bir adım türünün 1 tabanlı indeksi (bu türde yoksa -1). */
  function adimIndeksi(adimTuru) {
    const i = adimlar.indexOf(adimTuru);
    return i < 0 ? -1 : i + 1;
  }
  /** Sihirbazın ilk alt adımı. */
  const ilkAltAdim = 1;
  /** Adı verilen adıma atlar. hataTemizle=false → doğrulama hatası korunarak yönlendirme. */
  function adimaGit(adimTuru, hataTemizle = true) {
    const i = adimIndeksi(adimTuru);
    if (i > 0) {
      if (hataTemizle) setHata('');
      setAltAdim(i);
    }
  }
  function ileri() {
    setHata('');
    setAltAdim((a) => Math.min(a + 1, adimlar.length));
  }
  function geriGit() {
    setHata('');
    setAltAdim((a) => Math.max(a - 1, ilkAltAdim));
  }
  /** Şu an ekranda olan alt adım. */
  const aktifAdim = adimlar[altAdim - 1] || null;

  /** Adım 1 (özet) → Adım 2: son kontroller + kimlik doğrulamaya geç. */
  function basvuruyuOnayla(e) {
    e.preventDefault();
    if (!kategori) {
      // Kategori ilk alt adımda seçilir; bir şekilde boşsa oraya geri götür.
      setHata('Lütfen bir şikayet kategorisi seçin.');
      adimaGit('kategori', false);
      return;
    }
    // AÇIKLAMA OPSİYONELDİR ve alt karakter sınırı YOKTUR (sunucudaki
    // validators.aciklamaGecerliMi ile hizalı): "çöp alınmadı" geçerli bir şikayettir.
    // Üst sınırı textarea maxLength tutar.
    setHata('');
    setAdim(2);
  }

  /**
   * "Ad Soyad" tek alanını sunucunun beklediği ad/soyad çiftine böler.
   * SON kelime soyad, kalanı addır: "Ali Can Öztürk" → ad "Ali Can", soyad "Öztürk".
   * Tek kelime girilmişse soyad boş döner → çağıran uyarı gösterir.
   * @param {string} tam
   * @returns {{ad: string, soyad: string}}
   */
  function adSoyadAyir(tam) {
    const parcalar = String(tam || '').trim().split(/\s+/).filter(Boolean);
    if (parcalar.length < 2) return { ad: parcalar[0] || '', soyad: '' };
    return { ad: parcalar.slice(0, -1).join(' '), soyad: parcalar[parcalar.length - 1] };
  }

  /** Turnstile token'ını tazele (tek kullanımlık; backend'e gidince tükenir). */
  function turnstileTazele() {
    setTurnstileToken('');
    setTurnstileNonce((n) => n + 1);
  }

  /** Adım 2: Bilgileri al ve SMS gönder (KVKK onayı zorunlu) */
  async function tcDogrulaVeSmsGonder(e) {
    e.preventDefault();
    setHata('');
    if (!aydinlatmaOkundu) {
      setHata('Devam etmek için Aydınlatma Metni onayını işaretleyin.');
      return;
    }
    if (!kvkkOnay) {
      setHata('Başvurunuzu alabilmemiz için yurt dışı aktarımına açık rıza onayı gereklidir.');
      return;
    }
    // Bot kapısı: site anahtarı tanımlıysa token zorunlu (dev'de anahtar yoksa atlanır).
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setHata('Lütfen "Ben robot değilim" doğrulamasını tamamlayın.');
      return;
    }
    // Tek alandan ad/soyad ayrıştır; soyadsız girişte sunucuya gitmeden uyar
    // (sunucu "Ad, Soyad ve Telefon zorunludur" derdi — burada daha anlaşılır).
    const { ad, soyad } = adSoyadAyir(adSoyad);
    if (!ad || !soyad) {
      setHata('Lütfen adınızı ve soyadınızı birlikte yazın.');
      return;
    }
    setYukleniyor(true);

    try {
      // ÖN-KONTROL (SMS'ten ÖNCE): haftalık limit / kara liste. Limit zaten dolmuşsa
      // SMS hiç üretilmez → Netgsm kredisi boşa yanmaz ve vatandaş "kod bekle, sonra
      // reddedil" yaşamaz.
      // Ulaşılamazsa akış BOZULMAZ (bu yalnız optimizasyon; nihai kapı /api/sikayet).
      try {
        const onRes = await fetch('/api/dogrulama/on-kontrol', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefon }),
        });
        const onData = await onRes.json();
        if (onData?.izin === false) {
          // Turnstile token'ı HARCANMADI (tc ucuna hiç gitmedik) → tazelenmez, geçerli kalır.
          setHata(onData.hata || 'Şu anda başvurunuzu alamıyoruz.');
          return;
        }
      } catch {
        /* ön-kontrol ulaşılamadı → normal akışa devam */
      }

      const res = await fetch('/api/dogrulama/tc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad, soyad, telefon, turnstileToken, fingerprint }),
      });

      const data = await res.json();

      if (!res.ok) {
        setHata(data.hata || 'Doğrulama başarısız.');
        turnstileTazele(); // token tükendi → yeni challenge
        return;
      }

      setAdim(3);
      setGeriSayim(30); // tekrar gönder kilidi başlasın
    } catch {
      setHata('Bağlantı hatası. Lütfen tekrar deneyin.');
      turnstileTazele();
    } finally {
      setYukleniyor(false);
    }
  }

  /**
   * ORTAK SON ADIM: elde bir `dogrulamaToken` varken (varsa) fotoğrafı yükle ve şikayeti
   * kaydet. Başarıda adım 4'e geçer.
   * @param {string} dogrulamaToken - imzalı doğrulama belirteci
   * @returns {Promise<boolean>} kayıt başarılı mı
   */
  async function basvuruyuTokenIleGonder(dogrulamaToken) {
    // (varsa) fotoğrafı yükle. Fotoğraf OPSİYONELDİR: yükleme başarısız olsa bile
    // şikayet yine de gönderilir (kullanıcı mağdur olmasın).
    let fotografKey = null;
    if (foto) {
      try {
        const fd = new FormData();
        fd.append('sokakId', qrId);
        fd.append('sig', sig);
        fd.append('dogrulamaToken', dogrulamaToken);
        fd.append('file', foto);
        const fotoRes = await fetch('/api/sikayet/foto', { method: 'POST', body: fd });
        if (fotoRes.ok) {
          const fotoData = await fotoRes.json();
          fotografKey = fotoData.fotografKey || null;
        }
      } catch {
        /* fotoğraf yüklenemedi → sessizce geç, başvuru yine kaydedilir */
      }
    }

    // Şikayeti kaydet (TC/telefon DEĞİL, imzalı doğrulama belirteci gönderilir)
    const sikayetRes = await fetch('/api/sikayet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // sokakId + sig: HMAC kapısı (sahte QR koruması) + sikayetler.sokak_id NOT NULL.
        sokakId: qrId,
        sig,
        secilenSokakId: seciliSokakId,   // seçilen KONUM sokağı
        secilenSokakAdi: seciliSokakAdi, // kayıtlı olmayan sokak adı (yoksa null)
        dogrulamaToken,
        kategori,
        aciklama,
        fotografUrl: fotografKey,
        kvkkOnay: true, // adım 2'de işaretlendi (sunucu da doğrular)
        // Konum GÖNDERİLMEZ: şikayetin haritadaki yeri, seçilen sokağın (secilenSokakId)
        // sabit koordinatıdır — sunucu çözer. Okutulan QR (sokakId) imza/anti-abuse içindir.
      }),
    });

    const sikayetData = await sikayetRes.json();
    if (!sikayetRes.ok) {
      setHata(sikayetData.hata || 'Şikayetiniz kaydedilemedi.');
      return false;
    }

    // Başarı ekranı için tenant'a özel bilgileri sakla (belediye + başkan adı)
    setBelediyeAdi(sikayetData.belediyeAdi || '');
    setBaskanAdi(sikayetData.baskanAdi || '');
    setAdim(4);
    return true;
  }

  /** Adım 3 (SMS modu): SMS kodunu doğrula → token al → başvuruyu kaydet */
  async function smsDogrulaVeKaydet(e) {
    e.preventDefault();
    setHata('');
    setYukleniyor(true);

    try {
      // Önce SMS kodunu doğrula
      const smsRes = await fetch('/api/dogrulama/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefon, kod: smsKodu }),
      });

      const smsData = await smsRes.json();

      if (!smsRes.ok) {
        setHata(smsData.hata || 'Kod doğrulanamadı.');
        return;
      }

      await basvuruyuTokenIleGonder(smsData.dogrulamaToken);
    } catch {
      setHata('Bağlantı hatası. Lütfen tekrar deneyin.');
    } finally {
      setYukleniyor(false);
    }
  }

  /**
   * Adım 3: Kodu TEKRAR gönder (geri sayım bitince aktif). SMS operatör gecikmesiyle
   * hiç gelmemiş olabilir → vatandaş sayfayı yenilemeden yeni kod isteyebilsin;
   * başarıda 30 sn sayaç yeniden başlar.
   */
  async function koduTekrarGonder() {
    if (geriSayim > 0 || yukleniyor) return;
    setHata('');
    setYukleniyor(true);
    try {
      const { ad, soyad } = adSoyadAyir(adSoyad);
      const res = await fetch('/api/dogrulama/tc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad, soyad, telefon, turnstileToken, fingerprint, tur }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.adim === 'gonder_limit') setGonderLimiti(true); // sınır doldu → buton gizlenir
        setHata(data.hata || 'Kod tekrar gönderilemedi.');
        return;
      }
      setSmsKodu('');
      setGeriSayim(30); // sayaç yeniden başlasın
    } catch {
      setHata('Kod tekrar gönderilemedi. Lütfen tekrar deneyin.');
    } finally {
      setYukleniyor(false);
    }
  }

  // QR yoksa veya imza yoksa hata göster
  if (!qrId || !sig) {
    return (
      <div className="page-container">
        <div className="card">
          <div className="alert alert-error">
            <span>⚠️</span>
            <span>Geçersiz QR kodu. Lütfen sokağınızdaki QR kodu tekrar okutun.</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Sokak seçimi türetilen değerleri ---
  // okutulanSokak: QR'ın işaret ettiği sokak (koordinatı "en yakın" hesabının merkezi).
  const okutulanSokak = sokaklar.find((s) => s.id === qrId) || null;
  // Formda büyük gösterilecek ad: uydurma seçim varsa onun adı, yoksa seçili KONUM sokağının adı.
  const seciliKonumSokak = sokaklar.find((s) => s.id === seciliSokakId) || okutulanSokak;
  const gosterilenSokakAd = seciliSokakAdi || (seciliKonumSokak ? seciliKonumSokak.sokakAdi : '');
  // Okutulan QR'ın fiziksel levha numarası (tabela_no). Baskı/asım eşleştirmesi için köşede
  // küçük bir rozette gösterilir — hangi QR hangi sayfayı açıyor tek bakışta görülsün.
  // Vatandaş akışını bozmaz (küçük, soluk, köşede). Numarasız sokakta gizlenir.
  const levhaNo = okutulanSokak?.tabelaNo;

  // Her sokak ADI için okutulan noktaya EN YAKIN örneği (aynı ad birden çok QR noktasında
  // olabilir). Hem "en yakın 10" hem "numara komşusu gerçek mi" bunu kullanır.
  const adaGore = new Map(); // sokakAdi -> { id, sokakAdi, mesafe }
  if (okutulanSokak) {
    for (const s of sokaklar) {
      if (!Number.isFinite(s.enlem) || !Number.isFinite(s.boylam)) continue;
      const mesafe = mesafeMetre(okutulanSokak.enlem, okutulanSokak.boylam, s.enlem, s.boylam);
      const mevcut = adaGore.get(s.sokakAdi);
      if (!mevcut || mesafe < mevcut.mesafe) {
        adaGore.set(s.sokakAdi, { id: s.id, sokakAdi: s.sokakAdi, mesafe });
      }
    }
  }
  // En yakın 10 (gerçek satırlar).
  const enYakin10 = Array.from(adaGore.values())
    .sort((a, b) => a.mesafe - b.mesafe)
    .slice(0, EN_YAKIN_SOKAK_ADET)
    .map((x) => ({ ...x, gercek: true }));

  // Numaralı sokaklar grubu: okutulan sokak "NNNN. SOKAK" ise, AYRI ve tamamen artan sayı
  // sırasında bir blok olarak ±10 numara gösterilir (mesafeye bakılmaksızın, en yakın 10'la
  // ÇAKIŞABİLİR — kasıtlı: vatandaş tam numarayı biliyorsa ardışık listede taraması kolay
  // olsun diye, "en yakın" mesafe sırasına karışmaz). Taban (X000) DAHİL, altı HARİÇ.
  // Komşu sistemde varsa gerçek (koordinatlı) örneğiyle; yoksa "uydurma" (konum okutulan QR'da).
  const numaraGrubu = [];
  const numMatch = okutulanSokak && /^(\d+)\.\s*SOKAK$/.exec(okutulanSokak.sokakAdi.trim());
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    const taban = Math.floor(num / 1000) * 1000;
    for (let k = num - 10; k <= num + 10; k++) {
      if (k === num || k < taban) continue;
      const ad = `${k}. SOKAK`;
      const gercekRow = adaGore.get(ad); // en yakın gerçek örnek (varsa)
      numaraGrubu.push(
        gercekRow
          ? { ...gercekRow, gercek: true }
          : { id: null, sokakAdi: ad, mesafe: null, gercek: false, no: k }
      );
    }
  }
  const oneriler = [...enYakin10, ...numaraGrubu]; // öneriSeciliMi/anahtar hesapları için

  // "Sokağı değiştir" görünürlüğü.
  const sokakDegistirilebilir = okutulanSokak && oneriler.length > 1;

  // Bir önerinin şu an seçili olup olmadığı (vurgu için).
  function oneriSeciliMi(o) {
    return o.gercek ? (o.id === seciliSokakId && !seciliSokakAdi) : (o.sokakAdi === seciliSokakAdi);
  }
  // Öneri seçimi: gerçek satır → konumu o sokağa taşı; uydurma → konum okutulan QR'da kalır,
  // sadece bildirilecek ad değişir.
  function sokakOneriSec(o) {
    if (o.gercek) { setSeciliSokakId(o.id); setSeciliSokakAdi(null); }
    else { setSeciliSokakId(qrId); setSeciliSokakAdi(o.sokakAdi); }
    setKonumOnayAcik(false);   // modalı kapat (seçim yeterli; ayrı onay yok)
  }
  // Vatandaş listede olmayan bir sokağı ELLE yazdıysa: konum okutulan QR'da kalır, ad bu olur.
  function serbestSokakKullan() {
    const v = serbestSokakGirdi.trim();
    if (v.length < 2) return;
    setSeciliSokakId(qrId);
    setSeciliSokakAdi(v);
    setKonumOnayAcik(false);
  }

  /**
   * Bir öneri satırı (yakın / numaralı / tek QR arama sonucu).
   * Büyük dokunma alanı + seçili göstergesi için görünüm CSS'te (.sokak-secenek);
   * satır içi stil bırakılmadı ki iki farklı yerde iki farklı boyut oluşmasın.
   */
  function oneriButonu(o) {
    const secili = oneriSeciliMi(o);
    return (
      <button
        key={o.gercek ? o.id : 'u-' + o.sokakAdi}
        type="button"
        className="sokak-secenek"
        data-secili={secili ? 'true' : 'false'}
        aria-pressed={secili}
        onClick={() => sokakOneriSec(o)}
      >
        <span className="sokak-secenek-metin">
          {o.sokakAdi}
          {o.gercek && o.id === qrId && (
            <span className="sokak-secenek-not">Okuttuğunuz QR bu sokakta</span>
          )}
          {!o.gercek && (
            <span className="sokak-secenek-not">Listede kayıtlı değil — adı böyle iletilir</span>
          )}
        </span>
        <span className="sokak-secenek-tik" aria-hidden="true">✓</span>
      </button>
    );
  }

  /** Özet adımı için tek bir satır: etiket + değer + "Değiştir" (ilgili adıma atlar). */
  function ozetSatiri(etiket, deger, onDegistir) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '14px 16px', borderRadius: 12,
        background: 'var(--surface-2, rgba(255,255,255,.05))',
        border: '1px solid var(--border-subtle, rgba(255,255,255,.1))',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{etiket}</div>
          <div style={{ fontSize: 16, fontWeight: 600, wordBreak: 'break-word' }}>{deger}</div>
        </div>
        <button
          type="button"
          onClick={onDegistir}
          style={{ background: 'none', border: 'none', color: 'var(--accent, #6ea8fe)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0, flexShrink: 0 }}
        >
          Değiştir
        </button>
      </div>
    );
  }

  /** Özetteki konu satırının değeri. */
  function konuOzetDegeri() {
    const k = SikayetKategorileri.find((x) => x.id === kategori);
    return k ? `${k.ikon} ${k.etiket}` : '—';
  }

  /** İlk alt adımda "Geri" gidilecek bir yer yoktur. */
  const geriButonuGorunur = altAdim > ilkAltAdim;

  return (
    <div className="page-container">
      {/* Levha numarası rozeti (yalnız numaralı QR'da). Sabit köşe konumu → sayfa akışını
          bozmaz; baskı sonrası "bu QR hangi sokağın levhası?" eşleştirmesini kolaylaştırır.
          z-index modal (1000) altında kalır ki sokak-değiştir penceresini örtmesin. */}
      {levhaNo && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', top: 8, left: 8, zIndex: 50,
            padding: '3px 9px', borderRadius: 'var(--radius-sm, 8px)',
            fontSize: 11, fontWeight: 700, letterSpacing: '.4px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'var(--text-muted, #64748b)',
            background: 'var(--bg-input, rgba(255,255,255,.05))',
            border: '1px solid var(--border-subtle, rgba(255,255,255,.08))',
            opacity: 0.75, userSelect: 'text',
          }}
        >
          Levha #{levhaNo}
        </div>
      )}
      <div className="card">
        {/* Adım göstergesi — ÜST adım makinesi (1=sihirbaz, 2=kimlik, 3=SMS). */}
        <div className="steps">
          <div className={`step-dot ${getStepClass(1)}`} />
          <div className={`step-dot ${getStepClass(2)}`} />
          <div className={`step-dot ${getStepClass(3)}`} />
        </div>

        {/* Hata mesajı */}
        {hata && (
          <div className="alert alert-error">
            <span>⚠️</span>
            <span>{hata}</span>
          </div>
        )}

        {/* ========= ADIM 1: Şikayet sihirbazı =========
            Vatandaş tek seferde TEK karar verir; ekranın dışına basınca kapanmaz (bu kart
            içeriğidir, overlay değil) → yanlışlıkla akış bozulmaz. */}
        {adim === 1 && (
          <form onSubmit={basvuruyuOnayla}>
            {/* Alt-adım ilerleme çubuğu */}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 24 }}>
              {adimlar.map((ad, i) => (
                <div key={ad} style={{
                  height: 6, flex: 1, maxWidth: 48, borderRadius: 999,
                  background: i + 1 <= altAdim ? 'var(--accent-blue, #38bdf8)' : 'var(--border-subtle, rgba(255,255,255,.12))',
                  transition: 'background .3s ease',
                }} />
              ))}
            </div>

            {/* --- KONU (kategori) --- */}
            {aktifAdim === 'kategori' && (
              <>
                <div className="card-header" style={{ marginBottom: 22 }}>
                  <h1 className="gradient-text" style={{ fontSize: 26 }}>Ne şikayet edeceksiniz?</h1>
                  <p style={{ color: 'var(--text-primary)' }}>Konuya en yakın olana dokunun</p>
                </div>
                <div className="kategori-grid">
                  {SikayetKategorileri.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className={`kategori-btn ${kategori === k.id ? 'selected' : ''}`}
                      style={{ padding: '22px 8px' }}
                      onClick={() => { setKategori(k.id); ileri(); }}
                    >
                      <span className="kategori-ikon" style={{ fontSize: 34 }}>{k.ikon}</span>
                      <span className="kategori-etiket" style={{ fontSize: 15, fontWeight: 600 }}>{k.etiket}</span>
                    </button>
                  ))}
                </div>
                {geriButonuGorunur && (
                  <button type="button" className="btn-back" onClick={geriGit}>← Geri</button>
                )}
              </>
            )}

            {/* --- KONUM --- */}
            {aktifAdim === 'konum' && (
              <>
                <div className="card-header" style={{ marginBottom: 22 }}>
                  <h1 className="gradient-text" style={{ fontSize: 26 }}>Konumunuz doğru mu?</h1>
                  <p style={{ color: 'var(--text-primary)' }}>
                    Şikayetiniz bu sokakta kaydedilecek
                  </p>
                </div>
                <div style={{
                  textAlign: 'center', fontSize: 22, fontWeight: 800, padding: '22px 14px',
                  borderRadius: 16, background: 'var(--surface-2, rgba(255,255,255,.05))',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,.12))', marginBottom: 22,
                }}>
                  📍 {gosterilenSokakAd || 'Okuttuğunuz QR konumu'}
                </div>
                <button type="button" className="btn btn-primary" onClick={ileri}>
                  ✓ Evet, doğru — Devam Et
                </button>
                {sokakDegistirilebilir && (
                  <button
                    type="button"
                    onClick={() => setKonumOnayAcik(true)}
                    style={IKINCIL_BUTON_STIL}
                  >
                    Sokağı değiştir
                  </button>
                )}
                {geriButonuGorunur && (
                  <button type="button" className="btn-back" onClick={geriGit}>← Geri</button>
                )}
              </>
            )}

            {/* --- AÇIKLAMA (opsiyonel) --- */}
            {aktifAdim === 'aciklama' && (
              <>
                <div className="card-header" style={{ marginBottom: 22 }}>
                  <h1 className="gradient-text" style={{ fontSize: 26 }}>Kısaca ne oldu?</h1>
                  <p style={{ color: 'var(--text-primary)' }}>
                    İsterseniz yazın, istemezseniz boş geçin
                  </p>
                </div>
                <textarea
                  className="form-input form-textarea"
                  placeholder="Örn: 3 gündür çöp toplanmadı, kötü koku var."
                  value={aciklama}
                  onChange={(e) => setAciklama(e.target.value)}
                  maxLength={280}
                  autoFocus
                  style={{ minHeight: 140, fontSize: 16 }}
                />
                <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', marginTop: 4, marginBottom: 20 }}>
                  {aciklama.length}/280
                </div>
                <button type="button" className="btn btn-primary" onClick={ileri}>
                  {aciklama.trim() ? 'Devam Et →' : 'Açıklama eklemeden geç →'}
                </button>
                {geriButonuGorunur && (
                  <button type="button" className="btn-back" onClick={geriGit}>← Geri</button>
                )}
              </>
            )}

            {/* --- FOTOĞRAF (opsiyonel) --- */}
            {aktifAdim === 'foto' && (
              <>
                <div className="card-header" style={{ marginBottom: 22 }}>
                  <h1 className="gradient-text" style={{ fontSize: 26 }}>Fotoğraf ekleyelim mi?</h1>
                  <p style={{ color: 'var(--text-primary)' }}>Göstermek işi hızlandırır (isteğe bağlı)</p>
                </div>
                {!fotoOnizleme ? (
                  <label
                    htmlFor="foto"
                    className="form-input"
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 10, cursor: 'pointer', textAlign: 'center', color: 'var(--text-primary)',
                      borderStyle: 'dashed', minHeight: 150,
                    }}
                  >
                    <span style={{ fontSize: 42 }}>📷</span>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>Fotoğraf Çek / Seç</span>
                    <input id="foto" type="file" accept="image/*" capture="environment" onChange={fotoSec} style={{ display: 'none' }} />
                  </label>
                ) : (
                  <div style={{ position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fotoOnizleme}
                      alt="Şikayet fotoğrafı önizleme"
                      style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 12, display: 'block' }}
                    />
                    <button
                      type="button"
                      onClick={fotoKaldir}
                      aria-label="Fotoğrafı kaldır"
                      style={{
                        position: 'absolute', top: 8, right: 8, width: 34, height: 34,
                        borderRadius: '50%', border: 'none', cursor: 'pointer',
                        background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 16, lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                <button type="button" className="btn btn-primary" style={{ marginTop: 20 }} onClick={ileri}>
                  {fotoOnizleme ? 'Devam Et →' : 'Fotoğrafsız devam et →'}
                </button>
                {geriButonuGorunur && (
                  <button type="button" className="btn-back" onClick={geriGit}>← Geri</button>
                )}
              </>
            )}

            {/* --- ÖZET --- */}
            {aktifAdim === 'ozet' && (
              <>
                <div className="card-header" style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
                  <h1 className="gradient-text" style={{ fontSize: 26 }}>
                    Şikayetinizi kontrol edin
                  </h1>
                  <p style={{ color: 'var(--text-primary)' }}>Doğruysa gönderelim; değilse &quot;Değiştir&quot; deyin</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {ozetSatiri('Şikayet konusu', konuOzetDegeri(), () => adimaGit('kategori'))}
                  {okutulanSokak && ozetSatiri(
                    'Konum',
                    `📍 ${gosterilenSokakAd}`,
                    () => adimaGit('konum')
                  )}
                  {ozetSatiri(
                    'Kısaca ne oldu?',
                    aciklama.trim() || '— (eklenmedi)',
                    () => adimaGit('aciklama')
                  )}
                  {(
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      padding: '14px 16px', borderRadius: 12,
                      background: 'var(--surface-2, rgba(255,255,255,.05))',
                      border: '1px solid var(--border-subtle, rgba(255,255,255,.1))',
                    }}>
                      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Fotoğraf</div>
                          <div style={{ fontSize: 16, fontWeight: 600 }}>{fotoOnizleme ? 'Eklendi' : '— (eklenmedi)'}</div>
                        </div>
                        {fotoOnizleme && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={fotoOnizleme} alt="önizleme" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => adimaGit('foto')}
                        style={{ background: 'none', border: 'none', color: 'var(--accent, #6ea8fe)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0, flexShrink: 0 }}
                      >
                        Değiştir
                      </button>
                    </div>
                  )}
                </div>
                <button className="btn btn-primary" type="submit">
                  Onayla ve Devam Et →
                </button>
                {geriButonuGorunur && (
                  <button type="button" className="btn-back" onClick={geriGit}>← Geri</button>
                )}
                <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-primary)', marginTop: 16 }}>
                  Bir sonraki adımda kimlik doğrulama yapılacaktır.
                </p>
              </>
            )}
          </form>
        )}

        {/* ========= ADIM 2: Kimlik Doğrulama ========= */}
        {adim === 2 && (
          <form onSubmit={tcDogrulaVeSmsGonder}>
            <div className="card-header">
              <div style={{ fontSize: 40, marginBottom: 8 }}>🛡️</div>
              <h1 className="gradient-text">Kimlik Doğrulama</h1>
              <p>Spam önlemi için kimlik bilgilerinizi girin</p>
            </div>

            <div className="form-group">
              <label htmlFor="adSoyad" className="form-label">Ad Soyad</label>
              <input
                id="adSoyad"
                className="form-input"
                type="text"
                placeholder="Adınız ve soyadınız"
                value={adSoyad}
                onChange={(e) => setAdSoyad(e.target.value)}
                autoComplete="name"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="telefon" className="form-label">Telefon</label>
              <input
                id="telefon"
                className="form-input"
                type="tel"
                placeholder="05XX XXX XX XX"
                value={telefon}
                onChange={(e) => setTelefon(e.target.value)}
                required
              />
            </div>

            {/*
              KVKK onayları — İKİ AYRI KUTU (v13), ikisi de zorunlu. Ayrılma gerekçesi
              yukarıda (state tanımında) açıklanmıştır. İkisini tek kutuda birleştirmeye
              GERİ DÖNME: yurt dışı aktarımın hukuki dayanağı bu ikinci kutudur.
            */}
            <div className="form-group" style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <input
                  type="checkbox"
                  checked={aydinlatmaOkundu}
                  onChange={(e) => setAydinlatmaOkundu(e.target.checked)}
                  style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0, cursor: 'pointer' }}
                />
                <span>
                  <a href="/kvkk" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>
                    Aydınlatma Metni
                  </a>
                  {'’ni okudum.'}
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <input
                  type="checkbox"
                  checked={kvkkOnay}
                  onChange={(e) => setKvkkOnay(e.target.checked)}
                  style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0, cursor: 'pointer' }}
                />
                <span>
                  Başvurumun işlenebilmesi için verilerimin, Aydınlatma Metni&rsquo;nde açıklandığı
                  şekilde <strong>yurt dışına aktarılmasına açık rıza veriyorum.</strong>
                </span>
              </label>
            </div>

            {/* Bot kapısı: Cloudflare Turnstile (SMS üretilmeden önceki tek kapı). */}
            <TurnstileWidget
              key={turnstileNonce}
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setTurnstileToken}
            />

            <button
              className="btn btn-primary"
              type="submit"
              disabled={yukleniyor || !aydinlatmaOkundu || !kvkkOnay || (Boolean(TURNSTILE_SITE_KEY) && !turnstileToken)}
            >
              {yukleniyor ? <span className="spinner" /> : 'Doğrula ve Kod Gönder'}
            </button>

            <button
              type="button"
              className="btn-back"
              onClick={() => { setAdim(1); setAltAdim(adimlar.length); setHata(''); }}
            >
              ← Geri Dön
            </button>
          </form>
        )}

        {/* ========= ADIM 3: Kod Doğrulama → Otomatik Kayıt ========= */}
        {adim === 3 && (
          <form onSubmit={smsDogrulaVeKaydet}>
            <div className="card-header">
              <div style={{ fontSize: 40, marginBottom: 8 }}>📱</div>
              <h1 className="gradient-text">SMS Doğrulama</h1>
              <p>Telefonunuza gelen 6 haneli kodu girin</p>
            </div>

            <div className="alert alert-info">
              <span>📱</span>
              <span><strong>{telefon}</strong> numarasına doğrulama kodu gönderildi.</span>
            </div>

            <div className="form-group">
              <label htmlFor="smsKodu" className="form-label">Doğrulama Kodu</label>
              <input
                id="smsKodu"
                className="form-input sms-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="• • • • • •"
                value={smsKodu}
                onChange={(e) => setSmsKodu(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
              />
            </div>

            <button className="btn btn-primary" type="submit" disabled={yukleniyor || smsKodu.length !== 6}>
              {yukleniyor ? <span className="spinner" /> : 'Doğrula ve Şikayeti Gönder'}
            </button>

            {/* Kod gelmedi mi? 30 sn geri sayım sonrası tekrar gönder. Sayaç dolana
                kadar kaç saniye kaldığı yazar; dolunca tıklanabilir bağlantı olur. */}
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 14, color: 'var(--text-muted)' }}>
              {gonderLimiti ? (
                <span>Şu anda işleminizi gerçekleştiremiyoruz. Lütfen bir süre sonra tekrar deneyin.</span>
              ) : geriSayim > 0 ? (
                <span>Kod gelmediyse <strong>{geriSayim} sn</strong> sonra tekrar gönderebilirsiniz</span>
              ) : (
                <button
                  type="button"
                  onClick={koduTekrarGonder}
                  disabled={yukleniyor}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--primary, #3b82f6)', fontWeight: 700, fontSize: 14,
                    textDecoration: 'underline',
                  }}
                >
                  Kodu tekrar gönder
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn-back"
              onClick={() => { setAdim(2); setHata(''); setSmsKodu(''); setGeriSayim(0); }}
            >
              ← Geri Dön
            </button>
          </form>
        )}

        {/* ========= ADIM 4: Başarı ========= */}
        {adim === 4 && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div className="success-icon">✓</div>
            <h1 className="gradient-text" style={{ fontSize: 30, marginBottom: 14 }}>
              Şikayetiniz Alındı!
            </h1>
            <p style={{ color: '#ffffff', lineHeight: 1.7, fontSize: 18 }}>
              Şikayetiniz başarıyla iletildi.{' '}
              {belediyeAdi ? `${belediyeAdi} ekipleri` : 'Belediye ekiplerimiz'} en kısa sürede ilgilenecektir.
            </p>

            {/* Başkan imzası (tenant'ta başkan adı girilmişse) */}
            {baskanAdi && (
              <div
                style={{
                  marginTop: 24,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border, rgba(0,0,0,.1))',
                }}
              >
                <p style={{ fontWeight: 600, color: '#ffffff', fontSize: 18 }}>
                  {baskanAdi}
                </p>
                <p style={{ color: '#ffffff', fontSize: 15, marginTop: 2 }}>
                  Belediye Başkanı
                </p>
              </div>
            )}

            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 20 }}>
              Teşekkür ederiz 🙏
            </p>
          </div>
        )}
      </div>

      {/* ========= Sokak Seçim Modalı ========= */}
      {/* Konum adımındaki "Sokağı değiştir" ile açılır: en yakın sokaklar +
          (numaralıysa) ±10 komşu + elle yaz. */}
      {konumOnayAcik && okutulanSokak && (
        <div
          className="sokak-sheet-overlay"
          onClick={() => setKonumOnayAcik(false)}
        >
          {/* Sheet'e tıklama dışarıya sızmamalı; yoksa liste seçerken pencere kapanır. */}
          <div
            className="sokak-sheet"
            data-platform={platform}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sokak-sheet-baslik"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sokak-sheet-tutamac" aria-hidden="true" />

            <div className="sokak-sheet-header">
              <div className="sokak-sheet-ust">
                <h2 id="sokak-sheet-baslik" className="sokak-sheet-baslik">Sokağınızı seçin</h2>
                <button
                  type="button"
                  className="sokak-sheet-kapat"
                  onClick={() => setKonumOnayAcik(false)}
                  aria-label="Kapat"
                >
                  {platform === 'ios' ? 'İptal' : '✕'}
                </button>
                {/* iOS düzeninde başlığı gerçekten ortalamak için sağda eşit boşluk. */}
                <span className="sokak-sheet-denge" aria-hidden="true" />
              </div>
            </div>

            <div className="sokak-sheet-liste">
              {/* Grup 1: mesafeye göre en yakın sokaklar. */}
              {enYakin10.length > 0 && (
                <>
                  <div className="sokak-sheet-grup">Yakınınızdaki sokaklar</div>
                  {enYakin10.map(oneriButonu)}
                </>
              )}
              {/* Grup 2: sayısal sokaksa ±10 numara ardışık blok. */}
              {numaraGrubu.length > 0 && (
                <>
                  <div className="sokak-sheet-grup">Numaralı sokaklar</div>
                  {numaraGrubu.map(oneriButonu)}
                </>
              )}
            </div>

            {/* Sokak listede yoksa: elle yaz. Konum okutulan QR'da kalır, ad bu olur.
                Sabit alt bölümde durur — uzun listede aşağı inmeye gerek kalmaz. */}
            <div className="sokak-sheet-alt">
              <span className="sokak-sheet-alt-etiket">Sokağınız listede yok mu? Elle yazın:</span>
              <div className="sokak-sheet-alt-satir">
                <input
                  type="text"
                  value={serbestSokakGirdi}
                  onChange={(e) => setSerbestSokakGirdi(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); serbestSokakKullan(); } }}
                  placeholder="Sokak / cadde adı"
                  maxLength={120}
                  className="sokak-sheet-alt-giris"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="sokak-sheet-alt-buton"
                  onClick={serbestSokakKullan}
                  disabled={serbestSokakGirdi.trim().length < 2}
                >
                  Kullan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
