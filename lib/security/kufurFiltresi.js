/**
 * Küfür Filtresi — normalize et, sonra sözlükle eşleştir
 * ======================================================
 *
 * Ham sözlük eşleşmesi işe yaramaz: kimse "siktir" yazmaz; "s.ktir", "$1kt1r",
 * "s i k t i r", "sikkktir" yazar. Bu yüzden metin ÖNCE normalize edilir:
 *
 *   1. Unicode NFKD + birleştirici işaretleri sil → ş→s, ğ→g, ü→u, ö→o, ç→c, İ→i
 *   2. Küçült; NFKD'nin ayrıştırmadığı 'ı' elle 'i'ye map'lenir
 *   3. Leet çevir (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s, !→i)
 *   4. Ayırıcıları ele (boşluk, nokta, yıldız, tire, alt çizgi …)
 *   5. Tekrar eden harfleri daralt (aaa→a, kkk→k)
 *
 * SONRA İKİ AYRI GEÇİŞTE eşleştirilir — çünkü tek geçiş Türkçede felaket üretir:
 *
 *   • YAPIŞIK geçiş (ayırıcılar SİLİNİR) → alt-dize araması. "s i k t i r" ve
 *     "s.i.k.t.i.r" burada yakalanır. Yalnız masum bir kelimenin İÇİNDE geçmesi
 *     mümkün olmayan UZUN küfürler bu listede olabilir.
 *   • KELİME geçişi (ayırıcılar BOŞLUĞA çevrilir) → tam kelime eşleşmesi. Kısa ve
 *     riskli olanlar (am, got, pic, yarak…) yalnız burada aranır.
 *
 * Neden şart — alt-dize eşleşmesinin vurduğu masum kelimeler:
 *   psikolog/psikoloji ("sik"), kerpiç ("piç"), götürmek ("göt"), Amasya/amaç/amca
 *   ("am"), sikke/siklet ("sik"), ve iki sinsi olan:
 *     · zarf-fiil eki "-(y)arak": kayarak, sayarak, yapmayarak … hepsi "yarak" içerir
 *     · iyelik eki "-amına": adamına, akşamına, toplamına … hepsi "amına" içerir
 *
 * AYRICA ı/i düzlemesinin yan etkisi: normalizasyondan sonra "sık" = "sik". Türkçede
 * "sık-" kökü çok yaygındır (sık sık, sıkı, sıktı, sıkıntı), bu yüzden kısa "sik"
 * kalıpları HİÇBİR listede yer almaz — yalnız "siktir/sikeyim/sikerim" gibi masum
 * karşılığı olmayan uzun çekimler aranır.
 *
 * Bu modül SUNUCUDA çalışır (SikayetService.olustur içinde). İstemci tarafı bir
 * filtre `curl` ile beş saniyede atlanır; buradaki kapı atlanamaz.
 *
 * Filtre KESİN DEĞİLDİR ve öyle varsayılmamalıdır: yalnız açık küfrü yakalar. Örtük
 * hakaret ("başkan hırsız") sözlükle yakalanamaz — o ayrı bir katmandır.
 */

/** NFKD ile ayrışmayan, tek tek map'lenmesi gereken harfler ('ı' ayrı kod noktasıdır). */
const OZEL_HARFLER = { 'ı': 'i', 'ﬁ': 'fi', 'œ': 'oe', 'æ': 'ae' };

/** Rakam/sembolle harf taklidi (leetspeak). */
const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't',
};

/**
 * Her yerde (alt-dize olarak) aranan küfürler. BURAYA YALNIZ masum bir Türkçe
 * kelimenin içinde geçmesi mümkün OLMAYAN kalıplar girer.
 *
 * Yeni kelime eklemeden önce ÜÇ soru:
 *   (1) Bu dizi masum bir kelimenin içinde geçer mi?
 *   (2) ı→i düzlemesinden sonra masum bir kelimeye dönüşür mü?
 *   (3) İÇİNDE ÇİFT HARF VAR MI? Varsa buraya KOYMA — tekrar-daraltma listeyi de
 *       daralttığı için "yarrak" burada "yarak"a iner ve kayarak/sayarak/yapmayarak
 *       gibi masum kelimeleri vurur. Çift harfli kalıplar TAM_KELIME'ye gider.
 * Herhangi birine "evet" ise buraya değil, TAM_KELIME listesine ekle.
 */
