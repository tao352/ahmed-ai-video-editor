# CapCut بيعمل التايملاين إزاي، وناخد منه إيه (2026-10-24)

اتفحص CapCut 9.6.0.4097 المتسطب في `D:\lone00\CapCut` ومشاريعه في
`%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft`. الطريقة على خطى
سكيل REA (`~/.claude/skills/reverse-engineer-anything`): كل نقطة مكتوب جنبها هي
**اتشافت** (من ملف أو نص جوه البرنامج) ولا **استنتاج**. أداة REA نفسها (`npx rea-agents`)
اترفضت من صلاحيات الجهاز، فالفحص اتعمل بقراءة الملفات والنصوص اللي جوه الـ DLLs.

## 1. شكل البرنامج (اتشاف)
- Qt 6 + QML. الواجهة جوه `VECreator.dll` (271 MB) كملفات QML مضغوطة جوه البرنامج:
  `qrc:/TimeLine/main/MainTimelineDocker.qml`، `MainMultiTimelineLayout.qml`،
  `qrc:/TimeLine/track/MainTimeLineTrackAudioAdsorb.qml`... (نصوص الـ QML نفسها مش مقروءة من غير فك الـ qrc).
- محرك التعديل `clipflow` (`clipflow::shell::RippleMoveNode`، `RippleDeleteNode`).
- فيه CLI داخلي للوكلاء `lyra-cli-ipc` وسكيل `Resources/common_agent/skills/timeline-draft-cli/SKILL.md`.
- أداة `Tools/draft-converter` (OpenTimelineIO 0.18 + أدابترز AAF و FCP XML و FCPX XML).

## 2. ملف المشروع `draft_content.json` (اتشاف)
- **الوقت أعداد صحيحة بالميكروثانية** (`duration = 34233333`). مفيش كسور ولا تقريب.
- `tracks[]`: لكل تراك `type` (video / text / audio / effect / sticker)، و`name`، و`flag`، و`segments[]`.
- كل `segment`:
  - `target_timerange {start, duration}`: مكانه على التايملاين.
  - `source_timerange {start, duration}`: الجزء المتاخد من الملف الأصلي.
  - `speed`، `volume`، `visible`، `reverse`، `clip {scale, rotation, transform, flip, alpha}`.
  - `material_id`: الملف/النص نفسه في `materials.<kind>[]`.
  - `extra_material_refs[]`: حاجات متركبة على المقطع (سرعة، خلفية canvas، أنيميشن، beats...) كل واحدة material لوحدها.
  - `render_index` و`track_render_index`: ترتيب الطبقات (رقم التراك × 1000 + ترتيب المقطع).
  - `group_id`: مقاطع متجمعة مع بعض.
  - `common_keyframes` و`keyframe_refs`: الكي فريمز.
- `materials.beats[]`: لكل صوت `ai_beats` و`user_beats` و`user_delete_ai_beats` و`enable_ai_beats`.
  يعني الإيقاع جزء من الملف، والمستخدم يقدر يزود أو يشيل نقط.
- `config.maintrack_adsorb: true`: مغناطيس التراك الأساسي (التراك الأساسي يفضل لازق من غير فراغات).
- `config.subtitle_sync`: الكابشن ماشي مع الكلام.
- `time_marks`: ماركرز على التايملاين.
- `timeline_layout.json` و`Timelines/<id>/draft_content.json`: المشروع الواحد ممكن يبقى فيه كذا تايملاين.
- `.bak` لكل draft: نسخة احتياطية قبل كل حفظ.

## 3. سلوك التايملاين (أسامي اتشافت جوه `VECreator.dll`، والتفسير استنتاج)
| الميزة | الدليل | معناها |
|---|---|---|
| مغناطيس التراك الأساسي | `main_track_magnet_on.svg`، `setMainTrackAdsorb`، `turn_off_the_main_rail_magnet` | لما تمسح أو تحرك في التراك الأساسي، الباقي يقفل الفراغ لوحده |
| Snap (لزق) | `btnOpenAdsorb.svg`، `IMainTimeLineAdsorbModel` | زرار منفصل عن مغناطيس التراك الأساسي |
| الربط (Linkage) | `MainTimeLineLinkageModel`، `linkageGetDependents`، `GlobalLinkageSettingDialog.qml`، `ignoreLinkageSubtitle` | النصوص والأوفرلاي متعلقة بمقطع في التراك الأساسي. تحرّك المقطع، يتحركوا معاه. وتقدر تختار أنواع الحاجات اللي تتربط |
| Preview axis | `MainTimeLinePreviewAxis`، `previewAxisEnabled` | لما الماوس يعدّي على التايملاين، البريفيو يعرض الفريم اللي تحته من غير ما يحرك الـ playhead |
| تحديد ناحية | `timeline_op_mode_select_left / select_right` | يحدد كل اللي قبل الـ playhead أو بعده عشان تزقهم مرة واحدة |
| وضع المقص | `timeline_op_mode_split` | أداة blade تقص بالضغط مكان ما تدوس |
| قفل / إخفاء / كتم التراك | `isTrackLockedChanged`، `timeline_hide_track`، `timeline_cli_track_locked` | لكل تراك |
| جروب | `timeline_segment_create_group / remove_group` | تحديد واحد يحدد الجروب كله |
| Beats | `timeline_audio_beat_add / delete / clear`، `ai_beat_one / two / melody` | نقط إيقاع على المزيكا والـ snap بيلزق عليها |
| تراك مؤقت وقت السحب | `temp_main_track`، `temp_adsorb_track` | تسحب مقطع فوق أو تحت فيظهر تراك جديد |
| الصوت تحت | `bottomAdsorb`، `MainTimeLineTrackAudioAdsorb` | تراكات الصوت لازقة في تحت اللوحة |
| زوم | `timelineZoomRatio`، `zoomTimelineIn/Out` | — |

