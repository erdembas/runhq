# Agent çalışma alanı

RunHQ içindeki **Agents**, projelere bağlı Codex, OpenCode, Claude ve Cursor oturumlarını aynı pencerede toplar; özel ACP ve terminal araçları da eklenebilir. Her proje ekranında Logs, Notes ve Terminal yanında bir **Agents** iç sekmesi bulunur. Proje başlığındaki **Agents** düğmesi aynı ekran içindeki bu sekmeyi açar; kapatılmışsa geri getirir. Bu görünüm sadece ilgili projenin oturumlarını, worktree oturumları dahil, listeler; konuşma ve yeni görev ekranı da proje içinde açılır. Arşivlenmiş oturumlara **Archived** filtresinden erişilir. Her projenin konuşma seçimi ve filtreleri bağımsızdır. Mevcut bölünmüş panel düzenleri korunarak Agents sekmesi eklenir. Sol menüdeki **Agents** bütün projeleri gösterir.

## Mission Control

**Overview**, seçili proje veya bütün projelerdeki görevleri dört sütunda gösterir: **Needs attention**, **Working**, **Ready**, **Completed**. Bekleyen soru/onaylar, hatalar ve kesintiler müdahale sütununda öne çıkar; kartlarda sağlayıcı, proje, son hata veya bekleyen karar, okunmamış sonuç ve worktree bilgisi bulunur. Özet kartları durum filtresini uygular; görev kartı ilgili konuşmayı açar. Sütunlar gerçek oturum durumundan türetilir, sürükleyerek görev durumu değiştirilmez.

Agents yüzeyi üst çubuktan altı görünüme ayrılır: **Overview** (Mission Control panoları), **Conversations**, **Inbox**, **Workflows**, **Library** ve **Usage**. Bekleyen karar sayısı üst çubukta ayrıca gösterilir ve doğrudan Inbox'a götürür. Proje, durum ve sağlayıcı seçicileri bütün bu ekranlarda aynı aranabilir menü bileşenini kullanır.

Hazır görev şablonları yeni görev taslağını doldurur. Mesajı düzenleyip gönderene kadar agent başlamaz. Plan isteyen şablonlar, seçilen aracın bildirdiği plan desteğine göre çalışma modunu ayarlar. Global görünüm ve proje içindeki Agents sekmesi aynı görevleri kendi kapsamlarında izler.

## Proje seçimi ve arama

Global Agents görünümündeki proje seçici ve yeni görev composer'ındaki proje menüsü aramalıdır. Projeler, servis/stack dizinleri eşleştiğinde sol paneldeki bölüm adları ve renkleriyle gruplanır; eşleşmeyenler **Other projects** altında kalır. Arama ad, grup ve dizin yolunu birlikte tarar. Aynı adlı projeler yol bilgisiyle ayrılır. Model menüsü de ad/ID ve sağlayıcı araması sunar. OpenCode modelleri sağlayıcı başlıkları altında gruplanır; uzun listeler ekranı kaplamadan menünün içinde kaydırılır. Claude model açıklamaları ve varsa çözümlenen tam model ID’si korunur. **Auto** etiketli seçim sağlayıcının yapılandırmasını izler; **Exact versions** yalnızca sağlayıcının bildirdiği sürüm ID’lerini gösterir. Başka bir sürümü sabitlemek için model aramasına tam ID yazıp **Use …** seçilir; kullanılabilirliği sağlayıcı belirler. Açıklamalardan model ID’si türetilmez. Sağlayıcı ID’leri seçime aynen aktarılır. Menüler ok tuşları, Enter ve Escape ile kullanılabilir; dar alanlarda ekran sınırlarına göre konumlanır.

Sol panelin **Find projects, groups…** alanı servis, stack, grup, dizin ve komut metninde arama yapar. Stack üyesi servisler de stack sonucuna dahil edilir. Eşleşen kapalı gruplar arama süresince açılır; sorgu temizlenince kayıtlı açık/kapalı durum kullanılır. Arama sonucu üzerinden satır sıralaması değiştirilmez; grup hedeflerine taşıma kullanılabilir.

## Kullanım

