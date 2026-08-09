import { NextResponse } from 'next/server';
import { getSokakYonetimService } from '@/lib/services';
import { formHedefiOlustur } from '@/lib/server/qr.js';
import { uuidGecerliMi, qrKodGecerliMi } from '@/lib/utils/validators.js';

/**
 * GET /q/[id] — KALICI QR YÖNLENDİRİCİSİ
 * ======================================
 *
 * Yeni QR kodlar `https://qr.<domain>/q/<qr_kod>` (8 haneli base62), halihazırda
 * basılı eski QR'lar `https://qr.<domain>/q/<uuid>` adresini taşır (bkz.
 * lib/server/qr.js). Bu uç, sokağı (tenant-bağımsız; kod veya UUID ile global) bulur
 * ve vatandaşı ait olduğu belediyenin GÜNCEL form adresine 302 ile yönlendirir.
 *
 * Neden böyle: form yolu (`/s/`), imza şeması veya belediyenin subdomain'i
 * ileride değişse bile QR'lar değişmez; yalnızca burada üretilen hedef değişir.
 *
 * GÜVENLİK: Bu yalnızca herkese açık form adresine yönlendirmedir. UUID tahmin
 * edilemez ve imza (sig) her istekte ÇALIŞAN sunucunun HMAC_SECRET'ıyla CANLI
 * hesaplanır (DB'den okunmaz) — böylece secret dönse bile QR'lar bozulmaz. Asıl
 * yetki kontrolü yine hedef subdomain'de yapılır: /api/sikayet tenant'ı Host'tan
 * çözer ve imzayı yeniden doğrular.
 *
 * YÜK: (1) Geçersiz-biçimli id, DB'ye gitmeden 404 (bot taraması ucuz düşer).
 * (2) Sokak+tenant sonucu 60 sn süreç-içi cache'lenir — aynı QR'ın tekrar
 * okutmaları DB'siz karşılanır (kampanya pikinde /api/sikayet ile aynı havuzu
 * yemesin). İmza cache'lenMEZ; her yanıtta canlı hesaplanır (secret dönse bile taze).
 */

/**
 * Başarılı QR hedef (sokak+tenant) süreç-içi önbelleği: kısa TTL + boyut sınırlı.
 * YALNIZ başarılı sonuç cache'lenir — negatif (bulunamadı) cache'lenmez ki yeni
 * eklenen bir sokak 60 sn boyunca yanlışlıkla 404 vermesin. Boyut sınırı + FIFO
 * tahliye, çok sayıda farklı sokakta sınırsız bellek büyümesini engeller.
 */
const _qrCache = new Map();
const QR_CACHE_TTL_MS = 60 * 1000;
const QR_CACHE_MAX = 5000;

function qrCacheGetir(id) {
  const k = _qrCache.get(id);
  if (k && Date.now() - k.ts < QR_CACHE_TTL_MS) return k.veri;
  if (k) _qrCache.delete(id); // süresi geçmiş kaydı at
  return undefined;
}

function qrCacheYaz(id, veri) {
  if (_qrCache.size >= QR_CACHE_MAX) {
    let atilacak = Math.ceil(QR_CACHE_MAX * 0.1); // doluysa en eski ~%10'u at
    for (const anahtar of _qrCache.keys()) {
      _qrCache.delete(anahtar);
      if (--atilacak <= 0) break;
    }
  }
  _qrCache.set(id, { veri, ts: Date.now() });
}

export async function GET(request, { params }) {
  const { id } = await params;

  // Biçim ön-kontrolü: yeni QR'lar base62 kısa kod, eski basılı QR'lar UUID taşır.
  // İkisi de değilse (bot taraması + hatalı id) DB'ye HİÇ gitmeden 404 → ucuz düşer.
  if (!uuidGecerliMi(id) && !qrKodGecerliMi(id)) {
    return gecersizQr();
  }

  try {
    let hedefVeri = qrCacheGetir(id);
    if (hedefVeri === undefined) {
      const sonuc = await getSokakYonetimService().qrHedefBul(id);
      if (!sonuc.basarili) {
        return gecersizQr(); // negatif sonuç CACHE'LENMEZ (yeni sokak 404'te takılmasın)
      }
      hedefVeri = { slug: sonuc.tenant.slug, sokak: sonuc.sokak };
      qrCacheYaz(id, hedefVeri);
    }

    // İmza burada CANLI hesaplanır (cache'lenmiş sokak verisinden değil) → taze.
    const hedef = formHedefiOlustur(request, hedefVeri.slug, hedefVeri.sokak);
    const response = NextResponse.redirect(hedef, 302);
    // Edge (Cloudflare) 60 sn cache'leyebilir; tarayıcı cache'lemez (max-age=0).
    // NOT: Cloudflare uzantısız dinamik yolları VARSAYILAN cache'lemez — bunun
    // etkili olması için /q/* üzerinde "Eligible for cache" Cache Rule gerekir.
    // Süre 60 sn: tek HMAC secret'ının rotasyonunda bayat imza penceresini kısa tutar.
    response.headers.set('Cache-Control', 'public, s-maxage=60, max-age=0');
    return response;
  } catch (err) {
    console.error('QR yönlendirme hatası:', err);
    return gecersizQr();
  }
}

/** Bilinmeyen/pasif QR → 404 (bilgi sızdırmadan). */
function gecersizQr() {
  return new NextResponse('Geçersiz veya pasif QR kodu.', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
