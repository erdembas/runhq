# RunHQ — güncel ürün analizi ve uygulama roadmap’i

**Revizyon:** 2 · 22 Eylül 2026 · Europe/Istanbul

**İncelenen temel:** 2.1.0, HEAD `4bcd769` ve çalışma ağacındaki devam eden geliştirmeler.

**Kod kesiti:** İlk kayıt 22:20:48, son hedefli kaynak kontrolü 22:29 +03:00. İnceleme sırasında dosyalar başka çalışmalar tarafından değiştiriliyordu; testlerin çalıştırıldığı kesitler ayrıca belirtilmiştir.

**Amaç:** Bir sonraki geliştirmeleri doğrudan görevlendirilebilir, sıralanabilir ve doğrulanabilir iş paketlerine dönüştürmek.

Bu belge önceki ürün değerlendirmesinin yerine geçer. [Ana roadmap](../ROADMAP.md) içindeki A1–A11 yatırımlarının üzerine uygulanacak tamamlayıcı teslim planıdır. A1–A11’i yeniden yaptırmaz. Kodda mevcut, yerel geliştirmede mevcut ve kullanıcıya uçtan uca teslim edilmiş durumlarını ayırır.

**23 Eylül · 2.2.0 yayın adayı notu:** Bölüm 4.2’deki scheduler bulguları yayın hazırlığında ele alındı: havuz çözümleme öncesi kilit bırakılıyor; global/hesap kapasitesi, cooldown ve salt okunur inceleme uyumu denetleniyor; uzun bir kardeş görev çalışırken yeni açılan bağımlılıklar başlatılıyor. Otomatik scheduler aynı workflow/generation için tekilleştirildi ve ortak checkout kullanımında sonuç birleştirme korundu. Grafiğin kayıt öncesi topolojik sıralaması ve daraltılmış çok satırlı talimatların düzenlenirken korunması da regresyon testlerine eklendi. Bu not yeni sürümün doğrulama kapsamını belirtir; RHQ-04 ve diğer açık ürün yolculuklarının tamamlandığı veya bütün sağlayıcılarla canlı test yapıldığı anlamına gelmez.

## 1. Ürün kararı

RunHQ’nun öncelikli işi, geliştiricinin birden fazla projede ve sağlayıcıda yürüyen agent çalışmalarını **kabul edilmiş, doğrulanabilir sonuçlara** ulaştırmasını sağlamak olmalı.

Hedef kullanıcı için ilk hipotez: birkaç aktif reposu olan, agent’ları günlük kullanan geliştirici ve küçük ekibin teknik lideri. Bu bir pazar araştırması sonucu değildir. İlk kullanım ve sonuç kabul deneyimi bu kitleyle sınanmalıdır.

Ürünün güçlü birleşimi: yerel proje ve servis yönetimi, sağlayıcı bağımsız agent gözetimi, worktree izolasyonu, inceleme ve kontrol kanıtı. Yeni yatırımın ağırlığı mevcut parçaların birleştirilmesinde olmalı.

Teslim edilmesi gereken ana yolculuk:

1. Projeyi ekle; bağlantı ve çalışma ortamının hazır olduğunu gör.
2. Hedefi yaz; araştırma, uygulama veya uygulama + inceleme şeklinde başlat.
3. Gerektiğinde işi bağımlı/paralel adımlara böl; hesap ve checkout sınırları korunsun.
4. Bekleyen kararları tek yerden çöz; hata veya kesintide kontrollü devam et.
5. Oluşan değişikliğin tamamını ve inceleme bulgularını gör.
6. Doğru çalışma alanında kontrolleri çalıştır; gerekiyorsa uygulamayı açıp doğrula.
7. Sonucu kabul et; çalışma alanına, commit’e veya PR akışına taşı.
8. Ortamı temizle; tarifi tekrar kullan; veriyi yedekleyebil.

**Ana başarı ölçütü:** Haftalık kabul edilmiş yararlı görev sayısı. Kod, plan ve araştırma işleri ayrı değerlendirilmeli. Token tüketimi ve başlatılan oturum sayısı destekleyici ölçüttür.

## 2. Durum sözlüğü ve uygulama kuralı

| Durum        | Anlamı                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| Mevcut       | Kod ve kullanıcı akışı bulunuyor; yeniden geliştirilmez                  |
| Geliştirmede | Yerel değişiklik mevcut; entegrasyon, test veya yayın kapanışı gerekiyor |
| Kısmi        | Temel var; belirtilen kullanıcı yolculuğu henüz tamamlanmıyor            |
| Açık         | İncelenen kodda önerilen davranış yok veya doğrulanmış eksik sürüyor     |
| Koşullu      | Kullanıcı ihtiyacı ve önceki teslimler doğrulanınca başlanacak           |

Her uygulama görevi başlamadan ilgili dosyalar ve testler yeniden okunmalı. Kabul kriterleri zaten sağlanmışsa yeni uygulama yazmak yerine kanıt eklenip paket kapatılmalı. Devam eden başka bir çalışmanın dosyaları üzerine alternatif implementasyon kurulmamalı.

Tamamlanma; kod yazılması, test geçmesi, sağlayıcıyla canlı doğrulama ve yayınlanma için ayrı ayrı kaydedilir. Test fixture’ı gerçek sağlayıcı doğrulaması gibi raporlanmaz. Bu rapor ürün kodunu değiştirmez ve aşağıdaki işleri kendiliğinden başlatmaz.

## 3. Yeniden doğrulanan mevcut yetenekler

| Yetenek                                                                              | Güncel durum                                      | Kalan iş / ilgili paket                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Proje keşfi, servisler, stack’ler, terminal, log, port ve Git                        | Mevcut                                            | Agent sonucunun çalıştırılmasına bağla: RHQ-08/12                        |
| Codex, OpenCode, Claude, Cursor/ACP ve özel bağlantılar                              | Mevcut                                            | Sağlayıcı başına gerçek doğrulama ve toparlanma: RHQ-09/15               |
| Model/mod keşfi, bağlantı hataları, kurulu araç seçimi                               | Mevcut                                            | Bütün workflow için preflight: RHQ-09                                    |
| Kalıcı konuşmalar, kuyruk, taslak ve restart kurtarma                                | Mevcut                                            | Tam yedek/geri yükleme kapsamı: RHQ-11                                   |
| Merkezi Inbox, sorular, izinler ve isteğe bağlı bildirimler                          | Mevcut                                            | Ortak sonuç/gezinti diline bağla: RHQ-05/10                              |
| Global ve proje kapsamlı Mission Control                                             | Mevcut                                            | Oturum sonu ile kabul edilmiş işi ayır: RHQ-05                           |
| Plan düzenleme ve aynı konuşmada uygulama                                            | Mevcut                                            | Basit görev başlangıcının parçası yap: RHQ-07                            |
| Canvas, bağlam tepsisi ve sağlayıcıya bağlı ek desteği                               | Mevcut                                            | Sonuç kartına bağla; gerçek uygulama önizlemesiyle karıştırma: RHQ-06/12 |
| Worktree, setup/check komutları ve ortam dosyası aktarımı                            | Mevcut                                            | Proje düzeyinde tekrar kullanım: RHQ-08                                  |
| Workflow inceleme, çalışma ağacı parmak izi, bayat kontrol ve entegrasyon önizlemesi | Mevcut                                            | Normal görev yolculuğuna taşı: RHQ-04/06                                 |
| Hedef çalışma alanına uygulama veya yeni dala commit                                 | Mevcut                                            | PR’a devir eksik: RHQ-13                                                 |
| Sıralı çok sağlayıcılı adımlar ve oturum devri                                       | Mevcut                                            | Yeni bağımlılık grafiğiyle bütünleştirme: RHQ-01/02                      |
| Tarifler, geçmiş arama, proje kararları, import/export                               | Mevcut; graph alanları yerel geliştirmeye eklendi | Yeni alanların UI üzerinden kayıpsız gidiş-dönüşünü doğrula: RHQ-02      |
| Hesaplar, havuzlar, kapasite ve limit sonrası bekleme                                | Mevcut                                            | Frontend ve yeni Rust yürütme yolu aynı kuralları uygulamalı: RHQ-03     |
| Tarifleri uygulama çalışırken zamanlama                                              | Mevcut                                            | Görev/workflow hedefi ve yürütme sahipliği: RHQ-14                       |
| Sağlayıcı kullanım raporu ve yerel tur süresi                                        | Mevcut                                            | Bekleme/çalışma ayrımı ve ekran sırası: RHQ-10                           |
| Araç/düşünme etkinliğini gruplama, dosya/komut özeti                                 | Geliştirmede; kod ve test mevcut                  | Yeniden yazma; yayın öncesi UI doğrulaması: RHQ-15                       |
| Araç adımındaki değişikliği tam ekran split/inline diff olarak açma                  | Geliştirmede; ortak DiffPane kullanılıyor         | Bu, normal görevin toplam Changes kapsamını çözmüyor: RHQ-04             |
| Bağımlı görev grafiği, adım prompt’u, ayrı worktree ve sonuç birleştirme             | Geliştirmede                                      | Çekirdek, IPC, arayüz, tarif ve test kapanışı: RHQ-01/02                 |
| Uygulamadan bağımsız daemon, remote host ve takım gözetimi                           | Koşullu                                           | Yerel teslim yolculuğu tamamlandıktan sonra talebe göre                  |

