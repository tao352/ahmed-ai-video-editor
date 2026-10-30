import type React from 'react';
import {layoutMetadata,lookDescriptions,type LayoutMetadata} from './layoutMetadata';
import {z} from 'zod';
import {Headline,HeadlineSchema} from './components/Headline';
import {BigType,BigTypeSchema} from './components/BigType';
import {Phrase,PhraseSchema} from './components/Phrase';
import {CaptionsSchema} from './components/Captions';
import {CaptionLayer as Captions} from './components/GenericCaptions';
import {FullscreenText,FullscreenTextSchema,ImageLayer,ImageLayerSchema,VideoLayer,VideoLayerSchema,ColorOverlay,ColorOverlaySchema} from './components/Generic';
import {components as lib} from './components/Library';
import {KaraokeCaptions,KaraokeCaptionsSchema} from './components/KaraokeCaptions';
import {PhoneScreen,PhoneScreenSchema} from './components/PhoneScreen';
import {StepBadge,StepBadgeSchema} from './components/StepBadge';

import {Text,TextSchema} from './components/Text';
import {Highlight,HighlightSchema,Callout,CalloutSchema} from './components/Tracked';
type Layer='behindMatte'|'overlay';
type Entry=LayoutMetadata&{component:React.ComponentType<any>;schema:z.ZodType;description:string;defaults:Record<string,unknown>;layer:Layer};
const entry=(component:React.ComponentType<any>,schema:z.ZodType,description:string,layer:Layer='overlay'):Entry=>({component,schema,description,defaults:{},layer,region:'center',minTextU:2.8,purpose:'content',reading:'static',scalePolicy:'canvas'});
export const registry:Record<string,Entry>={
 Headline:entry(Headline,HeadlineSchema,'Two-line spring headline and accent pill'),
 BigType:entry(BigType,BigTypeSchema,'Markazi/Instrument big word with clipped reveal','behindMatte'),
 Phrase:entry(Phrase,PhraseSchema,'Plex first line and Instrument italic accent box'),
 Captions:entry(Captions,CaptionsSchema,'Two-word spring captions with RTL-safe Latin runs'),
 KaraokeCaptions:entry(KaraokeCaptions,KaraokeCaptionsSchema,'Word timed karaoke captions with active token highlight'),
 PhoneScreen:entry(PhoneScreen,PhoneScreenSchema,'Screen recording in a zoomable branded phone mockup'),
 StepBadge:entry(StepBadge,StepBadgeSchema,'Animated RTL tutorial step badge with Arabic title'),
 Highlight:entry(Highlight,HighlightSchema,'Tracking: outline that highlights a building, plot or object (smooth or straight), draws itself, soft glow; use with clip.follow'),
 Callout:entry(Callout,CalloutSchema,'Tracking: pin, leader line and label pointing at a spot; use with clip.follow mode position'),
 Text:entry(Text,TextSchema,'Text: type anything, any font on the machine, stroke, background, shadow, CapCut text animations'),
 FullscreenText:entry(FullscreenText,FullscreenTextSchema,'Full-frame title'),
 ImageLayer:entry(ImageLayer,ImageLayerSchema,'Image with Ken Burns motion'),
 VideoLayer:entry(VideoLayer,VideoLayerSchema,'B-roll video with four-frame whip in/out'),
 ColorOverlay:entry(ColorOverlay,ColorOverlaySchema,'Full-frame color overlay'),
 ...Object.fromEntries(Object.entries(lib).filter(([name])=>name!=='EndCard').map(([name,value]:[string,any])=>[name,entry(value.Component,value.Schema,`${name} composition primitive`)])),
 EndCardGeneric:entry(lib.EndCard.Component,lib.EndCard.Schema,'Generic CTA end card with title, subtitle, button and contact handle'),
};
for(const [name,value] of Object.entries(registry)){Object.assign(value,layoutMetadata[name]);if(lookDescriptions[name])value.description=lookDescriptions[name]}
export const listComponents=()=>Object.entries(registry).map(([name,value])=>({name,description:value.description,region:value.region,minTextU:value.minTextU,purpose:value.purpose,reading:value.reading,scalePolicy:value.scalePolicy,defaults:value.defaults,props:z.toJSONSchema(value.schema,{unrepresentable:'any'})}));
