/**
 * Belediyenin KVKK BAŞVURU KANALLARINI ayarlama aracı (migration 0017)
 * ====================================================================
 *
 * Aydınlatma metninin "Haklarınız (KVKK m.11)" bölümünde gösterilen somut kanallar:
 * posta adresi, KEP adresi, e-posta ve belediyenin kendi KVKK sayfası.
 *
 * NEDEN GEREKLİ: KVKK m.10, ilgili kişiye haklarını NEREYE başvurarak kullanacağını da
 * bildirmeyi gerektirir. "Belediyenin ilan ettiği kanallar" gibi genel bir ifade
 * denetimde eksik sayılabilir. Belediyeler bu bilgiyi kendi metinlerinde somut verir
 * (posta adresi + KEP adresi) — biz de aynısını göstermeliyiz ki iki metin çelişmesin.
 *
 * Kullanım:
 *   node scripts/tenant-kvkk.js <slug> [--adres "..."] [--kep "..."] [--eposta "..."] [--site "..."]
 * Örnek:
 *   node scripts/tenant-kvkk.js gulsehir \
 *     --adres "... Mah, ... Cd. No: 1, 50900 Gülşehir/Nevşehir" \
 *     --kep "gulsehirbelediyesi@hs01.kep.tr" \
 *     --site "https://www.gulsehir.bel.tr"
 *   node scripts/tenant-kvkk.js gulsehir            # yalnız MEVCUT durumu sorgula
 *
 * Verilmeyen alan DEĞİŞTİRİLMEZ (UPDATE'e hiç girmez); alanı BOŞALTMAK için değerini
 * boş dize ver: --eposta ""
 *
 * Çıktı: kopyala-yapıştır hazır psql komutu (DB'ye YAZMAZ) — tenant-harita.js ile aynı kalıp.
 */

const sqlEsc = (s) => String(s).replace(/'/g, "''");

const KULLANIM =
  'Kullanım: node scripts/tenant-kvkk.js <slug> [--adres "..."] [--kep "..."] [--eposta "..."] [--site "..."]';

/** Alan adı → kolon adı. Sıra, çıktıdaki okunma sırasıdır. */
const ALANLAR = {
  adres: 'kvkk_adres',
  kep: 'kvkk_kep',
  eposta: 'kvkk_eposta',
  site: 'kvkk_site',
};

function main() {
  const argv = process.argv.slice(2);
  const kalan = [];
  const degerler = {}; // alan → string ('' = boşalt), yoksa dokunma

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const ad = a.slice(2);
      if (!(ad in ALANLAR)) {
        console.error(`❌ Bilinmeyen alan: ${a}`);
        console.error(KULLANIM);
        process.exit(1);
      }
      // Değer eksikse ya da bir sonraki argüman başka bir bayraksa erken patla:
      // "--kep --site x" sessizce kep='--site' yazan bir UPDATE üretirdi.
      const deger = argv[i + 1];
      if (deger === undefined || (deger.startsWith('--') && deger.length > 2)) {
        console.error(`❌ ${a} için değer verilmedi. Boşaltmak istiyorsan: ${a} ""`);
        process.exit(1);
      }
      degerler[ad] = deger.trim();
      i++;
    } else {
      kalan.push(a);
    }
  }

  const slug = (kalan[0] || '').toLowerCase().trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    console.error("❌ Belediye slug'ı eksik veya geçersiz (yalnız a-z 0-9 -).");
    console.error(KULLANIM);
    process.exit(1);
  }

  const slugSql = sqlEsc(slug);
  const durumSql =
    `SELECT slug, kvkk_adres, kvkk_kep, kvkk_eposta, kvkk_site FROM tenantlar WHERE slug = '${slugSql}';`;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📮 KVKK BAŞVURU KANALLARI — ${slug}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const verilen = Object.keys(degerler);
  if (verilen.length === 0) {
    console.log('ℹ Değiştirilecek alan verilmedi. Önce MEVCUT durumu görün:');
    console.log('');
    console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
    console.log(durumSql);
    console.log('EOF');
    console.log('');
    console.log(KULLANIM);
    console.log('');
    return;
  }

  const atamalar = verilen.map((ad) => {
    const v = degerler[ad];
    // Boş dize → NULL: metinde "boş satır" göstermek yerine o kanalı hiç göstermemek doğru.
    return v === '' ? `  ${ALANLAR[ad]} = NULL` : `  ${ALANLAR[ad]} = '${sqlEsc(v)}'`;
  });

  for (const ad of Object.keys(ALANLAR)) {
    const v = degerler[ad];
    const gosterim = v === undefined ? 'dokunulmuyor' : v === '' ? 'BOŞALTILIYOR' : v;
    console.log(`   ${ad.padEnd(7)} → ${gosterim}`);
  }
  console.log('');

  // RETURNING: slug yanlış yazılmışsa hiç satır dönmez → "UPDATE 0" yerine gözle
  // görülür boş sonuç çıkar, yanlış belediyeyi güncellediğini sanmazsın.
  const sql =
    `UPDATE tenantlar SET\n${atamalar.join(',\n')}\n` +
    `WHERE slug = '${slugSql}'\n` +
    `RETURNING slug, kvkk_adres, kvkk_kep, kvkk_eposta, kvkk_site;`;

  console.log("📄 VPS'te ÇALIŞTIR (tek parça kopyala-yapıştır):");
  console.log('');
  console.log("docker compose exec -T db psql -U belediye -d belediye <<'EOF'");
  console.log(sql);
  console.log('EOF');
  console.log('');
  console.log('⚠ Bu kolonlar migration 0017 ile gelir. Uygulanmadıysa UPDATE "column does not');
  console.log('  exist" ile patlar:');
  console.log('  docker compose exec -T db psql -U belediye -d belediye < drizzle/0017_tenant_kvkk_iletisim.sql');
  console.log('');
  console.log('ℹ️  Metin 60 sn içinde güncellenir (tenant anlık görüntüsü önbelleklidir).');
  console.log('');
  console.log('🔎 Doğrulama:');
  console.log(`   ${durumSql}`);
  console.log('');
}

main();
