import {z} from 'zod';
import {captionStyleSchema} from './components/Captions';
import {gradeSchema} from './grade';
import {animSchema,chromaSchema,cropSchema,keySchema,maskSchema,styleSchema,subjectSchema} from './clipfx';
import {lanesSchema} from './lanes';
// box: hand placement from the Studio Editor; x/y shift as a fraction of the canvas, scale and rotate (deg) around the centre.
// follow: the clip moves with a track (tools/track/track.py): perspective = pinned on the surface, transform = moves, scales and turns
// with it, position = moves only (labels stay upright). point: the clip's anchor point in composition px (default: the shape's centre).
export const followSchema=z.object({track:z.string(),mode:z.enum(['perspective','transform','position']).default('perspective'),point:z.tuple([z.number(),z.number()]).optional()});
// stabilize: a footage piece steadied by a stabilize track (CapCut Stabilize); the track carries the correction and its zoom.
export const stabilizeSchema=z.object({track:z.string(),level:z.enum(['light','normal','max','lock']).optional()});
// volume keyframes on music / sfx: `volume` multiplies the sound's level at item time t
export const volumeKeySchema=z.object({t:z.number().min(0),volume:z.number().min(0).max(4).optional(),ease:z.enum(['linear','in','out','inOut','hold']).optional()});
export const boxSchema=z.object({x:z.number().default(0),y:z.number().default(0),scale:z.number().positive().default(1),rotate:z.number().default(0)});
export const clipSchema=z.object({id:z.string(),component:z.string(),from:z.number(),to:z.number(),props:z.record(z.string(),z.unknown()).default({}),track:z.number().optional(),box:boxSchema.optional(),grade:gradeSchema.optional(),style:styleSchema.optional(),mask:maskSchema.optional(),anim:animSchema.optional(),behind:z.boolean().optional(),keys:z.array(keySchema).optional(),disabled:z.boolean().optional(),crop:cropSchema.optional(),group:z.string().optional(),chroma:chromaSchema.optional(),follow:followSchema.optional()});
export const zoomSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('punch'),t:z.number(),peak:z.number(),hold:z.number().optional(),label:z.string().optional()}),
 z.object({type:z.literal('ratchet'),steps:z.array(z.tuple([z.number(),z.number()])),hold:z.number().optional(),label:z.string().optional()}),
 z.object({type:z.literal('kenburns'),t0:z.number(),t1:z.number(),peak:z.number(),label:z.string().optional()}),
 z.object({type:z.literal('ramp'),t0:z.number(),t1:z.number(),peak:z.number(),hold:z.number().optional(),label:z.string().optional()}),
 z.object({type:z.literal('drop'),t:z.number(),peak:z.number(),dur:z.number().optional(),label:z.string().optional()}),
]);
export const bigSchema=z.object({from:z.number(),to:z.number(),text:z.string(),ar:z.boolean().optional(),hit:z.boolean().optional(),label:z.string().optional()});
export const phraseSchema=z.object({from:z.number(),to:z.number(),lines:z.array(z.string()),hit:z.boolean().optional()});
export const editSchema=z.object({
 version:z.literal(1).default(1),
 settings:z.object({width:z.number().positive(),height:z.number().positive(),fps:z.number().positive(),background:z.string(),duration:z.number().positive()}),
 theme:z.object({colors:z.record(z.string(),z.string()).default({}),fonts:z.record(z.string(),z.string()).default({})}).default({colors:{},fonts:{}}),
 fonts:z.array(z.string()).default([]),
 base:z.array(z.object({src:z.string(),start:z.number().default(0),sourceIn:z.number().optional(),duration:z.number().optional(),mirror:z.boolean().optional(),fit:z.enum(['cover','contain','fill','blurfill']).default('cover'),matte:z.string().optional(),focus:z.tuple([z.number(),z.number()]).optional(),grade:gradeSchema.optional(),lut:z.object({file:z.string(),from:z.string()}).optional(),speed:z.number().positive().optional(),freeze:z.boolean().optional(),keys:z.array(keySchema).optional(),crop:cropSchema.optional(),anim:animSchema.optional(),stabilize:stabilizeSchema.optional()})).default([]),
 // cover: the frame used as the video's cover (CapCut "Cover"); the render also writes it as <out>.cover.jpg.
 cover:z.object({t:z.number().min(0)}).optional(),
 // grade: colour sliders for all footage (base[].grade overrides per piece); see grade.ts.
 grade:gradeSchema.optional(),
 // subject: outline / glow around the speaker cut-out (needs base[].matte).
 subject:subjectSchema.optional(),
 // lanes: timeline switches per lane (hidden / muted / locked); see lanes.ts.
 lanes:lanesSchema.optional(),
 layout:z.object({mode:z.enum(['full','pip','split-h','split-v']).default('full'),pip:z.object({x:z.number().default(.62),y:z.number().default(.58),width:z.number().default(.34),height:z.number().default(.34),radius:z.number().default(24)}).default({x:.62,y:.58,width:.34,height:.34,radius:24}),split:z.object({y:z.number().default(1060),offset:z.number().default(310)}).default({y:1060,offset:310}),beats:z.array(z.object({from:z.number(),to:z.number(),mode:z.string(),head:z.tuple([z.string(),z.string()]).optional(),card:z.string().optional()})).default([]),drift:z.boolean().optional()}),
 audio:z.object({
  // segments: the voice cut into pieces (start on the timeline, sourceIn in the file) after text-based cuts.
  // chain: the voice was cleaned by tools/edit/editor_tools.py voice (src is the cleaned file, original the raw one);
  // chain.bypass plays the original for A/B listening.
  voice:z.object({src:z.string(),volume:z.number().default(1),segments:z.array(z.object({start:z.number(),sourceIn:z.number(),duration:z.number()})).optional(),original:z.string().optional(),chain:z.object({preset:z.string(),bypass:z.boolean().optional()}).passthrough().optional()}).optional(),
  // duck: music drops by db decibels under speech (captions words), easing in/out over attack/release seconds.
  music:z.object({src:z.string(),volume:z.number(),gapBoost:z.number().default(1),fadeIn:z.number().default(0),fadeOut:z.number().default(0),beats:z.array(z.number()).optional(),duck:z.object({db:z.number().default(9),attack:z.number().default(.08),release:z.number().default(.35)}).optional(),keys:z.array(volumeKeySchema).optional()}).optional(),
  sfx:z.array(z.object({at:z.number(),file:z.string(),volume:z.number().default(1),duration:z.number().optional(),fadeIn:z.number().optional(),fadeOut:z.number().optional(),disabled:z.boolean().optional(),keys:z.array(volumeKeySchema).optional()})).default([]),
 }).default({sfx:[]}),
 captions:z.object({words:z.array(z.tuple([z.number(),z.number(),z.string()])).default([]),style:captionStyleSchema.default({preset:'reel4',size:64,colors:{},position:{},maxWords:2,gapBreak:.25,keywords:[]}),enabled:z.boolean().default(true),box:boxSchema.optional()}),
 zooms:z.array(zoomSchema).default([]),clips:z.array(clipSchema).default([]),
 transitions:z.array(z.object({at:z.number(),type:z.string(),duration:z.number()})).default([]),
 // Accepted for compatibility with early v1 edits; converted to registry clips by Edit.
 big:z.array(bigSchema).default([]),phrases:z.array(phraseSchema).default([]),
});
export type EditProps=z.input<typeof editSchema>;
export type EditData=z.infer<typeof editSchema>;
export type EditClip=z.infer<typeof clipSchema>;
