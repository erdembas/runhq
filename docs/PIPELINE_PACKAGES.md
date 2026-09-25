# Workflow paketleri

**Workflows → Import workflow / İş akışı içe aktar** üzerinden JSON veya ZIP seçin. Paket mevcut Workflow editöründe düzenlenebilir bir taslak olarak açılır; ajan veya betik çalıştırmaz. Depoları, dalları ve paket kontrolünü inceleyin; her adımın ajanını, modelini, effort değerini, promptunu ve yürütme ayarlarını aynı editörde değiştirin. **Create workflow / İş akışı oluştur** ile kaydedin ve Workflow üzerinden başlatın.

Paket içe aktarma ayrı bir çalıştırma motoru kullanmaz. Paket adımları mevcut Workflow grafiğine çevrilir; onay, koşul, inceleme turları, doğrulama ve kilitler aynı scheduler tarafından yürütülür. Recipe kütüphanesine kaydetmek zorunlu değildir. Tekrar kullanılacak bir süreç daha sonra recipe olabilir; skill ise ajanın yönergelerini sağlar.

Recipe JSON dışa aktarımı promptları, depo bağlamını ve yakalanmış paket yolunu korur; betik veya ikili dosyaları JSON içine gömmez. Başka bilgisayarda kullanmak için asıl ZIP/paketi tekrar içe aktarın ve geçerli yerel depo yollarını seçin.

Örnek paket: [`examples/pipeline-package/pipeline.json`](../examples/pipeline-package/pipeline.json). Çalışma yolunu, promptları ve doğrulama betiğini projeye göre doldurun.

## Desteklenen sözleşme

- `version: 1` ve `version: 2`; `settings`, `steps`, açıklama amaçlı `semantics`. JSON için göreli `promptFile`, `assets`; v2 `package.contents` içindeki dosyalar/klasörler. ZIP kökünde veya tek bir üst klasör altında `pipeline.json` bulunabilir.
- Paket dosyaları `RUNHQ_HOME/workflow-packages/<capture-id>/package` klasörüne kopyalanır. Kaynak dosyanın sonraki değişiklikleri taslağı etkilemez. `package.install` **çalıştırılmaz**; `generate.mjs` dahil hiçbir paket programı içe aktarma sırasında yürütülmez. İçe aktarma proje kaydı veya çalıştırma kaydı oluşturmaz.
- `agent`, `shell`, `human`, `barrier`; en fazla 512 adım, 16 MiB açılmış paket, 1.024 arşiv girdisi. Bilinmeyen alanlar veya desteklenmeyen koşullar sessizce düşürülmez.
- Çoklu `dependsOn`, `runIf`, `completeIf`, barrier için ifade biçiminde `haltIf`. İfadeler `.verdict` ve `.runCount` üzerinden `== != >= > <= <`, `&& || !` ve parantez kullanır. JavaScript çalıştırılmaz. Başvurular ön koşulların incelemelerine ait olmalıdır.
- `success.outputRegex` / `haltIf.outputRegex`: yanıtın tamamındaki bağımsız sonuç satırları. `lastLineRegex`: yalnız son dolu satır. `capture.verdict` bir regex metni veya `{ "lastLineRegex": "^REVIEW_VERDICT: (PASS|CONDITIONAL|FAIL)$", "group": 1 }` olabilir.
- Eksik, birden fazla veya geçersiz sonuç başarısızdır. `PIPELINE_RESULT: BLOCKED` / `FAILED` başarıya üstün gelir. Shell sonucu `exitCode` / `exitCodeNot` ile değerlendirilir.
- `onSuccess.rerun`: düzeltmeye bağlı shell doğrulamasından incelemeye geri dönüş. `maxRuns` üst sınırı ve tur bazlı koşullar uygulanır. Her deneme ve rapor ayrı kaydedilir. Teknik hata sonrası elle yeniden deneme yeni inceleme turu tüketmez.
- İnceleme sınırı otomatik düzeltmeleri durdurur. Workflow ekranından ilgili adımın kayıtlarını ve çalışma alanını inceleyin; devam etmek için açık bir kullanıcı işlemi gerekir.
- `human` yeni adımları durdurur ve açık kullanıcı onayı bekler. Eskimiş ekran durumuyla gönderilen onay reddedilir.
- `lock` aynı RunHQ örneğindeki akışlarla ortak tekil kaynaktır (`maxConcurrent: 1`). Asıl çalışma alanına yazan işler ayrıca aynı anda tek çalışır. Ayrı inceleme kopyaları paralel çalışabilir. `maxConcurrentUnlockedSteps`, düzenlenebilir Workflow eşzamanlılık sınırının başlangıç değeridir; genel sağlayıcı kapasitesi de uygulanır.
- Hata halinde yeni iş başlatılmaz, çalışan diğer işler tamamlanır. Başarısız adım elle yeniden çalıştırılır. Uygulama yeniden açıldığında kesilmiş işler otomatik tekrar edilmez; kurtarma durumu gösterilir.
- `agentTimeoutMinutes`, `shellTimeoutMinutes`, adımda `timeoutMinutes`: 1–10.080 dakika; 240 dakika desteklenir. Bağlantının kendi süre/hesap sınırları ayrıca geçerlidir.
- Adımda `backend`, `model`, `effort`, `mode`; boş değerler seçilen bağlantının varsayılanını kullanır. İncelemeler Codex/Claude bağlantısında zorunlu salt okunur modda çalışır. Genel izin listesi bu sürümde `read`, `write`, `terminal` üçlüsüdür; farklı izin profilleri reddedilir.
- `settings.repositories` ile ad, mutlak yol ve dal açıkça belirtilebilir. Yoksa çalışma kökü veya doğrudan altındaki Git depoları bulunur (1–16 depo). Birden fazla depo bulunduğunda başlatmak için `settings.repositories` içinde hedeflerin açıkça listelenmesi gerekir. Başlatırken dal ve temiz çalışma ağacı kontrol edilir. Yerel depolara doğrudan yazılır; otomatik merge/push yapılmaz.

