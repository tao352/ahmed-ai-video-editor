# كل ميزات CapCut، وناخد منها إيه (2026-10-24)

تكملة لـ [capcut-timeline.md](capcut-timeline.md). المصادر:
- ملف المشروع (`draft_content.json`، فيه 55 نوع material).
- 745 شاشة QML ليها أسامي جوه `VECreator.dll`، و71 ألف كلمة مفتاحية من نفس الملف.
- فولدر `Resources` (شيدرز الألوان والـ blend والماسك).

**اتشاف** = موجود بالاسم في الملفات. **استنتاج** = تفسيري لاسم الميزة.
الشيدرز والملفات بتاعتهم مش هننسخها. هناخد الفكرة ونبنيها بطريقتنا.

## القاعدة اللي هنمشي عليها
عند CapCut كل حاجة "material" متعلقة على المقطع، والمحرك بتاعه بيرسمها.
عندنا الحقيقة الوحيدة `edit.json`، والرسم Remotion في البريفيو والرندر.
يبقى أي ميزة لازم:
1. تبقى حقل اختياري في `edit.json`، يعدّله Claude بالنص وإنت بالإيد.
2. تترسم في Remotion (CSS / SVG / WebGL)، فاللي في البريفيو هو اللي هيطلع في الرندر بالظبط.
3. لو محتاجة معالجة تقيلة (تنظيف صوت، فصل شخص)، تتعمل مرة واحدة بأداة في `tools/edit` وتطلع ملف في `public/`، والمحرر يشغّلها بزرار.

## 1. الألوان
**عند CapCut (اتشاف):**
- تعديلات أساسية في `DefaultAdjustBundle`: brightness، contrast، saturation، temperature، tone (tint)، highlight، shadow، fade، vignetting، sharpen، particle (grain)، light_sensation، black_white.
- عجلات الألوان: `PrimaryWheel` و`LogWheel` (lift / gamma / gain).
- `Curves` (luma / red / green / blue)، و`hsl` و`hsl_curves` (لكل لون: hue / sat / light مع قطارة).
- LUT import (`.cube`).
- `color_match`: يطابق ألوان مقطع على مقطع تاني.
- `smart_relight`: إضاءة بالـ AI.
- `oscilloscope`: شاشة قياس في البريفيو.
- `AdjustPresetSaveView`: تحفظ التعديل كـ preset.
- كل ده ممكن يبقى على مقطع واحد، أو على "adjustment layer" فوق كذا مقطع.

**عندنا:** `tools/edit/grade.py` (presets جوه ffmpeg بتتطبق وقت الرندر) و`Grade` / `Vignette` / `Grain` في المكونات. مفيش أي حاجة منهم في المحرر.

**ناخد:**
- `grade` على الفيديو كله أو على حتة من الـ base: `{exposure, contrast, saturation, temperature, tint, highlights, shadows, fade, vignette, grain, sharpen}`.
  يترسم بـ SVG filter / WebGL جوه Remotion، ويبقى في المحرر سلايدرز بتغيّر البريفيو على طول.
- **Presets** تتحفظ مع البراند (`studio/user/brands/<brand>/grades.json`)، وتطبّقها بضغطة.
- **LUT** (`.cube`) بشيدر WebGL صغير. أغلب الـ LUTs المجانية تشتغل.
- **مطابقة لون مع ريفرنس:** `tools/edit/reference.py` بيطلّع "DNA" الكرييتور. نخليه يحسب grade يقرّبنا منه.
- **Scopes:** waveform وvectorscope صغيرين جنب البريفيو (canvas). رخيصة وبتفرق لأي حد بيظبط ألوان.
- مؤجَّل: curves، HSL، العجلات.

## 2. الماسكات وفصل الشخص
**عند CapCut (اتشاف):**
- أنواع الماسك: linear، mirror، rectangle، circle (وفي التطبيق heart و star)، text، و`custom_mask_brush`.
- إعدادات الماسك: `mask_feather`، `mask_round_corner`، invert، وكمان rotate و expand.
- `adjust_mask`: تعديل ألوان جوه ماسك بس.
- `keying` / `intelligent_keying` (فصل الشخص)، و`chroma_key` (شاشة خضرا: intensity / shadow / spill / edge_smooth)، و`keying_outline_style` (حدود حوالين الشخص المفصول).
- `mix_mode`: blend modes.
- `video_strokes` و`video_shadows` و`video_radius`: حدود وظل وحواف مدورة لأي مقطع فوق.

**عندنا:** `tools/edit/matte.py` بيعمل `matte.webm` (فصل الشخص) والكابشن ممكن يبقى ورا الشخص، و`mixBlendMode` و`clipPath` جوه بعض المكونات.

**ناخد:**
- `clips[].mask = {shape: rect|circle|linear|mirror, x, y, w, h, rotate, feather, radius, invert}`.
  يترسم بـ CSS `mask-image` / `clip-path`، وتسحبه وتكبّره على الشاشة زي الـ `box` بالظبط.
