// Ported from template-tiktok/src/CaptionedVideo/Page.tsx + SubtitlePage.tsx
import React from 'react';import {z} from 'zod';import {captionStyleSchema} from './Captions';import {CaptionLayer as Captions} from './GenericCaptions';
export const KaraokeCaptionsSchema=z.object({words:z.array(z.tuple([z.number(),z.number(),z.string()])).default([]),mode:z.string().default('full'),style:captionStyleSchema.default({preset:'karaoke',size:64,colors:{},position:{},maxWords:3,gapBreak:.25,keywords:[]}),width:z.number().default(1080),height:z.number().default(1920)});
export const KaraokeCaptions:React.FC<z.infer<typeof KaraokeCaptionsSchema>>=p=><Captions {...p} style={{...p.style,preset:'karaoke'}}/>;
