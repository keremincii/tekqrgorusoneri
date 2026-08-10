-- 0001 — Kategori ekseninin sökülmesi
-- =====================================================================
-- Uygula: docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/0001_kategorisiz.sql
--
-- NEDEN: Bu üründe tek merkezî QR vardır ve vatandaşa KATEGORİ SORULMAZ. Sınıflandırma
-- ekseni `sikayetler.tur` (şikayet / görüş / öneri) ile 0000'da zaten kurulmuştu; bu
-- migration eski ekseni geride bırakılan iki yerden temizler:
--
--   1. `sikayetler.kategori` NOT NULL idi → yeni kayıtlar kategori yazmadığı için
--      INSERT'ler kısıt ihlaliyle patlardı. Kolon DÜŞÜRÜLMEZ, yalnız NOT NULL kalkar:
--      Gülşehir kod tabanından türetilmiş kurulumlarda eski satırların kategorisi
--      bilgi olarak durur (uygulama okumaz, yeni kayıtlarda NULL'dur).
--
--   2. `birim_kategoriler` tablosu, "hangi kategori hangi birime düşer" yönlendirme
--      eşleşmesiydi. Eşleşmenin SOL TARAFI artık yok. Tabloyu boş bırakmak "otomatik
--      dağıtım hâlâ var ama hiç eşleşme girilmemiş" gibi okunurdu; oysa özellik
--      kaldırıldı: yeni başvuru başkan/yardımcıya bilgi olarak düşer, saha personeline
--      yalnız yönetim ATADIĞINDA iletilir. `birimler` tablosu KALIR — personeli
--      gruplamaya (panelde "kime atayayım?") devam eder.
--
-- İDEMPOTENT: iki kez çalıştırılırsa ikincisi hiçbir şey yapmaz (DROP ... IF EXISTS,
-- DROP NOT NULL zaten kalkmış kolonda hatasızdır).

BEGIN;

-- 1. Kategori artık toplanmıyor → zorunluluk kalkar (kolon geriye dönük uyum için kalır).
ALTER TABLE public.sikayetler
  ALTER COLUMN kategori DROP NOT NULL;

-- 2. Kategori→birim yönlendirme eşleşmesi tamamen kalkar.
--    (Index'ler ve FK'ler tabloyla birlikte düşer; ayrıca DROP gerekmez.)
DROP TABLE IF EXISTS public.birim_kategoriler;

COMMIT;
