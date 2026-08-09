import { NextResponse } from 'next/server';

/**
 * GET /api/health — Docker healthcheck ucu
 * ========================================
 *
 * BİLEREK "aptal" tutulur: DB'ye/Redis'e DOKUNMAZ. Amacı yalnızca Node process'inin
 * ayakta ve HTTP kabul eder durumda olduğunu bildirmektir. DB kontrolü eklenirse
 * geçici bir DB kesintisi app container'ını da "unhealthy" yapar ve cloudflared'in
 * (depends_on: service_healthy) hiç başlamamasına yol açar — kesintiyi BÜYÜTÜR.
 *
 * Yanıt cache'lenmez; Cloudflare arkasında da yalnızca iç healthcheck kullanır.
 */
export function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
