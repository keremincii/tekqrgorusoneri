import { headers } from 'next/headers';
import { hosttanSlug } from '@/lib/server/host.js';
import { tenantSlugIle } from '@/lib/server/tenant.js';
import { KisiselVeriSabitleri, KvkkSabitleri, aydinlatmaSurumu, saklamaTablosu } from '@/lib/utils/constants';

/**
 * KVKK Aydınlatma Metni (Kişisel Verilerin Korunması)
 * ===================================================
 *
 * Başvuru formundaki açık rıza onay kutusu buraya bağlanır. Vatandaş, hangi metin
 * sürümüne onay verdiyse o sürüm (KvkkSabitleri.AYDINLATMA_SURUMU) başvuru kaydında
 * `kvkk_metin_surumu` olarak saklanır.
 *
 * ÖNEMLİ (geliştirici notu — sayfada görünmez):
 *  - Veri SORUMLUSU ilgili BELEDİYE'dir; bu sistemi işleten taraf (KvkkSabitleri.VERI_ISLEYEN)
 *    belediye ADINA işleyen "veri işleyen"dir. Aşağıdaki metin sağlam bir taslaktır;
 *    her belediyenin KVKK/hukuk birimi nihai metni onaylamalı ve gerekiyorsa kendi
 *    VERBİS/başvuru kanallarını eklemelidir.
 *
 * Sayfa tenant'a duyarlıdır: subdomain'den belediye adını çözüp "veri sorumlusu"
 * olarak gösterir (çözülemezse genel ifadeye düşer).
 */
export const dynamic = 'force-dynamic';

const IMHA_GUN = KisiselVeriSabitleri.IMHA_GUN;

async function tenantGetir() {
  try {
    const h = await headers();
    const slug = hosttanSlug(h.get('host'));
    if (!slug) return null;
    // Ortak snapshot önbelleği (yalnız aktif tenant döner) → DB'ye her sayfa açılışında gitmez.
    return await tenantSlugIle(slug);
  } catch {
    return null;
  }
}

