-- 0000 — Başlangıç şeması (tek QR / görüş-öneri ürünü)
-- =====================================================================
-- Uygula: docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/0000_init.sql
--
-- Bu dosya, aynı kod tabanının Gülşehir kurulumundaki CANLI şemasından
-- (pg_dump --schema-only) türetilmiştir; yani uydurma değil, çalıştığı
-- doğrulanmış bir şemadır. Yeni ürüne göre iki fark vardır:
--   - `sms_kodlari` ATILDI: ölü tablo, OTP'ler Redis'te tutuluyor.
--   - `sikayetler.tur` EKLENDİ: vatandaş şikayet / görüş / öneri seçer.
--
-- NOT: `drizzle-kit generate/push` KULLANMA. Migration'lar elle yazılır ve
-- elle uygulanır (00NN_*.sql), sıra sabittir: önce migration, sonra kod.

BEGIN;

--
--

\restrict 5vwuG8wzFxq0CZ737GR7LaA5zOQphaJHAjmkph90qjzjHhWfT8XhwbYXMYDNacZ

--
--

CREATE TABLE public.admin_oturumlar (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    oturum_hash character varying(64) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    son_erisim_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    etiket character varying(40)
);

--
--

CREATE TABLE public.birim_kategoriler (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    birim_id uuid NOT NULL,
    kategori character varying(50) NOT NULL
);

--
--

CREATE TABLE public.birimler (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    ad character varying(120) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL
);

--
--

CREATE TABLE public.engelli_kimlikler (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    kimlik_hash character varying(64) NOT NULL,
    sebep character varying(200),
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL
);

--
--

CREATE TABLE public.magic_linkler (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    token_hash character varying(64) NOT NULL,
    kullanildi boolean DEFAULT false NOT NULL,
    son_gecerlilik_tarihi timestamp without time zone NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    kullanilma_tarihi timestamp without time zone,
    etiket character varying(40)
);

--
--

CREATE TABLE public.personel_baglanti_kodlari (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    personel_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    kullanildi boolean DEFAULT false NOT NULL,
    son_gecerlilik_tarihi timestamp without time zone NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    kullanilma_tarihi timestamp without time zone
);

--
--

CREATE TABLE public.personeller (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    ad character varying(100) NOT NULL,
    soyad character varying(100) NOT NULL,
    telefon character varying(20),
    telegram_chat_id bigint,
    aktif boolean DEFAULT true NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    rol character varying(20) DEFAULT 'personel'::character varying NOT NULL,
    birim_id uuid
);

--
--

CREATE TABLE public.sikayetler (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    sokak_id uuid NOT NULL,
    kimlik_hash character varying(64),
    kategori character varying(50) NOT NULL,
    aciklama text NOT NULL,
    fotograf_url character varying(500),
    durum character varying(20) DEFAULT 'beklemede'::character varying NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    silinme_tarihi timestamp without time zone,
    ad character varying(100),
    soyad character varying(100),
    telefon character varying(20),
    kvkk_onay boolean DEFAULT false NOT NULL,
    kvkk_onay_tarihi timestamp without time zone,
    kvkk_metin_surumu character varying(20),
    atanan_personel_id uuid,
    cozen_personel_id uuid,
    cozulme_tarihi timestamp without time zone,
    enlem double precision,
    boylam double precision,
    konum_dogruluk double precision,
    konum_kaynak character varying(20),
    konum_supheli boolean DEFAULT false NOT NULL,
    bildirilen_sokak_adi character varying(120),
    telefon_enc text
);

--
--

CREATE TABLE public.sms_gonderim_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer,
    telefon_hash character varying(64),
    ip_hash character varying(64),
    sonuc character varying(20) NOT NULL,
    sebep character varying(30),
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL
);

--
--

CREATE TABLE public.sokaklar (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    sokak_adi character varying(200) NOT NULL,
    enlem double precision NOT NULL,
    boylam double precision NOT NULL,
    hmac_imza character varying(128) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    tabela_no character varying(20),
    qr_kod character varying(12) NOT NULL
);

--
--

CREATE TABLE public.tenantlar (
    id integer NOT NULL,
    slug character varying(50) NOT NULL,
    ad character varying(150) NOT NULL,
    harita_enlem double precision,
    harita_boylam double precision,
    harita_zoom integer DEFAULT 14 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    olusturma_tarihi timestamp without time zone DEFAULT now() NOT NULL,
    baskan_adi character varying(150),
    sinir_geojson jsonb,
    netgsm_usercode character varying(50),
    netgsm_sifre_enc text,
    netgsm_header character varying(20),
    sinir_gb_enlem double precision,
    sinir_gb_boylam double precision,
    sinir_kd_enlem double precision,
    sinir_kd_boylam double precision,
    cozum_smsi_acik boolean DEFAULT false NOT NULL,
    kvkk_adres text,
    kvkk_kep character varying(150),
    kvkk_eposta character varying(150),
    kvkk_site character varying(255)
);

