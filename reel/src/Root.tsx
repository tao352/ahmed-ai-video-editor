import { Composition } from "remotion";
import { Edit, calculateEditMetadata } from "./edit/Edit";
import { editSchema } from "./edit/schema";

// One composition: Edit draws any edit.json (the editor's preview and the final render).
export const Root = () => (
  <Composition
    id="Edit"
    component={Edit}
    schema={editSchema}
    calculateMetadata={calculateEditMetadata}
    durationInFrames={1}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{version: 1, settings: {width: 1080, height: 1920, fps: 30, background: "#000000", duration: 1}, layout: {beats: [{from: 0, to: 1, mode: "full"}]}, captions: {words: [], style: {preset: "default"}, enabled: true}} as any}
  />
);
