# Yük Testi (k6)

Telefon doğrulaması (WhatsApp/SMS OTP) **backdoor eklemeden** aşılır: yazma testi,
sunucunun `HMAC_SECRET`'ı ile geçerli `dogrulamaToken` + QR `sig` üretir. Uygulamaya
hiçbir test-bypass kapısı eklenmez.

## k6'yı nasıl çalıştırırız — Docker (kurulum yok)

GPG/apt derdi yok; k6 resmi image ile çalışır. İki mod:

- **Origin-direkt (ÖNERİLEN):** Cloudflare'i baypas edip app container'ına vurur →
  saf yazılım kapasitesini ölçer, Cloudflare throttle'ı sonucu kirletmez. k6'yı
  compose ağında çalıştırırız (`--network`), hedef `http://app:3000`.
- **Cloudflare üzerinden:** Gerçek public URL. Daha yumuşak (edge cache + DDoS koruması)
  ama tek IP'den yüksek VU'da Cloudflare seni throttle/challenge edebilir.

> ⚠️ Yük üreticiyi (k6) test edilen 4GB kutuda çalıştırmak sonucu bir miktar kirletir
> (k6 CPU/RAM'i app ile paylaşır). İdeal: ayrı makine. Yoksa `MAKS_VU`'yu düşük başlat
> (300) ve `docker stats`'ı izle — k6 container'ı CPU'yu domine ediyorsa darboğaz k6'dır.

Compose ağının adını bir kez öğren:
```bash
NET=$(docker inspect belediye-app-1 -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
echo $NET   # ör. belediye_default
```

## 1) Okuma yolu (önce bunu çalıştır — OTP gerekmez, gerçek darboğaz burada)

QR redirect + form + durum polling. En yüksek QPS'li yol. Origin-direkt:

```bash
SOKAK_ID=$(docker compose exec -T db psql -U belediye -d belediye -tAc \
  "SELECT id FROM sokaklar WHERE tenant_id=1 AND aktif=true LIMIT 1")

docker run --rm -i --network "$NET" -v ~/belediye/scripts/yuk-testi:/s:ro \
  -e HOST=http://app:3000 -e QR_HOST=http://app:3000 \
  -e SOKAK_ID="$SOKAK_ID" -e MAKS_VU=300 \
  grafana/k6 run /s/oku-testi.js
```

`MAKS_VU`'yu kademeli artır: 300 → 800 → 1500. Her turda `docker stats`'a bak.

## 2) Yazma yolu (DB insert dahil — geçici olarak limitleri gevşet)

Test penceresi için sunucu `.env`'ine ekle, sonra `docker compose up -d app` (rebuild GEREKMEZ):

```
IP_DAKIKA_LIMIT=100000000
QR_SAAT_LIMIT=100000000
SIKAYET_HAFTALIK_ADET=100000000
```

Sonra (origin-direkt; Host başlığı tenant çözümü için ŞART):

```bash
HMAC=$(grep -E "^HMAC_SECRET=" .env | cut -d= -f2-)

docker run --rm -i --network "$NET" -v ~/belediye/scripts/yuk-testi:/s:ro \
  -e HOST=http://app:3000 -e HOST_HEADER=gulsehir.dijitalbelediyem.com \
  -e HMAC_SECRET="$HMAC" -e SOKAK_ID="$SOKAK_ID" -e MAKS_VU=100 \
  grafana/k6 run /s/yaz-testi.js
```

**TEST BİTİNCE:** yukarıdaki 3 satırı `.env`'den **SİL** ve `docker compose up -d app`.
Yazma testi GERÇEK kayıt oluşturur; test kayıtlarını sonra temizle:
```bash
docker compose exec db psql -U belediye -d belediye -c \
  "DELETE FROM sikayetler WHERE ad='YukTest' AND soyad='Kullanici';"
```

## İzleme (test sırasında ayrı bir terminalde)

```bash
docker stats                      # container başına CPU/RAM canlı
watch -n2 'free -h; echo; docker compose ps'
docker compose logs -f --tail=50 app db
```

Bakılacaklar: RAM 4GB'a dayanıyor mu (swap açılırsa kutu küçük), app/db mem_limit'e
çarpıp OOM-kill oluyor mu (`docker compose ps`'te "Restarting"), p95 gecikme, hata oranı.