1. Proje içindeki **Agents** sekmesini veya **New task** düğmesini açın. Mesaj alanı doğrudan görünür; ayrı bir oturum oluşturma formu yoktur. **Add project** ile servis komutu olmayan bir repo/dizin de eklenebilir.
2. Kurulu ve etkin bir agent otomatik seçilir; üstteki kurulu agent düğmelerinden veya mesaj alanının altındaki sağlayıcı menüsünden değiştirilebilir. Elle yapılan seçim yeniden taramada korunur. Bağlantı satırı CLI eksikliği, kurulum/protokol sorunu ve kimlik doğrulama hatasını ayrı gösterir. **Recheck** kurulumları ve bağlantıyı yeniler. Başarılı model keşfinden sonra model menüsü açılır; bağlantı doğrulanmadan yeni görev başlamaz. Hatalı özel model seçiminde **Use agent default** varsayılana döndürür. ACP model seçimi tur başlarken agent’ın bildirdiği seçeneklere karşı doğrulanır.
3. Aynı satırda model, desteklenen effort/variant ve **Agent / Plan**, Cursor ve destekleyen ACP araçlarında ayrıca **Ask** seçilir. Bilinen reasoning seviyeleri modelin desteklediği kademelerden oluşan yatay barla seçilir; composer ikonu seçili seviyeyi gösterir. **Auto** agent varsayılanına döner. Ok tuşları, Home/End ve Escape desteklenir. Özel OpenCode variant adları sıralı reasoning gibi gösterilmez; kendi menüsünde kalır. Codex plan modu read-only sandbox kullanır; Claude kendi plan izin modunu, OpenCode kendi plan agent'ını kullanır; Cursor bildirdiği native `agent`, `plan` ve `ask` modlarına geçer. Desteklenen agent profilleri aynı satırdaki aramalı menüden seçilebilir. OpenCode profili seçimi ilgili çalışma moduyla eşlenir; Agent / Plan düğmeleri varsayılan moda dönmek için özel profili temizler.
4. Mesaj alanının üstündeki **Local workspace / Isolated worktree** seçimi çalışma dizinini belirler. **Task settings** içinde görev adı ve Local/Worktree kartları bulunur; özel CLI yolu ve bağlantı bilgileri açılır **Agent connection** bölümündedir. Görev adı boşsa ilk mesajdan türetilir.
5. İlk mesajı gönderin; oturum oluşturulur ve agent aynı adımda başlar. Boş mesaj oturum oluşturmaz. İlk gönderim başarısızsa taslak korunur; tekrar deneme aynı oturumu ve istek kimliğini kullanır. Yeni görev taslakları proje bazında tutulur. Açık konuşmalar da aynı composer tasarımını kullanır; sağlayıcı konuşmaya bağlı kalır, model/mod değişiklikleri sonraki tura uygulanır.
6. Sorular, çoklu seçimler, serbest yanıtlar, komut/dosya izinleri ve MCP istekleri konuşmada görünür. Yanıtlar ilgili sağlayıcının bekleyen isteğine iletilir.
7. **Changes** mevcut çalışma dizininin tracked Git diff'ini gösterir. Görev oluşturulurken checkout'un bulunduğu commit ve o anda zaten değiştirilmiş olan tracked dosyalar kaydedilir; başlıkta başlangıç revizyonu ve bu dosyalar listelenir, böylece hangi düzenlemenin görevden önce var olduğu görünür. Dizin bir repo değilse başlangıç revizyonu kaydedilmediği belirtilir. Diff'in kendisi yine çalışma dizininin tamamını gösterir; satır bazında sahiplik iddia edilmez. Codex'in turn diff olayları ayrıca konuşmada tutulur.
8. **Terminal** aynı dizinde bağımsız bir kabuk açar. Editör düğmesi seçili çalışma dizinini mevcut editörde açar. Worktree oturumunda hedef worktree'dir.
9. Yanıt tamamlandıktan sonra model, effort, çalışma modu ve desteklenen agent profili değiştirilebilir. **Plan** panelinden planı inceleyip düzenleyebilir, **Build this plan** ile aynı konuşmada uygulama turunu başlatabilirsiniz.

Araç çağrıları ve düşünme adımları konuşmada tek bir etkinlik bloğunda toplanır. Blok tur sürerken açık kalır ve o anki adımı başlığında gösterir; tur bitince **Read 3 files · Ran 2 commands** gibi tek satırlık özete iner. Başarısız adım içeren blok açık kalır, blok elle de açılıp kapatılabilir. Özet tek bir dosya oluşturulduğunda onu adıyla anar (**Created ByokEndpoints.cs, ran 3 commands**) ve sağda adımların istediği satır değişimini `+427 −0` biçiminde gösterir. Bu sayılar agent'ın araca gönderdiği düzenleme talimatından türetilir; çalışma dizinine gerçekte ne yansıdığı **Changes** sekmesinde kalır. Her satır sağlayıcının bildirdiği girdiden türetilen fiili ve hedefi (dosya, komut, desen) gösterir; yollar görevin çalışma dizinine göre kısaltılır. Satır açıldığında dosya yazan ve düzenleyen adımlar renkli diff, diğerleri ham çıktı gösterir. Bu adımlardaki büyüteç düğmesi değişikliği tam ekran açar: **Source Control** ile aynı görüntüleyici, yan yana (**Split**) veya birleşik (**Inline**) okuma, sözdizimi renklendirmesi ve tam dosya anahtarı. Escape kapatır.

**Stop** sağlayıcıya gerçek kesme isteği gönderir. 15 saniyede durmayan işlem için RunHQ sahip olduğu süreç ağacını sonlandırır. Yapılmış dosya değişiklikleri geri alınmaz. Çalışan tura yönlendirme yalnızca destekleyen sağlayıcıda sunulur; Codex bunu `turn/steer` ile yapar. Sonraki işler ayrıca mesaj kuyruğuna eklenebilir.

## Planı inceleme ve uygulama

Konuşmadaki **Plan** paneli sağlayıcının yapılandırılmış planlarını, Cursor plan belgelerini ve plan modundaki metin yanıtlarını gösterir. Birden fazla plan varsa belge seçilebilir. **Edit** ile plan metni düzenlenir; yerel düzenleme bu cihazda saklanır ve sıfırlanabilir. Adımların ilerlemesi agent'ın bildirdiği durumdan gelir. Cursor **Ask** modu salt okunur soru/keşif içindir; **Plan** plan hazırlamak, **Agent** uygulamak için kullanılır.

**Build this plan**, ekrandaki düzenlenmiş metni gerçek bir yeni tur olarak aynı oturuma gönderir ve çalışma modunu uygulamaya geçirir. Devam eden tur veya bekleyen izin varken bu eylem kullanılamaz. Cursor'ın `cursor/create_plan` isteği ayrıca konuşmada kendi **Approve plan / Reject plan** kararını bekler; RunHQ'daki yerel plan düzenlemesi bu sağlayıcı isteğini kendiliğinden onaylamaz.

## Canvas