Önceki rapordaki genel önerilerden kuyruk, Inbox, worktree, tarif, hesap havuzu, kullanım süresi, zamanlama ve araç diff’i bağımsız yeni özellikler olarak backlog’a alınmamalı. Bunların üzerindeki eksik bağlantılar aşağıda tanımlanmıştır.

## 4. Yeni incelemenin değiştirdiği öncelikler

### 4.1. Workflow artık yalnızca sıralı adımlar olarak ele alınamaz

Yerel Rust geliştirmesi `depends_on`, adımın kendi `prompt` alanı, `shared/own` çalışma alanı, çıktı revizyonu, birleştirme kaydı ve workflow eşzamanlılık sınırı ekliyor. Adım sınırı çekirdekte 64’e çıkarılmış. **64 plan adımı, 64 eşzamanlı agent anlamına gelmiyor:** mevcut global/hesap kapasitesi 1–8 aralığında.

Son kontrolde TypeScript sözleşmesi, IPC schedule komutu, `AgentWorkflowTasks`, `AgentWorkflowBoard`, graph yardımcıları ve tarif dönüşüm köprüsü de mevcut. Tarif parser’ı 64 adıma çıkarılmış; kimlik, adım prompt’u, bağımlılık ve workspace alanlarını taşıyor. Eski tarifleri sıralı bağımlılığa dönüştürme ve adım prompt’larında parametre çözümleme de eklenmiş. **Bunlar yeniden yaptırılacak özellikler değil.**

Kalan iş bu zincirin gerçek UI üzerinden oluşturma → kaydetme → export/import → çalıştırma akışını kapatmak; eski kayıt, bekleme, çatışma ve kapasite durumlarını doğrulamak. RHQ-02 mevcut implementasyonun kabul ve entegrasyon paketidir. Kodun bulunması, yeni grafiğin paketlenmiş native uygulamada uçtan uca doğrulandığı anlamına gelmez.

### 4.2. Yeni scheduler için yayın öncesi kapanması gereken teknik bulgular var

Bunlar çalışan yayımlanmış uygulamada tetiklenmiş hata iddiaları değil, yerel geliştirme kesitindeki statik kod bulgularıdır:

- `workflow_step_wait`, `self.state` kilidini tutarken havuz hedefinde `resolve_step_target` çağırıyor. Bu yol `workspace_record` üzerinden aynı `parking_lot::Mutex` kilidini tekrar almaya çalışıyor. Havuz kullanan scheduler yolu için kilitlenme riski var; fixture ile doğrulanıp RHQ-01’de kapatılmalı.
- Otomatik döngü `implementing/reviewing` aşamasında bekliyor. Uzun A çalışırken kısa B’nin bitmesiyle bağımlılığı açılan C’nin başlayabildiği senaryo özellikle test edilmeli; yalnızca doğrudan `workflow_schedule` çağıran test, otomatik döngünün kapasiteyi kullanabildiğini kanıtlamaz.
- UI havuz seçimi ve Rust’taki `resolve_step_target` farklı karar yolları kullanıyor. Rust yolu görülen haliyle enabled/executable ve kapasite kontrolüne dayanıyor; frontend cooldown ve yetenek uyumunu da değerlendiriyor. Sözleşmenin tek bir otoriteye bağlanması gerekiyor.

Bu bulgular RHQ-01/03’ün başlangıç girdisidir. Uygulayıcı işe başladığında düzeltilmişlerse ilgili regresyon kanıtı yeterlidir.

### 4.3. Toplam Changes kapsamı hâlâ ayrı bir eksik

Normal görevde `agent_workspace_diff → git::diff_all_raw → git diff` zinciri sürüyor. Bu sorgu staged, untracked ve görev sırasında commit edilmiş değişikliklerin tamamını göstermez. Önceki incelemede staged düzenleme ve yeni dosya varken çıktının boş kaldığı geçici Git deposuyla doğrulandı; bu güncellemede aynı çağrı yolu tekrar okundu.

Yeni `AgentDiffModal`, agent’ın bir araç çağrısındaki düzenleme talimatını gösteriyor. Görevin çalışma alanına gerçekte ne bıraktığı için eksiksiz repo incelemesi yine gerekiyor. RHQ-04 bu ayrımı korur.

### 4.4. Görev sonucu ve ilk kullanım açıkları sürüyor

Pano `session.status === completed` durumunu Completed sütununa koyuyor; açıklaması incelemeye hazır yanıtlardan söz ediyor. Normal görevin ayrı, kalıcı kabul/sonuç durumu henüz yok. İlk kullanım turu servis odaklı; otomatik görev başlığı ilk prompt satırından türetiliyor. Bu tespitler RHQ-05/07/10/16’da ele alınır.

## 5. Teslim sırası ve bağımlılıklar

Takvim yerine çıkış kriterleri kullanılmıştır. **S:** tek odaklı PR; **M:** birkaç sınırlı PR; **L:** çekirdek/veri/UI geçişi nedeniyle bölünmesi gereken paket. Bunlar süre veya teslim tarihi taahhüdü değildir.