const HER_YERDE = [
  // "sık-" kökü masum olduğu için yalnız masum karşılığı olmayan çekimler.
  // 'sktir': ünlüsü düşürülmüş yazım ("s.ktir"); "sektir(mek)" ile çakışmaz.
  'siktir', 'sktir', 'sikeyim', 'sikeyin', 'sikerim', 'sikiyim', 'sikecegim',
  'siktimin', 'siktigimin', 'sikimde', 'sikimi', 'siktiginin',
  // "amına" TEK BAŞINA YASAK (adamına/akşamına/toplamına onu içerir) — yalnız tam kalıp:
  'aminakoyayim', 'aminakoyim', 'aminakoyarim', 'amcik', 'amcigi',
  'orospu', 'oruspu', 'orspu', 'kahpe', 'pezevenk', 'gavat', 'yavsak',
  'gotveren', 'gotlek', 'gotoglani',
  'ibne', 'ibnelik', 'kaltak', 'surtuk', 'serefsiz', 'namussuz',
  'piçkurusu', 'sülalesini', 'avradini',
];

/**
 * Yalnız TAM KELİME olarak aranan kalıplar: (a) kısa/riskli olanlar ve (b) çift harf
 * içerdiği için alt-dize aranamayanlar (bkz. yukarıdaki 3. soru).
 *
 * 'am' bilerek YOKTUR: tek başına "am" yazımı nadir, buna karşılık "saat 10 am"
 * gibi masum kullanımı vurur — kazancı düşük, yanlış pozitifi gerçek. Küfür olarak
 * yazıldığında pratikte "amk"/"amq" biçiminde gelir, onlar listede.
 */
const TAM_KELIME = [
  'amk', 'amq', 'aq', 'mk', 'sg', 'amcik',
  'got', 'gotu', 'gotune', 'gotunu',
  'pic', 'pici',
  // "yarrak" tekrar-daraltmadan sonra "yarak"tır; tam kelime olarak güvenle aranır
  // (kayarak/sayarak tam kelime olarak "yarak"a eşit değildir).
  'yarak', 'yaragi', 'yaragim',
  'anani', 'ananin', 'anasini',
];

/**
 * DOĞRUDAN AŞAĞILAYICI sözler — küfür sayılmasa da hakarettir, TEK BAŞINA yakalanır
 * (hedef aranmaz). Alt-dize aranır ki çekimleri de tutsun: "salak"→"salaklık",
 * "aptal"→"aptallık".
 *
 * BURAYA GİRMEYENLER ve nedeni — belediye şikayetinin doğal kelimeleri oldukları için
 * yanlış pozitif üretirlerdi:
 *   hayvan/köpek/çakal/domuz/eşek/öküz → "Hayvan Sorunu" diye bir kategori var
 *   çöp → "Çöp / Temizlik" kategorisi;  mal → "mal sahibi", "malzeme"
 *   hıyar → sebze;  parazit → sinyal paraziti;  it → çok kısa, İngilizce "it"
 *   alçak → "alçak duvar/basınç";  rezil → "rezil durumda" (eleştiri, hakaret değil)
 * Bunlardan bazıları aşağıdaki İSNAT listesinde: orada hedefle birlikte aranır.
 */
const DOGRUDAN_HAKARET = [
  'salak', 'aptal', 'ahmak', 'budala', 'dangalak', 'gerizekali', 'gerzek',
  'embesil', 'avanak', 'beyinsiz', 'sersemsin', 'moron', 'aptalsin',
  'asagilik', 'soysuz', 'edepsiz', 'terbiyesiz', 'hayasiz', 'utanmaz',
  'arsiz', 'yuzsuz', 'pust', 'musvedde', 'asalak', 'defol', 'geberesice',
  'salaksin', 'salaklar', 'aptallar', 'cahilsin',
];

/**
 * İSNAT / SUÇLAMA sözleri — TEK BAŞINA YAKALANMAZ. Yalnız metinde aşağıdaki HEDEF
 * listesinden biri de geçiyorsa hakaret sayılır.
 *
 * Neden şart: "sokakta hırsız var, aydınlatma yok" ve "rüşvet isteniyor" gerçek
 * şikayet/ihbardır — bunlar durdurulmamalı. Ama "başkan hırsız", "belediye rüşvetçi"
 * kişiye/kuruma yönelik asılsız isnattır ve önce senin onayından geçmeli.
 */
