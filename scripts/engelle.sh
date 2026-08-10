#!/usr/bin/env bash
# =============================================================================
# Şikayetçi engelleme — YALNIZ sistem operatörü (SSH) çalıştırır.
# Başkan/başkan yardımcısı panelinde bu yetki YOKTUR; sadece sunucuya erişimi
# olan kişi engelleyebilir.
#
# Engelleme, o şikayetin kimlik_hash'ini (telefonun tek yönlü hash'i) kara listeye
# (engelli_kimlikler) ekler → o numara bir daha SMS kodu / şikayet gönderemez.
# Ham telefon/isim gerekmez ve saklanmaz.
#
# ⚡ KÜFÜRLÜ/HAKARET İÇEREN ŞİKAYETLER İÇİN BU SCRIPT'E GEREK YOK:
#    Filtreye takılan her şikayet moderasyon botuna düşer ve mesajın altında
#    "🚫 Göndereni engelle" butonu vardır — tek tıkla kara listeye eklenir.
#    Bu script, o akış dışında kalan durumlar (normal görünen ama trol olan bir
#    şikayeti sonradan engelleme, kara listeyi görme, engel kaldırma) içindir.
#
# Kullanım (sunucuda /root/belediye içinde):
#   scripts/engelle.sh liste [N]            # son N şikayeti göster (hangi id'yi engelleyeceğini gör)
#   scripts/engelle.sh engelle <sikayet-id> # o şikayetin numarasını engelle
#   scripts/engelle.sh engelliler           # kara listeyi göster
#   scripts/engelle.sh kaldir <sikayet-id>  # o şikayetin engelini kaldır
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."   # proje kökü (docker compose buradan çalışır)
PSQL=(docker compose exec -T db psql -U belediye -d belediye)

cmd="${1:-}"
case "$cmd" in
  liste)
    n="${2:-20}"
    "${PSQL[@]}" -c "SELECT s.id,
        (s.olusturma_tarihi AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::timestamp(0) AS tarih_tr,
        s.kategori,
        COALESCE(sk.sokak_adi, s.bildirilen_sokak_adi, '-') AS sokak, s.durum
      FROM sikayetler s LEFT JOIN sokaklar sk ON sk.id = s.sokak_id
      WHERE s.silinme_tarihi IS NULL
      ORDER BY s.olusturma_tarihi DESC LIMIT ${n};"
    ;;
  engelle)
    # NOT: engelli_kimlikler artık TENANT'TAN BAĞIMSIZDIR (bkz. drizzle/0002).
    # Bir kimliği burada engellemek, bu dağıtımdaki TÜM belediyeleri kapsar.
    id="${2:?sikayet-id gerekli — 'scripts/engelle.sh liste' ile bak}"
    "${PSQL[@]}" -c "INSERT INTO engelli_kimlikler (kimlik_hash, sebep)
      SELECT kimlik_hash, 'cli' FROM sikayetler WHERE id = '${id}'
      ON CONFLICT DO NOTHING RETURNING kimlik_hash;"
    echo "→ Engellendi (bir satır döndüyse). Bu numara artık HİÇBİR belediyeye SMS kodu / şikayet gönderemez."
    ;;
  engelliler)
    # Tam hash gösterilir → 'kaldir' için doğrudan kopyalanabilir.
    "${PSQL[@]}" -c "SELECT kimlik_hash, sebep,
        olusturma_tarihi::timestamp(0) AS tarih
      FROM engelli_kimlikler ORDER BY olusturma_tarihi DESC;"
    ;;
  kaldir)
    arg="${2:?sikayet-id VEYA hash gerekli — 'scripts/engelle.sh engelliler' ile bak}"
    # Argüman 64 haneli hex ise doğrudan hash; değilse şikayet-id (UUID) kabul edilir.
    if [[ "$arg" =~ ^[0-9a-fA-F]{64}$ ]]; then
      "${PSQL[@]}" -c "DELETE FROM engelli_kimlikler WHERE kimlik_hash = '${arg}'
        RETURNING left(kimlik_hash, 12) || '…';"
    else
      "${PSQL[@]}" -c "DELETE FROM engelli_kimlikler
        WHERE kimlik_hash IN
          (SELECT kimlik_hash FROM sikayetler WHERE id = '${arg}')
        RETURNING left(kimlik_hash, 12) || '…';"
    fi
    echo "→ Engel kaldırıldı (bir satır döndüyse; tüm belediyeler için geçerliydi)."
    ;;
  *)
    echo "Kullanım:"
    echo "  scripts/engelle.sh liste [N]                 # son N şikayet (id'leri gör)"
    echo "  scripts/engelle.sh engelle <sikayet-id>      # numarayı engelle"
    echo "  scripts/engelle.sh engelliler                # kara liste (tam hash)"
    echo "  scripts/engelle.sh kaldir <sikayet-id|hash>  # engeli kaldır (id VEYA hash)"
    exit 1
    ;;
esac
