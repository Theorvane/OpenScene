// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("../src/renderer/src/editor/ProgramMonitor",()=>({ProgramMonitor:()=>null}));
vi.mock("../src/renderer/src/editor/SourceMediaPreview",()=>({SourceMediaPreview:()=>null}));
const previewPath = "../src/renderer/src/editor/EditorPreview";
const { EditorPreview } = await import(previewPath);
const playbackPath = "../src/renderer/src/editor/useTimelinePlayback";
const { useTimelinePlayback } = await import(playbackPath);
import {DEFAULT_CLIP_EFFECTS} from "../src/shared/timelineTypes";
it.each(["source", "settings"])("keeps the hidden edited clock fixed in %s context",async(context)=>{
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.useFakeTimers();
const project:any={id:"p",assets:[{id:"asset",kind:"video"}],timeline:{tracks:[{id:"v",kind:"video",clips:[{id:"c",assetId:"asset",timelineStartMs:0,sourceStartMs:0,sourceEndMs:5000,effects:DEFAULT_CLIP_EFFECTS,keyframes:[]}]}],transitions:[]}};
let playback!:ReturnType<typeof useTimelinePlayback>;
function Host(){playback=useTimelinePlayback(project);return createElement(EditorPreview,{editor:{...playback,project,selectedAsset:project.assets[0],setSelectedAssetId:()=>{}} as any,active:context !== "settings",sourceMode:context === "source"});}
const root=createRoot(document.createElement("div"));try{
await act(async()=>root.render(createElement(Host)));act(()=>playback.setPlayheadMs(500));
// This is the unchanged native playPause handler while source inspection is visible.
act(()=>playback.setIsPlaying((current:boolean)=>!current));act(()=>vi.advanceTimersByTime(300));
expect(playback.isPlaying).toBe(false);expect(playback.playheadMs).toBe(500);
}finally{act(()=>root.unmount());vi.useRealTimers();}
});
