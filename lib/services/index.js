import { SokakRepository } from '@/lib/infrastructure/repositories/SokakRepository.js';
import { SikayetRepository } from '@/lib/infrastructure/repositories/SikayetRepository.js';
import { AdminRepository } from '@/lib/infrastructure/repositories/AdminRepository.js';
import { PersonelRepository } from '@/lib/infrastructure/repositories/PersonelRepository.js';
import { BirimRepository } from '@/lib/infrastructure/repositories/BirimRepository.js';
import { TenantRepository } from '@/lib/infrastructure/repositories/TenantRepository.js';
import { SmsLogRepository } from '@/lib/infrastructure/repositories/SmsLogRepository.js';
import { MockSmsProvider } from '@/lib/infrastructure/services/MockSmsProvider.js';
import { NetgsmSmsProvider } from '@/lib/infrastructure/services/NetgsmSmsProvider.js';
import { sirCoz } from '@/lib/security/sifreleme.js';
import { TelegramClient } from '@/lib/infrastructure/telegram/TelegramClient.js';
import { DogrulamaService } from '@/lib/services/DogrulamaService.js';
import { AlarmService } from '@/lib/services/AlarmService.js';
import { ModerasyonService } from '@/lib/services/ModerasyonService.js';
import { SikayetService } from '@/lib/services/SikayetService.js';
import { AdminService } from '@/lib/services/AdminService.js';
import { PersonelService } from '@/lib/services/PersonelService.js';
import { BirimService } from '@/lib/services/BirimService.js';
import { TelegramService } from '@/lib/services/TelegramService.js';
import { SokakYonetimService } from '@/lib/services/SokakYonetimService.js';

/**
 * Servis Fabrikası (Service Factory / Dependency Injection Container)
 * 
 * Tüm servislerin bağımlılıklarını merkezi bir yerden yönetir.
 * API route'ları bu fabrikadan servis alır, doğrudan repository oluşturmaz.
 * 
 * Bu yapı sayesinde:
 * 1. Test ortamında mock repository'ler enjekte edilebilir
 * 2. SMS sağlayıcı değiştiğinde sadece bu dosya güncellenir
 * 3. Hiçbir API route veya servis, somut sınıfları doğrudan bilmek zorunda kalmaz
 */

// Singleton instance'lar (Serverless'ta her cold start'ta yeniden oluşturulur)
let _dogrulamaService = null;
let _alarmService = null;
let _smsLogRepo = null;
let _sikayetService = null;
let _adminService = null;
let _personelService = null;
let _birimService = null;
let _telegramService = null;
let _sokakYonetimService = null;
let _moderasyonService = null;

/**
 * SMS sağlayıcısını seçer: Netgsm kimlik bilgileri tanımlıysa Netgsm, değilse
 * MockSmsProvider (geliştirmede sessiz çalışır, gerçek SMS gitmez).
 */
function smsProviderOlustur() {
  const netgsmHazir =
    process.env.NETGSM_USERCODE && process.env.NETGSM_PASSWORD && process.env.NETGSM_HEADER;

  if (netgsmHazir) {
    return new NetgsmSmsProvider();
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '⚠ Netgsm kimlik bilgileri (NETGSM_USERCODE/PASSWORD/HEADER) tanımlı değil — ' +
      'ÜRETİMDE GERÇEK SMS GÖNDERİLMEYECEK (MockSmsProvider sessiz çalışıyor).'
    );
  }
  return new MockSmsProvider();
}

/**
 * Bir TENANT'ın SMS sağlayıcısını döndürür (per-belediye Netgsm hesabı).
 * Belediyenin kendi Netgsm bilgileri (usercode + AES-GCM şifreli şifre + header) tam ve
 * çözülebiliyorsa o hesapla NetgsmSmsProvider döner; aksi halde global env fallback'ine
 * (smsProviderOlustur → global Netgsm veya Mock) düşer. Şifre çözülemezse (anahtar yok/
 * yanlış) sessizce global'e düşülür + loglanır (SMS akışı kesilmez).
 * @param {Object} tenant - aktifTenant kaydı (netgsm* alanlarını içerebilir)
 * @returns {import('../domain/interfaces/ISmsProvider.js').ISmsProvider}
 */
export function getTenantSmsProvider(tenant) {
  const uc = tenant?.netgsmUsercode;
  const enc = tenant?.netgsmSifreEnc;
  const hdr = tenant?.netgsmHeader;
  if (uc && enc && hdr) {
    const sifre = sirCoz(enc); // yanlış anahtar/bozuk/kurcalanmış → null
    if (sifre) {
      try {
        return new NetgsmSmsProvider({ usercode: uc, password: sifre, header: hdr });
      } catch (e) {
        console.error(`Tenant Netgsm sağlayıcısı kurulamadı (${tenant?.slug || '?'}):`, e?.message);
      }
    } else {
      console.error(`Tenant Netgsm şifresi çözülemedi (${tenant?.slug || '?'}) — global SMS'e düşülüyor.`);
    }
  }
  return smsProviderOlustur(); // global env fallback (Netgsm veya Mock)
}