| ID     | İş paketi                                                    | Öncelik | Başlangıç durumu    | Bağımlılık                                   | Boyut |
| ------ | ------------------------------------------------------------ | ------- | ------------------- | -------------------------------------------- | ----- |
| RHQ-01 | Yeni workflow scheduler ve yaşam döngüsünü sağlamlaştır      | P0      | Geliştirmede        | Yok                                          | L     |
| RHQ-02 | Workflow sözleşmesi, görev grafiği UI’ı ve tarif uyumu       | P0      | Geliştirmede/kısmi  | 01, 03; sözleşme işi birlikte ilerleyebilir  | L     |
| RHQ-03 | Hesap yönlendirmesini bütün başlangıç yollarında tutarlı yap | P0      | Kısmi               | Yok                                          | M     |
| RHQ-04 | Normal görevde eksiksiz Changes                              | P0      | Açık                | Yok                                          | M     |
| RHQ-05 | Kalıcı görev sonucu ve doğru durum dili                      | P0      | Kısmi               | Yok                                          | M     |
| RHQ-06 | Sonuç kartı ve Review & finish                               | P1      | Kısmi               | 04, 05, 09                                   | L     |
| RHQ-07 | Tek görev başlangıcı ve agent odaklı onboarding              | P1      | Kısmi               | 02, 06, 09                                   | M     |
| RHQ-08 | Tekrar kullanılabilir proje çalışma profilleri               | P1      | Kısmi               | 02, 09                                       | M     |
| RHQ-09 | Provider preflight ve tanı/toparlanma                        | P1      | Kısmi               | 03                                           | M     |
| RHQ-10 | Görev kimliği, gezinti ve kapasite okunabilirliği            | P1      | Kısmi               | 05, 07; başlık düzeltmesi erken alınabilir   | M     |
| RHQ-11 | Tam yedek, geri yükleme ve şema migration’ı                  | P1      | Kısmi               | 02, 05                                       | L     |
| RHQ-12 | Doğru worktree’de çalıştır, önizle ve kanıtla                | P1      | Kısmi               | 06, 08                                       | M     |
| RHQ-13 | Kabul edilen değişiklikten PR’a devir                        | P2      | Açık; commit mevcut | 06, 12                                       | M     |
| RHQ-14 | Zamanlanmış görev/workflow hedefi ve yaşam döngüsü           | P2      | Kısmi               | 02, 03, 08, 09                               | M     |
| RHQ-15 | UI uçtan uca, performans ve erişilebilirlik doğrulaması      | P0–P1   | Kısmi               | Hemen başlar; her paketle genişler           | L     |
| RHQ-16 | Yayın, belgeler, onboarding ve tanıtım uyumu                 | P1      | Kısmi               | 07, 10, 15                                   | M     |
| RHQ-17 | Yerel ürün ölçümü ve kullanıcı doğrulaması                   | P1      | Açık                | 05; kullanıcı görüşmeleri hemen başlayabilir | S–M   |

### Teslim kapıları

- **G0 — Güvenilir çekirdek:** RHQ-01/02/03/04 kapanır; eski sıralı workflow açılabilir, yeni graph kayıpsız saklanır, havuzlu başlangıç takılmaz, değişiklikler eksiksiz görülür. Yeni DAG davranışı bu kapı geçilmeden genel kullanılabilir sayılmaz.
- **G1 — Kabul edilebilir sonuç:** RHQ-05/06/08/09/12 ile bir kullanıcı task → karar → tam diff → inceleme → kontrol → çalıştırma → kabul zincirini bitirir. Kaynak değişince eski doğrulama geçerli görünmez.
- **G2 — Öğrenilebilir ürün:** RHQ-07/10/16/17 ile yeni kullanıcı aynı yolu yardım almadan bulur; tanıtım üründe gerçekten çalışan yolu anlatır.
- **G3 — Günlük süreklilik:** RHQ-11/13/14 ve ilgili RHQ-15 senaryoları ile geri yükleme, PR’a devir ve zamanlanan işler tamamlanır.

RHQ-15 ve gerçek kullanıcı gözlemleri en sona bırakılmaz. Her kapının kendi doğrulaması vardır. Bir kapı için gerekmeyen sonraki özellik, o kapının yayınını bekletmemeli.

## 6. Görevlendirilebilir iş paketleri

### RHQ-01 — Workflow scheduler ve yaşam döngüsü

**Hedef:** Bağımlılığı açılan görevleri doğru checkout ve kapasiteyle yürütmek; durdurma, yeniden başlatma ve çatışmada değişiklik kaybetmemek.

**Mevcudu kullan:** Yeni `workflow_scheduler.rs`, graph alanları, generation kontrolü, ayrı worktree üretimi ve join kayıtları. İkinci scheduler yazma.

**İş:** Havuz yolundaki yeniden kilit alma bulgusunu kapat. Otomatik döngü runnable adımları diğer bağımsız işler çalışırken de değerlendirsin. Global/hesap/workflow sınırları ve tek checkout sahipliği atomik korunsun. Stop sonrası geç gelen sonuç eski generation’da kalsın. Join çakışması, setup/check iptali, cleanup ve restart davranışı netleşsin. Adım sonucunu workflow worktree’sine birleştirmek ile kullanıcının hedef reposuna entegre etmek ayrı eylemlerdir.

**Kabul ve test:** Fixture köprüyle iki bağımsız üretici paralel başlar; A sürerken B’ye bağlı C boş kapasitede başlayabilir. Pool hedefi zaman aşımına düşmez. Aynı checkout’a iki yazan agent girmez. Çakışma hedefi yarım yamalak değiştirmez. Stop bütün aktif adımları durdurur; restart kendiliğinden model turu başlatmaz. Otomatik ilerleme hedef repoya uygulama yapmaz. Durdurulan uzun setup/check diğer workflow’ları engellemez.

**Kod odağı:** E01, E02. **Kapsam dışı:** Quit sonrası daemon, remote host. **PR bölümü:** kilit/kapasite → otomatik ilerleme → stop/recovery/join/cleanup regresyonları.

### RHQ-02 — Workflow sözleşmesi, UI ve tarifler

**Hedef:** Yeni graph modelinin kullanıcıdan kayda, kayıttan yeniden çalıştırmaya kadar aynı kalması.

**Mevcudu kullan:** Rust/TS graph modeli, IPC schedule komutu, yeni görev editörü ve panosu, graph yardımcıları, 64 adımlı tarif parser’ı, eski sıralı tarif dönüşümü, parametre çözümleme ve `agentWorkflowRecipeBridge`. Bunlar yerel kodda mevcut.

**İş:** Mevcut bileşenleri kullanıcı yolculuğu üzerinden doğrula; yalnız kalan boşlukları tamamla. Adım kimliği, prompt, bağımlılıklar, workspace türü, durum/hata, çıktı revizyonu ve join sonucu UI ile kayıtta aynı anlama gelsin. Kolay sıralı başlangıç ile bağımlılık düzenleme birlikte çalışsın. Manuel başlatma ile izin verilmiş otomatik ilerleme ayrı olsun. Boş bağımlılık listesi ile eski kayıtta eksik alanın anlamı korunsun. Adım silme/sıralama bağımlılıkları bozmasın. Tarif export/import, workflow’a dönüşüm ve parametre doldurma yeni alanları kaybetmesin; şema/migration politikası belgelensin.

**Kabul ve test:** Eski iki-adımlı ve sıralı kayıtlar açılır. İki kök görev + birleşik inceleme grafiği UI’da kaydet/export/import sonrasında aynı kalır ve çalıştırılabilir. Adım prompt’undaki parametre sorulur, çözülür ve kaydedilmiş tarifi değiştirmez. Döngü, kayıp bağımlılık, yinelenen kimlik ve yeteneksiz rol reddedilir. UI, Rust ve tarif sınırları uyumludur; limit üstü veri sessizce kırpılmaz. 64 plan adımı ile 1–8 aktif agent kapasitesi ayrı anlatılır. Bekleme ve çatışma nedenleri görünürdür. Mevcut parser/graph testleri tekrar yazılmadan eksik UI/native senaryolarıyla tamamlanır.