export default async function KvkkAydinlatmaSayfasi() {
  const tenant = await tenantGetir();
  const belediyeAdi = tenant?.ad || null;
  const veriSorumlusu = belediyeAdi || 'başvurunuzu ilettiğiniz belediye';
  /**
   * Çözüm SMS'i bu belediyede AÇIK mı? Metnin telefon-saklama maddeleri YALNIZ açıkken
   * gösterilir; kapalı belediyede numara gerçekten saklanmadığı için o maddeleri
   * göstermek metni GERÇEĞE AYKIRI kılardı (KVKK'da en pahalı hata türü).
   * Sürüm dizesi de bu yüzden tenant'a göre çözülür — aynı sürüm altında iki farklı
   * metin göstermek "hangi metne rıza verildi?" sorusunu cevapsız bırakırdı.
   */
  const smsAcik = tenant?.cozumSmsiAcik === true;
  const surum = aydinlatmaSurumu(tenant);
  /** Belediyenin KVKK başvuru kanalları (migration 0017); boşsa metin genel ifadeye düşer. */
  const iletisim = {
    adres: tenant?.kvkkAdres || '',
    kep: tenant?.kvkkKep || '',
    eposta: tenant?.kvkkEposta || '',
    site: tenant?.kvkkSite || '',
  };

  return (
    <div className="page-container">
      <div className="card" style={{ maxWidth: 760, textAlign: 'left' }}>
        <div className="card-header" style={{ textAlign: 'left' }}>
          <h1 className="gradient-text" style={{ fontSize: 24 }}>Kişisel Verilerin Korunması — Aydınlatma Metni</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sürüm: {surum}</p>
        </div>

        <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8 }}>
          <p>
            6698 sayılı Kişisel Verilerin Korunması Kanunu (&ldquo;KVKK&rdquo;) kapsamında,
            başvurunuzda verdiğiniz kişisel veriler <strong>{veriSorumlusu}</strong> (&ldquo;veri
            sorumlusu&rdquo;) tarafından aşağıda açıklanan çerçevede işlenmektedir. Sistemin teknik
            altyapısı, belediye adına ve talimatları doğrultusunda hareket eden veri işleyen{' '}
            <strong>{KvkkSabitleri.VERI_ISLEYEN}</strong> tarafından sağlanmaktadır.
          </p>
          <p>
            Bu metin, sistem üzerinden gönderdiğiniz <strong>şikayet, görüş ve öneri</strong>
            {' '}başvurularının tamamı için geçerlidir. Üç tür de birebir aynı esaslarla işlenir:
            aynı saklama süreleri, aynı alıcılar ve aynı aktarımlar geçerlidir.
          </p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>İşlenen Kişisel Veriler</h3>
          <p>Başvuru sırasında <strong>ad, soyad ve telefon numaranız</strong> alınır ve telefon
            numaranız SMS ile doğrulanır. <strong>Ad ve soyadınız hiçbir türde saklanmaz</strong>;
            doğrulama tamamlandıktan sonra kalıcı olarak tutulmaz. Telefon numaranızın
            <strong> geri döndürülemez, tek yönlü şifreli özeti (hash)</strong> saklanır; bu özetten
            numaranız yeniden elde edilemez ve yalnızca aynı kişinin mükerrer başvurusunu
            sınırlamak ile kötüye kullananları engellemek için kullanılır.</p>
          {smsAcik && (
            <p><strong>Sonuç bildirimi için telefon numarası:</strong>{' '}
              başvurunuz sonuçlandığında size bilgi SMS&rsquo;i gönderebilmek amacıyla telefon
              numaranız <strong>şifrelenmiş biçimde</strong> saklanır. Şifre çözme anahtarı
              veritabanında değil, ayrı bir sunucu ortamında tutulur; veritabanına yetkisiz erişim
              hâlinde numaralar okunamaz. Bu numara <strong>yalnızca sonuç SMS&rsquo;i</strong> için
              kullanılır; pazarlama, duyuru veya başka hiçbir amaçla kullanılmaz ve saha ekibiyle
              paylaşılmaz. Başvurunuz sonuçlandıktan <strong>{IMHA_GUN} gün</strong> sonra numara
              otomatik olarak silinir.</p>
          )}
          {!smsAcik && (
            <p>Telefon numaranız <strong>hiçbir biçimde saklanmaz</strong>: doğrulama
              tamamlandıktan sonra yalnızca yukarıda anlatılan tek yönlü özeti tutulur.
              Belediyeniz sonuç bildirimi SMS&rsquo;i hizmetini kullanmamaktadır.</p>
          )}
          <p>Kalıcı olarak saklanan veriler: <strong>başvuru içeriği</strong> (seçtiğiniz tür —
            şikayet, görüş veya öneri —, yazdığınız metin ve varsa eklediğiniz fotoğraf) ile
            hash&rsquo;lenmiş işlem güvenliği kayıtları. <strong>Sizden bir konu/kategori
            seçmeniz istenmez</strong> ve böyle bir veri toplanmaz.</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Konum Verisi</h3>
          <p><strong>Cihazınızın konumu/GPS verisi alınmaz</strong> ve sizden bir konum seçmeniz
            istenmez. Başvurunuz, <strong>okuttuğunuz QR koduna önceden tanımlı sabit noktaya</strong>
            {' '}bağlanır; yönetim ekranında ve saha ekibine iletilen bildirimde görünen konum budur.</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>İşleme Amaçları</h3>
          <p>Başvurunuzun alınması, değerlendirilmesi ve sonuçlandırılması;
            mükerrer/sahte başvuruların ve kötüye kullanımın
            önlenmesi; hizmet ve sistem güvenliğinin sağlanması. Telefon numaranızın <strong>tek
            yönlü özeti</strong>, yalnızca mükerrer başvuru sınırının uygulanması ve
            kötüye kullanım (ör. asılsız/troll başvuru) hâlinde ilgili numaranın engellenmesi
            amacıyla kullanılır.{smsAcik && (
              <> Ayrıca <strong>başvurunuz sonuçlandığında size tek
                seferlik bir bilgi SMS&rsquo;i</strong> gönderilir; bunun dışında bu kanaldan
                sizinle iletişim kurulmaz.</>
            )}</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Toplama Yöntemi ve Hukuki Sebep</h3>
          <p>Kişisel verileriniz, bu başvuru formu aracılığıyla elektronik ortamda ve yalnızca sizin
            başvurunuz üzerine toplanır. İşlemenin hukuki sebepleri şunlardır:</p>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li>Başvurunuzun alınıp değerlendirilmesi ve belediyenin kanunla verilmiş görev ve
              yetkilerini yerine getirmesi bakımından <strong>KVKK m.5/2</strong> (bir hakkın tesisi,
              kullanılması veya korunması; veri sorumlusunun hukuki yükümlülüğü; ve temel hak ve
              özgürlüklerinize zarar vermemek kaydıyla meşru menfaat);</li>
            <li>Verilerinizin yurt dışına aktarılması bakımından <strong>açık rızanız (KVKK
              m.9)</strong>. Bu aktarım yalnız bildirim servisleriyle sınırlı değildir; sistemin
              barındırıldığı sunucu da yurt dışındadır — ayrıntısı aşağıdaki &ldquo;Sistemin
              Barındırılması ve Yurt Dışı Aktarım&rdquo; başlığındadır.</li>
          </ul>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Yurt dışı aktarıma verdiğiniz açık
            rızayı dilediğiniz zaman geri alabilirsiniz; geri alma, o ana kadar yapılmış işlemleri
            etkilemez. Açık rızaya bağlı olmayan işlemler, yukarıdaki kanuni sebeplerle devam eder.</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Aktarım</h3>
          <p>Verileriniz, başvurunuzla ilgilenmek üzere ilgili belediye birimleriyle ve sistemin
            çalışması için hizmet alınan teknik sağlayıcılarla paylaşılır:</p>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li><strong>Yönetim bilgilendirmesi:</strong> belediye başkanı ve başkan
              yardımcısına, bir mesajlaşma servisi üzerinden bilgi amaçlı bir bildirim
              gönderilir. Bu nedenle aşağıdaki yurt dışı aktarım söz konusudur.</li>
            <li><strong>Saha ekibine yönlendirme:</strong> başvurunuz saha ekibine
              <strong> otomatik olarak dağıtılmaz</strong>. Yalnızca yönetim, başvuruyu görevli bir
              personele <strong>atadığında</strong>; başvurunun türü, yazdığınız metin, (varsa)
              fotoğraf ve QR noktasının konumu o personele aynı mesajlaşma servisi
              üzerinden iletilir.</li>
            {/*
              GERÇEK DAVRANIŞ: ModerasyonService, filtreye takılan kaydı TEK bir moderasyon
              sohbetine düşürür (TELEGRAM_MODERASYON_CHAT_ID) ve bu sohbet birden çok
              belediyeye hizmet eder — yani içerik belediye birimine DEĞİL veri işleyenin
              ekibine gider. Önceki sürümdeki "yalnızca ilgili belediye birimleriyle
              paylaşılır" ifadesi bu yüzden gerçeğe aykırıydı.

              v14 — İSME EK GETİRİLMEZ: "…Teknolojileri'nin" gibi bir ek, VERI_ISLEYEN sabiti
              değiştiğinde (ör. sonu ünsüzle biten bir unvan) yanlışa düşer. Ad parantez içinde
              araya alınır; ek her zaman "veri işleyenin" üzerinde kalır. Ayrıca bu notu <li>
              İÇİNE koymak yasak: aradaki JSX yorumu metni iki ayrı düğüme böler ve birleştiren
              boşluk kaybolur ("takılanbaşvurular").
            */}
            <li><strong>İçerik moderasyonu:</strong> başvuru metni, hakaret/uygunsuz
              ifade içerip içermediği bakımından otomatik bir filtreden geçirilir. Filtreye takılan
              başvurular yayıma alınmadan önce, sistemi belediye adına işleten veri işleyenin
              {' '}(<strong>{KvkkSabitleri.VERI_ISLEYEN}</strong>){' '}
              <strong>moderasyon ekibine</strong> — yine aynı mesajlaşma servisi
              üzerinden — iletilir ve bir kişi tarafından incelenir. Bu incelemede yalnızca
              başvurunun metni görülür; <strong>kimlik bilgileriniz iletilmez.</strong>
              Uygun bulunan başvuru normal akışına devam eder.</li>
          </ul>
          <p><strong>Ad, soyad ve telefon gibi kimlik bilgileriniz ne saha ekibiyle ne de yönetimle
            paylaşılır.</strong> Bu mesajlaşma servisi yurt dışında barındırıldığından,
            iletilen başvuru türü, metin, (varsa) fotoğraf ve konum bilgisi{' '}
            <strong>KVKK m.9 kapsamında yurt dışına aktarılmış</strong>
            {' '}olur; bu aktarıma, formdaki ayrı açık rıza kutusunu işaretleyerek rıza vermiş
            olursunuz. Yasal olarak
            yetkili merciler tarafından talep edilmesi hâlinde mevzuat gereği ilgili kurumlara
            aktarılabilir. Verileriniz pazarlama amacıyla üçüncü kişilerle paylaşılmaz.</p>

          {/*
            KRİTİK — v13'te eklendi. v12'ye kadar metin yurt dışı aktarım olarak YALNIZ
            Telegram'ı sayıyordu; oysa veritabanının tamamı yurt dışındaki sunucuda, fotoğraflar
            yurt dışı merkezli nesne depolamada duruyor ve Turnstile vatandaşın tarayıcısından
            doğrudan Cloudflare'e istek atıyor. Okuyanın "gerisi Türkiye'de" sanmasına yol açan
            bu eksiklik, aktarımın EN BÜYÜK kısmını gizliyordu.

            ALTYAPI DEĞİŞİRSE BURASI DA DEĞİŞMELİ (ve sürüm numarası artmalı): bu paragraf
            koddan türetilemez, elle yazılmıştır. Barındırma sağlayıcısı/ülkesi değiştiğinde
            metnin gerçeğe aykırı kalması KVKK'da en pahalı hata türüdür. Sağlayıcı ADI ve
            ÜLKESİ v14'ten beri KvkkSabitleri'nden gelir — orayı değiştirirken sürümü de artır.
          */}
          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Sistemin Barındırılması ve Yurt Dışı Aktarım</h3>
          <p>Bu sistem, belediye adına hareket eden veri işleyen {KvkkSabitleri.VERI_ISLEYEN}
            {' '}tarafından, <strong>{KvkkSabitleri.BARINDIRMA_ULKE}&rsquo;da bulunan
            {' '}bir sağlayıcının sunucularında
            barındırılmaktadır.</strong> Dolayısıyla başvurunuzla
            birlikte verdiğiniz ve yukarıda sayılan tüm veriler — başvuru içeriği, fotoğraf,
            telefon numaranızın tek yönlü özeti{smsAcik ? ' ve şifreli telefon numaranız' : ''} dâhil —
            bu sunucuda saklandığı için <strong>KVKK m.9 kapsamında yurt dışına aktarılmış
            olur.</strong> Sunucunun bulunduğu ülke, kişisel verilerin korunması bakımından
            Avrupa Birliği mevzuatına tabidir.</p>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li><strong>Fotoğraflar</strong> ayrıca, yurt dışı merkezli bir bulut depolama
              hizmetinde tutulur.</li>
            {/*
              DÜRÜST SIRALAMA: IP, Turnstile yüzünden değil, sitenin Cloudflare üzerinden
              yayınlanması nedeniyle SAYFA AÇILIR AÇILMAZ sağlayıcıya ulaşır. Bunu yalnız
              Turnstile'a bağlamak, "widget'ı onaydan sonra yükleyelim" gibi hiçbir şeyi
              düzeltmeyen bir çözüme yol açardı — sayfa zaten oradan geçiyor.
            */}
            <li><strong>Site altyapısı ve bot koruması:</strong> bu sayfa ve başvuru formu,
              saldırı koruması sağlayan yurt dışı merkezli bir altyapı sağlayıcısı
              üzerinden yayınlanır. Bu nedenle <strong>IP adresiniz ve tarayıcınıza ilişkin teknik
              sinyaller, siz henüz hiçbir bilgi girmeden, sayfayı açtığınız anda</strong> bu
              sağlayıcı tarafından işlenir. Aynı sağlayıcının bot koruma aracı, formda
              otomatik/robot başvuruları engellemek için aynı verileri kullanır. Bu veriler
              yalnızca güvenlik ve &ldquo;insan mısınız&rdquo; kontrolü amacıyla işlenir;
              başvurunuzun içeriği bu araca gönderilmez.</li>
            <li><strong>Saha ekibi ve yönetim bildirimleri</strong> ile <strong>içerik
              moderasyonu</strong>, yukarıda açıklandığı üzere yurt dışında barındırılan bir
              mesajlaşma servisi üzerinden yürütülür.</li>
          </ul>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}><strong>Başvurunuzla birlikte
            verdiğiniz</strong> verilerin yurt dışına aktarılması, &ldquo;Toplama Yöntemi ve Hukuki
            Sebep&rdquo; başlığında belirtilen <strong>açık rızanıza</strong> dayanır; formdaki
            ilgili onay kutusunu işaretlemeden başvurunuz alınmaz. Açık rıza vermek istemezseniz
            belediyenin diğer başvuru kanallarını (yazılı başvuru, çağrı merkezi vb.)
            kullanabilirsiniz. Yukarıdaki ikinci maddede anlatılan ve <strong>sayfayı açtığınız
            anda</strong> gerçekleşen güvenlik işlemesi ise, siz henüz bir onay vermeden önce
            oluştuğu için açık rızaya değil, sayfanın güvenli biçimde sunulabilmesindeki teknik
            zorunluluğa ve hizmet güvenliğine dayanır.</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>SMS Gönderimi</h3>
          <p>
            <strong>Doğrulama:</strong> Telefon numaranızın size ait olduğunu doğrulamak için
            numaranıza bir doğrulama kodu gönderilir. Bu kod, belediyenin <strong>Türkiye&rsquo;de
            yerleşik SMS servis sağlayıcısı (Netgsm)</strong> üzerinden iletilir; SMS adımında
            yurt dışına herhangi bir aktarım yapılmaz. Başvurunuzun içeriği (konu, açıklama,
            fotoğraf) SMS sağlayıcısıyla paylaşılmaz.
          </p>
          {smsAcik && (
            <p><strong>Sonuç bildirimi:</strong> başvurunuz
              sonuçlandığında, saklanan şifreli numaranız çözülerek <strong>aynı Türkiye&rsquo;de
              yerleşik SMS sağlayıcısına</strong> yeniden iletilir ve size tek seferlik bir bilgi
              mesajı gönderilir. Mesajda başvurunuzun sonuçlandığı bilgisi yer alır; bu adımda da
              yurt dışına aktarım yapılmaz.</p>
          )}

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Saklama Süresi</h3>
          <p><strong>Ad ve soyadınız</strong> doğrulama tamamlanır tamamlanmaz kalıcı olarak
            saklanmaz (bkz. &ldquo;İşlenen Kişisel Veriler&rdquo;).</p>
          {smsAcik && (
            <p><strong>Telefon numaranız</strong> (sonuç SMS&rsquo;i için
              şifreli olarak saklanan kopya) başvurunuz sonuçlandıktan <strong>{IMHA_GUN} gün</strong>
              {' '}sonra otomatik olarak silinir. Bu silme işlemi sistem tarafından düzenli aralıklarla,
              elle müdahale gerekmeden yürütülür.</p>
          )}
          {/*
            Tablo constants.saklamaTablosu()'ndan gelir; süreler periyodik imha görevinin
            kullandığı SABİTLERİN AYNISIDIR. Böylece metinde yazan süre ile sistemin
            fiilen uyguladığı süre ayrışamaz — "yazmış ama yapmıyor" bulgusu doğmaz.
          */}
          <div style={{ overflowX: 'auto', margin: '10px 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>Veri</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>Saklama süresi</th>
                </tr>
              </thead>
              <tbody>
                {saklamaTablosu(tenant).map((s) => (
                  <tr key={s.veri}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>
                      {s.veri}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>
                      <strong>{s.sure}</strong>
                      {s.aciklama && (
                        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                          {s.aciklama}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 13 }}>Bu süreler sistem tarafından <strong>otomatik olarak</strong>
            uygulanır: düzenli aralıklarla çalışan bir imha görevi, süresi dolan verileri elle
            müdahale gerekmeden siler. &ldquo;Kimlik bağının koparılması&rdquo;, başvurunun sizinle
            ilişkilendirilmesini sağlayan tüm bilgilerin silinmesi demektir; geriye kalan içerik
            artık kişisel veri niteliği taşımaz ve yalnızca hizmet istatistiği olarak kullanılır.
            Mevzuatta daha uzun bir saklama süresi öngörülen hâller saklıdır.</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Otomatik Karar Alma</h3>
          <p>Başvuru metniniz, gönderdiğiniz anda <strong>otomatik bir içerik filtresinden</strong>
            geçirilir; hakaret/uygunsuz ifade tespit edilirse başvuru yayıma alınmadan önce bir
            kişinin incelemesine düşer (bkz. &ldquo;Aktarım&rdquo; — içerik moderasyonu). Ayrıca
            mükerrer başvuruları sınırlayan otomatik bir kural işletilir.</p>
          <p>Bunların dışında başvurunuz; aleyhinize hukuki sonuç doğuran veya sizi önemli ölçüde
            etkileyen, <strong>yalnızca</strong> otomatik sistemlerce verilmiş bir karara tabi
            tutulmaz. Başvurunuzun esasına ilişkin değerlendirme her hâlükârda ilgili belediye
            personeli tarafından yapılır.</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Veri Güvenliği</h3>
          <p>Verileriniz, yetkisiz erişime karşı KVKK m.12 uyarınca uygun teknik ve idari tedbirlerle
            korunur (erişimin yalnızca yetkili belediye personeliyle sınırlanması, iletişimin
            şifrelenmesi, yüklediğiniz fotoğrafların sunucuda yeniden işlenerek konum/EXIF verisinin
            silinmesi ve benzeri önlemler).</p>

          <h3 style={{ color: 'var(--text-primary)', marginTop: 20 }}>Haklarınız (KVKK m.11)</h3>
          <p>Kişisel verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltilmesini veya
            silinmesini isteme, işlemeye itiraz etme ve Kanun&rsquo;da sayılan diğer haklarınızı
            kullanabilirsiniz. Bu taleplerinizi, veri sorumlusu <strong>{veriSorumlusu}</strong>&rsquo;ne
            &ldquo;Kişisel Verilerin Korunması Kanunu Kapsamında Bilgi Talebi&rdquo; açıklamasıyla
            iletebilirsiniz. Başvurunuz en geç <strong>30 gün</strong> içinde sonuçlandırılır.
            Talebinizin reddi veya cevapsız kalması hâlinde Kişisel Verileri Koruma Kurulu&rsquo;na
            şikâyette bulunma hakkınız saklıdır.</p>
          {/*
            Somut kanallar tenant kaydından gelir (migration 0017). KVKK m.10, hakların
            NEREYE başvurularak kullanılacağının da bildirilmesini ister; "belediyenin ilan
            ettiği kanallar" gibi genel bir ifade denetimde eksik sayılabilir. Bilgi
            girilmemiş belediyede aşağıdaki genel ifadeye düşülür — metin yine doğrudur.
          */}
          {(iletisim.adres || iletisim.kep || iletisim.eposta || iletisim.site) ? (
            <ul style={{ margin: '8px 0 0 18px', paddingLeft: 0 }}>
              {iletisim.adres && (
                <li><strong>Elden veya noter/posta yoluyla:</strong> {iletisim.adres}</li>
              )}
              {iletisim.kep && (
                <li><strong>Güvenli elektronik imzalı KEP ile:</strong> {iletisim.kep}</li>
              )}
              {iletisim.eposta && (
                <li><strong>E-posta ile:</strong> {iletisim.eposta}</li>
              )}
              {iletisim.site && (
                <li><strong>Başvuru formu ve ayrıntılı bilgi:</strong>{' '}
                  <a href={iletisim.site} target="_blank" rel="noopener noreferrer">{iletisim.site}</a>
                </li>
              )}
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Başvuru kanalları için belediyenin KVKK başvuru formuna, kayıtlı e-posta (KEP)
              adresine veya VERBİS&rsquo;te ilan ettiği iletişim adresine bakabilirsiniz.
            </p>
          )}

          {/*
            v13: AYDINLATMA ile AÇIK RIZA formda TEK kutuda birleşikti. Kurul'un yerleşik
            görüşü ikisinin ayrı ayrı alınmasıdır; birleşik kutu, açık rızayı sakatlama
            riski taşır — burada açık rıza yurt dışı aktarımın TEK hukuki dayanağı olduğu
            için bu risk doğrudan aktarımı dayanaksız bırakırdı. Form artık iki kutu gösterir.
          */}
          <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-muted)' }}>
            Başvuru formunda size <strong>iki ayrı onay</strong> sunulur: birincisiyle bu Aydınlatma
            Metni&rsquo;ni okuduğunuzu beyan edersiniz; ikincisiyle, verilerinizin yukarıda
            açıklanan biçimde <strong>yurt dışına aktarılmasına açık rıza</strong> vermiş olursunuz.
            Açık rızanızı dilediğiniz zaman geri alabilirsiniz.
          </p>
        </div>
      </div>
    </div>
  );
}