## 4. إزاي الوكيل بيعدّل التايملاين (اتشاف من `timeline-draft-cli/SKILL.md`)
- كل تعديل فيه `--dry-run` الأول: فحص من غير كتابة، وبيرجّع `timeline_revision`.
- بعدها التنفيذ بـ `--expected-timeline-revision` و`--request-id`. لو حد غيّر الملف في النص، يرفض بـ `conflict`. ونفس الـ request-id مايتنفذش مرتين.
- طرق الحطّ: `append` (في الآخر)، `at + ripple` (يقص عند النقطة ويزق الباقي)، `at + overwrite` (يمسح المنطقة ويحط مكانها، وده بس لو المستخدم طلبه صراحة).
- بيرجّع `added_segment_ids` و`removed_segment_ids`.
- أخطاء واضحة: `track_locked`، `busy`، `rollback_failed`.

## 5. مقارنة بالمحرر بتاعنا
| | CapCut | إحنا |
|---|---|---|
| الوقت | ميكروثانية، أعداد صحيحة | ثواني كسور مقرّبة لـ 1ms (`round`) |
| تراكات | عامة بأي نوع وبأسماء | lanes ثابتة حسب النوع + `track` رقم للـ clips |
| مصدر / مكان | `source_timerange` + `target_timerange` لكل مقطع | `base[]` فيها `sourceIn` (نفس الفكرة للفيديو بس) |
| Ripple | موجود | موجود (`rippleDelete`، `splitBase`)، وبيزق كل حاجة بعده |
| Snap | موجود | موجود (`snapPoints`، N) |
| Linkage | موجود | مفيش ربط حقيقي، كل حاجة بتتزق مع الـ ripple بس |
| Preview axis | موجود | مفيش |
| تحديد ناحية / blade / قفل / إخفاء / كتم / جروب | موجود | مفيش |
| Beats | جوه الملف وتقدر تعدّلها | عندنا `tools/edit` بيحسب الـ beats، بس مش ظاهرة في المحرر |
| تعارض مع الوكيل | revision + dry-run + request-id | `meta.rev` + بانر تعارض (من غير dry-run ولا API للوكيل) |
| تصدير | OTIO → Premiere / Resolve / Avid | MP4 بس |

## 6. ناخد إيه (بالترتيب المقترح)
1. **Preview axis**: البريفيو يتبع الماوس على التايملاين. سهل وبيفرق جدًا في الإحساس.
2. **Beats على التايملاين**: تراك يعرض نقط الإيقاع من المزيكا، والـ snap يلزق عليها، و`B` يزود نقطة.
   تتخزن في `audio.music.beats` (اختياري).
3. **تحديد ناحية + أداة المقص**: `[` / `]` يحدد كل اللي قبل أو بعد الـ playhead، و`C` يشغّل وضع blade.
4. **قفل / إخفاء / كتم لكل lane**: `ui.lanes.<key> = {locked, hidden, muted}`. الإخفاء والكتم يأثروا على البريفيو والرندر.
5. **Linkage**: `clips[].link = "<base index أو word index>"`. لما تحرك أو تمسح الحتة الأساسية، اللي مربوط بيها يمشي معاها (مع زرار يقفّل الربط).
6. **API للوكيل زي `lyra-cli-ipc`**: `node editor/scripts/op.mjs <op> --dry-run --expected-rev N`،
   بينادي نفس الدوال اللي في `ops.ts`، وكده Claude يعدّل من غير ما يعيد كتابة الملف كله ومن غير ما يدوس على تعديلات المستخدم.
7. **تصدير OTIO / FCPXML**: تفتح المونتاج في Premiere أو Resolve. (أبعد شوية.)
8. الوقت بالفريمات أو الميكروثانية بدل كسور الثواني: يتأجل، لأنه بيكسر الملفات القديمة.

## 7. مش معروف
- طريقة رسم التايملاين بالظبط (الـ QML مضغوط جوه الـ DLL، ومافكّيناهوش).
- معنى `flag` في التراكات بالظبط (القيم اللي ظهرت 0 و1 و2، وجت من draft اتعمل بسكريبت قبل كده).
- إزاي الـ linkage بيتخزن في الملف (`relationships` كانت فاضية في المشاريع اللي اتفحصت).
