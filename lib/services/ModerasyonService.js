import {
  SikayetDurumu, GuvenlikSabitleri, turGecerliMi, turIkonluEtiket,
} from '@/lib/utils/constants.js';

/**
 * Tür satırı ("⚠️ Şikayet" / "💬 Görüş" / "💡 Öneri"). Tanınmayan bir tür (eski/elle
 * girilmiş kayıt) satırı hiç bastırmaz — bilgisiz bir satır operatöre bir şey söylemez.
 */
function turSatiri(basvuru) {
  return turGecerliMi(basvuru?.tur) ? turIkonluEtiket(basvuru.tur) : null;
}

/** Telegram parse_mode=HTML için kaçış. Küfürlü metin buradan geçer — şart. */
function htmlKacis(metin) {
  return String(metin ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function saatBicimle(tarih) {
  return new Date(tarih).toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });
}

/**
 * ModerasyonService — Küfür Filtresine Takılan Başvurular (AYRI Telegram botu)
 * ===========================================================================
 *
 * AKIŞ:
 *   1. Vatandaş küfürlü başvuru gönderir → SikayetService kaydı `moderasyonda`
 *      durumuyla açar. Vatandaşa SIRADAN BAŞARI YANITI döner (filtreyi kalibre
 *      edemesin) ama kayıt haritaya/panele düşmez, sahaya bildirim gitmez.
 *   2. Bu servis kaydı moderasyon botuna düşürür: tür rozeti + metin + yakalanan
 *      kalıp + buton.
 *   3. Operatör "Onayla ve ilet" derse durum `beklemede`ye çekilir ve NORMAL akış
 *      (türe göre birim/yönetici bildirimi) hiç atlanmamış gibi çalışır.
 *   4. Butona basılmazsa kayıt `moderasyonda` kalır — yani varsayılan "yayınlama".
 *
 * NEDEN TÜR ROZETİ ŞART: filtre öneri/teşekkür metinlerinde yapısal yanlış pozitif
 * üretir ("acizane bir önerim var…" → 'aciz' + 'belediye' → isnat şüphesi). Operatör
 * "🚫 küfür" başlığını görüp de elindekinin bir TEŞEKKÜR olduğunu bilmezse yanlış
 * karar verir. Bu yüzden her mesajda tür açıkça yazar.
 *
 * ÖNEMLİ: Bu bot personel (saha ekibi) ve alarm botlarından AYRIDIR; kendi token'ı
 * (TELEGRAM_MODERASYON_BOT_TOKEN) ve tek bir hedef sohbeti (TELEGRAM_MODERASYON_CHAT_ID)
 * vardır. Yetki kapısı da budur: callback yalnız o sohbetten kabul edilir.
 *
 * TelegramClient gibi exception FIRLATMAZ; yapılandırılmamışsa sessizce devre dışı
 * kalır — ama küfürlü başvuru o hâlde kimseye görünmeyeceği için WARN loglar.
 */
export class ModerasyonService {
  /**
   * @param {Object} bagimliliklar
   * @param {import('../infrastructure/telegram/TelegramClient.js').TelegramClient} bagimliliklar.telegramClient
   * @param {string|number} [bagimliliklar.chatId] - TELEGRAM_MODERASYON_CHAT_ID
   * @param {Object} bagimliliklar.sikayetRepo
   * @param {Object} bagimliliklar.sokakRepo
   * @param {Object} [bagimliliklar.tenantRepo] - Mesajda belediye adını göstermek için
   *   (tek moderasyon sohbeti birden çok belediyeye hizmet ettiğinde hangisi olduğu
   *   belli olsun). Yoksa ad satırı atlanır.
   * @param {() => Object} bagimliliklar.telegramServiceGetir - Onaydan sonra normal
   *   bildirim akışını çalıştıran saha botu servisi (lazy: döngüsel bağımlılık olmasın).
   */
  constructor({ telegramClient, chatId, sikayetRepo, sokakRepo, tenantRepo = null, telegramServiceGetir, akisServisi = null }) {
    this.tg = telegramClient;
    this.chatId = chatId || null;
    this.sikayetRepo = sikayetRepo;
    this.sokakRepo = sokakRepo;
    this.tenantRepo = tenantRepo;
    this.telegramServiceGetir = telegramServiceGetir;
    // Onaylanan kayıt o ana kadar panelde GÖRÜNMÜYORDU; onayla birlikte görünür olur →
    // açık panellere düşmeli. LAZY fabrika olarak geçilir (döngüsel import olmasın).
    this.akisServisiGetir = akisServisi;
  }

