/**
 * Tabela Numarası (Nokta_No) → DB Yükleyici / Doğrulayıcı
 * =======================================================
 *
 * Fiziksel QR levhalarının üstünde basılı numarayı (Nokta_No) `sokaklar.tabela_no`
 * kolonuna yazmak için SQL üretir. Kaynak: DB'den seed anında dışa aktarılmış
 * `gulsehir-qr-data.csv` (başlık: id,sokak_adi,enlem,boylam — burada sokak_adi
 * sütunu placeholder NUMARADIR, tabelaya basılan değer budur).
 *
 * ⚠️ İSİM KULLANILMAZ. Eşleşme ve doğrulama tamamen UUID + KOORDİNAT üzerinden yapılır
 * (reverse-geocode isim normalizasyonu sahte uyuşmazlık üretmesin diye). Yalnız fiziksel
 * levhası olan sokaklar numaraya sahiptir; sanal (levhasız) sokaklar CSV'de yoktur → NULL kalır.
 *
 * Üretilen dosyalar (kök dizin):
 *   tabela-dogrula.<slug>.sql  → DB'ye YAZMADAN önce çalıştır: numara↔UUID↔koordinat raporu
 *   tabela-no.<slug>.sql       → koordinat-güvenli UPDATE (yalnız UUID+koordinat tutarsa yazar)
 *
 * Kullanım:
 *   node scripts/tabela-no-yukle.js [slug] [csv-yolu]
 *   node scripts/tabela-no-yukle.js gulsehir ./gulsehir-qr-data.csv
 *
 * Uygulama (VPS):
 *   docker compose exec -T db psql -U belediye -d belediye < tabela-dogrula.gulsehir.sql   # ÖNCE incele
 *   docker compose exec -T db psql -U belediye -d belediye < tabela-no.gulsehir.sql        # rapor temizse uygula
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sqlEsc(s) {
  return String(s).replace(/'/g, "''");
}

/** CSV → [{id, no, enlem, boylam(str)}] (başlık: id,sokak_adi,enlem,boylam). */
function oku(csvPath) {
  const satirlar = fs.readFileSync(csvPath, 'utf8')
    .split('\n').map((s) => s.replace(/\r$/, '').trim()).filter(Boolean);
  const veri = satirlar.slice(1); // başlık atla
  const kayitlar = [];
  const atlanan = [];
  for (const satir of veri) {
    const p = satir.split(',');
    if (p.length < 4) { atlanan.push(satir); continue; }
    const id = p[0].trim();
    const no = p[1].trim();
    const enlemStr = p[2].trim();
    const boylamStr = p[3].trim();
    const enlem = parseFloat(enlemStr);
    const boylam = parseFloat(boylamStr);
    if (!UUID_RE.test(id) || !no || !Number.isFinite(enlem) || !Number.isFinite(boylam)) {
      atlanan.push(satir);
      continue;
    }
    // SAYISAL değer sakla (ham string DEĞİL): SQL'e `${k.enlem}` olarak gömülürken
    // yalnız temiz bir sayı literali çıkar. parseFloat "38.7);DROP…" gibi bir girdide
    // 38.7 döndürüp finite geçse de, ham string emit edilseydi ikinci-derece SQL
    // enjeksiyonu olurdu; sayıyı emit etmek bunu kökten engeller.
    kayitlar.push({ id, no, enlem, boylam });
  }
  return { kayitlar, atlanan };
}