- `clips[].style = {radius, stroke: {width, color}, shadow: {blur, opacity, y}, blend}`:
  شكل احترافي لأي B-roll أو صورة فوق الفيديو من غير ما نغيّر الكومبوننت.
- زرار **"ورا الشخص"** لأي عنصر (مش الكابشن بس)، باستخدام `matte.webm` اللي عندنا.
- حدود حوالين الشخص المفصول (glow / outline) زي `keying_outline`. ده لوك منتشر جدًا في الريلز.
- مؤجَّل: الماسك بالفرشاة، والتعديل جوه الماسك، والـ chroma key.

## 3. الحركة والمؤثرات
**عند CapCut (اتشاف):**
- لكل عنصر (فيديو / نص / ستيكر / شكل) خانات `animation_in` و`animation_out` و`animation_loop` و`animation_combo`.
- Keyframes على أي خاصية، مع presets للـ ease (`keyframe_preset_ease_in/out`) و"graph" للسرعة (`keyframes_graph_panel`).
- `curve_speed` (منحنى سرعة، speed ramp)، `freeze` (تجميد فريم)، `reverse`، `motion_blur` (درجة واتجاه)، `deflicker`، `stabilization`.
- `motion_tracking` و`camera_tracking`: نص أو ستيكر بيمشي مع حاجة في الفيديو.
- `reference_line` و`safe_area`: خطوط إرشاد ومنطقة آمنة للمنصة في البريفيو.
- المؤثرات نفسها packages شيدرز (Effect SDK بـ Lua) بتتنزل أونلاين.

**عندنا:** حوالي 110 مكوّن، وكل واحد ليه أنيميشن جواه. زوم على الـ base. انتقالات. `profiles.json` فيه الـ safe zones. وMotion Studio فيه 1,258 تمبلت.

**ناخد:**
- **دخول / خروج / لوب لأي عنصر**: `clips[].anim = {in: 'pop'|'slide-up'|'fade'|..., out, loop, inDur, outDur}`.
  wrapper واحد في `Edit.tsx` حوالين أي كومبوننت. تختار من قايمة صغيرة، وتشوف البريفيو وانت معدّي بالماوس.
- **Keyframes لـ `box`**: نقط على التايملاين جوه البلوك، كل نقطة فيها `{t, x, y, scale, rotate, ease}`.
  ده يخلي أي عنصر يتحرك على الشاشة. وفي المحرر علامة ◆ جنب كل خاصية زي CapCut.
- **Speed ramp و freeze** لحتة من الـ base: `base[i].speed` و`base[i].freeze`. ده لوك أساسي في ريلز الفيتنس.
- **خطوط إرشاد + safe zone** فوق البريفيو، من `profiles.json` حسب المنصة. سهلة جدًا وبتفرق.
- **Motion blur** على الزوم والحركات السريعة: في Remotion بـ `<CameraMotionBlur>`.
- مؤجَّل: التتبع.

## 4. الصوت
**عند CapCut (اتشاف):**
- `normalize_loudness`، مع قياس `avg_loudness` و`peak_loudness` و`target_loudness`.
- `audio_denoise` و`realtime_denoise` (موديل `rnnoise_v2.0.model` جوه Resources).
- `vocal_beautify` و`enhance_voice` (تحسين الصوت).
- `vocal_separation` (فصل الصوت عن المزيكا).
- `audio_fades` (fade in / out)، و`audio_balances` / `audio_pannings`، و`audio_pitch_shifts`، و`voice_changer`، و`speeds` للصوت.
- `beats` (اتكلمنا عنها في ملف التايملاين).
- `auto_remove_filler`: شيل الكلام الزيادة زي "آآ" و"يعني".
- مفيش equalizer ولا compressor كأداة ظاهرة للمستخدم. عندهم كله "ضغطة واحدة وخلاص" (استنتاج من غياب الأسامي).

**عندنا:** loudnorm بمرحلتين على -14 LUFS وقت الرندر، و`music.py duck` (خفض المزيكا تحت الكلام بـ attack / release)، و`volume` لكل حاجة.

**ناخد** (ده "الكومباكت" اللي قلت عليه):
- **سلسلة "صوت احترافي" للكلام** بضغطة: `audio.voice.chain = {denoise, highpass, eq: 'voice', compressor, deesser, limiter}`.
  تتعمل بـ ffmpeg (`arnndn` بنفس فكرة rnnoise، و`acompressor`، و`deesser`، و`alimiter`) وتطلع `voice_clean.wav`.
  المحرر يعرض قبل / بعد (A/B) ونسبة الضغط. ده أحسن من CapCut، لأن الكومبريسور عندهم مستخبي.
- **Ducking من المحرر:** زرار "المزيكا تنزل تحت الكلام" + سلايدر بكام dB. بيستخدم `music.py duck` اللي عندنا.
- **Fade in / out** لأي صوت (مزيكا / sfx / voice)، بمقابض صغيرة على حواف البلوك في التايملاين زي CapCut.
- **عداد LUFS** في المحرر (يقيس الملف بعد التظبيط)، مع علامة لو بعيد عن -14.
- **شيل الحشو والسكتات:** زرار في تبويب الكابشن يدوّر على السكتات الأطول من X ms وكلمات الحشو، ويعلّمها، وإنت تأكد، فيتعمل `rippleDelete`.
  ده نفس شغل "القص الضيق" اللي بنعمله بإيدينا.
