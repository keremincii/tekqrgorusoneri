import { TenantRepository } from '@/lib/infrastructure/repositories/TenantRepository.js';
import { hosttanSlug } from '@/lib/server/host.js';

/**
 * Sunucu tarafı Tenant Çözümleme
 *
 * KRİTİK GÜVENLİK KURALI: Tenant ASLA istemciden gelen bir değerle belirlenmez.
 * İstek host'undan (subdomain) çözülür ve `tenantlar` tablosundan doğrulanır.
 * Bilinmeyen/pasif subdomain → null (çağıran 404 döner). Fail-open (varsayılan
 * tenant'a düşme) YOKTUR.
 *
 *   gulsehir.sikayet.com → slug "gulsehir" → tenantlar tablosunda ara → tenant_id
 *
 * Geliştirmede (localhost / IP) subdomain olmadığından NEXT_PUBLIC_TENANT_SLUG kullanılır.
 *
 * ÖNBELLEK TASARIMI (yük + bellek güvenliği):
 * ------------------------------------------
 * Eski tasarım: her istenen slug'ı ayrı Map anahtarı olarak cache'lerdi. Slug, saldırgan
 * kontrolündeki Host başlığından geldiği için wildcard-DNS flood'unda (rastgele-subdomain)
 * Map SINIRSIZ büyür → OOM; ayrıca her yeni slug bir DB sorgusu tetiklerdi.
 *
 * Yeni tasarım: 60 sn'de bir TÜM tenantlar tablosunu tek sorguyla çekip anlık görüntü
 * (snapshot) Map'ine (slug → tenant) yazarız. Belediye sayısı küçük ve sınırlıdır, yani
 * bellek O(gerçek tenant sayısı) — istekten gelen slug'la BÜYÜMEZ. Bilinmeyen slug snapshot'ta
 * yoksa doğrudan null döner: ne DB sorgusu ne Map girdisi üretir. Böylece rastgele-subdomain
 * flood'u ne belleği ne DB'yi yorar.
 */

/** @type {Map<string, Object>} slug → aktif tenant kaydı (yalnız aktif olanlar) */
let _snapshot = new Map();
let _snapshotTs = 0;
/** @type {Promise<void>|null} Eş zamanlı yenilemeleri tekilleştiren uçuş-halindeki söz. */
let _yenilemeSozu = null;
const SNAPSHOT_TTL_MS = 60 * 1000;

/**
 * Snapshot bayatsa tüm tenantları tek sorguyla yeniden yükler. Eş zamanlı çağrılar
 * tek DB sorgusunu paylaşır (thundering-herd yok). DB hatasında ESKİ snapshot korunur
 * (tüm tenantları null'lamaktansa bayat veri sun — kesinti büyütme).
 */
async function snapshotGuncelle() {
  if (Date.now() - _snapshotTs < SNAPSHOT_TTL_MS) return;
  if (_yenilemeSozu) return _yenilemeSozu; // başka istek zaten yeniliyor

  _yenilemeSozu = (async () => {
    try {
      const hepsi = await new TenantRepository().hepsiniGetir();
      const yeni = new Map();
      for (const t of hepsi) {
        if (t && t.aktif && t.slug) yeni.set(t.slug, t);
      }
      _snapshot = yeni;
      _snapshotTs = Date.now();
    } catch (err) {
      // DB erişilemiyor: eski snapshot'ı KORU, TTL'i kısmen ilerlet ki her istekte
      // yeniden denemeyip DB'yi daha da yormayalım (5 sn sonra tekrar denenir).
      console.error('Tenant snapshot güncellenemedi (eski veri korunuyor):', err?.message);
      _snapshotTs = Date.now() - (SNAPSHOT_TTL_MS - 5_000);
    } finally {
      _yenilemeSozu = null;
    }
  })();
  return _yenilemeSozu;
}

/**
 * Bir slug'a karşılık gelen aktif tenant kaydını döndürür (snapshot'tan).
 * @param {string} slug
 * @returns {Promise<Object|null>}
 */
export async function tenantSlugIle(slug) {
  if (!slug) return null;
  await snapshotGuncelle();
  return _snapshot.get(slug) || null;
}

/**
 * Host başlığından subdomain slug'ını çıkarır (sunucuda güvenilir kaynak).
 * @param {Request} request
 * @returns {string} slug (boş olabilir)
 */
export function hostSlugCikar(request) {
  // Çok parçalı TLD'lere dayanıklı, APP_BASE_DOMAIN tabanlı tek çıkarım (lib/server/host.js).
  return hosttanSlug(request.headers.get('host'));
}

/**
 * İsteğin ait olduğu aktif tenant kaydını döndürür.
 * @param {Request} request
 * @returns {Promise<Object|null>} tenant kaydı veya null (bilinmiyor/pasif)
 */
export async function aktifTenant(request) {
  return tenantSlugIle(hostSlugCikar(request));
}

/**
 * İsteğin tenant_id'sini döndürür (yoksa null).
 * @param {Request} request
 * @returns {Promise<number|null>}
 */
export async function aktifTenantId(request) {
  const tenant = await aktifTenant(request);
  return tenant ? tenant.id : null;
}

/** Loglama/debug için: tenant bilgisini prettify et. */
export function formatTenantInfo(tenant) {
  if (!tenant) return '[Tenant: bilinmiyor]';
  if (typeof tenant === 'string') return `[Tenant: ${tenant}]`;
  return `[Tenant: ${tenant.slug}#${tenant.id}]`;
}

/** Önbelleği temizler (test/operasyon için). */
export function tenantCacheTemizle() {
  _snapshot = new Map();
  _snapshotTs = 0;
  _yenilemeSozu = null;
}