**Canvas**, yanıtlardaki tamamlanmış HTML, SVG ve Markdown kod bloklarını ayrı bir çıktı olarak açar. HTML prototipleri ve etkileşimli paneller, SVG çizimleri ve Markdown belgeleri önizlenebilir; **Source** içinde düzenlenebilir, sıfırlanabilir ve dosya olarak kaydedilebilir. Birden fazla çıktı arasında geçiş yapılır. Düzenlemeler konuşma/çıktı bazında bu cihazda saklanır; projedeki dosyalar kendiliğinden değiştirilmez.

Bu taşınabilir RunHQ yüzeyi bütün sağlayıcıların uygun kod bloklarıyla çalışır. Cursor'ın kendi Canvas kaydını veya paylaşılan Canvas URL'sini içe aktarma bağlantısı yoktur. Önizleme dış bağımlılık gerektirmeyen içerik içindir: HTML/SVG ayrı bir önizleme alanında çalışır; harici kaynaklar yüklenmez. Büyük bir belge önizleme sınırına takılırsa kaynak düzenleme ve dosyaya kaydetme kullanılabilir.

## Mesaj kuyruğu

Çalışma sürerken sonraki mesajları kuyruğa ekleyin. Her mesaj eklendiği andaki model, effort, mod ve agent profiliyle sırasını bekler. Bekleyen mesajlar yukarı/aşağı taşınabilir veya kaldırılabilir; gönderilmekte olan mesajın sırası değişmez. Başarılı tur tamamlanınca sıradaki mesaj gönderilir.

Kuyruk sekme veya proje değiştirildiğinde çalışmaya devam eder. Hata, bağlantı kesintisi veya **Stop** sonrasında otomatik ilerleme durur; devam etmek için kuyruktaki devam/yeniden deneme eylemi kullanılır. Gönderim hatasında aynı istek kimliği korunur. Kuyruk kalıcıdır. Bekleyen mesajlar, sıraları, taslaklar, istek kimlikleri ve her tur için seçilmiş model/effort/mod bu cihazda sürümlenmiş yerel kayıtta saklanır; RunHQ kapanıp açıldığında veya arayüz yeniden yüklendiğinde aynı sırayla geri gelir. Yerel kayıt yazılamazsa bu durum arayüzde bildirilir ve kalıcı sayılmaz.

## Karar kutusu

**Inbox**, bütün projelerdeki bekleyen izinleri, soruları ve MCP formlarını tek listede toplar. Her kayıt projeyi, görevi, sağlayıcıyı, istenen eylemi ve bekleme süresini gösterir; **Open task** ilgili konuşma kaydını açar. Proje ve istek türü (**Permissions**, **Questions**, **Forms**) ile filtrelenir, arama kutusu görev ve istek metninde çalışır, Alt+↑/↓ kayıtlar arasında gezinir.

Yanıt listenin içinde verilir. Gönderilmeden önce istek runtime'a karşı yeniden doğrulanır: kapanmış, yanıtlanmış veya değişmiş bir istek eski arayüz durumundan onaylanamaz ve aynı yanıt iki kez gönderilmez. İzin seçenekleri sağlayıcının bildirdiği kapsamla korunur.

Bildirimler isteğe bağlıdır ve yalnızca ana pencereden gönderilir. Proje bazında susturulabilir; kapalıyken karar kutusu davranışı değişmez.

## Görev bağlamı ve ekler

Composer'daki **Context** tepsisi göreve giden bağlamı açık hale getirir: workspace dosya yolları, log alıntıları ve notlar, görseller ve **Library**'de saklanan proje kararları. Her öğe kaynak projesini ve yakalanma zamanını gösterir; gönderilmeden önce tek tek incelenip kaldırılabilir. Tepsi taslakla birlikte saklandığı için başka bir görünüme geçip dönmek seçimi kaybetmez. Bağlam varsayılan olarak görevin projesine bağlıdır; kaynak projesi ayrıca seçilerek depo dışından içerik eklenebilir.

Görsel ekleme sağlayıcı yeteneğine bağlıdır: Codex ve Claude görsel kabul eder, OpenCode ve Cursor/ACP etmez ve bu durum arayüzde belirtilir. Sınırlar açıkça uygulanır — mesaj başına en fazla 5 görsel, PNG/JPEG/WebP/GIF ve toplam 2,25 MiB. Sınırı aşan veya desteklenmeyen içerik sessizce düşürülmez, hata olarak bildirilir.

## İş akışları

**Workflows**, bir işi senin yazdığın görevler → kontroller → açık onay zinciri olarak yürütür. Bir iş akışı onlarca ayrı görev taşıyabilir; her görevin kendi talimatı, kendi hesabı ve "şunlar bittikten sonra" bağımlılıkları vardır. Ortak bir **brief** (eski adıyla objective) isteğe bağlıdır — görev kendi talimatını taşıyorsa iş akışı zaten kendini anlatmıştır — kabul ölçütü (**acceptance**) ise bütün görevler için ortaktır. İş akışı izole bir checkout'ta çalışır ve başladığı commit'i kaydeder. Otomatik ilerleme isteğe bağlıdır ve sınırlıdır: bildirilen görevleri ve kayıtlı kontrolleri çalıştırır, hiçbir şeyi uygulamaz veya entegre etmez.