  /** Moderasyon botu + hedef sohbet tanımlı mı? */
  yapilandirildi() {
    return Boolean(this.tg?.yapilandirildi() && this.chatId);
  }

  /**
   * Moderasyon klavyesi: [Onayla ve ilet] + [Göndereni engelle].
   * tenantId callback_data'ya gömülür (bkz. TELEGRAM_MODERASYON_PREFIX) — bu botta
   * bağlı bir personel kaydı olmadığı için tenant başka türlü çözülemez.
   *
   * "Engelle", `scripts/engelle.sh liste` ile doğru kayıt id'sini arama adımını
   * ortadan kaldırır: mesaj zaten o başvuruya ait, hash de kaydından okunur.
   *
   * BUTON METNİ TÜR-NÖTRDÜR: mesajın kendisi zaten türü söylüyor; buton metnine tür
   * gömmek gereksiz. callback_data ÖNEKLERİ ise DEĞİŞMEZ — Telegram'daki eski
   * mesajların butonları o öneklere göre çözümlenir, değiştirmek onları kırardı.
   */
  _iletButonu(sikayet) {
    const hedef = `${sikayet.tenantId}:${sikayet.id}`;
    return [
      [{
        text: '✅ Hatalı yakalama — onayla ve ilet',
        callback_data: `${GuvenlikSabitleri.TELEGRAM_MODERASYON_PREFIX}${hedef}`,
      }],
      [{
        text: '🚫 Göndereni engelle (bir daha başvuru gönderemez)',
        callback_data: `${GuvenlikSabitleri.TELEGRAM_MODERASYON_ENGELLE_PREFIX}${hedef}`,
      }],
    ];
  }

  /**
   * Belediye adı satırı — tek moderasyon sohbeti birden çok belediyeye hizmet
   * ettiğinde hangisinden geldiği belli olsun. Repo yoksa/bulunamazsa boş döner.
   */
  async _belediyeSatiri(tenantId) {
    if (!this.tenantRepo) return null;
    const tenant = await this.tenantRepo.idIleGetir(tenantId).catch(() => null);
    return tenant?.ad ? `🏛️ ${htmlKacis(tenant.ad)}` : null;
  }

  /** "Bu kayıt şu an hiçbir yerde görünmüyor" notu (operatör yaptırımı sanmasın). */
  _gorunmezlikNotu() {
    return 'Vatandaşa normal başarı mesajı gösterildi. Bu başvuru panele ve sahaya <b>düşmedi</b>.';
  }

  /** Başvurunun okutulduğu QR noktasının adı (tek QR'da hep aynıdır; bağlam satırı). */
  async _noktaAdi(basvuru) {
    const nokta = await this.sokakRepo.idIleGetir(basvuru.sokakId, basvuru.tenantId).catch(() => null);
    return nokta?.sokakAdi || '';
  }

