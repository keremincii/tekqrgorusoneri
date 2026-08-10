import { sha256Hashle } from '@/lib/security/hmac.js';
import {
  GuvenlikSabitleri, PersonelRolleri, durumKapaliMi, turIkonluEtiket,
} from '@/lib/utils/constants.js';
import { r2Yapilandirildi, r2Indir } from '@/lib/server/r2.js';
import { sirCoz } from '@/lib/security/sifreleme.js';

/** Telegram parse_mode=HTML için kaçış (yalnızca & < > — HTML'in tehlikeli üçlüsü). */
function htmlKacis(metin) {
  return String(metin ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Google Maps yürüyüş/araç navigasyon linki (telefonun harita uygulamasını açar). */
function yolTarifiLinki(enlem, boylam) {
  return `https://www.google.com/maps/dir/?api=1&destination=${enlem},${boylam}`;
}

/** "Ahmet Y." biçimi (personel kısa adı). */
function personelKisaAd(personel) {
  const ad = personel?.ad || '';
  const soyadBas = personel?.soyad ? `${personel.soyad.charAt(0)}.` : '';
  return `${ad} ${soyadBas}`.trim();
}

/**
 * TelegramService - Saha Ekibi Telegram Botu Orkestrasyonu
 *
 * İKİ YÖN:
 * 1. GİDEN (atamaBildir): Başkan bir şikayeti personele atayınca, personelin
 *    Telegram'ına foto + konum + açıklama + "✅ Çözüldü" butonu gönderir.
 *    KVKK: Vatandaşın ad/soyad/telefonu GÖNDERİLMEZ (yalnızca sokak/kategori/
 *    açıklama/foto/konum — saha işi için gereken minimum).
 * 2. GELEN (updateIsle): Telegram webhook'undan gelen güncellemeleri işler:
 *    - /start <token> → personel chat_id eşleştirme (onboarding)
 *    - /islerim       → personele atalı açık işleri listeler (her biri buton'lu)
 *    - callback_query → "Çözüldü" butonu: IDOR doğrulaması + çözen personeli kaydet
 *
 * GÜVENLİK: Telegram, callback_query.from.id / message.from.id'yi garanti eder
 * (kimlik). tenant, bu kimliğe bağlı personel kaydından çözülür (Host yok). Her
 * çözümde şikayetin gerçekten o personele atalı olduğu doğrulanır (IDOR koruması).
 */
export class TelegramService {
  constructor({ telegramClient, personelRepo, sikayetRepo, sokakRepo, tenantRepo, smsProviderGetir, akisServisi = null }) {
    this.tg = telegramClient;
    this.personelRepo = personelRepo;
    this.sikayetRepo = sikayetRepo;
    this.sokakRepo = sokakRepo;
    this.tenantRepo = tenantRepo;
    // (tenant) => ISmsProvider — vatandaşa çözüm SMS'i için (belediyenin kendi Netgsm'i).
    this.smsProviderGetir = smsProviderGetir;
    // Telegram'dan yapılan durum değişikliği açık PANELLERE de yansımalı; yoksa
    // başkan "personel çözdü" bilgisini ancak sayfayı yenileyince görürdü.
    // LAZY fonksiyon olarak geçilir (dairesel bağımlılık olmasın).
    this.akisServisiGetir = akisServisi;
  }

  // ========== Paylaşılan gönderim yardımcıları ==========

  /** Başvurunun QR noktası adı + sabit koordinatını çözer (bildirim içeriği için). */
  async _basvuruIcerik(basvuru) {
    const nokta = await this.sokakRepo.idIleGetir(basvuru.sokakId, basvuru.tenantId);
    const enlem = nokta?.enlem;
    const boylam = nokta?.boylam;
    return {
      noktaAdi: nokta?.sokakAdi || '',
      enlem,
      boylam,
      konumVar: Number.isFinite(enlem) && Number.isFinite(boylam),
    };
  }

  /** Canlı akışa (varsa) güvenli bildirim — panel bildirimi asla ana akışı bozmaz. */
  async _akisaBildir(sikayetId, tenantId) {
    if (!this.akisServisiGetir) return;
    try {
      await this.akisServisiGetir().basvuruGuncellendi(sikayetId, tenantId);
    } catch (e) {
      console.error('Telegram → panel akış bildirimi hatası:', e?.message);
    }
  }

  /**
   * Bir başvuru bildirimini tek bir chat'e gönderir (foto varsa foto+caption, yoksa
   * metin; ardından native konum pini). KVKK: vatandaş kimliği EKLENMEZ.
   * @param {Array} butonlar - Opsiyonel inline_keyboard satır dizisi ([[btn],[btn]]); yoksa butonsuz.
   */
  async _basvuruGonder(chatId, sikayet, icerik, { butonlar = null, baslik = 'Yeni iş' } = {}) {
    const satirlar = [`<b>${htmlKacis(baslik)}</b>`, ''];
    satirlar.push(turIkonluEtiket(sikayet.tur));
    if (icerik.noktaAdi) satirlar.push(`📍 ${htmlKacis(icerik.noktaAdi)}`);
    if (sikayet.aciklama) satirlar.push('', htmlKacis(String(sikayet.aciklama).slice(0, 900)));
    if (icerik.konumVar) satirlar.push('', `<a href="${yolTarifiLinki(icerik.enlem, icerik.boylam)}">Yol tarifi için tıkla</a>`);
    const metin = satirlar.join('\n');
    const butonlarArr = butonlar && butonlar.length ? butonlar : undefined;

    let res;
    if (sikayet.fotografUrl && r2Yapilandirildi()) {
      const nesne = await r2Indir(sikayet.fotografUrl).catch(() => null);
      res = nesne
        ? await this.tg.sendPhoto(chatId, nesne.buffer, metin, butonlarArr)
        : await this.tg.sendMessage(chatId, metin, butonlarArr);
    } else {
      res = await this.tg.sendMessage(chatId, metin, butonlarArr);
    }
    if (icerik.konumVar) {
      await this.tg.sendLocation(chatId, icerik.enlem, icerik.boylam).catch(() => { });
    }
    return res;
  }

  /** "✅ Çözüldü" inline butonu (saha personeli için). */
  _cozButonu(sikayetId) {
    return { text: '✅ Çözüldü', callback_data: `${GuvenlikSabitleri.TELEGRAM_CALLBACK_PREFIX}${sikayetId}` };
  }

  /** "❌ Bulunamadı / Çözülemedi" inline butonu (personel sahada bulamazsa → başkana escalation). */
  _bulunamadiButonu(sikayetId) {
    return { text: '❌ Bulunamadı / Çözülemedi', callback_data: `${GuvenlikSabitleri.TELEGRAM_BULUNAMADI_PREFIX}${sikayetId}` };
  }

  /** Saha personeli klavyesi: [Çözüldü] + [Bulunamadı/Çözülemedi]. */
  _personelButonlari(sikayetId) {
    return [[this._cozButonu(sikayetId)], [this._bulunamadiButonu(sikayetId)]];
  }

  // ========== GİDEN: manuel atama bildirimi (başkan panelden atar) ==========

  /**
   * Personele MANUEL atanan şikayetin bildirimini gönderir (başkan panelden atama).
   * @param {Object} sikayet - Atanmış şikayet kaydı
   * @param {Object} personel - Hedef personel (telegramChatId dahil)
   * @returns {Promise<{bildirimGonderildi: boolean, sebep?: string, hata?: string}>}
   */
  async atamaBildir(sikayet, personel) {
    if (!personel?.telegramChatId) {
      return { bildirimGonderildi: false, sebep: 'baglanmadi' };
    }
    const icerik = await this._basvuruIcerik(sikayet);
    const res = await this._basvuruGonder(personel.telegramChatId, sikayet, icerik, {
      butonlar: this._personelButonlari(sikayet.id),
      baslik: 'Yeni iş atandı',
    });
    return { bildirimGonderildi: Boolean(res?.basarili), hata: res?.hata };
  }

  // ========== GİDEN: yeni başvuru bilgisi (kayıt anında) ==========

  /**
   * Yeni bir başvuru kaydedildiğinde başkan + başkan yardımcısına BİLGİ bildirimi
   * (butonsuz). KVKK: vatandaş kimliği gönderilmez.
   *
   * SAHA PERSONELİNE OTOMATİK GİTMEZ — ve bu bilinçli bir üründür kararıdır:
   * kategori ekseni olmadığı için "bu başvuru hangi birime düşer?" sorusunun makine
   * tarafından verilebilecek bir cevabı yok. Bir görüş ya da öneri zaten saha işi bile
   * olmayabilir. İş dağıtımı yönetimin kararıdır; personel bildirimi ATAMA ile gider
   * (bkz. atamaBildir).
   *
   * Asla fırlatmaz — kayıt zaten başarılı, bildirim en iyi çabadır.
   * @returns {Promise<{yoneticiSayisi: number}>}
   */
  async yeniBasvuruBildir(sikayet) {
    try {
      const icerik = await this._basvuruIcerik(sikayet);
      const yoneticiler = await this.personelRepo.rolPersonelleriGetir(
        sikayet.tenantId, [PersonelRolleri.BASKAN, PersonelRolleri.BASKAN_YARDIMCISI],
      );
      for (const y of yoneticiler) {
        await this._basvuruGonder(y.telegramChatId, sikayet, icerik, {
          baslik: 'Yeni başvuru',
        }).catch(() => { });
      }
      return { yoneticiSayisi: yoneticiler.length };
    } catch (err) {
      console.error('yeniBasvuruBildir hatası:', err);
      return { yoneticiSayisi: 0 };
    }
  }

  // ========== GELEN: webhook güncellemeleri ==========

  /**
   * Telegram'dan gelen bir update'i işler (webhook veya dev-polling çağırır).
   * Asla fırlatmaz; hatalar loglanır (Telegram'a hızlı 200 dönebilmek için).
   */
  async updateIsle(update) {
    try {
      if (update?.callback_query) {
        return await this._callbackIsle(update.callback_query);
      }
      const msg = update?.message;
      if (msg && typeof msg.text === 'string') {
        const text = msg.text.trim();
        if (text.startsWith('/start')) return await this._startIsle(msg, text);
        if (text.startsWith('/islerim')) return await this._islerimIsle(msg);
        await this.tg.sendMessage(
          msg.from?.id ?? msg.chat?.id,
          'Komutlar:\n/islerim — size atanmış açık işleri listeler.'
        );
      }
    } catch (err) {
      console.error('Telegram update işleme hatası:', err);
    }
  }

  /** /start <token> → personel chat_id eşleştirme (onboarding). */
  async _startIsle(msg, text) {
    const chatId = msg.from?.id ?? msg.chat?.id;
    const token = text.split(/\s+/)[1];

    if (!token) {
      await this.tg.sendMessage(
        chatId,
        'Merhaba! Bu bot belediye saha ekibi içindir. Başkanınızdan size özel <b>bağlantı linki</b> isteyin.'
      );
      return;
    }

    const kod = await this.personelRepo.baglantiKoduBul(sha256Hashle(token));
    const suresiDoldu = kod?.sonGecerlilikTarihi && Date.now() > new Date(kod.sonGecerlilikTarihi).getTime();
    if (!kod || kod.kullanildi || suresiDoldu) {
      await this.tg.sendMessage(
        chatId,
        '⚠️ Bağlantı linki geçersiz veya süresi dolmuş. Başkanınızdan yeni bir link isteyin.'
      );
      return;
    }

    // ATOMİK tek-kullanım claim ÖNCE (bind'den önce): yalnız kullanildi=false ise flip
    // eder + satır döner. Eşzamanlı iki /start yarışırsa yalnız biri claim eder; diğeri
    // null → reddedilir (aynı token'la iki farklı chat_id'nin aynı personele bağlanma
    // yarışı kapanır). Yukarıdaki kullanildi kontrolü hızlı yol/dostane mesaj içindir.
    const claim = await this.personelRepo.baglantiKoduKullanildiIsaretle(kod.id);
    if (!claim) {
      await this.tg.sendMessage(
        chatId,
        '⚠️ Bağlantı linki geçersiz veya zaten kullanılmış. Başkanınızdan yeni bir link isteyin.'
      );
      return;
    }

    // chat_id global benzersiz: başka kayda bağlıysa DB unique ihlali → yakala
    try {
      await this.personelRepo.chatIdBagla(kod.personelId, chatId);
    } catch {
      await this.tg.sendMessage(
        chatId,
        '⚠️ Bu Telegram hesabı zaten başka bir personel kaydına bağlı. Başkanınızla görüşün.'
      );
      return;
    }

    const personel = await this.personelRepo.idIleGetir(kod.personelId, kod.tenantId);
    await this.tg.sendMessage(
      chatId,
      `✅ Merhaba ${htmlKacis(personel?.ad || '')}, kaydınız tamamlandı. Size iş atandığında buradan bildirim alacaksınız.\n\nAçık işlerinizi görmek için: /islerim`
    );
  }

  /** /islerim → personele atalı açık işleri (her biri kendi "Çözüldü" butonuyla). */
  async _islerimIsle(msg) {
    const chatId = msg.from?.id ?? msg.chat?.id;
    const personel = await this.personelRepo.chatIdIleBul(chatId);
    if (!personel) {
      await this.tg.sendMessage(chatId, '⚠️ Kayıtlı değilsiniz. Başkanınızdan bağlantı linki isteyin.');
      return;
    }

    const isler = await this.sikayetRepo.personeleAtananAciklar(personel.tenantId, personel.id);
    if (!isler.length) {
      await this.tg.sendMessage(chatId, '✅ Şu an açık işiniz yok.');
      return;
    }

    await this.tg.sendMessage(chatId, `📋 Açık işleriniz: <b>${isler.length}</b>`);
    for (const s of isler) {
      const konumVar = Number.isFinite(s.enlem) && Number.isFinite(s.boylam);
      const satirlar = [turIkonluEtiket(s.tur)];
      if (s.noktaAdi) satirlar.push(`📍 <b>${htmlKacis(s.noktaAdi)}</b>`);
      if (s.aciklama) satirlar.push('', htmlKacis(String(s.aciklama).slice(0, 900)));
      if (konumVar) {
        satirlar.push('', `🧭 <a href="${yolTarifiLinki(s.enlem, s.boylam)}">Yol tarifi</a>`);
      }
      const buton = this._personelButonlari(s.id);
      await this.tg.sendMessage(chatId, satirlar.join('\n'), buton);
      if (konumVar) {
        await this.tg.sendLocation(chatId, s.enlem, s.boylam).catch(() => { });
      }
    }
  }

  /** Inline buton: kimlik → personel → IDOR doğrulama → prefix'e göre çöz / bulunamadı. */
  async _callbackIsle(cbq) {
    const chatId = cbq.from?.id;
    const data = cbq.data || '';
    const cozPre = GuvenlikSabitleri.TELEGRAM_CALLBACK_PREFIX;
    const bulPre = GuvenlikSabitleri.TELEGRAM_BULUNAMADI_PREFIX;

    let mod, sikayetId;
    if (data.startsWith(cozPre)) { mod = 'coz'; sikayetId = data.slice(cozPre.length); }
    else if (data.startsWith(bulPre)) { mod = 'bulunamadi'; sikayetId = data.slice(bulPre.length); }
    else {
      await this.tg.answerCallbackQuery(cbq.id, 'Anlaşılmadı.');
      return;
    }

    const personel = await this.personelRepo.chatIdIleBul(chatId);
    if (!personel) {
      await this.tg.answerCallbackQuery(cbq.id, 'Kayıtlı değilsiniz.', true);
      return;
    }

    const sikayet = await this.sikayetRepo.idIleGetir(sikayetId, personel.tenantId);
    if (!sikayet) {
      await this.tg.answerCallbackQuery(cbq.id, 'İş bulunamadı.', true);
      return;
    }

    // Yetki (IDOR): başkan/yardımcı her işi; kendisine atalı iş; ya da atama yoksa
    // kategorinin biriminde olan personel. Hem çöz hem bulunamadı için aynı kapı.
    if (!(await this._cozmeYetkisi(personel, sikayet))) {
      await this.tg.answerCallbackQuery(cbq.id, 'Bu işlem için yetkiniz yok.', true);
      return;
    }

    if (mod === 'bulunamadi') {
      await this._bulunamadiIsle(cbq, personel, sikayet);
      return;
    }

    // İdempotent: zaten çözülmüşse tekrar yazma
    if (durumKapaliMi(sikayet.durum)) {
      await this.tg.answerCallbackQuery(cbq.id, 'Bu iş zaten çözüldü olarak işaretli.');
      await this._mesajiCozulduYap(cbq, personel, sikayet.cozulmeTarihi);
      return;
    }

    const simdi = new Date();
    await this.sikayetRepo.cozenKaydet(sikayetId, personel.tenantId, personel.id, simdi);
    await this.tg.answerCallbackQuery(cbq.id, '✔️ Çözüldü olarak kaydedildi. Teşekkürler!');
    await this._mesajiCozulduYap(cbq, personel, simdi);

    // Açık panellerde kart anında "Çözüldü"ye dönsün (başkan yenilemek zorunda kalmasın).
    await this._akisaBildir(sikayetId, personel.tenantId);

    // Çözüm sonrası: başkan+yardımcıya "şu kişi çözdü" bildirimi + vatandaşa SMS.
    // En iyi çaba — biri patlarsa çözüm kaydı yine geçerlidir.
    await this._cozulduSonrasi(sikayet, personel, simdi).catch((e) =>
      console.error('çözüm sonrası bildirim hatası:', e));
  }

  /**
   * "Bulunamadı / Çözülemedi" butonu: personel sahaya gitmiş ama sorunu bulamamış/
   * çözememiştir. Şikayet AÇIK kalır (durum değişmez); başkan + yardımcıya escalation
   * bildirimi gider (yeniden atasın veya kapatsın). En iyi çaba — bildirim patlasa da
   * personele "iletildi" toast'u döner.
   */
  async _bulunamadiIsle(cbq, personel, sikayet) {
    if (durumKapaliMi(sikayet.durum)) {
      await this.tg.answerCallbackQuery(cbq.id, 'Bu iş zaten çözüldü olarak işaretli.');
      return;
    }
    await this.tg.answerCallbackQuery(cbq.id, '⚠️ Başkana iletildi. Teşekkürler.');

    const icerik = await this._basvuruIcerik(sikayet);
    const saat = new Date().toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
    const metin = [
      '<b>⚠️ Sahada bulunamadı / çözülemedi</b>',
      '',
      turIkonluEtiket(sikayet.tur),
      ...(icerik.noktaAdi ? [`📍 ${htmlKacis(icerik.noktaAdi)}`] : []),
      '',
      `Bildiren: <b>${htmlKacis(personelKisaAd(personel))}</b> • ${saat}`,
      '',
      'Başvuru açık bırakıldı; panelden yeniden atayabilir veya kapatabilirsiniz.',
    ].join('\n');

    const yoneticiler = await this.personelRepo.rolPersonelleriGetir(
      sikayet.tenantId, [PersonelRolleri.BASKAN, PersonelRolleri.BASKAN_YARDIMCISI],
    );
    for (const y of yoneticiler) {
      await this.tg.sendMessage(y.telegramChatId, metin).catch(() => { });
    }
  }

  /**
   * Çözme yetkisi (IDOR kapısı): başkan/yardımcı → her iş; saha personeli → YALNIZ
   * kendisine ATANMIŞ iş.
   *
   * Eskiden üçüncü bir yol daha vardı: atanmamış bir kayıtta, kaydın kategorisini
   * kapsayan birimin personeli de çözebiliyordu. Kategori ekseni kalkınca o yolun
   * dayanağı kalmadı ve kural DARALDI (gevşemedi): atanmamış bir başvuruya saha
   * personeli dokunamaz. Bu, otomatik dağıtımın kalkmasıyla da tutarlıdır — bir işin
   * sahibi olması için önce atanmış olması gerekir.
   */
  async _cozmeYetkisi(personel, sikayet) {
    if (personel.rol === PersonelRolleri.BASKAN || personel.rol === PersonelRolleri.BASKAN_YARDIMCISI) {
      return true;
    }
    return Boolean(sikayet.atananPersonelId) && sikayet.atananPersonelId === personel.id;
  }

  /**
   * Çözüm sonrası yan etkiler: (1) başkan+yardımcıya "şu şikayet şu kişi tarafından
   * çözüldü" Telegram bilgisi; (2) şikayeti açan vatandaşa "çözüldü" SMS'i (belediyenin
   * kendi Netgsm hesabından; telefon yoksa/sağlayıcı yoksa sessizce atlanır).
   */
  async _cozulduSonrasi(sikayet, cozenPersonel, tarih) {
    const icerik = await this._basvuruIcerik(sikayet);
    const saat = new Date(tarih).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

    // (1) Başkan + yardımcı bilgi bildirimi
    const yoneticiler = await this.personelRepo.rolPersonelleriGetir(
      sikayet.tenantId, [PersonelRolleri.BASKAN, PersonelRolleri.BASKAN_YARDIMCISI],
    );
    if (yoneticiler.length) {
      const satirlar = ['<b>✔️ Başvuru çözüldü</b>', ''];
      satirlar.push(turIkonluEtiket(sikayet.tur));
      if (icerik.noktaAdi) satirlar.push(`📍 ${htmlKacis(icerik.noktaAdi)}`);
      satirlar.push('', `Çözen: <b>${htmlKacis(personelKisaAd(cozenPersonel))}</b> • ${saat}`);
      const metin = satirlar.join('\n');
      for (const y of yoneticiler) {
        await this.tg.sendMessage(y.telegramChatId, metin).catch(() => { });
      }
    }

    // (2) Vatandaşa çözüm SMS'i (rıza ile saklanan telefon varsa)
    await this._vatandasaCozumSmsi(sikayet).catch((e) => console.error('çözüm SMS hatası:', e));
  }

  /** Şikayeti açan vatandaşa "çözüldü" SMS'i gönderir (belediyenin Netgsm hesabından). */
  /**
   * Vatandaşa "çözüldü" SMS'i. Numara DB'de ŞİFRELİ durur (sikayetler.telefon_enc,
   * migration 0016); burada yalnız gönderim ânında çözülür ve hiçbir yere yazılmaz/
   * loglanmaz. Çözülemezse (anahtar değişmiş, veri bozulmuş, süre dolup imha edilmiş)
   * sessizce vazgeçilir — çözüm kaydı zaten geçerlidir, SMS en iyi çabadır.
   */
  async _vatandasaCozumSmsi(sikayet) {
    if (!sikayet.telefonEnc || !this.tenantRepo || !this.smsProviderGetir) return;
    const telefon = sirCoz(sikayet.telefonEnc);
    if (!telefon) return; // anahtar/veri uyuşmuyor → gönderme
    const tenant = await this.tenantRepo.idIleGetir(sikayet.tenantId);
    if (!tenant) return;
    const provider = this.smsProviderGetir(tenant);
    if (!provider) return;
    const belediyeAdi = tenant.ad || 'Belediye';
    // SMS'te Türkçe karakter kullanılmaz (tek parça/ucuz gönderim).
    const mesaj = `${belediyeAdi}: Bize ilettiginiz basvuru sonuclandirilmistir. Ilginiz icin tesekkur ederiz.`;
    await provider.smsGonder(telefon, mesaj);
  }

  /**
   * PANELDEN kapatma yolu için dışa açık sarmalayıcı. Telegram'daki "Çözüldü" butonu
   * `_cozulduSonrasi` üzerinden zaten SMS gönderiyordu; panelden kapatılan kayıt ise
   * hiç SMS üretmiyordu — vatandaş açısından "kim kapattı"nın önemi yok, bildirim her
   * iki yolda da gitmeli.
   */
  async cozumSmsiGonder(sikayet) {
    return this._vatandasaCozumSmsi(sikayet);
  }

  /** Çözülen işin mesajını günceller: çözen + saat eklenir, buton kaldırılır. */
  async _mesajiCozulduYap(cbq, personel, tarih) {
    const msg = cbq.message;
    if (!msg) return;

    const saat = tarih
      ? new Date(tarih).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
      : '';
    const not = `\n\n✔️ <b>${htmlKacis(personelKisaAd(personel))}</b> çözdü • ${saat}`;

    // msg.caption/text Telegram'dan görüntü metni olarak gelir (HTML entity uygulanmış);
    // HTML parse_mode ile yeniden gönderirken & < > kırılmasın diye yeniden kaçışla.
    if (typeof msg.caption === 'string') {
      await this.tg.editMessageCaption(msg.chat.id, msg.message_id, htmlKacis(msg.caption) + not, []);
    } else {
      const taban = typeof msg.text === 'string' ? htmlKacis(msg.text) : '';
      await this.tg.editMessageText(msg.chat.id, msg.message_id, taban + not, []);
    }
  }
}
