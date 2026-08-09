# Tek QR — Görüş / Öneri Sistemi

Belediyenin **tek merkezî QR kodu** (ör. kent meydanı) okutulunca açılan başvuru formu.
Vatandaş türünü seçer, yazar, isterse fotoğraf ekler; başvuru **başkanın ve yetkililerin**
göreceği bir panele düşer.

Üç tür vardır ve **hepsi aynı akışı** kullanır:

| Tür | Ne için |
| --- | --- |
| Şikayet | Bozuk / eksik / aksayan bir durum |
| Görüş | Bir konudaki düşüncesi |
| Öneri | İlçe için bir fikir |

**Vatandaşa kategori ve konum SORULMAZ.** Tek QR olduğu için "hangi sokak" sorusunun
anlamı yok; kategori de olmadığından başvurular saha ekibine otomatik dağıtılmaz —
karar yönetimindedir. Akış: **tür → açıklama → fotoğraf (opsiyonel) → doğrulama**.

## Nereden geliyor

Bu proje, Gülşehir için yazılan sokak-QR'lı şikayet sisteminin
(`github.com/keremincii/belediye`) kod tabanından türetilmiştir. Ayrı repo olmasının
sebebi iki ürünün kalıcı olarak ayrışması; branch tutmak her düzeltmeyi ömür boyu
merge derdine çevirirdi.

**Devralınan ve DEĞİŞTİRİLMEMESİ gereken katmanlar** (aylar verilmiş, denetimden geçmiş):
SMS OTP kötüye kullanım koruması (Turnstile + katmanlı throttle + global bütçe kesici),
küfür/hakaret filtresi + moderasyon botu, KVKK saklama/imha görevleri, per-tenant Netgsm,
R2 fotoğraf yükleme sertleştirmesi (magic-byte beyaz listesi, decompression-bomb koruması).

Gülşehir'e gelen güvenlik düzeltmelerini almak için:

```bash
git remote add gulsehir git@github.com:keremincii/belediye.git
git fetch gulsehir && git log gulsehir/main --oneline
git cherry-pick <sha>
```

## Kurulum (VPS)

> ⚠ Aynı sunucuda başka yığınlar çalışıyor (`belediye`, `mezarlik`). `docker-compose.yml`
> içindeki `name: tekqrgorusoneri` satırı **silinmemeli** — o olmadan compose proje adını
> klasörden türetir ve yanlış ürünün konteynerlerini değiştirebilir.

1. **Sırları üret.** Gülşehir'inkiler ASLA kopyalanmaz:
   ```bash
   openssl rand -hex 32   # HMAC_SECRET
   openssl rand -hex 32   # SIR_SIFRELEME_ANAHTARI
   openssl rand -hex 24   # DB_PASSWORD
   ```
   `.env.docker.example`'ı `.env` olarak kopyalayıp doldur. Ayrıca **kendi** Netgsm
   hesabı, **kendi** Telegram bot token'ları (saha + moderasyon + alarm) ve **kendi**
   Turnstile anahtar çifti gerekir.

2. **Cloudflare tüneli.** Panelden yeni bir tünel oluştur, token'ı `.env`'e koy
   (`CLOUDFLARE_TUNNEL_TOKEN`), public hostname'i bu yığının `app:3000`'ine bağla.
   Sunucuda hiçbir inbound port açılmaz.

3. **Şema.** Migration'lar **elle** uygulanır (`drizzle-kit generate/push` KULLANMA):
   ```bash
   docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/0000_init.sql
   ```

4. **Belediye + QR noktası.**
   ```bash
   node scripts/tenant-ekle.js derinkuyu "Derinkuyu Belediyesi" 38.37775 34.73771 14 --baskan "Ad Soyad"
   ```
   Ardından tek QR noktasını `sokaklar` tablosuna ekle (kent meydanı koordinatı).

5. **Kod:**
   ```bash
   docker compose up -d --build
   ```

6. **Yönetici erişimi:** `node scripts/magic-link-uret.js <slug>` → 48 saat geçerli
   tek kullanımlık giriş linki.

## Güncelleme

```bash
git pull
# 1) ÖNCE migration (varsa) — ELLE:
docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/00NN_<ad>.sql
# 2) SONRA kod:
docker compose up -d --build
```

Sıra sabittir: **önce migration, sonra kod** — yeni kod eski şemada 500 verir.
