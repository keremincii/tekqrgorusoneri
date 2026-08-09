/**
 * Per-Tenant Admin Harita Görünüm Kutusu (sinir) Ayarlama Aracı
 * ============================================================
 *
 * Bir belediyenin admin haritasının açılışta kilitleneceği dikdörtgeni (sinir) ayarlar.
 * Dört köşe de verilince admin haritası TAM bu kutuyu gösterir + dışına çıkışı kilitler.
 * Kutu VERİLMEZSE (bu script çalıştırılmazsa) harita tenant merkez/zoom'una düşer
 * (tenant-ekle.js ile girilen harita_enlem/boylam/zoom) — o da yeterlidir; bu script
 * yalnız Gülşehir gibi elle-ince-ayarlı bir kutu istendiğinde gerekir.
 *
 * Köşeler: GB = güneybatı (en KÜÇÜK enlem/boylam), KD = kuzeydoğu (en BÜYÜK enlem/boylam).
 * Google Maps'ten sağ-tık → koordinat ile alınabilir.
 *
 * Kullanım:
 *   node scripts/tenant-harita.js <slug> <gb_enlem> <gb_boylam> <kd_enlem> <kd_boylam>
 * Örnek (Gülşehir'in mevcut kutusu):
 *   node scripts/tenant-harita.js gulsehir 38.723567 34.598041 38.770426 34.667735
 *
 * Çıktı: kopyala-yapıştır hazır docker exec + UPDATE komutu (DB'ye yazmaz, komutu basar).
 */

const sqlEsc = (s) => String(s).replace(/'/g, "''");

function main() {
  const [slug, gbE, gbB, kdE, kdB] = process.argv.slice(2);
  if (!slug || gbE === undefined || gbB === undefined || kdE === undefined || kdB === undefined) {
    console.error('Kullanım: node scripts/tenant-harita.js <slug> <gb_enlem> <gb_boylam> <kd_enlem> <kd_boylam>');
    console.error('Örnek:    node scripts/tenant-harita.js gulsehir 38.723567 34.598041 38.770426 34.667735');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error('❌ Geçersiz slug (yalnız a-z 0-9 -).');
    process.exit(1);
  }
  const sayilar = { gbE: parseFloat(gbE), gbB: parseFloat(gbB), kdE: parseFloat(kdE), kdB: parseFloat(kdB) };
  for (const [k, v] of Object.entries(sayilar)) {
    if (!Number.isFinite(v)) { console.error(`❌ Geçersiz sayı: ${k}=${v}`); process.exit(1); }
  }
  if (sayilar.gbE >= sayilar.kdE || sayilar.gbB >= sayilar.kdB) {
    console.error('❌ GB köşesi KD köşesinden KÜÇÜK olmalı (gb_enlem<kd_enlem ve gb_boylam<kd_boylam).');
    console.error('   GB = güneybatı (min), KD = kuzeydoğu (max). Değerleri karıştırmış olabilirsin.');
    process.exit(1);
  }

  const sql =
    `UPDATE tenantlar SET\n` +
    `  sinir_gb_enlem = ${sayilar.gbE},\n` +
    `  sinir_gb_boylam = ${sayilar.gbB},\n` +
    `  sinir_kd_enlem = ${sayilar.kdE},\n` +
    `  sinir_kd_boylam = ${sayilar.kdB}\n` +
    `WHERE slug = '${sqlEsc(slug)}';`;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🗺️  HARİTA SINIRI — ${slug}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log("📄 VPS'te ÇALIŞTIR (tek parça kopyala-yapıştır):");
  console.log('');
  console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
  console.log(sql);
  console.log('EOF');
  console.log('');
  console.log('ℹ 60 sn içinde snapshot yenilenir; o belediyenin admin haritası bu kutuya kilitlenir.');
  console.log('⚠ Bu kutunun İÇİNİN tile\'ları indirilmiş olmalı (scripts/tile-indir.js) yoksa gri boşluk çıkar.');
  console.log('');
}

main();