**Kod odağı:** E01, E03, E04. **Kapsam dışı:** İkinci graph editörü veya serbest çizim editörü zorunluluğu. **PR bölümü:** sözleşme/migration kanıtı → UI entegrasyon boşlukları → tarif round-trip ve native smoke.

### RHQ-03 — Tek ve açıklanabilir hesap yönlendirmesi

**Hedef:** Aynı havuz ve aynı anlık koşullar, composer/queue/workflow/schedule yollarında aynı uygunluk kurallarını kullansın.

**Mevcudu kullan:** Hesap bağlantıları, havuzlar, cooldown kayıtları, frontend seçim politikası ve Rust kapasite kontrolleri.

**İş:** Başlatma anındaki yetkili seçimi backend’e bağla; UI yalnızca öngörü ve açıklama sunsun. Etkinlik, kullanılabilirlik, gerçek role ait yetenek, cooldown ve global/hesap doluluğu birlikte değerlendirilir. Havuz hedefi taslakta erken somut hesaba çevrilip unutulmasın. Seçilen hesap ve gerekçe oturuma kaydedilsin. Kapasite bekleme ile kalıcı yapılandırma hatası ayrılmalı.

**Kabul ve test:** İlk hesap limitte, ikinci uygunken bütün yollar ikinciyi seçer. Hepsi doluysa yinelenen oturum açılmaz; görünen bekleme nedeni vardır. İnceleme rolü uygun olmayan üyeye gitmez. Bir aktif native oturumun hesabı sonradan değiştirilmez. Eşzamanlı iki başlangıç toplam sınırı aşmaz. Eksik kota bilgisi tahmin edilmez.

**Kod odağı:** E01, E02, E05. **PR bölümü:** backend politika/sonuç sözleşmesi → tüm başlangıç yolları → açıklama ve hata UX’i.

### RHQ-04 — Eksiksiz görev Changes görünümü

**Hedef:** Kullanıcı agent işinin dosyalara bıraktığı gerçek sonucu eksiksiz inceleyebilsin.

**Mevcudu kullan:** Workflow snapshot/fingerprint yaklaşımı, görev başlangıç revizyonu, önceden kirli dosya bilgisi, Source Control DiffPane ve yeni araç diff modalı.

**İş:** Staged, unstaged, untracked, silinen, yeniden adlandırılan ve görev sırasında commit edilmiş dosyaları listeleyen read-only inceleme API’si kur. Başlangıçtan toplam fark ile mevcut çalışma ağacı farkını açık kapsamlarla göster. Görev öncesi kirli durum ve harici değişiklikler için sahiplik iddiası üretme. Diff üretirken gerçek index’e stage/unstage yapma. İzinli environment transferlerini ve ignore politikasını koru. Büyük/binary dosyalarda anlaşılır özet göster.

**Kabul ve test:** Sadece staged değişiklik veya sadece yeni dosya varken ekran boş görünmez. Görev içinde commit sonrası fark kaybolmaz. Pre-existing dirty, rename/delete, binary, büyük dosya, non-Git klasör ve okunamayan dosya senaryoları kapsanır. Yenileme kullanıcının index’ini değiştirmez. Araç talimatından türetilen diff ile gerçek checkout sonucu doğru etiketlenir.

**Kod odağı:** E06, E07. **PR bölümü:** kapsamlı veri API’si → ortak görüntüleyici → uç durumlar. **İlk bağımsız teslim için uygun.**

### RHQ-05 — Görev sonucu ve durum modeli

**Hedef:** Yürütmenin bitmesi, incelemeye hazır sonuç ve kullanıcının kabulü birbirine karışmasın.

**Mevcudu kullan:** Runtime session durumları ve workflow kontrol/entegrasyon kayıtları; provider protokol durumlarını yeniden tanımlama.

**İş:** Ürün sonucu için ayrı kalıcı model ekle. En azından sonuç bekleniyor, inceleme gerekli, değişiklik istendi ve kabul edildi ayrımı olsun. İncelendi/doğrulandı/entegre edildi kanıtı ilgili revizyona veya artifact sürümüne bağlansın. Pano, filtre, bildirim ve kullanım tablosunda aynı dil kullanılsın. Kod, araştırma ve plan çıktılarının kabul kuralları ayrı olsun.

**Kabul ve test:** Provider `completed` tek başına Accepted üretmez. Eski kayıtlar otomatik kabul edilmiş sayılmaz. Yeni tur veya değişen kaynak eski doğrulamanın güncelliğini bozar. Kabul restart sonrasında korunur; yeni revizyon için tekrar değerlendirme gerekir. Unread işareti kabul anlamına gelmez. Araştırma görevi Git’siz tamamlanabilir.

**Kod odağı:** E08, E01. **PR bölümü:** şema/migration → backend eylemleri → pano ve ortak metinler.

### RHQ-06 — Sonuç kartı ve Review & finish

**Hedef:** Günlük konuşmadan kullanılabilir sonuca tek bir anlaşılır devam yolu sunmak.

**Mevcudu kullan:** Workflow inceleme, check, stale fingerprint, preview, entegrasyon ve plan/canvas çıktıları.

**İş:** Sonuç kartında hedef, değişen dosyalar/çıktılar, inceleme bulguları, gerçek kontrol sonuçları, kalan engeller ve sıradaki eylem gösterilsin. Normal görevden inceleme ve kontrol akışına geçiş sağlansın. Aktif konuşmayı sessizce taşımadan, değişiklik snapshot’ı ve çalışma alanı seçimiyle devam edilsin. Kontrol koşmadıysa koşmadığı açık olsun; agent’ın test geçti demesi gerçek komut kaydının yerine geçmesin.

**Kabul ve test:** Görev → sonuç → tam diff → bağımsız inceleme → gerçek check → hedef preview → kullanıcı kabulü tamamlanır. Kaynak veya hedef değişince stale koruması işler. Başarısız inceleme/check için ilgili düzeltme turuna gidilir. Aynı eyleme çift basılması iki workflow/commit yaratmaz. Salt belge çıktısı için gereksiz worktree zorunluluğu yoktur.

**Kod odağı:** E01, E06, E08, E09. **PR bölümü:** sonuç kartı → normal görev bağlama → kontrol/entegrasyon devamı.

### RHQ-07 — Tek görev başlangıcı ve onboarding

**Hedef:** Kullanıcı rol/account/pool terminolojisini öğrenmeden ilk yararlı görevi tamamlasın.

**Mevcudu kullan:** Composer, task templates, bağlantı keşfi, proje seçici, draft recovery ve workflow editörü.

**İş:** Araştır/planla, uygula, uygula + incele gibi amaçlar tek başlangıçtan seçilsin; gelişmiş adımlar sonradan açılsın. Son kullanılan proje/uygun bağlantı tercihleri korunsun; yanlış proje seçimi görünür olsun. İlk açılış rehberi proje → bağlantı → küçük görev → sonucu incele adımlarını izlesin. Mevcut servis kullanıcıları kendi başlangıç görünümünü koruyabilsin.

**Kabul ve test:** Temiz kullanıcı verisinde kurulu bir CLI ile ilk sonuç incelemesine ulaşılır. CLI/Node/auth sorunu doğru adımda çözüm gösterir. Boş mesaj oturum yaratmaz; başarısız ilk gönderim taslağı kaybetmez. Gelişmiş ayarlar ve provider yetenekleri kaybolmaz. Onboarding yeniden açılabilir ve klavyeyle tamamlanabilir.

**Kod odağı:** E09, E10, E11. **PR bölümü:** tek başlangıç modeli → onboarding → eski kullanıcı geçişi.

### RHQ-08 — Proje çalışma profilleri