--
--

CREATE SEQUENCE public.tenantlar_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
--

ALTER SEQUENCE public.tenantlar_id_seq OWNED BY public.tenantlar.id;

--
--

ALTER TABLE ONLY public.tenantlar ALTER COLUMN id SET DEFAULT nextval('public.tenantlar_id_seq'::regclass);

--
--

ALTER TABLE ONLY public.admin_oturumlar
    ADD CONSTRAINT admin_oturumlar_oturum_hash_unique UNIQUE (oturum_hash);

--
--

ALTER TABLE ONLY public.admin_oturumlar
    ADD CONSTRAINT admin_oturumlar_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.birim_kategoriler
    ADD CONSTRAINT birim_kategoriler_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.birimler
    ADD CONSTRAINT birimler_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.engelli_kimlikler
    ADD CONSTRAINT engelli_kimlikler_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.magic_linkler
    ADD CONSTRAINT magic_linkler_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.magic_linkler
    ADD CONSTRAINT magic_linkler_token_hash_unique UNIQUE (token_hash);

--
--

ALTER TABLE ONLY public.personel_baglanti_kodlari
    ADD CONSTRAINT personel_baglanti_kodlari_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.personel_baglanti_kodlari
    ADD CONSTRAINT personel_baglanti_kodlari_token_hash_unique UNIQUE (token_hash);

--
--

ALTER TABLE ONLY public.personeller
    ADD CONSTRAINT personeller_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.personeller
    ADD CONSTRAINT personeller_telegram_chat_id_unique UNIQUE (telegram_chat_id);

--
--

ALTER TABLE ONLY public.sikayetler
    ADD CONSTRAINT sikayetler_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.sms_gonderim_log
    ADD CONSTRAINT sms_gonderim_log_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.sokaklar
    ADD CONSTRAINT sokaklar_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.tenantlar
    ADD CONSTRAINT tenantlar_pkey PRIMARY KEY (id);

--
--

ALTER TABLE ONLY public.tenantlar
    ADD CONSTRAINT tenantlar_slug_unique UNIQUE (slug);

--
--

CREATE INDEX admin_oturumlar_tenant_hash_idx ON public.admin_oturumlar USING btree (tenant_id, oturum_hash);

--
--

CREATE INDEX birim_kategori_birim_idx ON public.birim_kategoriler USING btree (birim_id);

--
--

CREATE UNIQUE INDEX birim_kategori_tenant_birim_kategori_key ON public.birim_kategoriler USING btree (tenant_id, birim_id, kategori);

--
--

CREATE INDEX birim_kategori_tenant_kategori_idx ON public.birim_kategoriler USING btree (tenant_id, kategori);

--
--

CREATE INDEX birimler_tenant_aktif_idx ON public.birimler USING btree (tenant_id, aktif);

--
--

CREATE INDEX engelli_kimlikler_imha_idx ON public.engelli_kimlikler USING btree (olusturma_tarihi);

--
--

CREATE UNIQUE INDEX engelli_kimlikler_tenant_hash_uniq ON public.engelli_kimlikler USING btree (tenant_id, kimlik_hash);

--
--

CREATE INDEX magic_linkler_imha_idx ON public.magic_linkler USING btree (olusturma_tarihi);

--
--

CREATE INDEX personel_kod_imha_idx ON public.personel_baglanti_kodlari USING btree (olusturma_tarihi);

--
--

CREATE INDEX personeller_tenant_aktif_idx ON public.personeller USING btree (tenant_id, aktif);

--
--

CREATE INDEX sikayetler_anonim_imha_idx ON public.sikayetler USING btree (olusturma_tarihi) WHERE (kimlik_hash IS NOT NULL);

--
--

CREATE INDEX sikayetler_personel_idx ON public.sikayetler USING btree (tenant_id, atanan_personel_id);

--
--

CREATE INDEX sikayetler_silinme_imha_idx ON public.sikayetler USING btree (silinme_tarihi) WHERE (silinme_tarihi IS NOT NULL);

--
--

CREATE INDEX sikayetler_telefon_imha_idx ON public.sikayetler USING btree (cozulme_tarihi) WHERE (telefon_enc IS NOT NULL);

--
--