Görev listesi iş akışı oluşturulurken belirlenir: her görev bir anahtar (**key**), kendi talimatı, rolü (**plan**, **implement**, **review**, **revise**, **validate**), onu çalıştıran hesap ya da havuz, modeli ve beklediği görevlerin anahtarları ile tanımlanır. Anahtar hem tabloda hem bağımlılık çiplerinde hem panoda aynı şeyi söyler. Birbirini beklemeyen görevler **aynı anda** koşar; ne kadarının koşacağını hesap kapasitesi ayarların belirler. Bir checkout aynı anda iki ajan taşıyamadığı için kod değiştiren iki görev ancak her biri **kendi worktree'sinde** olduğunda birlikte koşabilir; ekran bunu söyler ve tek tıkla düzeltir. Kendi worktree'sinde biten bir görevin sonucu, bildirim sırasında iş akışının paylaşılan checkout'una uygulanır; çakışma aynen raporlanır, asla otomatik çözülmez ve çözülmemiş bir sonuç varken doğrulama ile entegrasyona geçilemez. Bağımlılığı olmayan her görev iş üretmek zorundadır — inceleyecek bir şey olmadan inceleme anlamsızdır — ve entegrasyonu yalnızca **bitmiş işi gören** bir inceleme açar: paylaşılan checkout'ta çalışan ve iş üreten her göreve geçişli olarak bağlı bir review. Bir dalı inceleyen review tavsiye niteliğindedir. Bu kurallar hem ekranda hem oluşturma sırasında ayrıca doğrulanır; bağımlılık yalnızca daha önce bildirilmiş bir görevi gösterebildiği için bir döngü ifade edilemez. İnceleme ve doğrulama rolleri yalnızca gerçek bir salt-okunur moda sahip bağlantılara verilebilir ve o oturumlar salt okunur açılır. Paylaşılan checkout'u seçen üretim rolleri iş akışının kendi worktree'sinde sırayla çalışır; her görev kendi hesabında kendi oturumunu açar, çünkü bir oturum onu başlatan hesaba aittir. **Plan** görevi yalnızca plan modu entegrasyona gömülü olan bağlantılarda (Codex, Claude, OpenCode) o modu ister; bir ACP ya da terminal bağlantısı modlarını ancak çalışırken bildirdiği için orada görev bağlantının kendi varsayılan modunda koşar ve planlama talimatını prompt taşır — bildirilmemiş bir mod istemek turu doğrudan başarısız eder. Sağlayıcının kendi subagent'ları, onları çalıştıran görevin oturumunda görünür.

Seçili iş akışının altındaki pano her görevin nerede durduğunu gösterir: **Needs you**, **Working**, **Ready**, **Waiting** ve **Done**. Bekleyen bir kart neyi beklediğini (`waiting on api, docs`) ve kaç görevi tuttuğunu (`blocks 3 tasks`) söyler; kendi worktree'sinde çalışan bir görev dal simgesiyle işaretlenir. **Start** bir görevi adıyla çalıştırır, başarısız bir görev **Retry** olur, **Start N unblocked** engellenmemiş her şeyi birden başlatır. Çalışma alanı inceleme sonrası değişirse — bir paralel sonuç indiğinde de — o inceleme yeniden sıraya döner: doğrulama ve entegrasyon yalnızca incelenen ağaç üzerinde yapılabilir. **Stop** adım açmış bütün oturumları durdurur ve her worktree'yi olduğu gibi bırakır.

Bağımsız inceleme aynı temel revizyon üzerinde salt okunur çalışır ve istenirse başka bir sağlayıcıya verilir. Kontroller komutu, çalışma dizinini, çıkış kodunu, çıktıyı ve test edilen parmak izini kaydeder; kaynaklar sonradan değişirse sonuç bayat olarak işaretlenir ve entegrasyon önizlemesi geçersiz olur.

Entegrasyon açıktır: hedefteki değişiklik önce önizlenir, çakışmalar ve yeni dosyalar gösterilir, ardından hedef seçilir. **Apply to the working tree** değişikliği commit'lemeden bırakır. **Commit on a new branch** hedefte yeni bir dal açar, değişikliği oraya commit'ler ve dal ile commit'i iş akışına kaydeder; hedef checkout bu dala geçer. Git'in kabul etmeyeceği bir dal adı hiçbir şeye dokunulmadan reddedilir; commit sırasında hata olursa kullanıcının bulunduğu dala geri dönülür ve açılan dal silinir, geri dönülemezse durum açıkça bildirilir. Hedefte yerel değişiklik varsa entegrasyon reddedilir. RunHQ push etmez ve pull request açmaz; cherry-pick ve merge hedefleri bu sürümde yoktur.

**Hand off** bir oturumdan bağlantılı yeni görev oluşturur; hedef ve değişiklik temeli aktarılır, sağlayıcıya özel oturum durumu ve izinler kaynak sağlayıcıda kalır.

## Kitaplık

**Library** üç bölümden oluşur.

**Task recipes** adlandırılmış, düzenlenebilir ve sürümlenen tariflerdir; `{{parametre}}` yer tutucuları, proje kapsamı, tercih edilen sağlayıcı/model ve worktree seçimi taşır. Bir tarif ayrıca **Workflow steps** altında bir görev grafı saklayabilir — talimatları, bağımlılıkları ve checkout tercihleriyle birlikte; bu liste yalnızca tarif bir iş akışı oluşturduğunda kullanılır, boş bırakılırsa tarifin tek ajanı hem uygular hem inceler. Bağımlılık bildirmeyen eski bir tarif, her zaman olduğu gibi bir zincir olarak okunur. Görev talimatındaki `{{parametre}}` de sorulur ve yerine konur. Kayıtlı liste havuz hedefi taşıyabilir — hesap adım başladığında seçilir — ve içe aktarılan bir tarifte tanınmayan bir rol iş akışına taşınmadan reddedilir. **Draft task** tarifi doldurulmuş bir taslağa, **Create workflow** doğrudan bir iş akışına dönüştürür. Bir tarifi düzenlemek çalışan görevi değiştirmez. Hazır tarifler hata tekrar üretimi, uygulama + bağımsız inceleme, bağımlılık güncellemesi ve sürüm hazırlığını kapsar; tarifler dışa ve içe aktarılabilir.

