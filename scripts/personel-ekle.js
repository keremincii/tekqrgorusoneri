/**
 * Personel Ekleme Scripti (geliştirici fallback)
 *
 * Kullanım:
 *   node scripts/personel-ekle.js <belediye-slug> <ad> <soyad> [telefon]
 *
 * Örnek:
 *   node scripts/personel-ekle.js gulsehir Ahmet Yılmaz 05551112233
 *
 * NOT: Birincil yol, başkanın admin panelinden "Saha Ekibi → Personel Ekle"
 * ile self-service eklemesidir. Bu script yalnızca DB'ye doğrudan erişim
 * gerektiğinde INSERT SQL'i üretir (DB'de çalıştırın).
 *
 * Telegram bağlantısı ayrı bir adımdır: personel eklendikten sonra panelden
 * "🔗 Link" ile bağlantı linki üretip personele gönderin.
 */

function main() {
  const slug = (process.argv[2] || '').toLowerCase().trim();
  const ad = (process.argv[3] || '').trim();
  const soyad = (process.argv[4] || '').trim();
  const telefon = (process.argv[5] || '').trim();

  if (!slug || !/^[a-z0-9-]+$/.test(slug) || !ad || !soyad) {
    console.error('❌ Eksik/geçersiz argüman!');
    console.error('   Kullanım: node scripts/personel-ekle.js <slug> <ad> <soyad> [telefon]');
    console.error('   Örnek:    node scripts/personel-ekle.js gulsehir Ahmet Yılmaz 05551112233');
    process.exit(1);
  }

  const q = (s) => s.replace(/'/g, "''");
  const telefonSql = telefon ? `'${q(telefon)}'` : 'NULL';

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`👷 PERSONEL EKLE — ${slug}: ${ad} ${soyad}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('📄 SQL (veritabanında çalıştır):');
  console.log('');
  console.log(`INSERT INTO personeller (id, tenant_id, ad, soyad, telefon, aktif)`);
  console.log(`VALUES (gen_random_uuid(), (SELECT id FROM tenantlar WHERE slug='${q(slug)}'), '${q(ad)}', '${q(soyad)}', ${telefonSql}, true);`);
  console.log('');
  console.log('➡️  Sonra panelden "🔗 Link" ile Telegram bağlantı linki üretip personele gönderin.');
  console.log('');
}

main();
