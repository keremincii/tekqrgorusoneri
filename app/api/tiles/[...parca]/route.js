import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { hosttanSlug } from '@/lib/server/host.js';

/**
 * GET /api/tiles/{z}/{x}/{y}.png — KENDİ TILE SUNUCUMUZ
 * ====================================================
 *
 * Harita karoları (tile) dış CDN'den DEĞİL, kendi sunucumuzdan gelir. Her belediye
 * için yalnızca o ilçenin sınır kutusu (bbox) tile'ları `scripts/tile-indir.js` ile
 * bir kez indirilip `tiles/<slug>/<z>/<x>/<y>.png` altına konur (host'ta bir volume;
 * imaja gömülmez). Böylece çalışma anında hiçbir dış harita sunucusuna bağımlı değiliz.
 *
 * GÜVENLİK:
 *  - Tenant subdomain'den çözülür → bir belediye yalnızca KENDİ klasörünü görür.
 *  - z/x/y yalnızca rakam (+ .png) olmalı; path traversal (../) imkânsız.
 *  - /api altında olduğu için WAF allow-list'ine ve proxy metot kontrolüne takılır.
 *
 * Yanıt uzun süre cache'lenir (tile içeriği değişmez); Cloudflare edge'de de tutulur,
 * bu route gerçekte çok seyrek çalışır.
 */
export async function GET(request, { params }) {
  const slug = hosttanSlug(request.headers.get('host'));
  // Slug yalnız [a-z0-9-] olmalı: dosya yoluna girmeden önce katı biçim doğrulaması
  // (path traversal / dizin kaçışına karşı savunma-derinliği; host manipülasyonu bile
  // olsa `tiles/` altından çıkılamaz).
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return yok();

  const { parca } = await params; // beklenen: [z, x, "y.png"]
  if (!Array.isArray(parca) || parca.length !== 3) return yok();

  const [z, x, yPng] = parca;
  // Katı doğrulama: yalnızca rakam; dosya adı "<rakam>.png". Bu, ../ ve her türlü
  // yol manipülasyonunu baştan eler.
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}\.png$/.test(yPng)) {
    return yok();
  }

  const kok = path.join(process.cwd(), 'tiles', slug);
  const dosya = path.join(kok, z, x, yPng);
  // Ek savunma: çözülen yol kök dizinin DIŞINA çıkmamalı.
  if (!dosya.startsWith(kok + path.sep)) return yok();

  try {
    const veri = await fs.readFile(dosya);
    return new NextResponse(veri, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    // Tile indirilmemişse (kapsam dışı kare) sade 404 — harita boşluğu olarak görünür.
    return yok();
  }
}

function yok() {
  return new NextResponse('Tile bulunamadı.', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
