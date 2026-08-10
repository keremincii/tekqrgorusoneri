# Tek QR — Görüş / Şikayet / Öneri Sistemi

Belediyenin **tek merkezî QR kodu** (ör. kent meydanı) okutulunca açılan başvuru formu.
Vatandaş türünü seçip yazar, isterse fotoğraf ekler, telefonunu doğrular; başvuru
**başkanın panosuna anında** düşer.

## Vatandaş akışı

```
QR → [tür + metin] → [fotoğraf — isteğe bağlı] → [ad soyad + telefon + KVKK] → [SMS kodu] → ✓
```

Üç tür vardır ve **hepsi aynı akışı, aynı tabloyu ve aynı KVKK esaslarını** kullanır:

| Tür | Ne için |
| --- | --- |
| ⚠️ Şikayet | Bozuk / eksik / aksayan bir durum |
| 💬 Görüş | Bir konudaki düşüncesi |
| 💡 Öneri | İlçe için bir fikir |

**Vatandaşa KATEGORİ ve KONUM sorulmaz.** Tek QR olduğu için "hangi sokak" sorusunun
anlamı yok; 7 başlıklı kategori listesi de kaldırıldı — yazdığı cümle konuyu zaten
söylüyor, sınıflandırmayı ona yaptırmak fazladan bir ekran ve yanlış seçime davetti.
Kategori olmadığı için başvurular saha ekibine **otomatik dağıtılmaz**: iş dağıtımı
yönetimin **atama** kararıdır.

## Başkan panosu (`/admin`)

Yenilemesiz, okuma odaklı tek ekran:

- **Canlı** — yeni başvuru geldiği anda listeye düşer (Server-Sent Events). Sağ üstteki
  "Canlı" rozeti bağlantının durumunu söyler; akış koparsa liste periyodik tazelenir.
- **Tür sekmeleri** hem filtre hem özettir (her sekmede o türün açık kayıt sayısı).
- **Durum filtresi + metin araması** sunucu tarafında çalışır, liste sayfalanır.
- **Kart = başvuru metni.** Metin kırpılmaz; punto, kontrast ve satır aralığı okumaya
  göre ayarlıdır. Fotoğraf, bekleme süresi, durum ve atama bilgisi metnin etrafındadır.
- **Aksiyonlar:** durum ilerlet (Bekliyor → İnceleniyor → Çözüldü), personele ata,
  fotoğrafı büyüt, sil. Atama, saha ekibine iş düşmesinin tek yoludur.

> Eski harita ekranı kaldırıldı: tek QR'lı bir üründe tüm başvurular aynı koordinata
> düşüyor, yani harita her zaman tek bir pin gösteriyordu.

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

## Mimari (kısa)

```
app/s/[qrId]/        Vatandaş sihirbazı (adım başına bir bileşen + tek API istemcisi)
app/admin/           Başkan panosu (BasvuruPanosu + panel/*)
app/api/admin/akis   Canlı akış (SSE) — oturum korumalı, tenant izole
lib/domain/          Entity + arayüzler (Basvuru, ISikayetRepository, IOlayYayini)
lib/services/        İş kuralları (SikayetService, BasvuruAkisServisi, Telegram…)
lib/infrastructure/  DB (Drizzle), Redis, olay yayını, Telegram istemcisi
lib/utils/constants  Tek otorite: başvuru türleri, durum sözlüğü, limitler, KVKK sürümü
```

Canlı akış, `IOlayYayini` arayüzünün arkasındadır: Redis varsa kopyalar arası pub/sub,
yoksa süreç içi yayın kullanılır — çağıran hangisi olduğunu bilmez.

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

3. **Şema.** Migration'lar **elle** uygulanır (`drizzle-kit generate/push` KULLANMA),
   numara sırasıyla:
   ```bash
   docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/0000_init.sql
   docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/0001_kategorisiz.sql
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
   tek kullanımlık giriş linki (`/admin` panosuna düşürür).

## Geliştirirken

Panoyu dolu görmek için sahte başvuru üret (yalnız yerel/demo):

```bash
node scripts/test-basvuru-ekle.js <qr-nokta-uuid> 20
```

Panoyu açık tutarsan kartların tek tek düştüğünü görürsün — canlı akışın testi budur.

## Güncelleme

```bash
git pull
# 1) ÖNCE migration (varsa) — ELLE:
docker compose exec -T db psql -U belediye -d belediye -v ON_ERROR_STOP=1 < drizzle/00NN_<ad>.sql
# 2) SONRA kod:
docker compose up -d --build
```

Sıra sabittir: **önce migration, sonra kod** — yeni kod eski şemada 500 verir.