function main() {
  const slug = (process.argv[2] || 'gulsehir').toLowerCase().trim();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error('❌ Geçersiz slug.');
    process.exit(1);
  }
  const csvArg = process.argv[3] || 'gulsehir-qr-data.csv';
  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV bulunamadı:', csvPath);
    process.exit(1);
  }

  const { kayitlar, atlanan } = oku(csvPath);
  if (kayitlar.length === 0) {
    console.error('❌ CSV\'de geçerli (UUID\'li) satır yok.');
    process.exit(1);
  }

  const slugEsc = sqlEsc(slug);
  // VALUES demeti: ('uuid'::uuid,'no',enlem,boylam)
  const values = kayitlar
    .map((k) => `  ('${k.id}'::uuid, '${sqlEsc(k.no)}', ${k.enlem}, ${k.boylam})`)
    .join(',\n');

  // ---- Doğrulama SQL (isimsiz; UUID + koordinat) ----
  const dogrula = `-- DOĞRULAMA — numara↔UUID↔koordinat (İSİM KULLANILMAZ). tabela-no.${slug}.sql'den ÖNCE çalıştır.
-- Beklenen: "eslesen_ok" ≈ fiziksel sokak sayısı; "db_de_yok" = silinmiş/eksik (ör. 55 silindiyse);
-- "koordinat_uyusmaz" = 0 olmalı (>0 ise o UUID bayat/farklı noktaya bakıyor → elle incele).
BEGIN;
CREATE TEMP TABLE _csv(uuid uuid, tabela_no varchar(20), enlem double precision, boylam double precision) ON COMMIT DROP;
INSERT INTO _csv (uuid, tabela_no, enlem, boylam) VALUES
${values};

-- Özet
SELECT
  (SELECT count(*) FROM _csv) AS csv_toplam,
  count(*) FILTER (WHERE s.id IS NULL) AS db_de_yok,
  count(*) FILTER (WHERE s.id IS NOT NULL AND (round(s.enlem::numeric,5) <> round(c.enlem::numeric,5) OR round(s.boylam::numeric,5) <> round(c.boylam::numeric,5))) AS koordinat_uyusmaz,
  count(*) FILTER (WHERE s.id IS NOT NULL AND round(s.enlem::numeric,5) = round(c.enlem::numeric,5) AND round(s.boylam::numeric,5) = round(c.boylam::numeric,5)) AS eslesen_ok
FROM _csv c
LEFT JOIN sokaklar s ON s.id = c.uuid;

-- Detay: yalnız SORUNLU satırlar (temizse 0 satır döner)
SELECT c.tabela_no,
       c.uuid,
       CASE WHEN s.id IS NULL THEN 'DB_DE_YOK' ELSE 'KOORDINAT_UYUSMAZ' END AS durum,
       s.sokak_adi AS db_isim
FROM _csv c
LEFT JOIN sokaklar s ON s.id = c.uuid
WHERE s.id IS NULL
   OR round(s.enlem::numeric,5) <> round(c.enlem::numeric,5)
   OR round(s.boylam::numeric,5) <> round(c.boylam::numeric,5)
ORDER BY length(c.tabela_no), c.tabela_no;
COMMIT;
`;

  // ---- UPDATE SQL (koordinat-güvenli + tenant-kapsamlı) ----
  const guncelle = `-- TABELA NO YÜKLEME (tenant: ${slug}) — koordinat-güvenli, idempotent
-- Uygula: docker compose exec -T db psql -U belediye -d belediye < tabela-no.${slug}.sql
-- Önce migration: docker compose exec -T db psql -U belediye -d belediye < drizzle/0007_sokak_tabela_no.sql
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenantlar WHERE slug = '${slugEsc}' AND aktif = true) THEN
    RAISE EXCEPTION 'Tenant bulunamadi veya pasif: ${slugEsc}';
  END IF;
END $$;

CREATE TEMP TABLE _csv(uuid uuid, tabela_no varchar(20), enlem double precision, boylam double precision) ON COMMIT DROP;
INSERT INTO _csv (uuid, tabela_no, enlem, boylam) VALUES
${values};

-- Yalnız UUID EŞLEŞEN + KOORDİNAT tutan + doğru tenant satırına yazar (isme bakmaz).
UPDATE sokaklar s
SET tabela_no = c.tabela_no
FROM _csv c
WHERE s.id = c.uuid
  AND s.tenant_id = (SELECT id FROM tenantlar WHERE slug = '${slugEsc}')
  AND round(s.enlem::numeric,5) = round(c.enlem::numeric,5)
  AND round(s.boylam::numeric,5) = round(c.boylam::numeric,5);

-- Kaç sokakta tabela_no dolu (bu tenant):
SELECT count(*) AS tabela_no_dolu
FROM sokaklar
WHERE tenant_id = (SELECT id FROM tenantlar WHERE slug = '${slugEsc}')
  AND tabela_no IS NOT NULL;
COMMIT;
`;

  const dogrulaYol = path.join(__dirname, '..', `tabela-dogrula.${slug}.sql`);
  const guncelleYol = path.join(__dirname, '..', `tabela-no.${slug}.sql`);
  fs.writeFileSync(dogrulaYol, dogrula, 'utf8');
  fs.writeFileSync(guncelleYol, guncelle, 'utf8');

  const toki = kayitlar.filter((k) => !/^\d+$/.test(k.no)).length;
  const sayisal = kayitlar.length - toki;

  console.log('═══════════════════════════════════════════════');
  console.log(`📊 TABELA NO — ${slug}`);
  console.log('═══════════════════════════════════════════════');
  console.log(`   CSV geçerli satır : ${kayitlar.length}`);
  console.log(`   ├─ sayısal numara : ${sayisal}`);
  console.log(`   └─ metinsel (TOKI): ${toki}`);
  console.log(`   Atlanan satır     : ${atlanan.length}`);
  console.log('───────────────────────────────────────────────');
  console.log(`📄 Doğrulama : ${dogrulaYol}`);
  console.log(`📄 UPDATE    : ${guncelleYol}`);
  console.log('\n👉 VPS\'te sırayla:');
  console.log(`   1) docker compose exec -T db psql -U belediye -d belediye < drizzle/0007_sokak_tabela_no.sql`);
  console.log(`   2) docker compose exec -T db psql -U belediye -d belediye < tabela-dogrula.${slug}.sql   # raporu incele`);
  console.log(`   3) docker compose exec -T db psql -U belediye -d belediye < tabela-no.${slug}.sql        # temizse uygula`);
  if (atlanan.length) {
    console.log('\n⚠️  Atlanan satır örnekleri (ilk 5):');
    atlanan.slice(0, 5).forEach((s) => console.log(`   ${s}`));
  }
}

main();