  /**
   * Filtreye takılan başvuruyu moderasyon botuna düşürür.
   * Asla fırlatmaz — kayıt zaten yapıldı, bildirim en iyi çabadır.
   *
   * @param {Object} sikayet - `moderasyonda` durumuyla kaydedilmiş şikayet
   * @param {{eslesme?: string, tur?: 'kufur'|'hakaret'|'isnat'}} [bilgi] - `tur` = KÜFÜR türü
   * @returns {Promise<{basarili: boolean, hata?: string}>}
   */
  async kufurBildir(sikayet, { eslesme, tur: kufurTuru } = {}) {
    if (!this.yapilandirildi()) {
      console.warn(
        '⚠ Küfür filtresine takılan başvuru moderasyona alındı ama moderasyon botu ' +
        'yapılandırılmamış (TELEGRAM_MODERASYON_BOT_TOKEN / TELEGRAM_MODERASYON_CHAT_ID). ' +
        `Kayıt görünmez durumda bekliyor: ${sikayet?.id}. Bot bağlandıktan sonra ` +
        'botta /bekleyenler yazarak listeleyebilirsiniz.'
      );
      return { basarili: false, hata: 'moderasyon-yapilandirilmamis' };
    }

    try {
      const noktaAdi = await this._noktaAdi(sikayet);
      const tur = turSatiri(sikayet);
      // Başlık KÜFÜR türüne göre: hangi katmanın yakaladığını tek bakışta gör (isnat
      // katmanı yanlış pozitife en açık olandır — "belediye" + "rezil" gibi sert eleştiri
      // ve hatta "acizane bir önerim var" da buraya düşebilir; başlık onu ayırt ettirir).
      const filtreBasligi = kufurTuru === 'isnat'
        ? '⚠️ Hedefli isnat/hakaret şüphesi'
        : kufurTuru === 'hakaret'
          ? '⚠️ Aşağılayıcı ifade'
          : '🚫 Küfür filtresine takıldı';
      const belediye = await this._belediyeSatiri(sikayet.tenantId);
      // İkisi de boşsa bu blok hiç basılmaz (başlıktan sonra iki boş satır kalmasın).
      const ustBilgi = [
        ...(tur ? [tur] : []),
        ...(noktaAdi ? [`📍 ${htmlKacis(noktaAdi)}`] : []),
      ];
      const metin = [
        `<b>${filtreBasligi}</b>`,
        ...(belediye ? [belediye] : []),
        '',
        ...(ustBilgi.length ? [...ustBilgi, ''] : []),
        htmlKacis(String(sikayet.aciklama || '(metin yok)').slice(0, 900)),
        '',
        `Yakalanan kalıp: <code>${htmlKacis(eslesme || '?')}</code> • ${saatBicimle(sikayet.olusturmaTarihi || Date.now())}`,
        '',
        this._gorunmezlikNotu(),
      ].join('\n');

      return await this.tg.sendMessage(this.chatId, metin, this._iletButonu(sikayet));
    } catch (err) {
      console.error('kufurBildir hatası:', err);
      return { basarili: false, hata: err?.message };
    }
  }

  // ========== GELEN: webhook güncellemeleri ==========

  /**
   * Moderasyon botuna gelen bir update'i işler. Asla fırlatmaz.
   * Yetki: yalnız TELEGRAM_MODERASYON_CHAT_ID sohbetinden gelen istekler kabul edilir.
   */
  async updateIsle(update) {
    try {
      if (update?.callback_query) return await this._callbackIsle(update.callback_query);

      const msg = update?.message;
      if (msg && typeof msg.text === 'string') {
        const chatId = msg.from?.id ?? msg.chat?.id;
        if (!this._yetkili(chatId)) return;
        const text = msg.text.trim();
        if (text.startsWith('/bekleyenler')) return await this._bekleyenleriListele(chatId);
        await this.tg.sendMessage(
          chatId,
          'Bu bot, küfür filtresine takılan başvuruları gösterir.\n\n' +
          '/bekleyenler — onay bekleyen kayıtları listeler.'
        );
      }
    } catch (err) {
      console.error('Moderasyon update işleme hatası:', err);
    }
  }

  /** Gelen sohbet, yapılandırılmış moderasyon sohbeti mi? (tek yetki kapısı) */
  _yetkili(chatId) {
    return this.chatId != null && String(chatId) === String(this.chatId);
  }