`review.maxReviewsPerPlan` ve `maxFixesPerPlan` üst sınırları doğrular. `acceptConditionalFromReview` / `strictPlans` açıklanan politikanın metadata alanlarıdır; kabul davranışını adımlardaki açık `runIf` / `completeIf` / `haltIf` ifadeleri belirler. `semantics` de yürütülebilir kod değildir.

## Prompt ve betik sözleşmesi

- `RUNHQ_PACKAGE_ROOT`: içe alınmış paket dosyaları.
- `RUNHQ_WORKSPACE_ROOT`: uygulama/düzeltme ve shell adımlarında asıl kod çalışma klasörü; bağımsız inceleyicide o tur için yakalanmış salt okunur kopya.
- `PIPELINE_HOME`: bu Workflow'un çalışma kayıtları ve inceleme kopyaları için klasör (`RUNHQ_HOME/workflow-runs/<workflow-id>`). Adım sonuçları ve deneme geçmişi Workflow kaydında saklanır.
- Shell çalışma klasörü, `settings.shellWorkingDirectory` ile paket içinde belirlenir; varsayılan `.`.
- Ön koşul sonuçları, kapı arkasındaki uygulama raporu, önceki deneme çıktısı ve mantıksal tur ajana bağlam olarak verilir. Çözümlenmiş paket/çalışma/kayıt yolları ayrıca JSON olarak sağlanır; dosya okuma araçlarının ortam değişkeni genişletmesine gerek kalmaz. İnceleyiciye uygulama başlangıcı ile yakalanan sürüm arasındaki dosya değişiklikleri ve sürüm kimlikleri de verilir. Dosya isimlerini tahmin ederek ayrı bir tur sayacı kurmayın.
- İnceleme kopyaları doğrulama adımında yakalanan depo ağaçlarından oluşturulur; sonradan yapılan değişiklikler bu incelemeye karışmaz. Yakalama, commit edilmemiş değişiklikleri de içerebilir ve hedef dalı değiştirmez. Test/build işlemi shell kapısında çalışmalıdır; inceleyici kapı çıktısını ve kodu inceler. Claude inceleyici terminal kullanamaz, Codex salt okunur sandbox kullanır.
- İnceleme ajanına worktree oluşturma/silme, `state.sh` ile sayaç artırma, rapor yazma veya build çıktısı üretme görevi vermeyin. Son yanıtta rapor ve tek karar satırı döndürsün. RunHQ yanıtı ilgili adımın deneme kaydında saklar; rapor dosya adı varsaymayın. İnceleme worktree'leri inceleme için korunur; otomatik disk temizleme bu değişikliğin kapsamı dışındadır.
- Durma/onay bildirimleri RunHQ bildirim tercihlerine ve işletim sistemi iznine uyar. Bildirim kapalı olsa da durum akış ekranında kalır.