/** Doğrulama servisini döndürür (SMS OTP — Netgsm/Mock). */
export function getDogrulamaService() {
  if (!_dogrulamaService) {
    _dogrulamaService = new DogrulamaService(smsProviderOlustur());
  }
  return _dogrulamaService;
}

/**
 * Alarm servisini döndürür (operasyonel uyarılar — SMS bütçe kesicisi).
 * AYRI Telegram botu: personel/başkan botundan bağımsız token + sohbet.
 * TELEGRAM_ALARM_BOT_TOKEN / TELEGRAM_ALARM_CHAT_ID yoksa sessizce devre dışı.
 */
export function getAlarmService() {
  if (!_alarmService) {
    _alarmService = new AlarmService(
      new TelegramClient(process.env.TELEGRAM_ALARM_BOT_TOKEN),
      process.env.TELEGRAM_ALARM_CHAT_ID
    );
  }
  return _alarmService;
}

/** SMS gönderim audit log repository'sini döndürür (kötüye kullanım tespiti). */
export function getSmsLogRepository() {
  if (!_smsLogRepo) {
    _smsLogRepo = new SmsLogRepository();
  }
  return _smsLogRepo;
}

/** Şikayet servisini döndürür */
export function getSikayetService() {
  if (!_sikayetService) {
    const sikayetRepo = new SikayetRepository();
    const sokakRepo = new SokakRepository();
    _sikayetService = new SikayetService(sikayetRepo, sokakRepo);
  }
  return _sikayetService;
}

/** Admin servisini döndürür (Magic Link + Oturum) */
export function getAdminService() {
  if (!_adminService) {
    const adminRepo = new AdminRepository();
    _adminService = new AdminService(adminRepo);
  }
  return _adminService;
}

/** Personel (saha ekibi) yönetim servisini döndürür */
export function getPersonelService() {
  if (!_personelService) {
    _personelService = new PersonelService(new PersonelRepository());
  }
  return _personelService;
}

/** Birim (departman) yönetim servisini döndürür */
export function getBirimService() {
  if (!_birimService) {
    _birimService = new BirimService(new BirimRepository());
  }
  return _birimService;
}

/**
 * Telegram servisini döndürür (saha ekibi botu — atama + otomatik yeni-şikayet
 * bildirimi + webhook). Tek bot tüm belediyelere hizmet eder; tenant, bağlanan
 * personelden çözülür. Çözüm sonrası vatandaşa SMS için tenant SMS sağlayıcısı
 * (getTenantSmsProvider) + TenantRepository enjekte edilir.
 */
export function getTelegramService() {
  if (!_telegramService) {
    _telegramService = new TelegramService({
      telegramClient: new TelegramClient(),
      personelRepo: new PersonelRepository(),
      sikayetRepo: new SikayetRepository(),
      sokakRepo: new SokakRepository(),
      birimRepo: new BirimRepository(),
      tenantRepo: new TenantRepository(),
      smsProviderGetir: getTenantSmsProvider,
    });
  }
  return _telegramService;
}

/**
 * Moderasyon servisini döndürür (küfür filtresine takılan şikayetler — AYRI Telegram
 * botu). Personel ve alarm botlarından bağımsız token + tek hedef sohbet.
 * TELEGRAM_MODERASYON_BOT_TOKEN / TELEGRAM_MODERASYON_CHAT_ID yoksa sessizce devre
 * dışıdır (takılan kayıt `moderasyonda` bekler, WARN loglanır).
 *
 * telegramServiceGetir LAZY geçilir: onay verildiğinde normal bildirim akışı saha
 * botu üzerinden çalışır ama iki servis birbirini modül düzeyinde import etmez.
 */
export function getModerasyonService() {
  if (!_moderasyonService) {
    _moderasyonService = new ModerasyonService({
      telegramClient: new TelegramClient(process.env.TELEGRAM_MODERASYON_BOT_TOKEN),
      chatId: process.env.TELEGRAM_MODERASYON_CHAT_ID,
      sikayetRepo: new SikayetRepository(),
      sokakRepo: new SokakRepository(),
      // Mesajda belediye adı gösterilsin: tek moderasyon sohbeti birden çok
      // belediyeye hizmet ettiğinde hangisinden geldiği belli olmalı.
      tenantRepo: new TenantRepository(),
      telegramServiceGetir: getTelegramService,
    });
  }
  return _moderasyonService;
}

/** Sokak yönetim servisini döndürür */
export function getSokakYonetimService() {
  if (!_sokakYonetimService) {
    const sokakRepo = new SokakRepository();
    _sokakYonetimService = new SokakYonetimService(sokakRepo);
  }
  return _sokakYonetimService;
}
