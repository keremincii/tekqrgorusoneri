import { NextResponse } from 'next/server';
import { getDogrulamaService } from '@/lib/services';
import { guvenliJsonParse } from '@/lib/security/sanitize';
import { dogrulamaTokenOlustur } from '@/lib/security/hmac';
import { ipRateLimitKontrol } from '@/lib/security/rateLimit';
import { getClientIp } from '@/lib/server/ip';
import { aktifTenant } from '@/lib/server/tenant';

/**
 * POST /api/dogrulama/sms
 * 
 * Vatandaşın girdiği SMS doğrulama kodunu kontrol eder.
 * 
 * İstek gövdesi:
 * { telefon, kod }
 */
export async function POST(request) {
  try {
    // IP rate limiting — kod doğrulama endpoint'ini brute-force denemelerine karşı korur
    // (per-OTP deneme sayacına ek ikinci kat; bu endpoint eskiden limitsizdi).
    const ip = getClientIp(request);
    if (!ipRateLimitKontrol(ip, 'sms').izinVar) {
      return NextResponse.json(
        { hata: 'Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.' },
        { status: 429 }
      );
    }

    // Tenant'ı Host'tan çöz: conversion (doğrulanan) sayacı tenant-başına tutulur.
    const tenant = await aktifTenant(request);
    if (!tenant) {
      return NextResponse.json({ hata: 'Belediye bulunamadı.' }, { status: 404 });
    }

    const { veri, hata: parseHata } = await guvenliJsonParse(request);
    if (parseHata) {
      return NextResponse.json({ hata: parseHata }, { status: 400 });
    }

    const { telefon, kod } = veri;

    if (!telefon || !kod) {
      return NextResponse.json(
        { hata: 'Telefon ve doğrulama kodu zorunludur.' },
        { status: 400 }
      );
    }

    if (typeof kod !== 'string' || kod.length !== 6 || !/^\d{6}$/.test(kod)) {
      return NextResponse.json(
        { hata: 'Doğrulama kodu 6 haneli bir sayı olmalıdır.' },
        { status: 400 }
      );
    }

    const dogrulamaService = getDogrulamaService();
    const sonuc = await dogrulamaService.smsKoduDogrula(tenant.id, telefon, kod);

    if (!sonuc.gecerli) {
      return NextResponse.json(
        { hata: sonuc.hata },
        { status: 400 }
      );
    }

    // Kimlik bilgisi bulunamadıysa (kod gönderme adımı atlanmışsa) şikayet izni verilmez.
    if (!sonuc.kimlikHash) {
      return NextResponse.json(
        { hata: 'Doğrulama oturumu bulunamadı. Lütfen baştan başlayın.' },
        { status: 400 }
      );
    }

    // Şikayet gönderme izni: kimlikHash + doğrulanmış kişisel veri (ad/soyad/telefon)
    // içeren imzalı, kısa ömürlü doğrulama belirteci. Kaydedilecek kişisel veri buradan
    // gelir; istemci sonradan değiştiremez.
    const dogrulamaToken = dogrulamaTokenOlustur({
      kimlikHash: sonuc.kimlikHash,
      ad: sonuc.ad,
      soyad: sonuc.soyad,
      telefon: sonuc.telefon,
    });

    return NextResponse.json({
      basarili: true,
      mesaj: 'Telefon numarası doğrulandı. Şikayetinizi gönderebilirsiniz.',
      dogrulamaToken,
    });

  } catch (err) {
    console.error('SMS doğrulama hatası:', err);
    return NextResponse.json(
      { hata: 'Beklenmedik bir hata oluştu.' },
      { status: 500 }
    );
  }
}