Bir tarife **Schedule** ile zamanlama verilebilir: birkaç saatte bir, her gün veya haftanın seçilen gününde belirli bir saatte. Vakti geldiğinde RunHQ tarifi yeni bir görev olarak başlatır. Zamanlamayı kaydetmek işi hemen başlatmaz; ilk çalışma bir sonraki tekrara bırakılır. **RunHQ kapalıyken hiçbir şey çalışmaz**: bu sırada geçen tekrarlar bildirilir ve tek bir çalışmaya indirilir, arka arkaya yeniden yürütülmez. Araç devre dışıysa, yürütme slotları doluysa veya proje çalışma alanından kalkmışsa çalışma yapılmaz ve nedeni kayda geçer. Tarif tek bir bağlantı yerine bir **hesap havuzu** hedefleyebilir; bu durumda çalışma başlarken havuzdaki uygun ve boş slotu olan hesap seçilir ve hangi hesabın neden seçildiği kayda geçer (bkz. [Agent tools](AGENT_TOOLS.md)). Bu nedenler yalnızca çalışma alanı gerçekten okunduktan sonra değerlendirilir: RunHQ yeni açıldığında projeler ve bağlantılar henüz yüklenmemişken bir zamanlama “proje kalkmış” sayılmaz, çünkü engellenen tekrar da harcanmış sayılır ve çalışma bir tur boyu kaybolurdu. Zaman dışındaki tetikleyiciler bu sürümde yoktur.

**History search** prompt, yanıt ve karar içeriğinde arama yapar; sağlayıcı, durum, tarih aralığı ve proje ile filtrelenir ve sonuç ilgili konuşma kaydını açar. Geçmiş dışa aktarılabilir ve arşiv olarak içe aktarılabilir; içe aktarılan kayıtlar salt okunurdur ve sağlayıcı oturumunu sürdürmez. **History retention** silmeden önce hangi konuşmaların gideceğini listeler.

**Project decisions** arama sonucundan **Save as project decision** ile oluşturulur. Kayıt kaynak konuşmasına bağlı kalır, düzenlenebilir ve kaldırılabilir; **Context** tepsisinden yeni göreve eklenebilir. Transcript'te redakte edilmiş yanıtlar dışa aktarımda da redakte kalır.

## Kapasite ve kullanım

**Usage** hem kapasiteyi hem raporlanan kullanımı gösterir. Sayımlar bağlantı başınadır: aynı ürün için ikinci bir hesap tanımladığında ayrı slot havuzu, ayrı eşzamanlılık sınırı ve ayrı eşik alır. Birden çok hesap tanımlama [Agent tools](AGENT_TOOLS.md) belgesinde anlatılır. Eşzamanlı görev sınırı bütün araçlar için ve sağlayıcı bazında ayarlanır; sınırı değiştirmek çalışan turları durdurmaz. Üst satır kullanımdaki yürütme slotlarını, kartlar sağlayıcı başına slot ve raporlanan token toplamlarını verir; kaç görevin token bildirdiği ayrıca yazılır, böylece eksik sağlayıcı verisi sıfır sanılmaz.

Görev tablosu durumu ve bekleme nedenini, süreyi, girdi/çıktı/toplam token'ı, raporlanan maliyeti ve raporun kapsamını gösterir. Maliyet bildirilmemişse **Unknown** yazılır; tahmin üretilmez.

Süre RunHQ'nun kendi ölçümüdür — sağlayıcılar token bildirir, süre değil — ve sütun başlığı bunu belirtir. Çalışan turda geçen süre canlı gösterilir; tur bitince son turun süresi ve tamamlanan turların toplamı kalır. Uygulama çökerse o turun gerçek bitişi bilinemeyeceği için ölçüm sayılmaz; son etkinlik zamanından tahmin üretilmez.

**Account cool-downs** kartı, sağlayıcının gerçekten döndürdüğü bir hız/kullanım limiti hatası nedeniyle şu an yönlendirme dışı tutulan hesapları listeler: limitin ne zaman bildirildiği, yönlendirmenin ne zaman süreceği, sağlayıcının kendi metni ve **Resume now**. Soğutma RunHQ'nun kendi geri çekilmesidir; sağlayıcının bildirdiği bir sıfırlama zamanı değildir. Bu CLI'lar kalan kotayı bildirmediği için kalan hak ne gösterilir ne tahmin edilir. Çalışan bir görev hesabını korur.

Eşikler sağlayıcı başına ayarlanır: raporlanan token veya USD değeri için uyarı ve kuyruğu duraklatma. Sağlayıcı kullanımı tur sonunda bildirdiği için eşik ancak turdan sonra değerlendirilir; çalışan tur kesilmez, sıradaki takip mesajları duraklatılır.

## Gereksinimler ve kimlik doğrulama

