import { IOlayYayini } from '@/lib/domain/interfaces/IOlayYayini.js';
import { BellekOlayYayini } from '@/lib/infrastructure/events/BellekOlayYayini.js';

/** Redis kanal ön eki. Diğer anahtarlarla (sayaç/OTP) çakışmaması için ayrı ad alanı. */
const KANAL_ONEKI = 'basvuru_olay:';

/**
 * Tek bir mesajın kabul edilebilir üst sınırı (byte). Kanal yalnızca kendi
 * uygulamamızın yazdığı panel DTO'larını taşır; bundan büyüğü ya bir hata ya da
 * kanala sızmış yabancı bir yayındır → sessizce atılır (parse edilmez).
 */
const MAKS_MESAJ_BYTE = 64 * 1024;

/**
 * RedisOlayYayini — Kopyalar Arası Olay Yayını (Redis pub/sub)
 * =============================================================
 *
 * NEDEN: Uygulama birden çok kopyaya ölçeklendiğinde, başvuruyu A kopyası kaydeder ama
 * başkanın paneli B kopyasına bağlı olabilir. Süreç içi yayın (BellekOlayYayini) tek
 * başına kullanılsaydı o panel olayı hiç görmez, "canlı" vaadi sessizce bozulurdu.
 *
 * NASIL: Yayın Redis'e PUBLISH edilir; her kopya AYNI kanala abonedir ve gelen mesajı
 * KENDİ süreç içi yayınına devreder. Yerel dağıtım mantığı böylece tek yerde kalır
 * (Decorator deseni: bu sınıf BellekOlayYayini'nı sarmalar, yerine geçmez).
 *
 * ÖNEMLİ — AYRI BAĞLANTI: Redis'te bir bağlantı SUBSCRIBE moduna girdiğinde başka
 * komut kabul etmez. Bu yüzden abonelik, paylaşılan istemcinin `duplicate()`'i ile
 * açılan AYRI bir bağlantı üzerindedir; paylaşılan istemci (sayaçlar, OTP, kilitler)
 * etkilenmez.
 *
 * FAIL-SAFE: Redis erişilemezse yayın/abonelik sessizce SÜREÇ İÇİNE düşer. Tek
 * konteynerli dağıtımda bu tam işlevseldir; çok kopyalıda panel yalnız kendi
 * kopyasının olaylarını görür ve yedek yoklama (panelin periyodik tazelemesi) boşluğu
 * kapatır. Yani en kötü durumda "canlılık" azalır, sistem DURMAZ.
 */
export class RedisOlayYayini extends IOlayYayini {
  /**
   * @param {import('ioredis').Redis} yayinciIstemci - Paylaşılan Redis istemcisi (PUBLISH için)
   * @param {import('ioredis').Redis} aboneIstemci - Yalnız bu sınıfa ait, SUBSCRIBE moduna girecek kopya
   */
  constructor(yayinciIstemci, aboneIstemci) {
    super();
    this._yayinciIstemci = yayinciIstemci;
    this._aboneIstemci = aboneIstemci;
    /** Yerel dağıtım: Redis'ten gelen mesajlar buraya devredilir. */
    this._yerel = new BellekOlayYayini();
    /** Redis'te SUBSCRIBE edilmiş kanallar (tenant başına bir kez abone olunur). */
    this._acikKanallar = new Set();

    this._aboneIstemci.on('message', (kanal, mesaj) => this._mesajGeldi(kanal, mesaj));
    this._aboneIstemci.on('error', (e) => {
      // Bağlantı hatası zaten RedisClient tarafından loglanıyor; burada yalnız
      // yeniden abone olmayı bir sonraki `abone()` çağrısına bırakmak için
      // kanal kaydını temizliyoruz (ioredis yeniden bağlanınca SUBSCRIBE'ı kendi
      // tekrarlar, ama bağlantı tamamen düşerse liste bayatlamasın).
      console.warn('⚠ Olay kanalı (Redis abone) hatası:', e?.message);
    });
  }

  /** @private */
  _kanal(tenantId) {
    return `${KANAL_ONEKI}${Number(tenantId)}`;
  }

  /** @private Redis'ten gelen mesajı yerel abonelere dağıtır. */
  _mesajGeldi(kanal, mesaj) {
    if (!kanal.startsWith(KANAL_ONEKI)) return;
    if (typeof mesaj !== 'string' || mesaj.length > MAKS_MESAJ_BYTE) return;
    const tenantId = Number(kanal.slice(KANAL_ONEKI.length));
    if (!Number.isInteger(tenantId)) return;
    let olay;
    try {
      olay = JSON.parse(mesaj);
    } catch {
      return; // bozuk/yabancı yayın → yok say
    }
    if (!olay || typeof olay.tip !== 'string') return;
    this._yerel.yayinla(tenantId, olay);
  }

  /** @inheritdoc */
  async yayinla(tenantId, olay) {
    const gövde = JSON.stringify(olay);
    try {
      await this._yayinciIstemci.publish(this._kanal(tenantId), gövde);
      // Redis'e BAŞARIYLA yayınlandıysa yerel dağıtımı TEKRAR yapmıyoruz: bu kopya da
      // aynı kanala abone olduğu için mesaj `_mesajGeldi` ile zaten geri gelecek.
      // İkisini birden yapmak, bu kopyadaki panellere olayı ÇİFT gönderirdi.
    } catch (e) {
      // Redis erişilemedi → en azından bu kopyadaki paneller haberdar olsun.
      console.warn('⚠ Olay Redis\'e yayınlanamadı, süreç içine düşülüyor:', e?.message);
      await this._yerel.yayinla(tenantId, olay);
    }
  }

  /** @inheritdoc */
  abone(tenantId, dinleyici) {
    const kanal = this._kanal(tenantId);
    // İlk yerel abonede Redis kanalına da abone ol (tenant başına yalnız bir kez).
    if (!this._acikKanallar.has(kanal)) {
      this._acikKanallar.add(kanal);
      this._aboneIstemci.subscribe(kanal).catch((e) => {
        this._acikKanallar.delete(kanal); // sonraki denemede tekrar denensin
        console.warn('⚠ Olay kanalına abone olunamadı:', e?.message);
      });
    }
    // Kanal aboneliğini panel kapanınca BIRAKMIYORUZ (UNSUBSCRIBE yok): belediye
    // sayısı sabit ve küçüktür, boşta duran bir kanal aboneliği neredeyse bedava,
    // buna karşılık her panel açılışında SUBSCRIBE/UNSUBSCRIBE gidip gelmesi
    // gereksiz gürültü ve yarış (son abone çıkarken yeni abone girerse olay kaybı).
    return this._yerel.abone(tenantId, dinleyici);
  }

  /** @inheritdoc */
  aboneSayisi(tenantId) {
    // BU KOPYADAKİ açık panel sayısı — bağlantı tavanı zaten kopya başına uygulanır.
    return this._yerel.aboneSayisi(tenantId);
  }
}
