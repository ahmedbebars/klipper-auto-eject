[klipper-auto-eject](../../README.md) › [العربية](README.md) › التثبيت

# التثبيت

هناك ثلاث طرق لتثبيت klipper-auto-eject. كلها تنتهي بالنتيجة نفسها: ملفان في مجلد إعدادات Klipper:

| الملف | وظيفته | يتحدّث تلقائيًا؟ |
|---|---|---|
| `auto_eject.cfg` | الماكروهات | نعم (هو رابط إلى المستودع) |
| `auto_eject_settings.cfg` | إعداداتك | **أبدًا.** هذا ملفك أنت، عدّله كما تريد |

## الطريقة الأولى: سكربت التثبيت (الموصى بها)

افتح طرفية على الطابعة عبر SSH. على Windows استخدم PowerShell واكتب `ssh pi@<printer address>`، وضع اسم المستخدم في طابعتك بدل `pi`. ثم الصق هذا السطر:

```bash
cd ~ && git clone https://github.com/ahmedbebars/klipper-auto-eject.git && ./klipper-auto-eject/install.sh
```

يسألك السكربت بعض الأسئلة أولًا. اضغط **Enter** لتقبل الإجابة المقترحة (وهي الحرف الكبير بين القوسين):

```text
[auto-eject] Will this printer push its prints off with the blade? (No: only the web page or the farm) [Y/n]
[auto-eject] Add the auto-eject page to Mainsail (bed map, print queue, settings)? [Y/n]
[auto-eject] Watch and control the printer from your phone, from anywhere? (a free Tailscale account) [y/N]
[auto-eject] Notifications on your phone when the printer needs you? [Y/n]
[auto-eject] More than one Klipper printer? See them all on one page (printer farm)? [y/N]
```

تظهر الأسئلة بالإنجليزية كما في الأعلى. هذا معنى كل سؤال:

| السؤال | معناه | الإجابة عند ضغط Enter |
|---|---|---|
| `Will this printer push its prints off with the blade?` | هل ستدفع هذه الطابعة طبعاتها خارج السرير بالشفرة؟ أجب بـ «لا» إذا كنت تريد صفحة الويب أو مزرعة الطابعات فقط | نعم |
| `Add the auto-eject page to Mainsail?` | هل تضيف صفحة الإزالة التلقائية إلى Mainsail؟ فيها خريطة السرير وقائمة الطباعة والإعدادات | نعم |
| `Watch and control the printer from your phone, from anywhere?` | هل تريد مشاهدة الطابعة والتحكم فيها من هاتفك من أي مكان؟ يحتاج ذلك حساب Tailscale مجانيًا | لا |
| `Notifications on your phone when the printer needs you?` | هل تريد إشعارات على هاتفك عندما تحتاجك الطابعة؟ | نعم |
| `More than one Klipper printer? See them all on one page?` | هل عندك أكثر من طابعة Klipper؟ هل تريد رؤيتها كلها في صفحة واحدة (مزرعة الطابعات)؟ | لا |

`[Y/n]` تعني أن الإجابة المقترحة هي «نعم»، و`[y/N]` تعني أنها «لا». اكتب `y` لنعم أو `n` للا، ثم اضغط Enter.

بعد ذلك يقوم السكربت بما يلي:

1. يضع رابطًا لـ `auto_eject.cfg` في مجلد الإعدادات، وينشئ `auto_eject_settings.cfg`، وهو ملف إعداداتك
   الخاص الذي لا تغيّره التحديثات أبدًا.