  /** Onay bekleyen (moderasyonda) kayıtları buton'larıyla listeler. */
  async _bekleyenleriListele(chatId) {
    const bekleyenler = await this.sikayetRepo.moderasyondakileriGetir();
    if (!bekleyenler.length) {
      await this.tg.sendMessage(chatId, '✅ Onay bekleyen başvuru yok.');
      return;
    }
    await this.tg.sendMessage(chatId, `📋 Onay bekleyen: <b>${bekleyenler.length}</b>`);
    for (const s of bekleyenler) {
      const belediye = await this._belediyeSatiri(s.tenantId);
      const tur = turSatiri(s);
      const metin = [
        ...(belediye ? [belediye] : []),
        ...(tur ? [tur] : []),
        ...(s.noktaAdi ? [`📍 ${htmlKacis(s.noktaAdi)}`] : []),
        '',
        htmlKacis(String(s.aciklama || '(metin yok)').slice(0, 900)),
        '',
        saatBicimle(s.olusturmaTarihi),
      ].join('\n');
      await this.tg.sendMessage(chatId, metin, this._iletButonu(s)).catch(() => { });
    }
  }

  /**
   * Inline buton yönlendirmesi: yetki (chat) → prefix'e göre "ilet" veya "engelle".
   */
  async _callbackIsle(cbq) {
    const chatId = cbq.from?.id;
    if (!this._yetkili(chatId)) {
      await this.tg.answerCallbackQuery(cbq.id, 'Bu işlem için yetkiniz yok.', true);
      return;
    }

    const iletPre = GuvenlikSabitleri.TELEGRAM_MODERASYON_PREFIX;
    const engellePre = GuvenlikSabitleri.TELEGRAM_MODERASYON_ENGELLE_PREFIX;
    const data = cbq.data || '';

    const mod = data.startsWith(iletPre) ? 'ilet' : data.startsWith(engellePre) ? 'engelle' : null;
    if (!mod) {
      await this.tg.answerCallbackQuery(cbq.id, 'Anlaşılmadı.');
      return;
    }

    // `<prefix><tenantId>:<sikayetId>` — tenant, bu botta personel kaydından
    // çözülemediği için callback_data'ya gömülüdür.
    const ham = data.slice((mod === 'ilet' ? iletPre : engellePre).length);
    const [tenantHam, sikayetId] = ham.split(':');
    const tenantId = Number(tenantHam);
    if (!Number.isInteger(tenantId) || !sikayetId) {
      await this.tg.answerCallbackQuery(cbq.id, 'Anlaşılmadı.');
      return;
    }

    const sikayet = await this.sikayetRepo.idIleGetir(sikayetId, tenantId);
    if (!sikayet) {
      await this.tg.answerCallbackQuery(cbq.id, 'Başvuru bulunamadı.', true);
      return;
    }

    if (mod === 'engelle') {
      await this._engelleIsle(cbq, sikayet, tenantId);
      return;
    }

    // İdempotent: aynı butona iki kez basılırsa ikinci kez bildirim GÖNDERİLMEZ
    // (aksi halde saha ekibine mükerrer iş düşerdi).
    if (sikayet.durum !== SikayetDurumu.MODERASYONDA) {
      await this.tg.answerCallbackQuery(cbq.id, 'Bu başvuru zaten iletilmiş.');
      await this._mesajiIletildiYap(cbq);
      return;
    }

    const guncel = await this.sikayetRepo.durumGuncelle(sikayetId, tenantId, SikayetDurumu.BEKLEMEDE);
    await this.tg.answerCallbackQuery(cbq.id, '✔️ Onaylandı ve iletildi.');
    await this._mesajiIletildiYap(cbq);

    // Kayıt artık görünür → açık panellere YENİ başvuru olarak düşsün (o ana kadar
    // hiç görünmediği için bu bir "güncelleme" değil, "yeni"dir).
    if (this.akisServisiGetir) {
      await this.akisServisiGetir().yeniBasvuru(sikayetId, tenantId).catch((e) =>
        console.error('moderasyon sonrası akış yayını hatası:', e));
    }

    // Normal akış: yönetime (başkan + yardımcı) bilgi bildirimi. En iyi çaba —
    // patlarsa durum değişikliği yine geçerlidir.
    await this.telegramServiceGetir().yeniBasvuruBildir(guncel || sikayet).catch((e) =>
      console.error('moderasyon sonrası bildirim hatası:', e));
  }