- مؤجَّل: فصل الصوت عن المزيكا (demucs تقيل)، وتغيير الصوت.

## 5. شكل الواجهة (التصميم)
**اتشاف من أسامي الشاشات:**
- `MaterialPanel` على الشمال: مكتبة بتبويبات (media / audio / text / sticker / effect / transition / filter / adjust).
- `Player` في النص، فيه `FullScreenToolBar` و`ExportSingleFrameDialog` (تصدير فريم كصورة) و`reference_line`.
- `FunctionPanel` على اليمين: inspector بيتغيّر حسب اللي محدد، وكل نوع ليه تبويبات.
  مثلًا الفيديو: Basic / Audio / Speed / Animation / Adjust / AI.
  وفيه `DraftInspectorMultipleSelection` لما تحدد كذا حاجة.
- `TimeLine` تحت، والـ toolbar فوقه.
- `AdjustPresetSaveView`: حفظ أي تعديل كـ preset.

**استنتاج من معرفة البرنامج نفسه، مش من الملفات:** خلفية رمادي غامق جدًا، ولون واحد فاتح (سماوي) للتحديد والأزرار المهمة. السلايدر دايمًا جنبه رقم تكتب فيه، وجنبه ◆ للكي فريم، وجنبه زرار reset.

**ناخد البنية مش الجلد** (اللوك بتاعنا broadcast control-room، والبراند بتاعنا يكسب):
- Inspector بـ **تبويبات حسب النوع** بدل لستة طويلة: للمشهد (أساسي / حركة / ماسك / ألوان)، وللفيديو (لون / سرعة / صوت).
- **سطر خاصية موحّد:** اسم، سلايدر، رقم، ◆ keyframe، ↺ reset. ده يدّي الواجهة كلها إحساس الاحترافية.
- **تعديل جماعي:** لما تحدد كذا مشهد، الخصائص المشتركة تظهر وتتغيّر لكلهم مرة واحدة.
- **Presets في كل مكان:** احفظ الـ grade، أو الأنيميشن، أو ستايل الكابشن، باسم.
- **تصدير فريم كصورة** من البريفيو (للثامبنيل).

## 6. الترتيب اللي أقترحه (من الأسهل والأكتر فرق)
1. خطوط الإرشاد + safe zone في البريفيو.
2. fade in / out للأصوات + ducking من المحرر.
3. `grade` أساسي بسلايدرز + presets للبراند.
4. `style` للمشاهد (حواف / حدود / ظل / blend) + الماسك بالشكل.
5. `anim` دخول / خروج / لوب لأي عنصر.
6. سلسلة "صوت احترافي" (denoise + compressor + EQ) مع A/B.
7. شيل الحشو والسكتات من تبويب الكابشن.
8. keyframes لحركة العناصر + speed ramp / freeze.
9. LUT + scopes + مطابقة لون مع ريفرنس.

(ومعاهم بنود التايملاين من `capcut-timeline.md`: preview axis، beats، تحديد ناحية، blade، قفل / إخفاء / كتم.)


## Zoom في كاب كات (من الـ drafts بتاعتك، 2026-10-25)

- كاب كات ما عندوش مسار زوم لوحده. الزوم keyframes على الفيديو نفسه: `common_keyframes` على الـ segment.
  - الخصائص: `KFTypeScaleX`, `KFTypeScaleY`, `KFTypePositionX`, `KFTypePositionY`, `KFTypeRotation`.
  - كل keyframe فيها `time_offset` (بالميكروثانية) و`values`، و`curveType` (Line / FreeCurveIn / FreeCurveOut / FreeCurveInOut) بـ bezier handles.
- النمطين اللي انت بتستخدمهم:
  - "AI Reel - Viral Hormozi": push بطيء على طول الجزء، 1.00 → 1.075، والجزء اللي بعده 1.079 → 1.15، Line.
  - "narrow grip seated rows": punch في 0.37 ثانية لـ 1.13–1.17، ومعاه حركة Position ناحية الوش، وFreeCurveInOut.
- نصوص الواجهة في `VECreator.dll`: `pc_add_keyframes`, `pc_previous_keyframe`, `pc_next_keyframe`, `move_keyframe_position`, `keyframe_preset_ease_in/out`, `preset_keyframe_curve`, `pc_keyframe_right_click_edit_value`, `pc_copy_keyframe_position`.
- اللي اتعمل عندنا من ده: `base[].keys` + ◆ لكل خاصية + ‹ › + presets + سحب الـ ◆ + كليك يمين للـ ease. شوف `reel/src/edit/LOOK.md`.
- ملاحظة: أداة REA's MCP مش متسجلة في الجلسة دي، فالدراسة اتعملت من ملفات الـ drafts والنصوص اللي جوه الـ DLL.
