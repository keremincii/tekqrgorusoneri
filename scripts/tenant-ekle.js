/**
 * Tenant (Belediye) Ekleme Scripti
 *
 * Multi-tenant tek-DB modelinde her belediye `tenantlar` tablosunda bir satırdır.
 * Tenant ÇÖZÜMLEMESİ subdomain'den yapılır (gulsehir.sikayet.com → slug "gulsehir"),
 * bu yüzden slug subdomain ile birebir aynı olmalıdır.
 *
 * Kullanım:
 *   node scripts/tenant-ekle.js <slug> "<Belediye Adı>" [enlem] [boylam] [zoom] \
 *        [--baskan "<Ad Soyad>"]
 *
 * Örnek:
 *   node scripts/tenant-ekle.js gulsehir "Gülşehir Belediyesi" 38.746 34.62 14 --baskan "Erkan Çiftci"
 *   node scripts/tenant-ekle.js nevsehir "Nevşehir Belediyesi" --baskan "Ahmet Yılmaz"
 *
 * `--baskan` OPSİYONEL: verilmezse baskan_adi NULL kalır → şikayet başarı ekranında
 * başkan imzası bölümü gösterilmez (kırılmaz, sadece görünmez). Bayrak konumdan
 * bağımsızdır — enlem/boylam/zoom sırasını etkilemez.
 *
 * MEVCUT bir belediyenin bayraklarını sonradan değiştirmek için: scripts/tenant-bayrak.js
 *
 * Çıktı: 'tenantlar' tablosuna çalıştıracağınız INSERT SQL'i. Harita merkezi
 * verilmezse (enlem/boylam boş) harita o belediyenin sokaklarına göre otomatik
 * ortalanır.
 */

const KULLANIM =
  '   Kullanım: node scripts/tenant-ekle.js <slug> "<Belediye Adı>" [enlem] [boylam] [zoom] [--baskan "<Ad Soyad>"]';

function main() {
  const argv = process.argv.slice(2);

  // --baskan "<Ad Soyad>" konumdan bağımsız ayıklanır; kalan argümanlar eskisi gibi
  // pozisyoneldir (slug, ad, enlem, boylam, zoom).
  let baskanAdi = null;
  const kalan = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baskan') {
      // Değer eksikse ya da başka bir bayraksa erken patla: "--baskan --xyz"
      // sessizce baskan_adi='--xyz' yazan bir INSERT üretirdi.
      const deger = argv[++i];
      if (deger === undefined || deger.startsWith('--')) {
        console.error('❌ --baskan bir ad bekliyor: --baskan "Ad Soyad"');
        console.error(KULLANIM);
        process.exit(1);
      }
      baskanAdi = deger;
    } else if (argv[i].startsWith('--')) {
      // Tanınmayan bayrak SESSİZCE pozisyonel argüman olarak kabul edilirse ("--tekqr")
      // slug/ad/zoom yerine geçer ve yanlış bir tenant satırı üretilir. Erken patla.
      console.error(`❌ Bilinmeyen bayrak: ${argv[i]}`);
      console.error(KULLANIM);
      process.exit(1);
    } else {
      kalan.push(argv[i]);
    }
  }
  const [slug, ad, enlem, boylam, zoom] = kalan;

  if (!slug || !ad) {
    console.error('❌ Eksik argüman.');
    console.error(KULLANIM);
    process.exit(1);
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error('❌ slug yalnızca küçük harf, rakam ve tire içerebilir (subdomain ile aynı olmalı).');
    process.exit(1);
  }

  // Sayısal alanlar: verilmişlerse GERÇEKTEN sayı olmalı. parseFloat('abc') → NaN ve
  // NaN doğrudan SQL'e basılırsa psql "column ... NaN" ile patlar; daha kötüsü
  // parseFloat('38,375') → 38 sessizce YANLIŞ bir merkez yazar (Türkçe ondalık virgülü).
  const sayi = (deger, etiket, desen, ornek) => {
    const s = String(deger).trim();
    if (!desen.test(s)) {
      console.error(`❌ ${etiket} geçersiz: "${deger}" — beklenen biçim: ${ornek}`);
      process.exit(1);
    }
    return Number(s);
  };
  const adEsc = ad.replace(/'/g, "''");
  const ONDALIK = /^-?\d+(\.\d+)?$/; // ondalık ayırıcı NOKTA (Türkçe virgül SQL'e sızmasın)
  const enlemSql = enlem ? sayi(enlem, 'enlem', ONDALIK, '38.746') : 'NULL';
  const boylamSql = boylam ? sayi(boylam, 'boylam', ONDALIK, '34.62') : 'NULL';
  const zoomSql = zoom ? sayi(zoom, 'zoom', /^\d{1,2}$/, 'tam sayı, ör. 14') : 14;
  const baskanSql = baskanAdi ? `'${baskanAdi.replace(/'/g, "''")}'` : 'NULL';

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🏛️  TENANT (BELEDİYE) EKLEME: ${ad} (${slug})`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Aşağıdaki SQL\'i veritabanı konsolunda çalıştırın:');
  console.log('');
  console.log(`INSERT INTO tenantlar (slug, ad, baskan_adi, harita_enlem, harita_boylam, harita_zoom, aktif)`);
  console.log(`VALUES ('${slug}', '${adEsc}', ${baskanSql}, ${enlemSql}, ${boylamSql}, ${zoomSql}, true)`);
  console.log(`RETURNING id;`);
  console.log('');
  if (!baskanAdi) {
    console.log('ℹ️  Başkan adı verilmedi (--baskan "Ad Soyad") — başarı ekranında imza bölümü boş kalır.');
    console.log('   Sonradan eklemek için: UPDATE tenantlar SET baskan_adi=\'...\' WHERE slug=\'' + slug + '\';');
    console.log('');
  }
  console.log('⚠️  Dönen id değerini not edin: sokakları yüklerken (.env.local içindeki');
  console.log('   NEXT_PUBLIC_TENANT_ID) bu id kullanılmalıdır. Subdomain ise:');
  console.log(`   ${slug}.<ana-domain>`);
  console.log('');
  console.log('ℹ️  Tenant anlık görüntüsü (snapshot) 60 sn önbelleklidir — yeni belediye/bayrak');
  console.log('   değişikliği canlıda EN GEÇ 1 dakika içinde görünür (yeniden başlatma gerekmez).');
  console.log('');
}

main();
