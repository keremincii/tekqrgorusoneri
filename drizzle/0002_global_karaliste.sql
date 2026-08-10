-- 0002 — Kara liste (engelli_kimlikler) TENANT'TAN BAĞIMSIZ hale gelir
-- =====================================================================
-- Uygula: docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/0002_global_karaliste.sql
--
-- NEDEN: Bir kimlik (telefon hash'i) engellendiğinde, bu artık YALNIZ engellendiği
-- belediyeyi değil, bu DAĞITIMDAKİ (aynı veritabanını paylaşan) TÜM belediyeleri
-- kapsar. Kimlik hash'i bu dağıtımın TEK bir HMAC_SECRET'ıyla türetildiği için aynı
-- telefon hangi belediyeden başvursa AYNI hash'i üretir — troll bir belediyede
-- engellenip komşu belediyede aynı numarayla devam edemesin diye bilinçli tercih.
--
-- KAPSAM SINIRI: Bu yalnız BU dağıtım içindir. Farklı bir sunucudaki/HMAC_SECRET'ı
-- FARKLI bir dağıtımdaki belediyeye uzanmaz — oradaki hash matematiksel olarak
-- bambaşka bir değerdir, sırrı paylaşmadan eşleştirilemez.
--
-- VERİ KAYBI YOK: (tenant_id, kimlik_hash) birlikte benzersizdi; artık yalnız
-- kimlik_hash benzersiz olacak. Aynı hash zaten en fazla bir tenant'ta engelliydi
-- (uygulama tek bir tenant'tan engelliyordu), bu yüzden birleştirmede çakışma
-- beklenmez — beklenmedik bir çakışma çıkarsa (aynı hash birden çok tenant'ta ayrı
-- ayrı engellenmişse) DISTINCT ON ile en eski kaydı tutar, migration hata vermez.

BEGIN;

-- Olası çakışan (tenant başına ayrı engellenmiş) hash'leri tekilleştir: her hash için
-- en eski kaydı tut, gerisini sil. Taze kurulumlarda (Derinkuyu gibi) bu adım 0 satır
-- siler; migration idempotent ve zararsız kalır.
DELETE FROM public.engelli_kimlikler a
USING public.engelli_kimlikler b
WHERE a.kimlik_hash = b.kimlik_hash
  AND a.olusturma_tarihi > b.olusturma_tarihi;

ALTER TABLE public.engelli_kimlikler
  DROP CONSTRAINT IF EXISTS engelli_kimlikler_tenant_id_tenantlar_id_fk;

DROP INDEX IF EXISTS public.engelli_kimlikler_tenant_hash_uniq;

ALTER TABLE public.engelli_kimlikler
  DROP COLUMN IF EXISTS tenant_id;

CREATE UNIQUE INDEX IF NOT EXISTS engelli_kimlikler_hash_uniq
  ON public.engelli_kimlikler (kimlik_hash);

COMMIT;
