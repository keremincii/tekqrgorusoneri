/**
 * Next.js Instrumentation
 * =======================
 * `register()` yeni bir sunucu instance'ı başlarken BİR KEZ çalışır (v15+ stable).
 * Burada (1) üretim güvenlik denetimini tetikliyoruz (kritik env eksiklerini görünür
 * kılar), (2) KVKK imha görevini zamanlıyoruz.
 */
export async function register() {
  // Yalnız Node.js runtime'ında çalıştır (Edge'de gerek yok; guard env okur).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { guvenlikBaslangicKontrolu } = await import('./lib/security/startupGuard.js');
  guvenlikBaslangicKontrolu();

  /**
   * KVKK PERİYODİK İMHA GÖREVİ (migration 0016 + 0018 / aydınlatma metni v12)
   * ------------------------------------------------------------------------
   * Aydınlatma metnindeki SAKLAMA SÜRESİ TABLOSUNU fiilen uygular: süresi dolan
   * kişisel veriyi siler ya da kimlik bağını koparır. Veri, amacı gerçekleştikten
   * sonra tutulmaz — bu bir "iyi olur" değil, KVKK m.7 yükümlülüğüdür. Metinde
   * yazıp yapmamak, denetimde hiç yazmamaktan daha kötüdür.
   *
   * NEDEN AYRI BİR CRON DEĞİL DE UYGULAMA İÇİNDE: dağıtım tek Docker yığını ve
   * sunucuda ayrı zamanlayıcı kurulumu yok. Görevi uygulamanın içine almak,
   * "cron kurulmayı unutuldu → kişisel veri süresiz durdu" hatasını imkânsız kılar.
   * Görev İDEMPOTENTTİR (iki instance aynı anda çalışsa ikincisi 0 kayıt bulur),
   * bu yüzden ölçeklemede de güvenlidir.
   *
   * Açılışta bir kez + IMHA_ARALIK_MS'de bir çalışır. unref(): bekleyen zamanlayıcı
   * sürecin kapanmasını engellemesin.
   */
  const { KisiselVeriSabitleri } = await import('./lib/utils/constants.js');

  const imhaCalistir = async () => {
    try {
      const { getSikayetService, getSmsLogRepository } = await import('./lib/services/index.js');
      const { AdminRepository } = await import('./lib/infrastructure/repositories/AdminRepository.js');
      const { PersonelRepository } = await import('./lib/infrastructure/repositories/PersonelRepository.js');
      const { r2Sil, r2Yapilandirildi } = await import('./lib/server/r2.js');

      const rapor = await getSikayetService().periyodikImha({
        // R2 yapılandırılmamışsa fotoğraf silme adımı atlanır (DB tarafı yine çalışır).
        r2Sil: r2Yapilandirildi() ? r2Sil : null,
        adminRepo: new AdminRepository(),
        personelRepo: new PersonelRepository(),
        smsLogRepo: getSmsLogRepository(),
      });

      // Yalnız iş yapıldığında log bas — her 6 saatte bir boş satır kirliliği olmasın.
      const toplam = rapor.telefon + rapor.anonimlestirilen + rapor.kaliciSilinen
        + rapor.smsLog + rapor.belirtec + rapor.engelli;
      if (toplam > 0) {
        console.log(
          `[KVKK imha] telefon:${rapor.telefon} anonim:${rapor.anonimlestirilen} `
          + `kalıcı-sil:${rapor.kaliciSilinen} foto:${rapor.fotografSilinen} `
          + `sms-log:${rapor.smsLog} belirteç:${rapor.belirtec} engelli:${rapor.engelli}`
        );
      }
      // Kısmi hatalar sessiz kalmasın: bir adım patlasa da diğerleri çalışmıştı.
      if (rapor.hatalar.length) console.error('[KVKK imha] kısmi hatalar:', rapor.hatalar.join(' | '));
    } catch (err) {
      // İmha başarısız olursa uygulama ayakta kalmalı; bir sonraki turda yeniden denenir.
      console.error('[KVKK imha] görev hatası:', err?.message);
    }
  };

  // Açılışta hemen değil kısa gecikmeyle: DB havuzu ısınmadan sorgu atmayalım.
  setTimeout(imhaCalistir, 30_000).unref?.();
  setInterval(imhaCalistir, KisiselVeriSabitleri.IMHA_ARALIK_MS).unref?.();
}
