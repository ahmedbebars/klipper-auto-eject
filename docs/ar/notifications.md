[klipper-auto-eject](../../README.md) › [العربية](README.md) › الإشعارات

# الإشعارات

رسالة على هاتفك عندما تحتاجك الطابعة. وإن أردت، رسالة أيضًا عند انتهاء كل طباعة.

| يصلك إشعار عندما… | |
|---|---|
| تبقى قطعة على السرير بعد الإزالة ومحاولات إعادتها | تتوقف قائمة الطباعة |
| تكون الطبعة أرفع من أن تمسكها الشفرة، فتُترك على السرير | تنتظرك قائمة الطباعة |
| تنتهي طباعة دون إزالة (لا يوجد `AUTO_EJECT` في كود النهاية، أو أُلغيت الطباعة) | القطع ما زالت على السرير |
| لا تبدأ الطباعة التالية لأن قطعًا قديمة ما زالت على السرير | [الحارس `AUTO_EJECT_GUARD`](../recovery.md#the-guard-auto_eject_guard) (بالإنجليزية) |
| تتوقف طباعة بخطأ، أو تُلغى | |
| تنتهي كل طباعة (اختياري) | مع `AUTO_EJECT` في كود النهاية، يصل هذا الإشعار بعد أن يصبح السرير فارغًا |

الضغط على الإشعار يفتح صفحة auto-eject. ومع [مزرعة الطابعات](farm.md)، يستقبل التطبيق أيضًا
إشعارات كل الطابعات الأخرى في المزرعة، وعلى كل إشعار اسم طابعته.

توجد طريقتان لاستقبالها:

| | [في تطبيق auto-eject](#في-تطبيق-auto-eject-الموصى-به) | [عبر ntfy](#عبر-ntfy) |
|---|---|---|
| تطبيق آخر على الهاتف | لا: الإشعارات تأتي من تطبيق auto-eject نفسه | تطبيق ntfy المجاني |
| والتطبيق مغلق | نعم | نعم |
| يحتاج | HTTPS ([remote-access.md](remote-access.md#https))، و`sudo` مرة واحدة | لا شيء آخر |
| من يستطيع قراءة الرسائل | أجهزتك فقط: الرسائل مشفّرة من طرف إلى طرف | أي شخص يعرف اسم الموضوع (topic) |
| Telegram وDiscord والبريد الإلكتروني… | لا | نعم، عبر Apprise |

## في تطبيق auto-eject (الموصى به)

خدمة صغيرة على الطابعة تراقبها، وترسل كل إشعار مشفّرًا إلى خدمة الإشعارات (push) لكل جهاز فعّلها:
خدمة Google لـ Chrome وAndroid، وخدمة Apple لـ iPhone وiPad، وخدمة Mozilla لـ Firefox. تعمل
والتطبيق مغلق، بل وحتى عندما يكون Tailscale مطفأً في الهاتف: فتح التطبيق فقط هو الذي يحتاج
Tailscale.

1. اضبط أولًا [التحكم عن بعد مع HTTPS](remote-access.md): الهواتف لا تسمح بالإشعارات إلا عبر
   HTTPS.
2. **على الطابعة**، عبر SSH:
   ```bash
   ~/klipper-auto-eject/install.sh --push
   ```
   يثبّت خدمة `klipper-auto-eject` (وتُثبَّت حزمة `cryptography` الخاصة بـ Python في
   `~/klipper-auto-eject-env` إن لم تكن موجودة)، ويسمح لـ Moonraker بإعادة تشغيلها بعد التحديثات.
   يطلب كلمة المرور مرة واحدة.
3. **على الهاتف**، افتح تطبيق auto-eject عبر HTTPS، ثم تبويب **الشفرة والإعداد**، ثم
   **الإشعارات**، ثم **تفعيل**، واسمح بالإشعارات. سيصلك إشعار تجريبي.
4. كرّر ذلك على كل هاتف أو جهاز لوحي أو حاسوب تريد أن تصله الإشعارات. كل جهاز يختار وحده هل يريد
   أيضًا إشعارًا عند انتهاء كل طباعة.

| الجهاز | هل يعمل |
|---|---|
| Android: Chrome وEdge وSamsung Internet وFirefox | نعم، سواء ثُبّت كتطبيق أو لا |
| iPhone وiPad | iOS 16.4 أو أحدث، وفقط في التطبيق [المضاف إلى الشاشة الرئيسية](web-page.md) |
| الحواسيب: Chrome وEdge وFirefox وSafari | نعم، طالما المتصفح يعمل |

كيف يعمل: يشترك الجهاز عبر متصفحه، ويُحفظ الاشتراك في قاعدة بيانات Moonraker (namespace
`auto_eject_push`)، لذلك لا تحتاج الخدمة منفذًا خاصًا بها. كل رسالة تُشفَّر لهذا الجهاز وحده
([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291))، وخدمات الإشعارات تنقلها دون أن تستطيع قراءتها.
مفتاح الخدمة نفسها يبقى في `~/.config/klipper-auto-eject/vapid.pem`. وسجلّها:
`journalctl -u klipper-auto-eject`.

## عبر ntfy

تمر الإشعارات عبر [ntfy](https://ntfy.sh)، وهو تطبيق إشعارات مجاني ومفتوح المصدر.

1. **على الطابعة**، عبر SSH:
   ```bash
   ~/klipper-auto-eject/install.sh --notify
   ```
   يسألك قبل كل خطوة:
   - هل ترسل الإشعارات عبر ntfy،
   - هل تريد أيضًا إشعارًا عند انتهاء كل طباعة،
   - وفي النهاية، هل يرسل إشعارًا تجريبيًا.

   يضيف قسمين `[notifier]` إلى `moonraker.conf` (بعد أخذ نسخة احتياطية)، ويعيد تشغيل Moonraker
   عندما لا تكون الطابعة مشغولة، ويضبط إعداد auto-eject المسمى `notify` على `auto_eject`. وفي
   النهاية يعرض **الموضوع (topic)** الخاص بك، وهو اسم عشوائي مثل `auto-eject-3f9a1c2b7d4e5f60`.
2. **على هاتفك**، ثبّت تطبيق ntfy (من Google Play أو F-Droid أو App Store)، واضغط **+**، ثم
   اشترك في هذا الموضوع على الخادم الافتراضي `ntfy.sh`.
3. يمكنك تشغيل المثبّت مرة أخرى في أي وقت: يحتفظ بالموضوع نفسه.

**نجح الإعداد إذا** وصل الإشعار التجريبي إلى الهاتف. أرسل إشعارًا تجريبيًا آخر في أي وقت بالأمر
`AUTO_EJECT_NOTIFY_TEST` في نافذة الأوامر (console)، أو بزر **أرسل تجربة** في الصفحة. يمر الإشعار
بالطريق كله، من Klipper عبر Moonraker إلى الهاتف، بكل طريقة مضبوطة من الطريقتين.

تعرض صفحة auto-eject الموضوع في تبويب **الشفرة والإعداد**، مع زر يفتحه في تطبيق ntfy.

## احتفظ بالموضوع لنفسك

على الخادم العام `ntfy.sh`، أي شخص يعرف اسم موضوع يستطيع قراءة رسائله. لذلك يختار المثبّت اسمًا
عشوائيًا لا يمكن تخمينه، فلا تنشره في أي مكان. الرسائل فيها أسماء الملفات وأسماء القطع فقط، ولا شيء
غير ذلك.

لتُبقي كل شيء على شبكتك أنت، [شغّل خادم ntfy خاصًا بك](https://docs.ntfy.sh/install/) وغيّر أسطر
`url:` في `moonraker.conf`:

```ini
url: ntfys://user:password@ntfy.example.com/auto-eject-3f9a1c2b7d4e5f60?priority=high&tags=warning
```

## Telegram وDiscord والبريد الإلكتروني وغيرها

يرسل Moonraker الإشعارات عبر [Apprise](https://github.com/caronc/apprise/wiki)، الذي يعرف حوالي
100 خدمة. ضع أي رابط Apprise في سطر `url:` في القسمين، مثل `tgram://<bot-token>/<chat-id>`
لـ Telegram، ثم أعد تشغيل Moonraker.

## باليد، بدون المثبت

```ini
# moonraker.conf
[notifier auto_eject]
url: ntfys://<your-topic>?priority=high&tags=warning
events: gcode
title: Auto-eject
body: {event_message}

[notifier auto_eject_jobs]
url: ntfys://<your-topic>?tags=printer
events: complete, error, cancelled
title: Print {event_name}
body: {event_args[1].filename}{(': ' ~ event_args[1].message) if event_args[1].message else ''}
```

أعد تشغيل Moonraker، ثم أخبر auto-eject أي notifier يستخدم، بهذا الأمر في نافذة الأوامر:

```gcode
AUTO_EJECT_SET KEY=notify VALUE=auto_eject
```

القسم `[notifier auto_eject]` يستقبل رسائل auto-eject (`events: gcode`)، والقسم
`[notifier auto_eject_jobs]` يستقبل أحداث Moonraker نفسه عن الطباعات الكاملة. احذف القسم الثاني إن
كنت تريد أن تعرف بالمشاكل فقط.

## بدون الخدمة

بدون `install.sh --push`، يبقى زر **تفعيل** يعمل طالما تطبيق auto-eject مفتوح أو يعمل في الخلفية:
الصفحة نفسها تعرض الإشعارات. أما عندما يكون التطبيق مغلقًا، فلا يصل إليك إلا الخدمة أو ntfy.

## Mobileraker

لتطبيق [Mobileraker](https://mobileraker.app) إشعاراته الخاصة عن الطباعات والأخطاء، عندما يكون
البرنامج المرافق له مثبتًا على الطابعة ([remote-access.md](remote-access.md#تطبيقات-الهاتف-والكاميرا)).
ويعمل إلى جانب ntfy.

## المشاكل وحلولها

| ما تراه | ما تفعله |
|---|---|
| لا يوجد زر **تفعيل** في التطبيق | الصفحة ليست على HTTPS ([remote-access.md](remote-access.md#https))، أو الإشعارات محظورة لها في إعدادات الموقع في المتصفح |
| يعرض التطبيق أن الإشعارات **مفعّلة والتطبيق يعمل** فقط | الخدمة غير مثبتة أو لا تعمل: شغّل `install.sh --push`، ثم `systemctl status klipper-auto-eject` |
| لا يصل أي شيء على iPhone | أضف التطبيق إلى الشاشة الرئيسية، وفعّل الإشعارات من هناك (iOS 16.4 أو أحدث) |
| الإشعار التجريبي لا يصل | في تطبيق ntfy، تأكد من الموضوع والخادم (`ntfy.sh`). وعلى الطابعة، يجب أن يصل الأمر `curl -d test https://ntfy.sh/<topic>` إلى الهاتف |
| التجربة تعمل، لكن لا يصل شيء من الطابعة | لم يُعَد تشغيل Moonraker بعد التغيير، أو `notify` غير مضبوط: `AUTO_EJECT_SET KEY=notify VALUE=auto_eject` |
| `Remote method 'notify' not registered` | `notify` يشير إلى notifier غير موجود في Moonraker. راجع أسماء الأقسام في `moonraker.conf`، أو أرجع `notify` إلى `""` |
| إشعارات كثيرة جدًا | شغّل `install.sh --notify` مرة أخرى، وأجب بـ «لا» عند سؤاله عن إشعار لكل طباعة |
