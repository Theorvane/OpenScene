// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/LlmProviderContext", () => ({ useLlmModel: () => ({ providerConfig: {}, credentialStatus: { local_ollama: true } }) }));
vi.mock("../src/renderer/src/ChatGptAuthContext", () => ({ useChatGptAuth: () => ({ isConnected: false }) }));
vi.mock("../src/renderer/src/AiDomainModelContext", () => ({ useAiDomainModel: () => ({ selectedModel: () => ({ id: "local_ollama/fixture", providerId: "local_ollama", available: true }), hasConnectedProvider: true }) }));
const providerPath = "../src/renderer/src/AgentChatContext";
const { AgentChatProvider, useAgentChat } = await import(providerPath);
it.each(['before', 'during'])('rejects an approval when the project changes %s preparation', async (when) => {
 Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
 const proposal = {toolCallId:"call-A", toolName:"editProject", args:{projectId:"A", operations:[]}};
 const approve = vi.fn(async () => ({ok:true,value:{messages:[],pendingApproval:null,status:"idle"}}));
 Object.assign(window,{videoTool:{agentChatHistoryList:async()=>({ok:true,value:[]}),agentChatSend:async()=>({ok:true,value:{messages:[],pendingApproval:proposal,status:"awaiting-approval"}}),agentChatApprove:approve}});
 let controller!: ReturnType<typeof useAgentChat>;
 function Probe(){controller=useAgentChat();return null;}
 const root=createRoot(document.createElement("div"));
 const prepared:string[]=[];
 let release: (() => void) | undefined;
 const preparing = new Promise<void>(resolve => { release = resolve; });
 const draw=async(id:string)=>act(async()=>root.render(createElement(AgentChatProvider,{activeProject:{projectId:id,name:id,assetCount:1,trackCount:1},prepareProject:async()=>{prepared.push(id);if(when === 'during' && prepared.length > 1) await preparing;return true;}},createElement(Probe))));
 try { await draw("A"); await act(async()=>controller.sendMessage("trim A")); expect(controller.pendingApproval).toEqual(proposal);
 if (when === 'before') {
  await draw("B");
  await act(async()=>controller.respondToApproval("approve"));
  expect(prepared).toEqual(["A"]);
 } else {
  let response!: Promise<void>;
  act(() => { response = controller.respondToApproval('approve'); });
  await draw('B');
  await act(async () => { release!(); await response; });
  expect(prepared).toEqual(['A', 'A']);
 }
 expect(controller.activeProject?.projectId).toBe("B");expect(approve).not.toHaveBeenCalled();expect(controller.error).toContain("another project");
 } finally {act(()=>root.unmount());}
});