**Hedef:** Her yeni worktree’de aynı kurulum ve kontrol bilgisini yeniden girmemek.

**Mevcudu kullan:** Tariflerdeki setup/check alanları, workflow komut yürütücüsü, seçili environment dosyası aktarımı ve worktree envanteri.

**İş:** Proje düzeyinde sürümlü profil tanımla: çalışma alt dizini, setup komutları, check komutları, seçili yerel dosya aktarımı ve geliştirme servisi bilgisi. Manifest’ten önerileri kullanıcıya göster; keşif yapıldığı için komutları kendiliğinden çalıştırma. Normal isolated task ve workflow aynı profili kullansın; kullanılan sürüm görevde saklansın. Kısmen başarısız kurulum tekrar denenebilir olsun.

**Kabul ve test:** Aynı profille ikinci worktree açıldığında kurulum tekrarlanabilir. Monorepo alt dizini doğru kalır. Env içeriği transcript/export/patch’e sızmaz. Profil düzenlemesi geçmiş görevin kayıtlı kanıtını değiştirmez. Bozuk veya eksik setup açık hata verir; kaynak projede istenmeyen işlem yapılmaz.

**Kod odağı:** E01, E04, E09. **PR bölümü:** profil kaydı → mevcut setup ile bağlama → composer/recipe tekrar kullanımı.

### RHQ-09 — Provider preflight ve toparlanma

**Hedef:** Özellikle çok adımlı işin sonraki aşamasındaki bağlantı problemini mümkün olduğunca başlamadan göstermek.

**Mevcudu kullan:** Executable ve Node keşfi, model katalogları, bağlantı durumları ve provider capability bilgisi.

**İş:** İşte kullanılacak bütün bağlantılara; sürüm, kontrol zamanı, desteklenen rol/mod, auth sonucu ve model seçimi içeren preflight uygula. Bağlantı kontrolünü gerçek ücretli model turundan ayır. Eksik CLI, auth, uyumsuz sürüm, yeteneksiz reviewer, geçersiz model ve cooldown için somut toparlanma eylemleri sun. Kullanıcının inceleyip paylaşabileceği redakte tanı paketi oluştur.

**Kabul ve test:** Bozuk ikinci provider işin uygun aşamasında açıkça raporlanır. Kimlik doğrulama düzeldikten sonra görev ve taslak kaybolmadan devam edilir. Preflight başarısı gelecekteki kota/auth için garanti olarak sunulmaz. Görsel, plan, steer, readonly ve resume yetenekleri provider/version bazında doğrulanır. Tanı çıktısında secret/env içeriği bulunmaz.

**Kod odağı:** E05, E10, E12. **PR bölümü:** durum sözleşmesi → workflow/composer gösterimi → tanı ve toparlanma.

### RHQ-10 — Görev kimliği, gezinti ve kullanım ekranı

**Hedef:** Kullanıcı neye bakacağını, hangi görevin karar beklediğini ve işin nerede kaldığını hızlıca bulsun.

**Mevcudu kullan:** Global/proje kapsamları, aramalı seçiciler, yeniden adlandırma, Inbox, usage tablosu ve yeni etkinlik gruplama.

**İş:** Yol/bağlam satırları yerine hedefi anlatan başlık öner; elle düzenleme kolay olsun. Kartta proje, son anlamlı etkinlik, bekleme nedeni ve sıradaki eylem önceliklendirilsin. Büyük listeler için kompakt görünüm ekle. Global görev ile proje filtresi arasındaki kapsamı belirginleştir. Usage’da görev raporu/kapasite bilgisi ayarlardan önce gelsin; ölçülebilen aktif ve karar bekleme süreleri ayrı gösterilsin. AI Assistant analizinden bağlamı hazır göreve geçiş sunulsun.

**Kabul ve test:** Aynı `Depo:` satırıyla başlayan farklı görevler ayırt edilebilir. Filtre/gezinme taslağı veya çalışan işi kaybetmez. Açık işin kapsamı her görünümde anlaşılır. Eksik kullanım verisi Unknown kalır; farklı provider rapor kapsamları tek bir fatura toplamı gibi sunulmaz. Yeni zaman ayrımı geçmişte ölçülmeyen süreyi uydurmaz.

**Kod odağı:** E08, E09, E13. **PR bölümü:** başlık/kart → gezinti → usage/bekleme süresi.

### RHQ-11 — Tam yedek ve güvenli geri yükleme

**Hedef:** Kullanıcı cihaz veya kurulum değiştirdiğinde hangi çalışmasının geri geleceğini bilsin.

**Mevcudu kullan:** SQLite geçmiş, tarif/history import/export ve localStorage kurtarma katmanı.

**İş:** Sürümlü bir arşivde ayar/proje kaydı, görev ve workflow verisi, tarif/karar, taslak/kuyruk ve yerel Plan/Canvas düzenlemelerinin kapsamını tanımla. Tutarlı DB snapshot’ı al; salt dosya kopyasına güvenme. Credentials varsayılan dışarıda kalsın. Provider-native geçmiş ve gerçek worktree dosyalarının dahil olup olmadığı açık yazılsın. Yol eşleme, önizleme, çakışma politikası ve geri dönüş sağlayan import uygula.

**Kabul ve test:** Temiz geçici home’a export/import ile desteklenen kayıtlar ve taslaklar geri gelir. Eski/yeni şema, bozuk/kesik arşiv, eksik proje yolu ve yinelenen import denenir. İçe aktarılan işler otomatik çalışmaz; eski pending izin yanıtı tekrar gönderilmez. Başarısız import mevcut çalışma alanını yarım durumda bırakmaz.

**Kod odağı:** E01, E04, E14. **PR bölümü:** arşiv sözleşmesi → export/import çekirdeği → önizleme ve yol eşleme UI’ı.

### RHQ-12 — Worktree’de çalıştır ve sonucu doğrula

**Hedef:** Kullanıcı incelenen kodun gerçekten çalıştığını doğru ortamda görebilsin.

**Mevcudu kullan:** Servis başlatma/durdurma, terminal, port bilgisi, tarayıcı açma ve workflow check kanıtı.

**İş:** Görevdeki Run/Preview eylemi doğru worktree ve proje profilini hedeflesin. Readiness, port çakışması, setup hatası ve son loglar göreve bağlı gösterilsin. Kullanıcı doğru URL’ye ulaşsın. Test/çalıştırma kaydı komut, cwd, çıkış kodu ve revizyonu taşısın. Görev bitişi/cleanup ilgili servis yaşam döngüsünü hesaba katsın.

**Kabul ve test:** Ana checkout değiştirilmeden iki farklı worktree’nin servisi ayırt edilir. Port doluysa yanlış uygulama başarı diye açılmaz. Readiness hatası ve kapanan süreç görünürdür. Kontrol sonrası kaynak değişince kanıt stale olur. Kullanıcının bağımsız başlattığı servisi yanlışlıkla durdurmaz.

**Kod odağı:** E01, E15. **Kapsam dışı:** Tam gömülü tarayıcı veya yeni genel test IDE’si. **PR bölümü:** görev-servis bağlama → readiness/URL → doğrulama ve cleanup bağlantısı.

### RHQ-13 — İncelenen değişiklikten PR’a devir

**Hedef:** Yerel kabul ve commit sonrası kullanıcı ekip incelemesine geçebilsin.

**Mevcudu kullan:** Workflow’un branch/commit çıktısı ve mevcut Git/editör bağlantıları.