2. يضيف أسطر `[include]` إلى `printer.cfg`، فوق كتلة `SAVE_CONFIG`.
3. يضيف أقسام Klipper التي تحتاجها الإزالة التلقائية إذا لم تكن في إعداداتك
   ([انظر بالأسفل](#ما-يحتاجه-printercfg)).
4. يضيف قسم `[update_manager klipper-auto-eject]` إلى `moonraker.conf`، فتصلك التحديثات من لوحة
   التحديثات في Mainsail أو Fluidd.
5. يجهّز ما أجبت عنه بنعم: صفحة الويب، والوصول من الهاتف، والإشعارات، ومزرعة الطابعات.
6. يعرض عليك إعادة تشغيل Klipper، ولا يفعلها إلا إذا كانت الطابعة لا تطبع.
7. يخبرك بالخطوة التالية: ركّب الشفرة وشغّل الإعداد الموجّه.

قبل أن يغيّر السكربت أي ملف، يحفظ منه نسخة احتياطية (`printer.cfg.bak-auto-eject-<date>`). لا يعمل
السكربت بصلاحيات root أبدًا، ويطلب كلمة المرور (`sudo`) فقط من أجل صفحة الويب وخدمة الإشعارات. يمكنك
تشغيله مرة أخرى في أي وقت، وما جُهّز من قبل يبقى كما هو.

### ما يحتاجه printer.cfg

تستخدم الإزالة التلقائية ثلاثة أقسام من Klipper. أغلب الإعدادات فيها هذه الأقسام بالفعل (ملفات `*.cfg`
الخاصة بـ Mainsail وFluidd فيها `[respond]`)، والسكربت يضيف الناقص منها:

```ini
[exclude_object]       # where every part is, from the sliced file
[respond]              # messages and dialogs in the console
[save_variables]       # remembers the parts across restarts
filename: ~/printer_data/config/variables.cfg
```

معنى كل قسم:

- `[exclude_object]`: يعرف مكان كل قطعة على السرير من الملف الذي جهّزه برنامج التقطيع.
- `[respond]`: يعرض الرسائل والنوافذ في الكونسول.
- `[save_variables]`: يتذكر القطع الموجودة على السرير حتى بعد إعادة التشغيل.

### خيارات السكربت

| الخيار | القيمة الافتراضية | استخدمه عندما |
|---|---|---|
| `-c`, `--config-dir DIR` | `~/printer_data/config` | عندك أكثر من نسخة Klipper على الجهاز نفسه، أو مجلد إعدادات قديم بالشكل `~/klipper_config` |
| `-r`, `--repo-dir DIR` | `~/klipper-auto-eject` | تريد وضع المستودع في مكان آخر |
| `-b`, `--branch NAME` | `main` | تريد تجربة فرع تطوير |
| `--no-include` | | تدير أسطر `[include]` بنفسك |
| `--no-update-manager` | | لا تستخدم Moonraker، أو تدير `moonraker.conf` بنفسك |
| `-w`, `--web` | | تريد أيضًا تجهيز صفحة الويب على `http://<printer>/auto-eject/` ورابطها في القائمة الجانبية في Mainsail. يحتاج `sudo` مرة واحدة من أجل nginx ([web-page.md](web-page.md)) |
| `-R`, `--remote` | | تريد أيضًا تجهيز الوصول عن بعد عبر Tailscale، لتفتح الطابعة من هاتفك من أي مكان. يسأل قبل كل خطوة ([remote-access.md](remote-access.md)) |
| `-P`, `--push` | | تريد أيضًا تثبيت خدمة `klipper-auto-eject`: فتصل الإشعارات إلى تطبيق الإزالة التلقائية حتى وهو مغلق، وتعمل مزرعة الطابعات. الإشعارات تحتاج HTTPS (`--remote`)، و`sudo` مرة واحدة ([notifications.md](notifications.md)) |
| `-F`, `--farm` | | تريد كل طابعاتك في صفحة واحدة: يجهّز صفحة الويب وخدمة `klipper-auto-eject` التي تجد الطابعات الأخرى على الشبكة. الطابعات الأخرى لا تحتاج أي تثبيت ([farm.md](farm.md)) |
| `-N`, `--notify` | | تريد أيضًا إرسال إشعارات إلى هاتفك عبر ntfy: قطعة ما زالت على السرير، أو طباعة انتهت. يسأل قبل كل خطوة ([notifications.md](notifications.md)) |
| `-u`, `--uninstall` | | تريد إزالة ما أضافه السكربت: الرابط، وأسطر include، وقسم مدير التحديثات، وصفحة الويب، ونطاق Tailscale الذي أضافه إلى `trusted_clients` |

مثال لطابعة ثانية تعمل كنسخة Klipper أخرى على الجهاز نفسه:

```bash
./klipper-auto-eject/install.sh --config-dir ~/printer_2_data/config
```

## الطريقة الثانية: التثبيت اليدوي

1. انسخ `config/auto_eject.cfg` و`config/auto_eject_settings.cfg` إلى مجلد الإعدادات
   (مثلًا ارفعهما من Mainsail أو Fluidd).
2. أضف إلى `printer.cfg`:
   ```ini
   [include auto_eject.cfg]
   [include auto_eject_settings.cfg]
   ```
3. تأكد أن في `printer.cfg` قسم `[exclude_object]`.
4. نفّذ `FIRMWARE_RESTART`.

في هذه الطريقة ستحتاج إلى استبدال `auto_eject.cfg` بيدك عند كل تحديث.

## الطريقة الثالثة: مدير التحديثات في Moonraker فقط

إذا نسخت المستودع بنفسك ووضعت رابطًا لـ `auto_eject.cfg`، أضف هذا إلى `moonraker.conf` لتصلك
التحديثات من لوحة التحديثات في Mainsail أو Fluidd:

```ini
[update_manager klipper-auto-eject]
type: git_repo
path: ~/klipper-auto-eject
origin: https://github.com/ahmedbebars/klipper-auto-eject.git
primary_branch: main
is_system_service: False
```

بعدها أعد تشغيل Moonraker.

## بعد التثبيت

- تأكد أن في `printer.cfg` هذه الأقسام، وأضف الناقص منها:
  ```ini
  [exclude_object]
  [respond]
  [save_variables]
  filename: ~/printer_data/config/variables.cfg
  ```
- فعّل **Label objects** في برنامج التقطيع (OrcaSlicer: *Process → Others → Label objects*؛
  PrusaSlicer: *Print Settings → Output options → Label objects: Firmware-specific*).
- اضبط الشفرة: انظر [hardware.md](../hardware.md) (بالإنجليزية) و[configuration.md](../configuration.md)
  (بالإنجليزية).

## التحديث

- **من Moonraker:** اضغط *Update* بجانب `klipper-auto-eject` في لوحة التحديثات.
- **من الطرفية:** `git -C ~/klipper-auto-eject pull`

بعدها نفّذ `FIRMWARE_RESTART`. التحديثات لا تلمس ملف `auto_eject_settings.cfg` أبدًا. الإعدادات الجديدة
تعمل فورًا بقيمها الافتراضية، والملف [CHANGELOG.md](../../CHANGELOG.md) (بالإنجليزية) يذكرها إذا أردت
تغييرها.

## إلغاء التثبيت

```bash
~/klipper-auto-eject/install.sh --uninstall
rm -rf ~/klipper-auto-eject                      # optional
rm ~/printer_data/config/auto_eject_settings.cfg # optional
```

السطر الأول يلغي التثبيت. السطران الأخيران اختياريان: الأول يحذف المستودع، والثاني يحذف ملف إعداداتك.
