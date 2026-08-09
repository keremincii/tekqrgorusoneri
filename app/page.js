import { notFound } from 'next/navigation';

/**
 * Kök adres (/) — KAPALI.
 *
 * Bu sistemin yalnızca iki meşru giriş kapısı vardır:
 *   1. Başkan  → magic-link ile gelen oturum → /admin/harita (proxy.js korur)
 *   2. Vatandaş → sokaktaki QR → /q/<id> yönlendiricisi → /s/<id>?sig=...
 *
 * Bu yüzden gulsehir.<domain>/ gibi çıplak kök adres hiçbir şey sunmaz; 404 döner.
 * (Eskiden burada herkese açık bir landing sayfası vardı; kasıtlı olarak kaldırıldı.)
 */
export default function AnaSayfa() {
  notFound();
}