**İş:** İlk teslimde dal, commit, hedef remote ve karşılaştırma bağlantısını açık göster; mevcut editör/CLI/tarayıcı akışına devir sun. Sonraki küçük teslimde uygun bağlantı varsa kullanıcı eylemiyle push ve draft PR oluştur, doğrulanmış URL’yi göreve kaydet. PR başlığı ve açıklaması gerçek diff ve check kanıtından hazırlanmalı. Remote seçimi ve yayınlama eylemi görünür kalmalı.

**Kabul ve test:** Remote olmayan repo, auth hatası, mevcut PR, push reddi ve birden çok remote desteklenir. Başarısız push/PR Accepted sonucunu yayımlanmış gibi göstermez. Aynı işlem tekrarlandığında yinelenen PR oluşturulmaz. Ürün deploy/merge yapmış gibi davranmaz.

**Kod odağı:** E01, E06, E15. **Kapsam dışı:** Otomatik merge veya deployment. **PR bölümü:** devir ekranı → açık push/PR eylemi.

### RHQ-14 — Zamanlanan işlerin hedefi ve sahipliği

**Hedef:** Kullanıcı bir tarifi zamanladığında tek görev mi, bütün workflow mu çalışacağını ve hangi koşulda kaçırılacağını bilsin.

**Mevcudu kullan:** Zamanlama kayıtları, kaçırılan tekrar politikası, creation request kimliği ve hesap yönlendirmesi.

**İş:** Zamanlama modelinde task/workflow hedefi açık olsun. Şu an runner `recipe.prompt` ile agent session açıyor; tarifin çok adımlı olması otomatik olarak workflow çalıştırıldığı anlamına gelmiyor. İki hedef için kayıtlı profil ve yönlendirme tutarlı uygulansın. Masaüstü süreç ayaktayken yürütme zamanlayıcısının sahipliğini native katmana taşıma seçeneğini değerlendir; UI’da tek kayıt üzerinden göster. Son/sonraki çalışma, kaçırılan/engellenen tekrar ve nedeni görünür olsun.

**Kabul ve test:** Birden çok pencere veya reload aynı tekrarı iki kez başlatmaz. Başlangıçta workspace yüklenmeden görev düşürülmez. Suspend/resume, kapasite doluluğu, auth hatası, silinen tarif, timezone/DST ve kaçırılan tekrar senaryoları deterministiktir. Varsayılan çalışma uygulama ömrüne bağlıysa bu açık yazılır; Quit sonrası çalışma vaat edilmez.

**Kod odağı:** E05, E16, E01. **Kapsam dışı:** Bağımsız daemon; bu ayrı koşullu yatırımdır. **PR bölümü:** hedef modeli → native sahiplik/tekilleştirme → durum UX’i.

### RHQ-15 — Uçtan uca kalite, performans ve erişilebilirlik

**Hedef:** Birim testleri yeşil olan parçaların gerçek kullanıcı yolunda da birlikte çalıştığını göstermek.

**Mevcudu kullan:** Node testleri, Rust fixture köprüleri, CI ve görünürlük/terminal akış kontrolü regresyonları.

**İş:** Repo içinde tekrar çalıştırılabilir izole UI fixture’ı ve ana yolculuk otomasyonu kur. İlk görev, soru/izin, diff, checks, kabul, restart ve workflow grafiğini kapsa. Yeni ActivityBlock/DiffModal için klavye aç/kapat, Escape, focus dönüşü, uzun çıktı ve eksik payload senaryolarını doğrula. Provider canlı smoke sonuçlarını sürüm/tarih/platformla kaydet. Uzun transcript, çok görev ve paralel güncellemeler için ölçüm senaryosu tanımla.

**Kabul ve test:** Gerçek kullanıcı verisi ve ücretli model gerektirmeyen deterministik UI senaryoları CI’da çalışır. Canlı provider testleri ayrı opt-in iştedir ve auth yüzünden çalışmadıysa passed yazmaz. Native macOS/Windows/Linux smoke matrisi kaydedilir. 500 kayıtlı görev, uzun konuşma ve 8 aktif tur gibi tanımlı fixture yükünde sekme geçişi, input gecikmesi, bellek ve event backlog ölçülür; bütçe baseline’dan sonra yazılır. Klavye odağı kaybolmaz, modal odak yönetimi ve durum erişilebilirliği doğrulanır.

**Kod odağı:** E17, E07, E12. **PR bölümü:** UI test düzeneği → kapı senaryoları → native/performance/a11y kayıtları. Her ürün PR’ı kendi anlamlı regresyonunu da içerir.

### RHQ-16 — Yayın ve ürün anlatımı

**Hedef:** README, ilk kullanım, web demosu ve release notes aynı çalışan ürünü anlatsın.

**Mevcudu kullan:** Shared cockpit-ui, Next.js tanıtım sitesi, release registry ve mevcut release/asset doğrulamaları.

**İş:** Ana vaadi agent işi → doğrulanmış sonuç döngüsüne bağla. 60–90 saniyelik tek örnek görev demosu hazırla. Yeni özellikleri sürüm bazında belgele; gerçek/fixture desteğini ayır. README repo yapısına agent runtime gibi mevcut paketleri yansıt. What's New kaydını ürün sürümüyle eşleştir. Ana roadmap’te eski sıralı model ve artık teslim edilmiş zamanlama anlatımlarını düzelt. Performans iddialarında idle uygulama ile child agent süreçlerinin kapsamı açık olsun.

**Kabul ve test:** Yayın paketindeki sürüm, What's New ve web indirme hedefi uyumludur. Paketlenmiş bridge bulunur; updater/install smoke sonuçları kayıtlıdır. Kullanıcı provider/Node gereksinimini kurulum sırasında öğrenir. Tanıtımda gösterilen akış aynı release’de tamamlanabilir. Ölçülmemiş RAM/başlangıç değeri garanti olarak verilmez.

**Kod odağı:** E11, E18. **PR bölümü:** belgeler/konumlandırma → gerçek demo → release tutarlılık kontrolü.

### RHQ-17 — Yerel ölçüm ve kullanıcı doğrulaması

**Hedef:** Sonraki yatırımı gerçek darboğaz üzerinden seçmek.

**İş:** 5–8 hedef kullanıcıyla mevcut bir gerçek işi gözle. İlk yararlı sonuç süresi, karar bulma, kabul edilen sonuç, setup yüzünden duran iş ve kullanılan dış uygulama sayısını kaydet. RHQ-05 durumlarıyla yerel sayaçlar üret; kullanıcı isterse kapsamı görüp dışa aktarabilsin. Ölçüm ile içerik/transcript aktarımını ayır.

**Kabul:** Zero telemetry varsayılanı korunur. Kod ve araştırma kabul oranı ayrı hesaplanır. Başlangıç değeri ölçülmeden iyileşme yüzdesi veya süre garantisi yazılmaz. Her gözlem turu sonunda en fazla üç öncelik değişikliği gerekçesiyle kaydedilir. Kullanılmayan yüzeyler kaldırılmadan önce gizleme/ikincilleştirme denenir.

**Kod odağı:** E08, E14 ve ürün araştırma notları. **Çıktı:** Ölçüm tanımları, anonimleştirilmiş gözlem özeti ve sonraki sürüm kararları.

## 7. İlk iş dağıtımı

İlk atamalar şu sırayla yapılabilir; bu bölüm başka agent veya görevlerin bu incelemede başlatıldığı anlamına gelmez.

