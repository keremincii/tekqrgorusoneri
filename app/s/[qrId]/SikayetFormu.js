'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VARSAYILAN_TUR, FotografSabitleri } from '@/lib/utils/constants';
import { cihazParmakIziAl } from './cihazParmakIzi';
import * as api from './basvuruIstemcisi';
import BasvuruAdimi from './adimlar/BasvuruAdimi';
import FotografAdimi from './adimlar/FotografAdimi';
import KimlikAdimi from './adimlar/KimlikAdimi';
import KodAdimi from './adimlar/KodAdimi';
import BasariAdimi from './adimlar/BasariAdimi';

/**
 * Cloudflare Turnstile site anahtarı (bot kapısı). Build zamanında inline edilir.
 * Boşsa (geliştirme) widget gösterilmez ve backend doğrulamayı atlar.
 */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

/**
 * SİHİRBAZ ADIMLARI — sıra ANLAMLIDIR ve TEK OTORİTE burasıdır.
 * İlerleme çubuğu, "Geri" ve adım geçişleri hep bu diziden indekslenir; kodun hiçbir
 * yerinde çıplak adım numarası (`adim === 3`) yoktur. Araya bir adım eklemek yalnız
 * bu diziyi ve ilgili `case`'i değiştirmeyi gerektirir.
 */
const ADIMLAR = Object.freeze(['basvuru', 'foto', 'kimlik', 'kod', 'basari']);

/** "Kodu tekrar gönder" kilidinin süresi (saniye). */
const TEKRAR_GONDER_KILIDI_SN = 30;

/**
 * QR Okutma Sayfası — Vatandaş Başvuru Sihirbazı
 * ===============================================
 *
 * AKIŞ (tek merkezî QR ürünü):
 *   1. basvuru → tür (şikayet/görüş/öneri) + metin
 *   2. foto    → isteğe bağlı fotoğraf
 *   3. kimlik  → ad soyad + telefon + KVKK onayları + bot kapısı → SMS kodu gönderilir
 *   4. kod     → SMS kodu doğrulanır ve başvuru OTOMATİK kaydedilir
 *   5. basari  → teşekkür ekranı
 *
 * VATANDAŞA SORULMAYANLAR ve NEDENLERİ:
 *   - KATEGORİ: yazdığı cümle konuyu zaten söylüyor. Sınıflandırmayı vatandaşa
 *     yaptırmak fazladan bir ekran ve yanlış seçime davetti; iş dağıtımı zaten
 *     yönetimin kararı (otomatik dağıtım yok).
 *   - KONUM/SOKAK: tek bir merkezî QR var. "Hangi sokak?" sorusunun bu üründe cevabı
 *     tek ve sabit; sormak vatandaşı boş yere karar vermeye zorlardı.
 *
 * DEFENSE IN DEPTH: Başvuru sunucuya YALNIZCA SMS doğrulandıktan sonra gönderilir.
 * Tür whitelist'i, metin kuralları ve HMAC imza kontrolü sunucuda TEKRAR uygulanır —
 * bu dosyadaki hiçbir kontrol güvenlik sınırı değildir.
 */
