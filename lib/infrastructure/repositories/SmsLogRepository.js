import { lt } from 'drizzle-orm';
import { getDb } from '@/lib/infrastructure/database/connection.js';
import { smsGonderimLog } from '@/lib/infrastructure/database/schema.js';

/**
 * SmsLogRepository - SMS Gönderim Audit Log
 *
 * Her SMS gönderim DENEMESİNİ (başarılı/reddedilen) kaydeder: kötüye kullanım
 * tespiti + adli iz. KVKK: ham telefon/IP SAKLANMAZ, yalnızca SHA-256 hash'leri.
 *
 * KRİTİK: Bu kayıt ana akışı (SMS gönderimi) BOZMAMALI. `kaydet` hiçbir zaman
 * exception fırlatmaz; DB hatası olsa bile sessizce yutar (log'a yazar).
 */
export class SmsLogRepository {
  constructor() {
    this.db = getDb();
  }

  /**
   * @param {{tenantId?: number|null, telefonHash?: string|null, ipHash?: string|null,
   *   sonuc: string, sebep?: string|null}} kayit
   * @returns {Promise<void>}
   */
  async kaydet({ tenantId = null, telefonHash = null, ipHash = null, sonuc, sebep = null }) {
    try {
      await this.db.insert(smsGonderimLog).values({
        tenantId: tenantId ?? null,
        telefonHash: telefonHash || null,
        ipHash: ipHash || null,
        sonuc,
        sebep: sebep || null,
      });
    } catch (e) {
      console.error('SMS audit log yazılamadı:', e?.message);
    }
  }

  /**
   * PERİYODİK İMHA: saklama süresi dolan audit kayıtlarını siler.
   * Bu tablo telefon ve IP'nin tek yönlü özetlerini tutar — kötüye kullanım tespiti
   * kısa vadeli bir amaçtır, süresiz saklamanın gerekçesi yoktur.
   * @param {Date} esikTarih - Bu tarihten ESKİ satırlar silinir
   * @returns {Promise<number>} silinen satır sayısı
   */
  async eskileriSil(esikTarih) {
    const sonuc = await this.db
      .delete(smsGonderimLog)
      .where(lt(smsGonderimLog.olusturmaTarihi, esikTarih))
      .returning({ id: smsGonderimLog.id });
    return sonuc.length;
  }
}