- Node.js **22+**. Node uygulamayla birlikte dağıtılmaz; PATH üzerinde bulunmalıdır. macOS GUI açılışındaki mevcut PATH kurtarma mekanizması kullanılır.
- Kullanılacak CLI önceden kurulmuş olmalıdır. RunHQ CLI kurmaz, güncellemez veya kullanıcı adına giriş yapmaz.
- Codex: yerel `codex app-server` ve mevcut Codex yapılandırması/kimlik doğrulaması.
- Cursor: yerel `agent acp` ve Cursor CLI kimlik doğrulaması. `agent acp --help` ile uyumluluk denetlenir; destek yoksa güncelleme yönlendirmesi gösterilir. Giriş için CLI'ın `agent login` akışı kullanılır.
- OpenCode: yerel `opencode serve` ve bağlı provider yapılandırması. RunHQ yalnızca localhost üzerinde, her süreç için rastgele parola ile kendi sunucusunu başlatır.
- Claude: resmi Claude Agent SDK ve seçilen yerel `claude` executable. Bu entegrasyon için desteklenen API/cloud kimlik doğrulaması yapılandırılmalıdır. Claude aboneliği API erişimi olarak vaat edilmez; doğrudan `CLAUDE_CODE_OAUTH_TOKEN` ortam değişkeni köprüye aktarılmaz. Sağlayıcı ayarları ve auth hataları CLI/SDK tarafından değerlendirilir. [Claude Agent SDK belgeleri](https://platform.claude.com/docs/en/agent-sdk/overview).

Model çağrıları sağlayıcının normal kullanım/kota koşullarına tabidir. Model keşfi bir sohbet mesajı göndermez; ancak CLI ve yapılandırılmış entegrasyonlarını başlatabilir. Proje düzeyindeki agent talimatları, hook'lar ve MCP yapılandırmaları sağlayıcının normal kurallarıyla yüklenir. RunHQ bunları yeniden uygulamaz.

## Destek matrisi

| Yetenek                        | Codex                                | OpenCode                              | Claude Agent                       | Cursor / ACP                                           |
| ------------------------------ | ------------------------------------ | ------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| Model keşfi                    | App-server model/list                | Bağlı provider modelleri              | SDK supportedModels                | Agent'ın bildirdiği model/config seçenekleri           |
| Effort / variant               | Modelin bildirdikleri                | Model variants                        | SDK model effort listesi           | Bildirilen thought_level seçenekleri                   |
| Kalıcı konuşmayı sürdürme      | thread/resume                        | session ID                            | SDK resume                         | Destekleniyorsa session/load veya session/resume       |
| Metin ve araç akışı            | JSON-RPC bildirimleri                | SSE                                   | SDK async iterator                 | ACP session/update                                     |
| Kullanıcı sorusu               | requestUserInput                     | question.asked                        | AskUserQuestion                    | Cursor native tekli/çoklu seçim soruları               |
| İzin verme / reddetme          | Komut, dosya, ek izin                | Permission reply                      | canUseTool                         | ACP izin seçenekleri; Cursor plan onayı                |
| MCP form / tarayıcı bağlantısı | Elicitation request                  | CLI'nin yayınladığı akışlarla sınırlı | onElicitation                      | Genel ACP form/istemci uzantısı yok                    |
| Plan modu                      | Collaboration mode + read-only       | plan agent                            | plan permission mode               | Bildirilen plan; Cursor ayrıca ask                     |
| Görsel ek                      | PNG/JPEG/WebP/GIF                    | Yok                                   | PNG/JPEG/WebP/GIF                  | Yok                                                    |
| Çalışırken yönlendirme         | turn/steer                           | Yok                                   | Yok                                | Yok                                                    |
| Durdurma                       | turn/interrupt                       | session abort                         | SDK abort controller               | session/cancel; bekleyen Cursor istekleri iptal edilir |
| Yerel slash komutları          | Genel terminal komut menüsü sunulmaz | command endpoint                      | SDK üzerinden desteklenen komutlar | Genel terminal komut menüsü sunulmaz                   |

İzin seçenekleri sağlayıcının bildirdiği kapsamla gösterilir. Örneğin Codex'in “bu oturum için” izni ile OpenCode'un “bu kural için her zaman” izni aynı anlamda sunulmaz. Desteklenmeyen Codex server request'leri otomatik onaylanmaz; protokol hatası ve görünür bir bildirimle reddedilir. Gelişmiş MCP şemaları JSON yanıt alanına düşer; son şema doğrulaması sağlayıcınındır.

Destek kapsamı sağlayıcıya ve kurulu CLI/SDK sürümüne bağlıdır. Harici pencerelerde önceden açılmış konuşmaları içe aktarma, sağlayıcının gizli oturum durumunun kayıpsız aktarımı, terminalin tüm slash komutlarına özel ekranlar, uzaktaki makineler ve uygulama kapandıktan sonra çalışan daemon kapsam dışıdır. Sağlayıcılar arası devir, kaynak görevin hedefini ve değişiklik temelini taşıyan yeni bir oturum başlatır. Yeni protokol türleri için adapter genişletilmelidir; bilinmeyen olaylardan sahte başarı üretilmez.

## Oturum, veri ve süreç yaşam döngüsü

- Projeler canonical dizinle tekilleştirilir. Aynı dizindeki farklı servis adları ayrı agent projesi yaratmaz.
- Oturum başlığı, model/effort/mod, sağlayıcı oturum kimliği, durum, pending istekler, transcript ve raporlanan kullanım `RUNHQ_HOME/agents.db` içinde tutulur. Varsayılan dizin mevcut RunHQ home dizinidir.
- Aynı RunHQ home dizini için ikinci manager/süreç açılışı OS tarafından bırakılan ayrı bir SQLite sahiplik kilidiyle engellenir; canlı oturumlar yanlışlıkla restart recovery işlemine alınmaz.
- SQLite WAL, şema sürümü, atomik kullanıcı mesajı kaydı ve istek kimliği ile yinelenen gönderime karşı koruma vardır. Transcript 200 kayıtlık sayfalar halinde okunur.
- Rust tarafındaki manager çalışmanın sahibidir. Sekme değiştirmek veya konuşma görünümünü kapatmak agent'ı durdurmaz. Arayüz önce canlı olaya abone olur, sonra snapshot okur; revision karşılaştırması eski snapshot'ın yeni durumu ezmesini engeller. 15 saniyelik yeniden okuma kaçan olayları telafi eder.
- Her tur bir Node bridge ve ona bağlı CLI süreçlerini çalıştırır. Tur bitince bridge/süreç grubu kapanır; sonraki mesaj sağlayıcının native session kimliğiyle devam eder. Boşta CLI süreci tutulmaz. Native geçmiş CLI tarafında da bulunmalıdır.
- Plan/Canvas düzenlemeleri, mesaj kuyruğu ve composer taslakları uygulamanın yerel web depolamasında sürümlenmiş ve doğrulanan kayıtlarda tutulur; bozuk veya tanınmayan kayıt eski veriyi silmez, hata olarak bildirilir. Bu veriler `agents.db` içine yazılmaz; konuşma geçmişi ve raporlanan kullanım veritabanında kalır.
- Bekleyen bir takip mesajındaki **Hemen gönder**, çalışan turu durdurup seçilen mesajı aynı görev ve sağlayıcı oturumunda başlatır. Durdurma onayından sonra turun gerçekten kapanması beklenir; konuşma bağlamı, ekler ve mesaj ayarları korunur. Diğer bekleyen mesajların kendi aralarındaki sırası değişmez. Durdurma veya gönderim başarısız olursa mesaj kuyrukta kalır; yeniden deneme aynı istek kimliğini kullanır.
- Uygulama tamamen kapandığında aktif işler devam ettirilmez. Bir sonraki açılışta **Interrupted** görünür ve kurtarma bildirimi neyin bittiğini, neyin kesildiğini ve neyin hâlâ karar beklediğini gösterir; devam etme, yeniden deneme ve atma eylemleri açıktır. Hiçbir tur kendiliğinden yeniden yürütülmez. Kaydedilmiş bir yanıt, gönderilmeden önce runtime'a karşı doğrulanır; kapanmış veya değişmiş bir isteğe uygulanmaz. Pencereyi gizlemek mevcut RunHQ pencere davranışına tabidir.
- Transcript çıktıları kayıt başına 128 KiB ile sınırlanır; çok uzun araç çıktılarının yalnızca son bölümü tutulur. İşlem sırasında sağlayıcı dosya/logları kendi politikasına göre tutabilir.
- Gizli olarak işaretlenen soru yanıtları transcript'te redakte edilir. MCP form içeriği kaydedilmez; karar kaydedilir. Normal konuşmalar ve araç çıktıları yerel veritabanında düz metindir.
- Arşivleme verileri veya worktree'yi silmez. Aktif oturum önce durdurulmalıdır.

## Paralel işler ve Git

Aynı gerçek checkout kökü için varsayılan olarak tek aktif agent turuna izin verilir. Monorepo alt dizinleri aynı köke bağlanır. Yeni görev başlatırken veya bekleyen mesaj kuyruğunda **Şimdi başlat** seçilirse, o tur seçilen çalışma alanını koruyarak diğer bağımsız görevlerle aynı checkout'ta paralel çalışabilir; görevler aynı dosyaları düzenleyebilir. Bu seçim ilk mesajın yeniden denemelerinde korunur. İş akışlarının checkout kilitleri ve toplam/sağlayıcı kapasite sınırları geçerliliğini korur; varsayılan toplam kapasite sekiz aktif turdur. Bu kilit RunHQ agent oturumları arasındadır; dış editörler, kullanıcı terminali veya başka uygulamalardaki agent'lar kilide dahil değildir.

Yeni worktree, seçili projenin repo kökündeki committed `HEAD` üzerinden `codex/runhq-<id>` dalında açılır. Monorepo alt dizini korunur. Doğrudan başlatılan bir görevde uncommitted değişiklikler, `.env` dosyaları veya `node_modules` kopyalanmaz; ortam kurulumunu görev içinde veya terminalde yapın. Worktree'ler `RUNHQ_HOME/worktrees` altında korunur; otomatik merge, commit, push veya silme yapılmaz.

Bir iş akışı üzerinden başlatıldığında kurulum ve aktarım açıktır: kaydedilmiş kurulum komutları çalıştırılır, aktarılan yerel dosyalar listelenir ve seçilen ortam dosyaları parmak izi alınarak kopyalanır — bu içerik patch'e ve veritabanına girmez. Başlangıç revizyonu görevle birlikte saklanır, böylece sonraki inceleme güvenilir bir temele dayanır. **Workflows → Worktrees** envanteri iş akışının paylaşılan checkout'unu ve görevlerin kendi worktree'lerini dal, kirli durum, aktif kullanım ve disk boyutuyla listeler; temizlik, iş hâlâ kullanımdayken reddedilir ve saklanan değişiklikler gösterilmeden silme yapılmaz.

## Geliştirme ve doğrulama

```sh
pnpm install --frozen-lockfile
pnpm agent:build
pnpm agent:test
pnpm typecheck
pnpm lint
pnpm build
cargo test -p runhq-core
cargo clippy -p runhq-core -p runhq-desktop --all-targets -- -D warnings
```

`pnpm dev` ve `pnpm build` agent bridge'i otomatik üretir. Tauri release paketi üretilmiş `bridge.mjs` dosyasını resource olarak içerir. Üretilen bundle Git'e eklenmez. SDK sürümü ve lockfile sabittir. Node protokol testleri CI frontend işine dahildir; OpenCode testi geçici localhost sunucusu açar, API anahtarı/model çağrısı gerektirmez.

Uygulama kodu katmanları:

- `crates/runhq-core/src/agents`: kalıcı state, checkout kilidi, süreç sahipliği, komut yönlendirme.
- `packages/agent-runtime`: sağlayıcı adapter'ları, normalize olaylar ve protokol testleri.
- `apps/desktop/src-tauri/src/ipc/agents.rs`, `ipc/agent_workflows.rs`, `ipc/agent_workspace_data.rs`: ince Tauri komut katmanı.
- `apps/desktop/src/store/useAgentStore.ts`: canlı oturum listesi ve görünümden bağımsız taslaklar.
- `apps/desktop/src/components/agents`: proje listesi, sohbet, yeni görev, diff ve terminal bağlantıları; ayrıca karar kutusu, bağlam tepsisi, iş akışları, kitaplık ve kullanım ekranları.
- `packages/cockpit-ui/src/components/SearchableSelect.tsx`: bütün agent ekranlarının ortak aranabilir seçicisi. Bu yüzeylerde native `<select>` kullanılmaz.
- `packages/cockpit-ui/src/components/AgentRequestCard.tsx`: Tauri bağımlılığı olmayan soru/onay/form arayüzü.

İlk çekirdek doğrulamasında macOS üzerinde 12 agent-core testi ve 13 runtime testi geçti. Gerçek kurulu Codex 0.153.4, OpenCode 1.18.30 ve Claude CLI 2.1.119 ile model keşfi geçti. Codex'in gerçek plan oturumunda soru → yanıt → tamamlanma akışı ayrıca doğrulandı. Claude/OpenCode soru/onay akışları deterministik SDK/protokol fixture'larıyla test edildi; bu iki sağlayıcıda ücretli gerçek model turları çalıştırılmadı. React ekranı izole browser fixture'ında soru yanıtı, canlı durum geçişi, diff ve model keşfiyle görsel olarak kontrol edildi. Windows/Linux native paketleri bu makinede çalıştırılmadı.

Merkezî agent yönetimi genişletmesinin (A1-A9) testleri kuyruk kalıcılığını ve yeniden başlatma kurtarmasını, bekleyen isteğin yanıt öncesi yeniden doğrulanmasını, karar kutusu eylemlerini, bağlam eklerini ve sağlayıcı yetenek sınırlarını, iş akışı yaşam döngüsünü (kurulum, ortam parmak izi, inceleme, bayat kontroller, çakışma önizlemesi, paylaşılan worktree koruması), tarif/geçmiş/karar kitaplığını, kullanım eşiklerini ve sidebar etkinlik göstergelerini kapsar. Arayüz, mock IPC kullanan izole bir fixture üzerinde Overview, Inbox, Workflows, Library, Usage ve yeni görev bağlam tepsisi için görsel olarak gezildi; gerçek sağlayıcı turları bu doğrulamaya dahil değildir.

Önceki genişletmenin fixture testleri Mission Control sınıflandırmasını, görev şablonlarını, plan metni/adımlarını, kuyruk sırası/yeniden deneme davranışını, Canvas çıktılarının ayrıştırılmasını ve Cursor ACP onay/soru/iptal/devam akışlarını kapsar. Kurulu Cursor `2026.01.23-916f423` sürümünde ACP alt komutu doğrulandı; canlı keşif kimlik doğrulama aşamasında başarısız oldu. Cursor ile gerçek model turu veya uçtan uca oturum doğrulaması yapılmadı.

## Kaynaklar ve entegrasyon sınırları

15 Eylül 2026 tarihinde incelenen birincil kaynaklar:

- [Cursor ACP](https://cursor.com/docs/cli/acp): bağlantı, modlar, native plan/soru istekleri ve alt-agent bildirimleri. RunHQ alt-agent olaylarını konuşmada gösterir; bunlar ayrı RunHQ görevleri oluşturmaz.
- [Cursor Canvases](https://cursor.com/docs/agent/tools/canvas): Cursor'ın görsel çıktı ve paylaşım ürünü. RunHQ Canvas kendi HTML/SVG/Markdown yüzeyidir; Cursor paylaşımlarını içe aktarma veya yayımlama desteklenmez.
- [Cursor Plan Mode](https://cursor.com/blog/plan-mode): planı inceleme, düzenleme ve uygulama deneyimi için referans.
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams): çoklu Claude oturumlarının koordinasyonu için referans. RunHQ'nun çok sağlayıcılı görev panosu ve worktree paralelliği, Claude CLI agent teams/teammate mesajlaşmasının SDK üzerinden uygulandığı anlamına gelmez.

## Araç yönetimi

**Agents → Agent tools** ekranında yerleşik ve özel araçlar etkinleştirilir, bağlantıları düzenlenir ve proje içinde açılır/durdurulur. Native, ACP ve gömülü terminal bağlantılarının kapsamı, oturum devamlılığı ve kullanım ayrıntıları [Agent tools](AGENT_TOOLS.md) belgesindedir.

## Delete conversation history

Use the trash button on a conversation in the left session list (global or project Agents view). Confirming permanently removes its RunHQ transcript, saved requests and local draft. Active turns must be stopped first. Project files, Git worktrees and provider-owned history are preserved. Archived conversations can also be deleted from the Archived filter.