export default function SikayetFormu() {
  const params = useParams();
  const searchParams = useSearchParams();
  const qrId = params.qrId;
  const sig = searchParams.get('sig');

  // --- Sihirbaz konumu ---
  const [adim, setAdim] = useState('basvuru');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState('');

  // --- Başvuru içeriği (sunucuya yalnız doğrulama sonrası gider) ---
  const [tur, setTur] = useState(VARSAYILAN_TUR);
  const [metin, setMetin] = useState('');
  const [foto, setFoto] = useState(null);
  const [fotoOnizleme, setFotoOnizleme] = useState('');

  // --- Kimlik ---
  // Tek alan: "Ad Soyad". Vatandaş iki ayrı kutuya tıklamasın diye birleşik alınır;
  // sunucuya gönderilirken adSoyadAyir() ile ad/soyad'a bölünür (API sözleşmesi aynı).
  const [adSoyad, setAdSoyad] = useState('');
  const [telefon, setTelefon] = useState('');
  const [kod, setKod] = useState('');
  const [aydinlatmaOkundu, setAydinlatmaOkundu] = useState(false);
  const [kvkkOnay, setKvkkOnay] = useState(false);

  // --- Bot kapısı / cihaz parmak izi ---
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileNonce, setTurnstileNonce] = useState(0); // widget'ı tazeler (token tek kullanımlık)
  const [fingerprint, setFingerprint] = useState('');

  // --- SMS tekrar gönderme ---
  const [geriSayim, setGeriSayim] = useState(0);
  const [gonderLimiti, setGonderLimiti] = useState(false);

  // --- Başarı ekranı bilgileri (tenant'a özel; kişisel veri değil) ---
  const [belediyeAdi, setBelediyeAdi] = useState('');
  const [baskanAdi, setBaskanAdi] = useState('');

  /**
   * Object URL'i temizlemek için son değerin aynası. Temizlik effect'i state'e
   * bağımlı OLMAMALI: [fotoOnizleme] bağımlılığıyla yazılsaydı, her yeni fotoğraf
   * seçiminde önceki URL iki kez (hem fotoSec içinde hem effect temizliğinde) iptal
   * edilir; ref ile yalnız BİLEŞEN SÖKÜLÜRKEN bir kez iptal edilir.
   */
  const onizlemeRef = useRef('');
  useEffect(() => {
    onizlemeRef.current = fotoOnizleme;
  }, [fotoOnizleme]);
  useEffect(() => () => {
    if (onizlemeRef.current) URL.revokeObjectURL(onizlemeRef.current);
  }, []);

  // Cihaz parmak izini arka planda hesapla (kullanıcıyı bekletmez). Yüklenemezse boş
  // kalır — backend parmak izsiz devam eder (IP + telefon katmanları korur).
  useEffect(() => {
    let iptal = false;
    cihazParmakIziAl().then((fp) => { if (!iptal) setFingerprint(fp); });
    return () => { iptal = true; };
  }, []);

  // SMS "tekrar gönder" geri sayımı.
  useEffect(() => {
    if (geriSayim <= 0) return;
    const t = setTimeout(() => setGeriSayim((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [geriSayim]);

  // ===================== Gezinme =====================

  const adimIndeksi = ADIMLAR.indexOf(adim);

  /** Adı verilen adıma geçer ve önceki hata mesajını temizler. */
  function adimaGit(hedef) {
    setHata('');
    setAdim(hedef);
  }

  /** Bir önceki adıma döner (ilk adımda etkisizdir). */
  function geriGit() {
    if (adimIndeksi <= 0) return;
    adimaGit(ADIMLAR[adimIndeksi - 1]);
  }

  // ===================== Fotoğraf =====================

  const MAX_FOTO_BYTE = FotografSabitleri.MAX_BOYUT_BYTE;

  /** Fotoğraf seçimi. Ön kontrol yalnız hızlı geri bildirim içindir (asıl kapı sunucuda). */
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

  // ===================== Kimlik / doğrulama =====================

  /**
   * "Ad Soyad" tek alanını sunucunun beklediği ad/soyad çiftine böler.
   * SON kelime soyad, kalanı addır: "Ali Can Öztürk" → ad "Ali Can", soyad "Öztürk".
   * Tek kelime girilmişse soyad boş döner → çağıran uyarı gösterir.
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

  /** Adım "basvuru" → "foto": metin zorunlu (kategori yok, içerik metindir). */
  function basvuruyuOnayla() {
    if (!metin.trim()) {
      setHata('Lütfen iletmek istediğinizi yazın.');
      return;
    }
    adimaGit('foto');
  }

  /** Adım "kimlik": bilgileri doğrula ve SMS kodu gönder. */
  async function kimlikGonder(e) {
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
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setHata('Lütfen "Ben robot değilim" doğrulamasını tamamlayın.');
      return;
    }
    // Soyadsız girişte sunucuya gitmeden uyar (sunucu "Ad, Soyad ve Telefon zorunludur"
    // derdi — burada daha anlaşılır).
    const { ad, soyad } = adSoyadAyir(adSoyad);
    if (!ad || !soyad) {
      setHata('Lütfen adınızı ve soyadınızı birlikte yazın.');
      return;
    }

    setYukleniyor(true);
    try {
      // ÖN-KONTROL (SMS'ten ÖNCE): limit/kara liste. Limit zaten dolmuşsa SMS hiç
      // üretilmez → Netgsm kredisi boşa yanmaz ve vatandaş "kod bekle, sonra reddedil"
      // yaşamaz. Ulaşılamazsa akış bozulmaz (nihai kapı /api/sikayet).
      const on = await api.onKontrolYap(telefon);
      if (!on.izin) {
        // Turnstile token'ı HARCANMADI (kod ucuna hiç gitmedik) → geçerli kalır.
        setHata(on.hata || 'Şu anda başvurunuzu alamıyoruz.');
        return;
      }

      const sonuc = await api.kodGonder({ ad, soyad, telefon, turnstileToken, fingerprint });
      if (!sonuc.basarili) {
        setHata(sonuc.hata);
        turnstileTazele(); // token tükendi → yeni challenge
        return;
      }

      adimaGit('kod');
      setGeriSayim(TEKRAR_GONDER_KILIDI_SN);
    } finally {
      setYukleniyor(false);
    }
  }

  /** Adım "kod": kodu doğrula → (varsa) fotoğrafı yükle → başvuruyu kaydet. */
  async function koduDogrulaVeGonder(e) {
    e.preventDefault();
    setHata('');
    setYukleniyor(true);

    try {
      const dogrulama = await api.kodDogrula({ telefon, kod });
      if (!dogrulama.basarili) {
        setHata(dogrulama.hata);
        return;
      }

      // Fotoğraf OPSİYONELDİR: yükleme başarısız olsa bile başvuru gönderilir
      // (istemci `null` alır ve devam eder — vatandaş mağdur olmasın).
      const fotografKey = await api.fotografYukle({
        dosya: foto,
        qrId,
        sig,
        dogrulamaToken: dogrulama.dogrulamaToken,
      });

      const sonuc = await api.basvuruGonder({
        qrId,
        sig,
        dogrulamaToken: dogrulama.dogrulamaToken,
        tur,
        aciklama: metin,
        fotografKey,
      });

      if (!sonuc.basarili) {
        setHata(sonuc.hata);
        return;
      }

      setBelediyeAdi(sonuc.belediyeAdi);
      setBaskanAdi(sonuc.baskanAdi);
      adimaGit('basari');
    } finally {
      setYukleniyor(false);
    }
  }

  /** Adım "kod": kodu TEKRAR gönder (geri sayım bitince aktif). */
  async function koduTekrarGonder() {
    if (geriSayim > 0 || yukleniyor) return;
    setHata('');
    setYukleniyor(true);
    try {
      const { ad, soyad } = adSoyadAyir(adSoyad);
      const sonuc = await api.kodGonder({ ad, soyad, telefon, turnstileToken, fingerprint });
      if (!sonuc.basarili) {
        if (sonuc.adim === 'gonder_limit') setGonderLimiti(true); // sınır doldu → buton gizlenir
        setHata(sonuc.hata);
        return;
      }
      setKod('');
      setGeriSayim(TEKRAR_GONDER_KILIDI_SN);
    } finally {
      setYukleniyor(false);
    }
  }

  // ===================== Görünüm =====================

  // QR kimliği ya da imza yoksa form hiç açılmaz (elle uydurulmuş adres).
  if (!qrId || !sig) {
    return (
      <div className="page-container">
        <div className="card">
          <div className="alert alert-error">
            <span aria-hidden="true">⚠️</span>
            <span>Geçersiz QR kodu. Lütfen QR kodu tekrar okutun.</span>
          </div>
        </div>
      </div>
    );
  }

  // Başarı ekranında ilerleme çubuğu gösterilmez (iş bitti).
  const ilerlemeGorunur = adim !== 'basari';

  return (
    <div className="page-container">
      <div className="card">
        {ilerlemeGorunur && (
          <div className="ilerleme" role="progressbar" aria-valuemin={1} aria-valuemax={ADIMLAR.length - 1} aria-valuenow={adimIndeksi + 1}>
            {ADIMLAR.slice(0, -1).map((ad, i) => (
              <span key={ad} className={`ilerleme-parca${i <= adimIndeksi ? ' dolu' : ''}`} />
            ))}
          </div>
        )}

        {/* Hata mesajı — tüm adımlar için tek yer. `aria-live` ile ekran okuyucu da duyurur. */}
        {hata && (
          <div className="alert alert-error" role="alert" aria-live="assertive">
            <span aria-hidden="true">⚠️</span>
            <span>{hata}</span>
          </div>
        )}

        {adim === 'basvuru' && (
          <BasvuruAdimi
            tur={tur}
            onTur={setTur}
            metin={metin}
            onMetin={setMetin}
            onDevam={basvuruyuOnayla}
          />
        )}

        {adim === 'foto' && (
          <FotografAdimi
            onizleme={fotoOnizleme}
            onSec={fotoSec}
            onKaldir={fotoKaldir}
            onDevam={() => adimaGit('kimlik')}
            onGeri={geriGit}
            maxByte={MAX_FOTO_BYTE}
          />
        )}

        {adim === 'kimlik' && (
          <KimlikAdimi
            adSoyad={adSoyad}
            onAdSoyad={setAdSoyad}
            telefon={telefon}
            onTelefon={setTelefon}
            aydinlatmaOkundu={aydinlatmaOkundu}
            onAydinlatma={setAydinlatmaOkundu}
            kvkkOnay={kvkkOnay}
            onKvkkOnay={setKvkkOnay}
            turnstileSiteKey={TURNSTILE_SITE_KEY}
            turnstileNonce={turnstileNonce}
            turnstileToken={turnstileToken}
            onTurnstileToken={setTurnstileToken}
            yukleniyor={yukleniyor}
            onGonder={kimlikGonder}
            onGeri={geriGit}
          />
        )}

        {adim === 'kod' && (
          <KodAdimi
            telefon={telefon}
            kod={kod}
            onKod={setKod}
            yukleniyor={yukleniyor}
            onDogrula={koduDogrulaVeGonder}
            geriSayim={geriSayim}
            gonderLimiti={gonderLimiti}
            onTekrarGonder={koduTekrarGonder}
            onGeri={() => { setKod(''); setGeriSayim(0); adimaGit('kimlik'); }}
          />
        )}

        {adim === 'basari' && (
          <BasariAdimi tur={tur} belediyeAdi={belediyeAdi} baskanAdi={baskanAdi} />
        )}
      </div>
    </div>
  );
}
