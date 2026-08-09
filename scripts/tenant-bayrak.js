/**
 * Tenant Davranış Bayrağı Aç/Kapat Aracı
 * ======================================
 *
 * MEVCUT bir belediyenin davranış bayraklarını değiştirir.
 *
 * Bayraklar (tenantlar tablosu — VARSAYILAN KAPALI):
 *   cozum_smsi_acik : şikayet sonuçlandığında vatandaşa "çözüldü" SMS'i gider. Bunun için
 *                     telefon numarası ŞİFRELİ saklanır (sikayetler.telefon_enc) ve amaç
 *                     bitince otomatik imha edilir. KAPALIYKEN NUMARA HİÇ SAKLANMAZ ve
 *                     aydınlatma metninde telefon saklama maddesi GÖRÜNMEZ.
 *                     ⚠ Bu bayrak YENİ BİR KVKK İŞLEME FAALİYETİ başlatır: açmadan önce
 *                     belediyenin aydınlatma metni ve protokolü buna göre güncellenmiş
 *                     olmalıdır. Kapatınca script, o belediyenin SAKLANAN numaralarını
 *                     silen sorguyu da basar (bayrak kapalıyken veri durmamalı).
 *
 * Kullanım:
 *   node scripts/tenant-bayrak.js <slug> [--cozum-smsi-ac|--cozum-smsi-kapat]
 * Örnekler:
 *   node scripts/tenant-bayrak.js gulsehir --cozum-smsi-ac   # çözüm SMS'ini aç
 *   node scripts/tenant-bayrak.js gulsehir                   # yalnız MEVCUT durumu sorgula
 *
 * Çıktı: kopyala-yapıştır hazır docker exec + UPDATE komutu (DB'ye YAZMAZ, komutu basar) —
 * tenant-harita.js ile aynı kalıp.
 */

const sqlEsc = (s) => String(s).replace(/'/g, "''");

const KULLANIM =
  'Kullanım: node scripts/tenant-bayrak.js <slug> [--cozum-smsi-ac|--cozum-smsi-kapat]';

function main() {
  const argv = process.argv.slice(2);
  const kalan = [];
  // Bayrak: null = DOKUNMA (kolon UPDATE'e hiç girmez), true/false = o değere ayarla.
  let cozumSmsi = null;
  // Aynı bayrağın hem aç hem kapat hâli verilirse SESSİZCE sonuncusu kazanmasın:
  // niyetin tersi bir UPDATE üretip canlıda yanlış modu açmak, fark edilmesi en zor
  // hatadır (bayrak kapalı = "eski davranış", yani hiçbir şey patlamaz).
  const cakisma = (bayrak) => {
    console.error(`❌ Çelişkili bayrak: ${bayrak} için hem "ac" hem "kapat" verildi.`);
    console.error(KULLANIM);
    process.exit(1);
  };
  for (const a of argv) {
    if (a === '--cozum-smsi-ac') { if (cozumSmsi === false) cakisma('--cozum-smsi'); cozumSmsi = true; }
    else if (a === '--cozum-smsi-kapat') { if (cozumSmsi === true) cakisma('--cozum-smsi'); cozumSmsi = false; }
    else if (a.startsWith('--')) {
      console.error(`❌ Bilinmeyen bayrak: ${a}`);
      console.error(KULLANIM);
      process.exit(1);
    } else kalan.push(a);
  }

  const slug = (kalan[0] || '').toLowerCase().trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    console.error('❌ Belediye slug\'ı eksik veya geçersiz (yalnız a-z 0-9 -).');
    console.error(KULLANIM);
    process.exit(1);
  }

  const slugSql = sqlEsc(slug);
  const durumSql = `SELECT slug, cozum_smsi_acik, aktif FROM tenantlar WHERE slug = '${slugSql}';`;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🚩 TENANT BAYRAKLARI — ${slug}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (cozumSmsi === null) {
    // Hiç bayrak verilmedi → değiştirme, yalnız mevcut durumu göster.
    console.log('ℹ Değiştirilecek bayrak verilmedi. Önce MEVCUT durumu görün:');
    console.log('');
    console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
    console.log(durumSql);
    console.log('EOF');
    console.log('');
    console.log(KULLANIM);
    console.log('');
    return;
  }

  // RETURNING: slug yanlış yazılmışsa psql hiç satır döndürmez → "UPDATE 0" yerine
  // gözle görülür bir boş sonuç çıkar, yanlış belediyeyi açtığını sanmazsın.
  const sql =
    `UPDATE tenantlar SET\n  cozum_smsi_acik = ${cozumSmsi}\n` +
    `WHERE slug = '${slugSql}'\n` +
    `RETURNING slug, cozum_smsi_acik;`;

  console.log(`   cozum_smsi_acik → ${cozumSmsi ? 'AÇIK' : 'KAPALI'}`);
  console.log('');
  console.log("📄 VPS'te ÇALIŞTIR (tek parça kopyala-yapıştır):");
  console.log('');
  console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
  console.log(sql);
  console.log('EOF');
  console.log('');
  if (cozumSmsi === false) {
    // Bayrak kapatılıyorsa SAKLANAN numaralar da gitmeli: "artık saklamıyoruz" demek,
    // önceden saklananların durmaya devam etmesiyle bağdaşmaz (KVKK amaçla bağlılık).
    console.log('');
    console.log('🧹 Çözüm SMS\'i KAPATILIYOR — bu belediyenin SAKLANAN numaralarını da silin:');
    console.log('');
    console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
    console.log(`UPDATE sikayetler SET telefon_enc = NULL
WHERE telefon_enc IS NOT NULL
  AND tenant_id = (SELECT id FROM tenantlar WHERE slug = '${slugSql}');`);
    console.log('EOF');
    console.log('');
  }

  console.log('⚠ Bu kolon migration 0016 ile gelir. Uygulanmadıysa UPDATE "column does not');
  console.log('  exist" ile patlar: docker compose exec -T db psql -U belediye -d belediye < drizzle/0016_cozum_smsi_telefon.sql');
  console.log('');
  console.log('ℹ️  DEĞİŞİKLİK ANINDA GÖRÜNMEZ: tenant anlık görüntüsü (lib/server/tenant.js,');
  console.log('   SNAPSHOT_TTL_MS) 60 sn önbelleklidir → yeni davranış EN GEÇ 1 dakika içinde');
  console.log('   canlıya yansır. Hemen test edip "çalışmadı" diye SQL\'i tekrar çalıştırma.');
  console.log('   (Uygulamanın birden çok kopyası varsa her kopya kendi 60 sn\'sini bekler.)');
  console.log('');
  console.log('🔎 Doğrulama sorgusu:');
  console.log(`   ${durumSql}`);
  console.log('');
}

main();