| İlk paket                         | Somut teslim                                                               | Çakışma yönetimi                                                              |
| --------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| RHQ-01 + RHQ-03 çekirdek kapanışı | Scheduler kilidi, havuz kararı, otomatik ilerleme ve iptal/recovery kanıtı | Devam eden workflow geliştirmesiyle aynı çekirdek sahipliği altında ilerlesin |
| RHQ-04                            | Eksiksiz Changes API’si ve ortak inceleme UI’ı                             | Workflow snapshot yardımcıları için arayüzü önce kararlaştır                  |
| RHQ-05                            | Sonuç durumu sözleşmesi ve migration                                       | RHQ-02 ile ortak agent/workflow tiplerini koordine et                         |
| RHQ-15 ilk dilim                  | Tekrar çalıştırılabilir UI fixture ve mevcut ana yol smoke’u               | Ürün davranışını taklit eden ikinci motor kurma                               |

Ardından RHQ-02 sözleşme/UI/tarif zinciri ve RHQ-09 preflight tamamlanır. RHQ-06/07/08/12 aynı günlük kullanıcı yolunu birleştirir. Yayın metni final davranışa göre yazılır.

Her paket için görevlendirme metni şu bilgileri içermeli: ilgili RHQ kimliği, mevcut davranışı tekrar kontrol etme talebi, kapsam ve kapsam dışı, bağımlı paketlerin durumu, aşağıdaki kabul/test kriterleri ve tek odaklı PR beklentisi. Bir paket L ise tek dev PR yerine belirtilen teslim dilimlerine ayrılmalı.

## 8. Ortak kabul ve doğrulama senaryoları

| Senaryo                                     | Kanıtlanacak sonuç                                                | Paketler   |
| ------------------------------------------- | ----------------------------------------------------------------- | ---------- |
| Temiz kullanıcı, eksik CLI/auth             | Açıklanmış eksik, korunmuş taslak, düzeltilebilir başlangıç       | 07, 09     |
| Sadece staged ve yeni dosyalar              | Changes eksiksiz; sahte boş sonuç yok                             | 04         |
| Görev öncesi dirty + dış editör değişikliği | Kapsam doğru; kesin agent sahipliği iddiası yok                   | 04, 06     |
| İki bağımsız iş ve bir join/review          | Paralellik, doğru revizyon, bütün üreticileri kapsayan inceleme   | 01, 02     |
| Pool ilk hesabı cooldown’da                 | Uygun hesaba tutarlı yönlendirme ve açıklama                      | 03         |
| İzin beklerken Stop/restart                 | Eski izin tekrar oynatılmaz; aktif süreç ve kuyruk durumu tutarlı | 01, 09, 11 |
| İnceleme sonrası kaynak/hedef değişikliği   | Kontrol veya entegrasyon önizlemesi stale olur                    | 05, 06     |
| İki worktree, aynı port                     | Doğru uygulama ve anlaşılır çakışma                               | 08, 12     |
| Hedef dirty, commit/push başarısız          | Önceden var olan iş korunur; yanlış başarı gösterilmez            | 06, 13     |
| Tarif graph export/import                   | Kimlik, bağımlılık, prompt ve workspace türü kaybolmaz            | 02, 11     |
| Uygulama kapalıyken kaçan zamanlama         | Açık politika; tekrar fırtınası ve çift görev yok                 | 14         |
| Uzun konuşma, çok görev, klavye kullanımı   | Ölçülen tepki süresi, bounded backlog ve erişilebilir eylemler    | 10, 15     |

Genel bitiş kuralı: davranış ve eski veri uyumu doğrulanmış; ilgili kontroller geçmiş; destek sınırı belgelenmiş; kullanılan gerçek/fixture kanıtı ve test edilen commit/kesit kaydedilmiş olmalı. Belge değişikliği için ürün testlerini gereksiz yere yeniden yazma; davranış değişikliğinde anlamlı regresyon ekle.

## 9. Bu güncellemede çalıştırılan kontroller

22:16–22:19 aralığındaki çalışma ağacı üzerinde:

