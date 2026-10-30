// Region declarations describe visible foreground content; background/effect layers are compositional.
export type Region='top'|'center'|'bottom'|'full'|'lowerThird'|'corner';
export type LayoutMetadata={region:Region;minTextU:number;purpose:'content'|'background'|'effect'|'frame';reading:'static'|'voice-synced'|'none';scalePolicy:'canvas'|'reference';smallPrint?:boolean;regions?:Region[]};
const content=(region:Region,minTextU=2.8):LayoutMetadata=>({region,minTextU,purpose:'content',reading:'static',scalePolicy:'canvas'});
const background:LayoutMetadata={region:'full',minTextU:0,purpose:'background',reading:'none',scalePolicy:'canvas'};
const effect:LayoutMetadata={...background,purpose:'effect'};
export const layoutMetadata:Record<string,LayoutMetadata>={
 LowerThird:content('lowerThird',3.4),ChapterTitle:{...content('center',2.2),smallPrint:true},KineticText:content('center',6),
 EndCardGeneric:content('full'),PropertyHero:content('lowerThird',3.4),PriceFacts:content('center'),FeatureChips:content('center'),FeatureList:content('center'),MapPins:content('full'),
 KpiCounter:content('center',3.4),StatCard:content('center',3.4),BarChartRace:content('center'),FullscreenText:content('center',6),
 NarratorPiP:{...content('corner',3.4),purpose:'frame',regions:['top','corner']},SplitScreen:{...content('full'),purpose:'frame'},SocialFrame:{...content('bottom'),purpose:'frame'},
 Captions:{...content('bottom'),reading:'voice-synced'},KaraokeCaptions:{...content('bottom'),reading:'voice-synced'},
 PhoneScreen:background,StepBadge:{...content('top',2.2),smallPrint:true},
 Spectrum:{...content('lowerThird',0),reading:'none'},Waveform:{...content('lowerThird',0),reading:'none'},
 ImageLayer:background,VideoLayer:background,KenBurnsGallery:background,
 HookTitle:content('top',6),ExerciseCard:content('top',3.4),RepCounter:content('corner',2.2),HoloAnatomy:content('center',2.6),XrayScan:effect,FreezePop:effect,BeatFlash:effect,BehindText:effect,VTaper:effect,BrandSting:content('full'),
 ColorOverlay:effect,FilmGrain:effect,Vignette:effect,Letterbox:effect,ColorGrade:effect,LightLeak:effect,Arrow:effect,CircleHighlight:effect,Underline:effect,Spotlight:effect
};
// Fixed-layout, word-synced reference compositions are governed by SSIM, not the generic type scale.
for(const name of ['DesignTool','Headlines','OrderList','AiPost','FieldChips','JobsStrike','TeamToOne','SelfEditTimeline','StackLayers','CompareBars','Donut'])layoutMetadata[name]={...content('center'),scalePolicy:'reference',reading:'voice-synced'};
for(const name of ['Headline','BigType','Phrase'])layoutMetadata[name]={...content('top'),scalePolicy:'reference',reading:'voice-synced'};
for(const name of ['EndCard','EndCardReel4'])layoutMetadata[name]={...content('full'),scalePolicy:'reference',reading:'voice-synced'};

export const lookDescriptions:Record<string,string>={
 LowerThird:'Generous two-level identity panel with an accent rail, minimal line or smoked glass treatment.',
 ChapterTitle:'Oversized chapter headline, editorial chapter label and readable subtitle on a quiet dark panel.',
 KineticText:'Width-fitted stacked tokens with cubic stagger, safe margins and a single accent rule.',
 EndCardGeneric:'Solid ink closing scene, balanced title stack, accessible accent button and clear contact line.',
 PropertyHero:'Large Arabic-safe property headline and location over a dark architectural panel.',
 PriceFacts:'Localized hero price above three evenly spaced property fact tiles.',
 FeatureChips:'Roomy amenity chips with accent dots and a minimum 6u chip height.',
 FeatureList:'Stacked amenity rows with generous spacing and consistent rounded surfaces.',
 MapPins:'Dark local map/grid, separated accent markers and large isolated label panels.',
 KenBurnsGallery:'Edge-to-edge image sequence with per-image durations and alternating slow camera moves.',
 KpiCounter:'14u count-up number on a centered 60% canvas panel with clear metric hierarchy.',
 StatCard:'14u key metric, readable label and supporting copy in a substantial centered card.',
 BarChartRace:'65% canvas chart panel with bold row labels, large bars and animated values.',
 NarratorPiP:'Talking-person footage, readable episode header and an inset kept clear of spectrum/captions.',
 SplitScreen:'Two clean media panes with configurable direction, gap and readable panel labels.',
 Spectrum:'Voice-driven FFT bars in a dedicated dark panel above the caption safe area.',
 Waveform:'Rounded audio-reactive waveform treatment using the same real audio analysis.',
 FullscreenText:'Canvas-scaled, width-fitted title inside title-safe margins with a strong dark backing.'
};