CREATE INDEX sikayetler_tenant_durum_tarih_idx ON public.sikayetler USING btree (tenant_id, durum, olusturma_tarihi);

--
--

CREATE INDEX sikayetler_tenant_kimlik_idx ON public.sikayetler USING btree (tenant_id, kimlik_hash);

--
--

CREATE INDEX sms_log_imha_idx ON public.sms_gonderim_log USING btree (olusturma_tarihi);

--
--

CREATE INDEX sms_log_ip_tarih_idx ON public.sms_gonderim_log USING btree (ip_hash, olusturma_tarihi);

--
--

CREATE INDEX sms_log_tenant_tarih_idx ON public.sms_gonderim_log USING btree (tenant_id, olusturma_tarihi);

--
--

CREATE UNIQUE INDEX sokaklar_qr_kod_key ON public.sokaklar USING btree (qr_kod);

--
--

CREATE INDEX sokaklar_tenant_aktif_idx ON public.sokaklar USING btree (tenant_id, aktif);

--
--

ALTER TABLE ONLY public.admin_oturumlar
    ADD CONSTRAINT admin_oturumlar_tenant_id_tenantlar_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.birim_kategoriler
    ADD CONSTRAINT birim_kategoriler_birim_id_fkey FOREIGN KEY (birim_id) REFERENCES public.birimler(id);

--
--

ALTER TABLE ONLY public.birim_kategoriler
    ADD CONSTRAINT birim_kategoriler_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.birimler
    ADD CONSTRAINT birimler_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.engelli_kimlikler
    ADD CONSTRAINT engelli_kimlikler_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.magic_linkler
    ADD CONSTRAINT magic_linkler_tenant_id_tenantlar_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.personel_baglanti_kodlari
    ADD CONSTRAINT personel_baglanti_kodlari_personel_id_personeller_id_fk FOREIGN KEY (personel_id) REFERENCES public.personeller(id);

--
--

ALTER TABLE ONLY public.personel_baglanti_kodlari
    ADD CONSTRAINT personel_baglanti_kodlari_tenant_id_tenantlar_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.personeller
    ADD CONSTRAINT personeller_birim_id_fk FOREIGN KEY (birim_id) REFERENCES public.birimler(id);

--
--

ALTER TABLE ONLY public.personeller
    ADD CONSTRAINT personeller_tenant_id_tenantlar_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.sikayetler
    ADD CONSTRAINT sikayetler_atanan_personel_id_personeller_id_fk FOREIGN KEY (atanan_personel_id) REFERENCES public.personeller(id);

--
--

ALTER TABLE ONLY public.sikayetler
    ADD CONSTRAINT sikayetler_cozen_personel_id_personeller_id_fk FOREIGN KEY (cozen_personel_id) REFERENCES public.personeller(id);

--
--

ALTER TABLE ONLY public.sikayetler
    ADD CONSTRAINT sikayetler_sokak_id_sokaklar_id_fk FOREIGN KEY (sokak_id) REFERENCES public.sokaklar(id);

--
--

ALTER TABLE ONLY public.sikayetler
    ADD CONSTRAINT sikayetler_tenant_id_tenantlar_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.sms_gonderim_log
    ADD CONSTRAINT sms_gonderim_log_tenant_id_tenantlar_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

ALTER TABLE ONLY public.sokaklar
    ADD CONSTRAINT sokaklar_tenant_id_tenantlar_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenantlar(id);

--
--

\unrestrict 5vwuG8wzFxq0CZ737GR7LaA5zOQphaJHAjmkph90qjzjHhWfT8XhwbYXMYDNacZ

-- ---------------------------------------------------------------------
-- BAŞVURU TÜRÜ — bu ürünün tek ekseni.
-- Vatandaşa kategori ve konum SORULMAZ; yalnız türü seçer, sonra yazar.
-- CHECK kısıtı whitelist'i uygulama katmanından BAĞIMSIZ kılar: elle SQL ya da
-- bakım script'iyle girmiş tutarsız bir tür DB'de kesilir.
-- ---------------------------------------------------------------------
ALTER TABLE public.sikayetler
  ADD COLUMN tur character varying(20) DEFAULT 'sikayet'::character varying NOT NULL;

ALTER TABLE public.sikayetler
  ADD CONSTRAINT sikayetler_tur_check CHECK (tur IN ('sikayet','gorus','oneri'));

-- Panel sekmeleri (tür bazlı liste + rozet sayacı) ve tür başına limit sorgusu.
CREATE INDEX sikayetler_tenant_tur_durum_tarih_idx
  ON public.sikayetler USING btree (tenant_id, tur, durum, olusturma_tarihi);

COMMIT;