| Kontrol                              | Sonuç                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm typecheck`                     | Geçti                                                                   |
| `pnpm lint`                          | Geçti; site lint aracında deprecation/config uyarıları sürüyor          |
| Desktop Node testleri                | 242 geçti                                                               |
| Agent runtime testleri               | 36 geçti; yalnız localhost fixture sunucusu için izinli çalıştırma      |
| `cargo test -p runhq-core --offline` | 225 unit + 4 log + 3 scanner = 232 geçti; 1 canlı-provider testi ignore |

Bu ilk kesitte toplam **510 test geçti**. Önceki rapordaki test sayıları yeni kanıt olarak tekrar kullanılmadı.

### Son kapanış kontrolü — 22:25–22:29

| Kontrol                              | Sonuç                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                     | 22:25 sonrası turda geçti                                                                                                                             |
| Desktop Node testleri                | İlk tekrar 257/258; tarif parametresi testinde beklenti uyuşmazlığı vardı. Eşzamanlı geliştirmede test düzeltildi; 22:29 tekrarında **258/258 geçti** |
| Agent runtime testleri               | Adapter değişiklikleri sonrası tekrar: **36/36 geçti**                                                                                                |
| `cargo test -p runhq-core --offline` | Son tekrarda **232 geçti**, 1 canlı-provider testi ignore                                                                                             |
| Lint                                 | İlk tur geçti; kapanış değişikliklerinin tamamı için yeniden çalıştırılmadı                                                                           |

Son kayıtlı test sonuçları toplam **526 geçen test** içeriyor. Bunlar farklı dakikalardaki çalışma ağacı kesitlerine aittir; tek bir değişmez commit için tam CI veya yayın onayı değildir. Test sayısının artması scheduler’daki statik bulguları kapatmaz: havuz ve otomatik ilerleme senaryolarının özel kanıtı hâlâ isteniyor. İnceleme sırasında bulunan geçici tarif testi hatası açık hata olarak backlog’a taşınmadı.

Bu güncelleme için native uygulama yeniden derlenip yeni workflow grafiği canlı sağlayıcıyla yürütülmedi. Önceki rapordaki macOS UI gezintisi önceki kurulu sürümün kanıtıdır. Windows/Linux native uygulama, remote CI durumu, tüm provider canlı turları, kurulum/güncelleme ve performans benchmark’ı doğrulanmış sayılmıyor. Yeni scheduler bulguları statik incelemedir; RHQ-01’de yürütülebilir regresyona dönüştürülmelidir.

## 10. Bilinçli olarak sonraya bırakılanlar

### Mevcut üründe sadeleştirilecekler

| Yüzey                                                     | Karar                                                              | Gerekçe / paket                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Normal görev, workflow ve tariften ayrı başlangıç yolları | Tek amaç seçimi; ayrıntıları gerektiğinde aç                       | Kullanıcı işe başlamak için iç modeli öğrenmesin: RHQ-07             |
| Hesap/havuz/yetenek ayarları                              | Gerektiğinde görünür gelişmiş kontroller                           | Kontrol korunurken ilk görev hafiflesin: RHQ-03/07/10                |
| Servisler ve stack’ler                                    | Kaldırma; görev sonucunu çalıştırmaya bağla                        | Ürünün mevcut güçlü altyapısı: RHQ-08/12                             |
| Araç diff’i, toplam Changes ve sonuç kartı                | Üçünün kapsamını açık tut; aynı bilgiyi tekrarlayan özetleri azalt | Talimat, gerçek dosya sonucu ve kabul kanıtı farklıdır: RHQ-04/06    |
| Usage yapılandırması ve görev raporu                      | Günlük durum önce, bağlantı ayarları sonra                         | Sık iş ile seyrek ayarı ayır: RHQ-10                                 |
| Plan, Canvas ve AI Assistant                              | Kullanım verisi olmadan silme; ana görev/sonuç yoluna bağla        | Bağımsız yüzey çoğaltmak yerine bağlamı yeniden kullan: RHQ-06/10/17 |

### Yeni kapsam olarak ertelenenler

- **Bağımsız daemon:** Uygulama kapandıktan sonra çalışma ihtiyacı kullanıcılarla doğrulanırsa. Mevcut recipe timer veya workflow scheduler bunun yerine sayılmaz. Ayrı süreç sahipliği, IPC reconnect, durable queue/schedule ve açık stop politikası gerekir.
- **Remote host:** Yerel çalışma alanı, artifact/kanıt ve reconnect modeli oturduktan sonra.
- **Takım modu:** Görev sahipliği, ortak inceleme ve erişim gereksinimi doğrulanınca.
- **Genel API/DB istemcisi, takvim, mobil companion ve plugin pazaryeri:** Ana görev döngüsünde çözülemeyen somut ihtiyaç gösterilene kadar.
- **Tam IDE veya tam gömülü tarayıcı:** Mevcut editör devri ve odaklı preview ile çözülmeyen kullanım kanıtı gerekir.
- **Otomatik kota tahmini, model yarıştırma ve sınırsız otonomi:** Bilinmeyen kullanım verisinden kesinlik üretilmez; maliyet ve yetki sınırlarını büyüten otomasyonlar bu teslim planının parçası değil.

## 11. Kaynak ve kod odakları

Bu bağlantılar başlangıç noktalarıdır; geliştirme sırasında satır numaraları değiştiği için fonksiyon/bileşen adları esas alınmıştır.

- **E01 — Workflow çekirdeği:** [workflows.rs](../crates/runhq-core/src/agents/workflows.rs), [workflow_scheduler.rs](../crates/runhq-core/src/agents/workflow_scheduler.rs).
- **E02 — Agent sahipliği ve kayıtları:** [mod.rs](../crates/runhq-core/src/agents/mod.rs), [workspace_data.rs](../crates/runhq-core/src/agents/workspace_data.rs), [types.rs](../crates/runhq-core/src/agents/types.rs).
- **E03 — Workflow sözleşmesi ve UI:** [agentWorkflowIpc.ts](../apps/desktop/src/lib/ipc/agentWorkflowIpc.ts), [IPC](../apps/desktop/src-tauri/src/ipc/agent_workflows.rs), [AgentWorkflowHub](../apps/desktop/src/components/agents/AgentWorkflowHub.tsx), [AgentWorkflowTasks](../apps/desktop/src/components/agents/AgentWorkflowTasks.tsx), [AgentWorkflowBoard](../apps/desktop/src/components/agents/AgentWorkflowBoard.tsx), [graph yardımcıları](../apps/desktop/src/components/agents/agentWorkflowGraph.ts), [adım politikası](../apps/desktop/src/components/agents/agentWorkflowStepPolicy.ts).
- **E04 — Tarifler ve kitaplık:** [agentLibraryModel](../apps/desktop/src/components/agents/agentLibraryModel.ts), [AgentLibrary](../apps/desktop/src/components/agents/AgentLibrary.tsx), [tarif/workflow dönüşümü](../apps/desktop/src/components/agents/agentWorkflowRecipeBridge.ts), [library store](../apps/desktop/src/store/useAgentLibraryStore.ts).
- **E05 — Hesap ve kapasite:** [agentAccountRouting](../apps/desktop/src/components/agents/agentAccountRouting.ts), [agentCapacity](../apps/desktop/src/components/agents/agentCapacity.ts), [agentUsagePolicy](../apps/desktop/src/components/agents/agentUsagePolicy.ts).
- **E06 — Görev diff’i ve Git:** [AgentSessionView](../apps/desktop/src/components/agents/AgentSessionView.tsx), [agent IPC](../apps/desktop/src-tauri/src/ipc/agents.rs), [git/diff.rs](../crates/runhq-core/src/git/diff.rs).
- **E07 — Etkinlik ve ortak diff:** [AgentActivityBlock](../apps/desktop/src/components/agents/AgentActivityBlock.tsx), [AgentDiffModal](../apps/desktop/src/components/agents/AgentDiffModal.tsx), [DiffPane](../apps/desktop/src/components/git/DiffPane.tsx), [agentActivity](../apps/desktop/src/components/agents/agentActivity.ts).
- **E08 — Görev durumu:** [agentMissionControl](../packages/cockpit-ui/src/lib/agentMissionControl.ts), [AgentMissionControl](../packages/cockpit-ui/src/components/AgentMissionControl.tsx), [agentTypes](../packages/cockpit-types/src/agentTypes.ts).
- **E09 — Yeni görev ve workspace:** [AgentNewSession](../apps/desktop/src/components/agents/AgentNewSession.tsx), [AgentWorkspace](../apps/desktop/src/components/agents/AgentWorkspace.tsx), [agentTaskLauncher](../apps/desktop/src/components/agents/agentTaskLauncher.ts).
- **E10 — Bağlantı keşfi:** [useAgentCatalog](../apps/desktop/src/components/agents/useAgentCatalog.ts), [useAgentDiscovery](../apps/desktop/src/components/agents/useAgentDiscovery.ts), [discovery.rs](../crates/runhq-core/src/agents/discovery.rs).
- **E11 — İlk kullanım:** [WelcomeTour](../apps/desktop/src/components/WelcomeTour.tsx), [başlangıç sekmesi](../apps/desktop/src/store/slices/mainTabSlice.ts), [README](../README.md).
- **E12 — Sağlayıcılar:** [agent-runtime/src](../packages/agent-runtime/src), [Agent tools](AGENT_TOOLS.md), [Agent workspace](AGENT_WORKSPACE.md).
- **E13 — Süre ve kullanım:** [AgentUsagePanel](../apps/desktop/src/components/agents/AgentUsagePanel.tsx), [agentDuration](../apps/desktop/src/components/agents/agentDuration.ts), [AgentDecisionInbox](../apps/desktop/src/components/agents/AgentDecisionInbox.tsx).
- **E14 — Kurtarma ve veri:** [agentRecoveryPersistence](../apps/desktop/src/lib/agentRecoveryPersistence.ts), [useAgentQueueStore](../apps/desktop/src/store/useAgentQueueStore.ts), [DataCategory](../apps/desktop/src/components/settings/categories/DataCategory.tsx).
- **E15 — Servis ve Git bağlantıları:** [serviceIpc](../apps/desktop/src/lib/ipc/serviceIpc.ts), [gitIpc](../apps/desktop/src/lib/ipc/gitIpc.ts), [services IPC](../apps/desktop/src-tauri/src/ipc/services.rs).
- **E16 — Zamanlama:** [useAgentSchedules](../apps/desktop/src/components/app/useAgentSchedules.ts), [agentScheduleRunner](../apps/desktop/src/components/agents/agentScheduleRunner.ts), [agentSchedule](../apps/desktop/src/components/agents/agentSchedule.ts).
- **E17 — Test ve kalite:** [desktop tests](../apps/desktop/tests), [runtime tests](../packages/agent-runtime/test), [CI](../.github/workflows/ci.yml), [UI responsiveness](UI_RESPONSIVENESS.md).
- **E18 — Yayın ve tanıtım:** [What's New registry](../apps/desktop/src/lib/whatsnew/registry.ts), [site](../apps/site/src), [release workflow](../.github/workflows/release.yml), [release doğrulama](../scripts/verify-release.mjs), [ana roadmap](../ROADMAP.md).
