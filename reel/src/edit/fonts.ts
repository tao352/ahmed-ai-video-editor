// Fonts the built-in captions use (Google Fonts, bundled by Remotion so renders match the preview).
import {loadFont as loadCairo} from '@remotion/google-fonts/Cairo';
import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadDomine} from '@remotion/google-fonts/Domine';
const {fontFamily:cairo}=loadCairo('normal',{weights:['700','900'],subsets:['arabic','latin']});
const {fontFamily:anton}=loadAnton('normal',{weights:['400'],subsets:['latin']});
const {fontFamily:domine}=loadDomine('normal',{weights:['700'],subsets:['latin']});
export const baseFonts={cairo,anton,domine};