const ISNAT = [
  'hirsiz', 'yolsuz', 'rusvet', 'dolandirici', 'soyguncu', 'sahtekar',
  'ucagitci', 'torpil', 'kayirma', 'vurguncu', 'talanci', 'yiyici', 'satilmis',
  'beceriksiz', 'isbilmez', 'cahil', 'yalanci', 'tembel', 'liyakatsiz',
  'kifayetsiz', 'yetersiz', 'basarisiz', 'sorumsuz', 'umursamaz', 'aciz',
  'zalim', 'gaddar', 'hain', 'yalaka', 'dalkavuk', 'rezil', 'alcak', 'zorba',
  'ciker', 'cete', 'mafya', 'sulaleniz',
];

/**
 * HEDEF sözcükleri — isnadın "kime" yöneldiğini gösterir. Alt-dize aranır ki tüm
 * çekimleri tutsun: "belediye"→"belediyenin/belediyeye", "baskan"→"başkanı/başkanlık".
 */
const HEDEF = [
  'baskan', 'belediye', 'mudur', 'memur', 'personel', 'zabita', 'muhtar',
  'encumen', 'meclis', 'amir', 'yetkili', 'idare', 'kurum', 'vekil',
  'kaymakam', 'vali', 'calisan', 'gorevli',
];

/**
 * `.env`'den eklenen kelimeler (virgülle ayrılır) — deploy gerektirmeden listeyi
 * genişletmek için. Hepsi TAM KELİME olarak eklenir: elle eklenen kısa bir kelimeyi
 * alt-dize aramak yanlış pozitif üretir, ve o riski operatöre yüklemek doğru olmaz.
 */
function envKelimeleri() {
  const ham = process.env.KUFUR_EK_KELIMELER;
  if (!ham || typeof ham !== 'string') return [];
  return ham.split(',').map((k) => k.trim()).filter(Boolean);
}

/**
 * Metni karşılaştırılabilir hâle getirir.
 * @param {string} metin
 * @param {boolean} ayiriciKoru - true: ayırıcılar tek boşluğa çevrilir (kelime
 *   geçişi); false: tamamen silinir (yapışık geçiş).
 * @returns {string}
 */
function normalize(metin, ayiriciKoru) {
  let s = String(metin ?? '')
    // NFKD: ş→s+cedilla, ğ→g+breve, ü→u+diaeresis, İ→I+dot … birleştiriciler sonra silinir.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  // NFKD'nin ayrıştırmadığı harfler.
  s = s.replace(/[ıﬁœæ]/g, (c) => OZEL_HARFLER[c] ?? c);

  // Leet: rakam/sembolle harf taklidi. '*' bilerek YOK — o, aşağıdaki ayırıcı
  // temizliğinde zaten siliniyor ('s*ktir' → 'siktir').
  s = s.replace(/[0134578@$!|+]/g, (c) => LEET[c] ?? c);

  // Ayırıcılar: harf ve rakam dışındaki her şey.
  s = s.replace(/[^a-z0-9]+/g, ayiriciKoru ? ' ' : '');

  // Tekrar eden harfleri tek harfe indir (sikkktir → siktir).
  s = s.replace(/(.)\1+/g, '$1');

  return ayiriciKoru ? s.trim() : s;
}

/**
 * Listeler de aynı normalizasyondan geçmeli — aksi hâlde tekrar-daraltma yüzünden
 * çift harfli bir liste kelimesi ("yarrak") normalize metinle ("yarak") asla
 * eşleşmezdi. Modül yüklenirken bir kez hesaplanır.
 */
const HER_YERDE_N = [...new Set(HER_YERDE.map((k) => normalize(k, false)).filter(Boolean))];
const TAM_KELIME_N = new Set(
  [...TAM_KELIME, ...envKelimeleri()].map((k) => normalize(k, false)).filter(Boolean)
);
const DOGRUDAN_HAKARET_N = [...new Set(DOGRUDAN_HAKARET.map((k) => normalize(k, false)).filter(Boolean))];
const ISNAT_N = [...new Set(ISNAT.map((k) => normalize(k, false)).filter(Boolean))];
const HEDEF_N = [...new Set(HEDEF.map((k) => normalize(k, false)).filter(Boolean))];

