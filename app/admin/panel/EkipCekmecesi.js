'use client';

import { useState } from 'react';
import { PersonelRolleri } from '@/lib/utils/constants';

/** Rol id → panelde gösterilen etiket. */
const ROL_ETIKET = Object.freeze({
  [PersonelRolleri.BASKAN]: 'Başkan',
  [PersonelRolleri.BASKAN_YARDIMCISI]: 'Başkan Yrd.',
  [PersonelRolleri.PERSONEL]: 'Saha',
});

/** Tek bir kişi satırı: ad, Telegram durumu, bağlantı linki, kaldır. */
function KisiSatiri({ kisi, etiket, onSil, onLink }) {
  return (
    <div className="ekip-satir">
      <div className="ekip-satir-bilgi">
        <span className="ekip-ad">
          {kisi.ad} {kisi.soyad}
          {etiket && <span className="ekip-rol">{etiket}</span>}
        </span>
        <span className={`ekip-tg${kisi.telegramBagli ? ' bagli' : ''}`}>
          {kisi.telegramBagli ? '✓ Telegram bağlı' : '○ Telegram bağlı değil'}
        </span>
      </div>
      <div className="ekip-satir-aksiyon">
        <button type="button" onClick={() => onLink(kisi.id)} title="Telegram bağlantı linki oluştur">🔗</button>
        <button type="button" className="sil" onClick={() => onSil(kisi.id)} title="Kaldır">✕</button>
      </div>
    </div>
  );
}

/** Kişi ekleme formu. `rolSecici` açıksa başkan/yardımcı seçilebilir. */
function KisiEkleFormu({ onEkle, rolSecici = false, butonMetni = '+ Ekle' }) {
  const [ad, setAd] = useState('');
  const [soyad, setSoyad] = useState('');
  const [telefon, setTelefon] = useState('');
  const [rol, setRol] = useState(PersonelRolleri.BASKAN);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);

  async function gonder(e) {
    e.preventDefault();
    setHata('');
    setYukleniyor(true);
    const sonuc = await onEkle(ad.trim(), soyad.trim(), telefon.trim(), rolSecici ? { rol } : {});
    setYukleniyor(false);
    if (sonuc.ok) { setAd(''); setSoyad(''); setTelefon(''); }
    else setHata(sonuc.hata || 'Eklenemedi.');
  }

  return (
    <form onSubmit={gonder} className="ekip-form">
      <div className="ekip-form-satir">
        <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Ad" aria-label="Ad" />
        <input value={soyad} onChange={(e) => setSoyad(e.target.value)} placeholder="Soyad" aria-label="Soyad" />
      </div>
      <input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="Telefon (isteğe bağlı)" aria-label="Telefon" />
      {rolSecici && (
        <select value={rol} onChange={(e) => setRol(e.target.value)} aria-label="Rol">
          <option value={PersonelRolleri.BASKAN}>Başkan</option>
          <option value={PersonelRolleri.BASKAN_YARDIMCISI}>Başkan Yardımcısı</option>
        </select>
      )}
      <button type="submit" disabled={yukleniyor}>{yukleniyor ? 'Ekleniyor…' : butonMetni}</button>
      {hata && <p className="ekip-hata">{hata}</p>}
    </form>
  );
}

/**
 * EkipCekmecesi — Saha ekibi ve birim yönetimi (yan çekmece)
 * ===========================================================
 *
 * Panelin ASIL işi başvuruları okutmaktır; ekip yönetimi ara sıra yapılan bir bakım
 * işidir. Bu yüzden ekranın kalıcı bir sütununu değil, gerektiğinde açılan bir
 * çekmeceyi kaplar — okuma alanı daralmaz.
 *
 * BİRİMLER YALNIZCA GRUPLAMADIR: eskiden her birim bir kategori kümesini kapsıyor ve
 * o kategorinin şikayeti otomatik olarak birimin personeline düşüyordu. Kategori
 * ekseni kalktığı için kategori seçimi arayüzü de kaldırıldı. Birim bugün, atama
 * listesinde kişileri gruplayan bir etikettir.
 */