  /**
   * "Göndereni engelle" butonu: kaydın kimlik_hash'ini (telefonun tek yönlü özeti)
   * kara listeye ekler → o numara bir daha SMS kodu isteyemez ve HİÇBİR TÜRDE, BU
   * DAĞITIMDAKİ HİÇBİR BELEDİYEDE başvuru gönderemez (bkz. schema.js
   * engelliKimlikler). Ham telefon GEREKMEZ; hash zaten kayıtta durur.
   *
   * Tek moderasyon sohbeti birden çok belediyeye hizmet edebildiği için bu, farklı
   * belediyelerden gelen kayıtları da aynı operatörün tek düğmeyle, hepsini birden
   * kapsayacak şekilde engelleyebilmesini sağlar — kasıtlı davranış.
   *
   * Kayıt ayrıca `silindi` yapılır: zaten yayınlanmayacak, `/bekleyenler` listesini
   * de kirletmesin. Kayıt silinmez (soft delete) — hash ve içerik denetim için kalır.
   */
  async _engelleIsle(cbq, sikayet, tenantId) {
    const kimlikHash = sikayet.kimlikHash || await this.sikayetRepo.kimlikHashGetir(sikayet.id, tenantId);
    if (!kimlikHash) {
      await this.tg.answerCallbackQuery(cbq.id, 'Kimlik bilgisi bulunamadı.', true);
      return;
    }

    await this.sikayetRepo.engelle(kimlikHash, 'moderasyon-botu');
    // Zaten silinmişse tekrar yazmaya gerek yok (idempotent).
    if (sikayet.durum !== SikayetDurumu.SILINDI) {
      await this.sikayetRepo.softDelete(sikayet.id, tenantId).catch((e) =>
        console.error('engelle sonrası soft delete hatası:', e));
    }

    await this.tg.answerCallbackQuery(cbq.id, '🚫 Bu numara engellendi.');

    const msg = cbq.message;
    if (!msg) return;
    const not = `\n\n🚫 <b>Gönderen engellendi</b> • ${saatBicimle(Date.now())}\n` +
      `<code>${htmlKacis(kimlikHash.slice(0, 12))}…</code> kara listede. ` +
      'Engeli kaldırmak için sunucuda: <code>scripts/engelle.sh kaldir &lt;hash&gt;</code>';
    const taban = typeof msg.text === 'string' ? htmlKacis(msg.text) : '';
    await this.tg.editMessageText(msg.chat.id, msg.message_id, taban + not, []).catch(() => { });
  }

  /** Mesajı "iletildi" olarak işaretler ve butonu kaldırır (metin tür-nötr). */
  async _mesajiIletildiYap(cbq) {
    const msg = cbq.message;
    if (!msg) return;
    const not = `\n\n✔️ <b>Onaylandı ve iletildi</b> • ${saatBicimle(Date.now())}`;
    // msg.text Telegram'dan görüntü metni olarak gelir → HTML parse_mode ile yeniden
    // gönderirken & < > kırılmasın diye yeniden kaçışlanır.
    const taban = typeof msg.text === 'string' ? htmlKacis(msg.text) : '';
    await this.tg.editMessageText(msg.chat.id, msg.message_id, taban + not, []).catch(() => { });
  }
}