/**
 * Metin küfür ya da hakaret içeriyor mu?
 *
 * ÜÇ KATMAN, sırayla:
 *   1. Küfür (sözlük) — açık küfür.
 *   2. Doğrudan hakaret — "salak", "aptal" gibi tek başına aşağılayıcı sözler.
 *   3. Hedefli isnat — "hırsız/yolsuz/rüşvetçi" YALNIZ bir hedefle ("başkan",
 *      "belediye"…) birlikte geçerse. Tek başına geçtiğinde meşru şikayettir
 *      ("sokakta hırsız var") ve durdurulmaz.
 *
 * @param {string} metin - Vatandaşın yazdığı ham açıklama
 * @returns {{kufur: boolean, eslesme?: string, yontem?: string, tur?: 'kufur'|'hakaret'|'isnat'}}
 *   eslesme: yakalanan kalıp — moderasyon bildiriminde gösterilir ki yanlış pozitifi
 *   tek bakışta anlayasın. Vatandaşa ASLA gösterilmez (filtreyi kalibre ettirmemek için).
 */
export function kufurIceriyorMu(metin) {
  if (typeof metin !== 'string' || metin.trim() === '') return { kufur: false };

  // 1) Yapışık geçiş: ayırıcıları silinmiş metinde alt-dize araması.
  const yapisik = normalize(metin, false);
  for (const kelime of HER_YERDE_N) {
    if (yapisik.includes(kelime)) {
      return { kufur: true, eslesme: kelime, yontem: 'yapisik', tur: 'kufur' };
    }
  }

  // 1b) Mesajın TAMAMI bir tam-kelime kalıbıysa yakala. Bu, ayırıcılarla parçalanmış
  //     kısa küfrü ("ya.r.r.a.k", "a.q") kurtarır: kelime geçişinde parçalara ayrılır,
  //     alt-dize geçişinde ise aranamaz (aranırsa "kayarak" vurulur). Tamamının
  //     eşleşmesini şart koşmak güvenlidir — "kayarakdustum" hiçbir kalıba eşit değil.
  if (TAM_KELIME_N.has(yapisik)) {
    return { kufur: true, eslesme: yapisik, yontem: 'kelime', tur: 'kufur' };
  }

  // 2) Kelime geçişi: yalnız tam kelime eşleşmesi (kısa/riskli kalıplar).
  const kelimeler = normalize(metin, true).split(' ');
  for (const k of [...kelimeler, ...tekHarfleriBirlestir(kelimeler)]) {
    if (k && TAM_KELIME_N.has(k)) {
      return { kufur: true, eslesme: k, yontem: 'kelime', tur: 'kufur' };
    }
  }

  // 3) Doğrudan aşağılayıcı sözler — hedef aranmaz, tek başına yeter.
  for (const kelime of DOGRUDAN_HAKARET_N) {
    if (yapisik.includes(kelime)) {
      return { kufur: true, eslesme: kelime, yontem: 'yapisik', tur: 'hakaret' };
    }
  }

  // 4) Hedefli isnat: isnat sözü VE hedef birlikte geçmeli. Biri eksikse metin
  //    geçer — "sokakta hırsız var" (hedef yok) ve "belediyeye bildirdim" (isnat
  //    yok) meşru şikayetlerdir.
  const isnat = ISNAT_N.find((k) => yapisik.includes(k));
  if (isnat) {
    const hedef = HEDEF_N.find((h) => yapisik.includes(h));
    if (hedef) {
      return { kufur: true, eslesme: `${hedef}+${isnat}`, yontem: 'yapisik', tur: 'isnat' };
    }
  }

  return { kufur: false };
}

/**
 * Ardışık TEK HARFLİK parçaları birleştirip ek aday kelimeler üretir: "a.q" ayırıcı
 * temizliğinden "a q" olarak çıkar ve tam kelime eşleşmesinde parçalanırdı; bu
 * fonksiyon onu "aq" olarak geri kazandırır. Tek harf Türkçede anlamlı bir kelime
 * olmadığından birleştirmek yanlış pozitif üretmez ("saat 10 am" gibi ikişer harfli
 * gerçek kelimeler birleşmez, çünkü yalnız uzunluğu 1 olanlar tampona alınır).
 * @param {string[]} kelimeler
 * @returns {string[]}
 */
function tekHarfleriBirlestir(kelimeler) {
  const adaylar = [];
  let tampon = '';
  for (const k of kelimeler) {
    if (k.length === 1) {
      tampon += k;
    } else {
      if (tampon.length > 1) adaylar.push(tampon);
      tampon = '';
    }
  }
  if (tampon.length > 1) adaylar.push(tampon);
  return adaylar;
}

/** Teşhis/test amaçlı dışa açılır (normalizasyonun ne ürettiğini görmek için). */
export const _normalize = normalize;