export default function EkipCekmecesi({
  acik, onKapat, personeller, birimler,
  onPersonelEkle, onPersonelSil, onLink, onBirimEkle, onBirimSil,
}) {
  const [birimAdi, setBirimAdi] = useState('');
  const [birimHata, setBirimHata] = useState('');
  const [birimYukleniyor, setBirimYukleniyor] = useState(false);

  if (!acik) return null;

  const saha = personeller.filter((p) => p.rol === PersonelRolleri.PERSONEL);
  const yoneticiler = personeller.filter(
    (p) => p.rol === PersonelRolleri.BASKAN || p.rol === PersonelRolleri.BASKAN_YARDIMCISI,
  );
  const birimsiz = saha.filter((p) => !p.birimId);

  async function birimGonder(e) {
    e.preventDefault();
    setBirimHata('');
    setBirimYukleniyor(true);
    const sonuc = await onBirimEkle(birimAdi.trim());
    setBirimYukleniyor(false);
    if (sonuc.ok) setBirimAdi('');
    else setBirimHata(sonuc.hata || 'Eklenemedi.');
  }

  return (
    <>
      <div className="cekmece-perde" onClick={onKapat} role="presentation" />
      <aside className="cekmece" aria-label="Ekip yönetimi">
        <div className="cekmece-baslik">
          <h2>Ekip Yönetimi</h2>
          <button type="button" onClick={onKapat} aria-label="Kapat">✕</button>
        </div>

        <div className="cekmece-icerik">
          <p className="cekmece-not">
            Saha ekibine iş <strong>otomatik dağıtılmaz</strong>. Bir başvuru, siz
            karttan &quot;Ata&quot; dediğinizde ilgili kişinin Telegram&rsquo;ına düşer.
          </p>

          {/* ===== Birimler ===== */}
          <h3 className="cekmece-bolum">🏢 Birimler</h3>
          <form onSubmit={birimGonder} className="ekip-form">
            <input
              value={birimAdi}
              onChange={(e) => setBirimAdi(e.target.value)}
              placeholder='Birim adı (ör. "Fen İşleri")'
              aria-label="Birim adı"
            />
            <button type="submit" disabled={birimYukleniyor}>
              {birimYukleniyor ? 'Ekleniyor…' : '+ Birim Ekle'}
            </button>
            {birimHata && <p className="ekip-hata">{birimHata}</p>}
          </form>

          {birimler.length === 0 && <p className="ekip-bos">Henüz birim yok.</p>}
          {birimler.map((b) => {
            const uyeler = saha.filter((p) => p.birimId === b.id);
            return (
              <section key={b.id} className="ekip-birim">
                <div className="ekip-birim-ust">
                  <strong>{b.ad}</strong>
                  <button type="button" className="sil" onClick={() => onBirimSil(b.id)} title="Birimi kaldır">✕</button>
                </div>
                {uyeler.length === 0 && <p className="ekip-bos">Bu birimde kimse yok.</p>}
                {uyeler.map((p) => (
                  <KisiSatiri key={p.id} kisi={p} onSil={onPersonelSil} onLink={onLink} />
                ))}
                <KisiEkleFormu
                  onEkle={(ad, soyad, telefon) =>
                    onPersonelEkle(ad, soyad, telefon, { rol: PersonelRolleri.PERSONEL, birimId: b.id })}
                  butonMetni="+ Bu birime kişi ekle"
                />
              </section>
            );
          })}

          {birimsiz.length > 0 && (
            <section className="ekip-birim">
              <div className="ekip-birim-ust"><strong>Birimi olmayan saha personeli</strong></div>
              {birimsiz.map((p) => (
                <KisiSatiri key={p.id} kisi={p} onSil={onPersonelSil} onLink={onLink} />
              ))}
            </section>
          )}

          {/* ===== Başkan / yardımcı ===== */}
          <h3 className="cekmece-bolum">👔 Başkan ve Yardımcıları</h3>
          <p className="cekmece-not">
            Buradakilere <strong>her</strong> yeni başvuru ve her çözüm Telegram&rsquo;dan bilgi olarak düşer.
          </p>
          <KisiEkleFormu onEkle={onPersonelEkle} rolSecici butonMetni="+ Başkan/Yardımcı Ekle" />
          {yoneticiler.length === 0 && <p className="ekip-bos">Henüz eklenmedi.</p>}
          {yoneticiler.map((p) => (
            <KisiSatiri key={p.id} kisi={p} etiket={ROL_ETIKET[p.rol]} onSil={onPersonelSil} onLink={onLink} />
          ))}
        </div>
      </aside>
    </>
  );
}
