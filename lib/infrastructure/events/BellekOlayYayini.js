import { EventEmitter } from 'node:events';
import { IOlayYayini } from '@/lib/domain/interfaces/IOlayYayini.js';

/**
 * BellekOlayYayini — Süreç İçi (in-process) Olay Yayını
 * ======================================================
 *
 * Node'un EventEmitter'ı üzerine ince bir sarmalayıcı. Tek uygulama konteynerinde
 * (bu ürünün varsayılan dağıtımı — bkz. docker-compose.yml) tam yeterlidir: başvuruyu
 * yazan istek ile paneli besleyen SSE bağlantısı AYNI süreçtedir.
 *
 * Redis'li dağıtımda da silinmez, ALTTA KALIR: RedisOlayYayini gelen mesajı bu
 * yayına devrederek yerel abonelere ulaştırır (bkz. RedisOlayYayini). Yani "yerel
 * dağıtım" mantığı tek yerde yazılıdır.
 *
 * Tenant izolasyonu: her belediye ayrı bir olay adıdır (`t:<id>`) — bir belediyenin
 * dinleyicisi diğerinin olayını hiç GÖRMEZ (filtrelemeye gerek kalmaz, ki filtreleme
 * unutulabilecek bir adımdır).
 */
export class BellekOlayYayini extends IOlayYayini {
  constructor() {
    super();
    this._yayinci = new EventEmitter();
    // Varsayılan 10 dinleyici sınırı, aynı belediyede 10'dan fazla açık panel olunca
    // sahte bir "olası bellek sızıntısı" uyarısı basardı. Gerçek sınır, SSE ucundaki
    // açık bağlantı tavanıdır (AKIS_TAVANI); burada uyarıyı kapatıyoruz.
    this._yayinci.setMaxListeners(0);
  }

  /** @private Belediyeye özel olay adı. */
  _kanal(tenantId) {
    return `t:${Number(tenantId)}`;
  }

  /** @inheritdoc */
  async yayinla(tenantId, olay) {
    // EventEmitter dinleyicisinden fırlayan bir hata, emit() çağrısını — yani başvuruyu
    // kaydeden isteği — patlatır. Panel bildirimi asla vatandaşın kaydını riske atmaz.
    try {
      this._yayinci.emit(this._kanal(tenantId), olay);
    } catch (e) {
      console.error('olay yayını hatası:', e?.message);
    }
  }

  /** @inheritdoc */
  abone(tenantId, dinleyici) {
    const kanal = this._kanal(tenantId);
    // Dinleyiciyi sarmala: bir abonenin (kopmuş bir SSE yazımı) hatası, aynı olayı
    // bekleyen DİĞER abonelerin bildirimini kesmemeli.
    const guvenli = (olay) => {
      try { dinleyici(olay); } catch (e) { console.error('olay dinleyici hatası:', e?.message); }
    };
    this._yayinci.on(kanal, guvenli);
    return () => this._yayinci.off(kanal, guvenli);
  }

  /** @inheritdoc */
  aboneSayisi(tenantId) {
    return this._yayinci.listenerCount(this._kanal(tenantId));
  }
}
