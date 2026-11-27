/**
 * Test-only entry: npm run build && node_modules/.bin/electron scripts/cua-agent-app.integration.mjs
 * Only the model's invoke is substituted. The actual built main, renderer,
 * approval IPC, safety snapshots, driver and release settlement stay intact.
 * A fresh local fixture is written before app startup; no existing user data is used.
 */
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { waitForNativeMenuReady } from './cua-harness-readiness.mjs';
import { ChatOllama } from '@langchain/ollama';
import { AIMessage } from '@langchain/core/messages';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const evidenceDirectory = resolve(process.env.CUA_AGENT_EVIDENCE_DIR || `/tmp/openscene-cua-agent-app-${Date.now()}`);
mkdirSync(evidenceDirectory, { recursive: true });
const profile = mkdtempSync(join(evidenceDirectory, 'profile-'));
const projectId = randomUUID();
const assetId = randomUUID();
const projectDirectory = join(profile, 'projects', projectId);
mkdirSync(join(projectDirectory, 'assets', assetId), { recursive: true });
app.setPath('userData', profile);
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
writeFileSync(join(projectDirectory, 'assets', assetId, 'original.png'), image);
const timestamp = new Date().toISOString();
writeFileSync(join(projectDirectory, 'project.json'), JSON.stringify({
  schemaVersion: 4, id: projectId, name: 'CUA Agent Isolated Fixture', projectType: 'editing',
  createdAt: timestamp, updatedAt: timestamp,
  assets: [{ id: assetId, displayName: 'CUA fixture.png', projectRelativePath: `assets/${assetId}/original.png`, kind: 'image',
    mimeType: 'image/png', byteLength: image.length, metadata: { durationMs: 5000, width: 1, height: 1 }, createdAt: timestamp, updatedAt: timestamp }],
  timeline: { schemaVersion: 3, tracks: [{ id: 'video-track-1', kind: 'video', name: 'Video 1', clips: [] },
    { id: 'audio-track-1', kind: 'audio', name: 'Audio 1', clips: [], mix: { gainDb: 0, pan: 0, muted: false } }], transitions: [] },
  ai: { schemaVersion: 1, scripts: [], scenes: [], shots: [], characters: [],
    styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] }, referenceAssets: [], generations: [], provenance: [] }
}));

const evidence = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  harnessSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  workingTree: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
  syntheticModel: true, liveModelQualityTested: false, profile, projectId, inputs: [], states: [], snapshots: [], surfaceReports: [], saveRequests: [], agentRequests: [], saves: [], modelCalls: [], scenarios: [] };
let target;
let source = 'product';
let scenario = { kind: 'move', stage: 0 };
let callSequence = 0;
let lastActionCallId = null;
evidence.menuReports = [];
evidence.menuReadiness = [];
evidence.productPin = process.env.CUA_AGENT_PRODUCT_COMMIT || evidence.head;
evidence.harnessHelperSha256 = createHash('sha256').update(readFileSync(new URL('./cua-harness-readiness.mjs', import.meta.url))).digest('hex');
const originalOn = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, handler) => originalOn(channel, channel !== 'timeline-menu:state' ? handler : (event, payload, ...rest) => {
  const focused = BrowserWindow.getFocusedWindow();
  const record = { at: performance.now(), sequence: evidence.menuReports.length + 1,
    senderId: event.sender.id, focusedSenderId: focused?.webContents.id,
    senderMatches: focused?.webContents === event.sender, payload: structuredClone(payload) };
  const result = handler(event, payload, ...rest);
  record.native = Object.fromEntries(['undo', 'redo'].map(command => [command, Menu.getApplicationMenu()?.getMenuItemById(`timeline:${command}`)?.enabled]));
  evidence.menuReports.push(record);
  return result;
});
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel === 'project-timeline:save') return originalHandle(channel, async (event, payload) => {
    const startedAt = performance.now();
    evidence.saveRequests.push({ at: startedAt, projectId: payload?.projectId, scenario: scenario.kind, modelStage: scenario.stage });
    const response = await handler(event, payload);
    evidence.saves.push({ startedAt, completedAt: performance.now(), projectId: payload?.projectId,
      ok: response?.ok, updatedAt: response?.value?.updatedAt,
      clips: response?.value?.timeline?.tracks.flatMap(track => track.clips.map(clip => ({ id: clip.id, timelineStartMs: clip.timelineStartMs }))) });
    return response;
  });
  if (['agent-chat:send', 'agent-chat:approve', 'agent-chat:cancel'].includes(channel)) return originalHandle(channel, async (event, payload) => {
    const record = { channel, at: performance.now(), conversationId: payload?.conversationId,
      interactionMode: payload?.interactionMode, hasUnsavedTimeline: payload?.hasUnsavedTimeline, decision: payload?.decision, toolCallId: payload?.toolCallId };
    evidence.agentRequests.push(record);
    const response = await handler(event, payload);
    record.response = { ok: response?.ok, status: response?.value?.status, errorCode: response?.value?.errorCode,
      pendingApproval: response?.value?.pendingApproval, cuaSaveResult: response?.value?.cuaSaveResult };
    return response;
  });
  return originalHandle(channel, channel !== 'cua:report-surface-snapshot' ? handler : (event, snapshot, ...rest) => {
  // Passive evidence tap: original sender, payload, handler and return value.
  evidence.surfaceReports.push({ at: performance.now(), snapshot: structuredClone(snapshot) });
  return handler(event, snapshot, ...rest);
  });
};

app.on('browser-window-created', (_event, window) => {
  if (target) throw new Error('Harness only permits one own app window');
  target = window;
  // Observation only: every event is forwarded unchanged to the original API.
  const original = window.webContents.sendInputEvent.bind(window.webContents);
  window.webContents.sendInputEvent = (event) => {
    evidence.inputs.push({ at: performance.now(), source, ...event });
    return original(event);
  };
});

const js = (code) => target.webContents.executeJavaScript(code);
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
async function until(description, predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await wait(25);
  }
  throw new Error(`Timed out: ${description}`);
}
async function bridge(method, ...args) {
  const response = await js(`window.videoTool[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  assert.equal(response?.ok, true, `${method}: ${JSON.stringify(response)}`);
  return response.value;
}
async function nativeMenuReady(command, afterSequence = 0) {
  try {
    const result = await waitForNativeMenuReady({ command, read: async () => {
      const report = evidence.menuReports.at(-1);
      return { at: performance.now(), enabled: Menu.getApplicationMenu()?.getMenuItemById(`timeline:${command}`)?.enabled,
        report: report && report.sequence > afterSequence ? { ...report, enabled: report.payload?.commands?.[command]?.enabled } : null,
        focus: { window: target.isFocused(), contents: target.webContents.isFocused() },
        dom: await js(`(() => {const e=document.querySelector('.timeline-clip');return {position:e?.dataset.timelineStartMs,dirty:document.querySelector('[data-testid=timeline-canvas]')?.dataset.dirty,undoDisabled:document.querySelector('[data-testid="timeline-undo-btn"]')?.disabled,redoDisabled:document.querySelector('[data-testid="timeline-redo-btn"]')?.disabled,activeTag:document.activeElement?.tagName};})()`) };
    } });
    evidence.menuReadiness.push({ command, afterSequence, result });
  } catch (error) {
    evidence.menuReadiness.push({ command, afterSequence, timeout: error.telemetry });
    throw error;
  }
}
async function mcp(name, args) {
  const result = await bridge('mcpExecuteTool', name, args);
  assert.equal(result?.success, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}
async function pointFor(selector, text, requireHit = true) {
  return js(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => {
      const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&${text === undefined ? 'true' : `e.textContent.trim()===${JSON.stringify(text)}`};
    });
    if(!element||element.disabled) return null;
    const r=element.getBoundingClientRect();
    let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    for(let p=element.parentElement;p;p=p.parentElement){
      const style=getComputedStyle(p),pr=p.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,pr.left);right=Math.min(right,pr.right);}
      if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,pr.top);bottom=Math.min(bottom,pr.bottom);}
    }
    if(right<=left||bottom<=top)return null;
    const point={x:left+Math.min(right-left,160)/2,y:(top+bottom)/2};
    const hit=document.elementFromPoint(point.x,point.y);
    return ${requireHit ? 'hit&&(hit===element||element.contains(hit))' : 'true'}?point:null;
  })()`);
}
function input(event) {
  source = 'harness-ui';
  try { target.webContents.sendInputEvent(event); } finally { source = 'product'; }
}
async function clickPoint(point) {
  assert.ok(point, 'UI target exists');
  const zoom = target.webContents.getZoomFactor();
  const location = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 };
  input({ type: 'mouseMove', ...location });
  input({ type: 'mouseDown', ...location });
  input({ type: 'mouseUp', ...location });
}
async function click(selector, text) {
  await clickPoint(await until(`visible ${selector} ${text ?? ''}`, () => pointFor(selector, text)));
}
async function capture(label) {
  writeFileSync(join(evidenceDirectory, `${label}.png`), (await target.webContents.capturePage()).toPNG());
  const snapshot = await js(`(() => {
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    return {inert:document.querySelector('#app-shell-workspace')?.inert,
      safe:[...document.querySelectorAll('[data-cua-safe-surface]')].map(e=>({kind:e.dataset.cuaSafeSurface,rect:rect(e)})),
      protected:[...document.querySelectorAll('[data-cua-protected]')].map(e=>({kind:e.dataset.cuaProtected,rect:rect(e)})),
      active:document.activeElement?.outerHTML.slice(0,400),
      status:[...document.querySelectorAll('[role=status]')].map(e=>e.textContent)};
  })()`);
  evidence.snapshots.push({ label, at: performance.now(), focus: { window: target.isFocused(), contents: target.webContents.isFocused() }, snapshot,
    state: await bridge('cuaGetState') });
  writeFileSync(join(evidenceDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
function lastFrame(messages) {
  for (const message of [...messages].reverse()) {
    if (!['observeEditorWindow', 'executeCuaAction'].includes(message.name) || typeof message.content !== 'string') continue;
    try {
      const frame = JSON.parse(message.content.split('\n').at(-1));
      if (frame.frameId && frame.sessionId) return frame;
    } catch { /* Other tool messages are not observations. */ }
  }
  return null;
}
const originalModelInvoke = ChatOllama.prototype.invoke;
ChatOllama.prototype.invoke = async function(messages, options) {
  options?.signal?.throwIfAborted();
  evidence.modelCalls.push({ kind: scenario.kind, stage: scenario.stage, at: performance.now() });
  if (scenario.stage++ === 0) return new AIMessage({ content: '', tool_calls: [{ id: `observe-${++callSequence}`, name: 'observeEditorWindow', args: {} }] });
  if (scenario.kind === 'dirty-observe') return new AIMessage('Readonly dirty first-turn probe settled; no input or saving requested.');
  if (scenario.stage === 2) {
    const frame = lastFrame(messages);
    if (!frame) return new AIMessage('Synthetic planner stopped after the actual observation tool refused. No input was requested.');
    const point = await pointFor('.timeline-clip', undefined, false);
    assert.ok(point, 'Fixture clip is visible to the deterministic synthetic planner');
    const focusPointer = scenario.kind === 'remap-key' ? await pointFor('[aria-label="Audio 1 lane. Drop assets or clips here."]', undefined, false) : null;
    if (scenario.kind === 'remap-key') assert.ok(focusPointer, 'Separate disclosed focus-pointer target is visible');
    const action = scenario.kind === 'remap-key' ? { kind: 'click', point: focusPointer }
      : scenario.kind.startsWith('remap-') ? { kind: 'key', key: 'ArrowUp', modifiers: [] }
      : ['move', 'move-save', 'save-deny', 'cancel'].includes(scenario.kind)
      ? { kind: 'drag', from: point, to: { x: point.x + 65, y: point.y }, durationMs: scenario.kind === 'cancel' ? 1800 : 600 }
      : { kind: 'click', point };
    lastActionCallId = `action-${++callSequence}`;
    return new AIMessage({ content: '', tool_calls: [{ id: lastActionCallId, name: 'executeCuaAction', args: {
      sessionId: frame.sessionId, runId: frame.runId, windowId: frame.windowId,
      frameId: scenario.kind === 'stale' ? `${frame.frameId}-stale` : frame.frameId, layoutRevision: frame.layoutRevision, contentRevision: frame.contentRevision, action
    } }] });
  }
  if (scenario.stage === 3) {
    const result = [...messages].reverse().find(message => message.name === 'executeCuaAction');
    try {
      if (JSON.parse(result?.content).actionExecuted) return new AIMessage({ content: '',
        tool_calls: [{ id: `observe-after-action-${++callSequence}`, name: 'observeEditorWindow', args: {} }] });
    } catch { /* A denied/failed input is never retried. */ }
  }
  if (scenario.kind === 'remap-key' && scenario.stage === 4) {
    const frame = lastFrame(messages);
    assert.ok(frame, 'A new post-pointer observation is required for the separate key approval');
    lastActionCallId = `key-action-${++callSequence}`;
    return new AIMessage({ content: '', tool_calls: [{ id: lastActionCallId, name: 'executeCuaAction', args: {
      sessionId: frame.sessionId, runId: frame.runId, windowId: frame.windowId, frameId: frame.frameId,
      layoutRevision: frame.layoutRevision, contentRevision: frame.contentRevision,
      action: { kind: 'key', key: 'ArrowUp', modifiers: [] }
    } }] });
  }
  if (scenario.kind === 'remap-key' && scenario.stage === 5) {
    const result = [...messages].reverse().find(message => message.name === 'executeCuaAction');
    if (JSON.parse(result?.content).actionExecuted) return new AIMessage({ content: '',
      tool_calls: [{ id: `observe-after-key-${++callSequence}`, name: 'observeEditorWindow', args: {} }] });
  }
  if (['move-save', 'save-deny'].includes(scenario.kind) && scenario.stage === 4) {
    const frame = lastFrame(messages);
    assert.ok(frame, 'Explicit post-input observation is required for Save');
    return new AIMessage({ content: '', tool_calls: [{ id: `save-${++callSequence}`, name: 'saveCuaEditorProject', args: {
      projectId, sessionId: frame.sessionId, runId: frame.runId, windowId: frame.windowId,
      frameId: frame.frameId, layoutRevision: frame.layoutRevision, contentRevision: frame.contentRevision
    } }] });
  }
  if (scenario.kind === 'move-save' && scenario.stage === 5) {
    const message = [...messages].reverse().find(candidate => candidate.name === 'saveCuaEditorProject');
    const receipt = JSON.parse(String(message?.content));
    scenario.saveReceipt = receipt;
    if (!['persisted', 'persisted-after-cancel', 'already-clean'].includes(receipt.status) || receipt.diskMatches !== true || receipt.uiApplied !== true) {
      return new AIMessage('Save was not fully verified/applied. Inspect the terminal receipt; do not retry the write.');
    }
    return new AIMessage({ content: '', tool_calls: [{ id: `saved-read-${++callSequence}`, name: 'getProjectTimeline', args: { projectId } }] });
  }
  if (scenario.kind === 'move-save' && scenario.stage === 6) {
    const message = [...messages].reverse().find(candidate => candidate.name === 'getProjectTimeline');
    scenario.modeledSavedRead = JSON.parse(String(message?.content));
  }
  return new AIMessage(`Synthetic ${scenario.kind} scenario settled. Verify the saved timeline separately.`);
};

async function prompt(kind) {
  scenario = { kind, stage: 0 };
  await click('[aria-label="Edit Agent prompt"]');
  const text = `CUA integration scenario ${kind}`;
  for (const keyCode of text) input({ type: 'char', keyCode });
  await until('actual prompt character input', () => js(`document.querySelector('[aria-label="Edit Agent prompt"]')?.value===${JSON.stringify(text)}`));
  await click('[aria-label="Send Edit Agent prompt"]');
}
async function waitIdle() {
  await until('agent turn settlement', () => js(`(() => {
    const button=document.querySelector('[aria-label="Send Edit Agent prompt"]');
    return button&&button.textContent.trim()==='Send'&&!document.querySelector('.agent-chat-approval');
  })()`));
}
const productDowns = () => evidence.inputs.filter((event) => event.source === 'product' && event.type === 'mouseDown').length;
const heldInputs = () => {
  const held = new Set();
  for (const event of evidence.inputs.filter((item) => item.source === 'product')) {
    if (event.type === 'mouseDown') held.add('left');
    if (event.type === 'mouseUp') held.delete('left');
    if (event.type === 'keyDown') held.add(event.keyCode);
    if (event.type === 'keyUp') held.delete(event.keyCode);
  }
  return [...held];
};
async function saveThroughUi() {
  const button = await pointFor('.oc-editor-host__save');
  if (!button) {
    evidence.scenarios.push({ kind: 'explicit-save', required: false, at: performance.now() });
    return;
  }
  const previousAcks = evidence.saves.length;
  evidence.scenarios.push({ kind: 'explicit-save', required: true, actor: 'harness-user-ui', at: performance.now() });
  await clickPoint(button);
  await until('actual main save acknowledgement', () => evidence.saves.length > previousAcks);
  assert.equal(evidence.saves.at(-1).ok, true, JSON.stringify(evidence.saves.at(-1)));
  assert.equal(evidence.saves.at(-1).projectId, projectId);
  await until('project save', () => js(`(() => {const b=document.querySelector('[data-testid="editor-save-btn"]');return b?.dataset.dirty==='false'&&b.dataset.saving!=='true'&&b.dataset.saveStatus!=='error';})()`));
}
const liveClip = () => js(`(() => {const e=document.querySelector('.timeline-clip');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,left:e.style.left,timelineStartMs:Number(e.dataset.timelineStartMs),selected:e.classList.contains('timeline-clip--selected')};})()`);
async function savedPosition() {
  const state = await mcp('getProjectTimeline', { projectId });
  return state.project.timeline.tracks.flatMap((track) => track.clips)[0]?.timelineStartMs;
}

let exitCode = 1;
const deadline = setTimeout(() => { evidence.timeout = true; void finish(1); }, 120000);
async function finish(code) {
  clearTimeout(deadline);
  ChatOllama.prototype.invoke = originalModelInvoke;
  evidence.heldInputsAtExit = heldInputs();
  writeFileSync(join(evidenceDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ evidenceDirectory, head: evidence.head, outcome: code === 0 ? 'passed' : 'failed', error: evidence.error }));
  app.once('will-quit', () => app.exit(code));
  app.quit();
  setTimeout(() => app.exit(code), 2500).unref();
}
// Finish loading the production entry before yielding Electron's ESM startup.
// Awaiting app.whenReady at this module's top level would deadlock ready itself.
await import(pathToFileURL(resolve('out/main/index.js')).href);
async function runScenarios() {
try {
  await app.whenReady();
  await until('actual OpenScene renderer', async () => target && !target.webContents.isLoading() && await js('!!window.videoTool&&!!document.querySelector("#root")'));
  if (process.env.CUA_AGENT_REMAP_SAVE_PROBE === '1' || process.env.CUA_AGENT_ORDINARY_SAVE_PROBE === '1') {
    // App mounts the hidden editor on the home screen. Its preference hook reads
    // once, so persisted fixture preferences require a fresh mount before ANY
    // project interaction, observation, run or approval. Never reload a proposal.
    assert.equal(evidence.agentRequests.length, 0);
    await js(`localStorage.setItem('window-loom-editor-shortcuts', JSON.stringify({schemaVersion:1,overrides:{saveTimeline:'ArrowUp'}}))`);
    const loaded = new Promise(resolveLoaded => target.webContents.once('did-finish-load', resolveLoaded));
    target.webContents.reload();
    await loaded;
    await until('fresh renderer after persisted shortcut fixture', () => js('!!window.videoTool&&!!document.querySelector("#root")'));
    evidence.shortcutFixture = { storageKey: 'window-loom-editor-shortcuts', action: 'saveTimeline', key: 'ArrowUp',
      initialization: 'persist-then-reload-before-any-project-or-agent-interaction', agentRequestsBeforeReload: 0 };
  }
  // No OS activation or programmatic focus, including initial setup.
  // Native window-manager focus or an actual user selection is required.
  evidence.userRole = { synthetic: true, actualHumanSelection: false, autoFocus: false };
  evidence.window = { id: target.id, title: target.getTitle(), windowFocused: target.isFocused(), contentsFocused: target.webContents.isFocused() };
  await js(`window.__cuaAgentEvents=[];window.__cuaAgentStates=[];
    window.videoTool.onCuaStateChanged(s=>window.__cuaAgentStates.push({at:performance.now(),state:s}));
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','focusin'])document.addEventListener(type,e=>{
      window.__cuaAgentEvents.push({at:performance.now(),type,x:e.clientX,y:e.clientY,buttons:e.buttons,target:e.target.className});
    },true);`);
  if (await pointFor('button', 'Skip setup')) await click('button', 'Skip setup');
  await until('fixture project', () => pointFor('.projects-home__project'));
  const clip = await mcp('addClipToTimeline', { projectId, assetId, durationSeconds: 2 });
  evidence.fixtureClip = clip;
  evidence.fixtureTimeline = await mcp('getProjectTimeline', { projectId });
  await click('.projects-home__project');
  // Phase 1B opens Natural by default. Explicit synthetic user-role selection
  // enters the real precision surface before any observation or approval.
  await click('[data-testid="mode-tab-precision"]');
  await until('MCP-created timeline clip', () => pointFor('.timeline-clip'));
  if (!await pointFor('[aria-label="Edit Agent prompt"]')) await click('button', 'Assistant');
  if (process.env.CUA_AGENT_ORDINARY_SAVE_PROBE !== '1') {
    await click('[data-testid="agent-mode-self-window"]');
    await until('explicit Window CUA mode after cancellation settlement', () => js('document.querySelector("[data-testid=agent-mode-self-window]")?.getAttribute("aria-pressed")==="true"'));
  }
  if (process.env.CUA_AGENT_DIRTY_READ_PROBE === '1' || process.env.CUA_AGENT_REMAP_SAVE_PROBE === '1' || process.env.CUA_AGENT_ORDINARY_SAVE_PROBE === '1') {
    const before = await liveClip();
    const point = await pointFor('.timeline-clip');
    const zoom = target.webContents.getZoomFactor();
    input({ type: 'mouseMove', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) });
    input({ type: 'mouseDown', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step++) {
      input({ type: 'mouseMove', x: Math.round((point.x + step * 5) * zoom), y: Math.round(point.y * zoom), modifiers: ['leftbuttondown'] });
      await wait(12);
    }
    input({ type: 'mouseUp', x: Math.round((point.x + 60) * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
    await until('user-role fixture edit is visibly dirty', () => js('document.querySelector("[data-testid=timeline-canvas]")?.dataset.dirty==="true"'));
    const after = await liveClip(), saved = await savedPosition();
    assert.ok(after.timelineStartMs > before.timelineStartMs, 'User-role fixture setup changed the live timeline');
    assert.equal(saved, before.timelineStartMs, 'User-role fixture setup has not saved the project');
    evidence.scenarios.push({ kind: 'user-role-dirty-fixture-setup', before, after, savedPosition: saved });
  }
  await capture('00-actual-app-before-observe');
  const focusWaitMs = Number(process.env.CUA_AGENT_WAIT_FOR_FOCUS_MS || 0);
  assert.ok(Number.isFinite(focusWaitMs) && focusWaitMs >= 0 && focusWaitMs <= 60000, 'Focus wait must be between 0 and 60000 ms');
  if (focusWaitMs && (!target.isFocused() || !target.webContents.isFocused())) {
    console.log(JSON.stringify({ waitingForUserSelection: true, windowId: target.id, title: target.getTitle(), evidenceDirectory, focusWaitMs }));
    await until('one explicit user selection of the test OpenScene window', () => target.isFocused() && target.webContents.isFocused(), focusWaitMs);
    await capture('explicit-user-window-selection');
  }
  if (!target.isFocused() || !target.webContents.isFocused()) {
    const legacyBefore = evidence.saveRequests.length;
    const dirtyBefore = await js('document.querySelector("[data-testid=timeline-canvas]")?.dataset.dirty');
    await prompt('focus-probe');
    await until('actual product focus refusal', () => js('document.body.textContent.includes("CUA_NOT_FOCUSED")'));
    await capture('actual-product-focus-refusal');
    assert.equal(evidence.saveRequests.length, legacyBefore, 'Explicit CUA first turn must emit zero legacy save requests');
    assert.equal(await js('document.querySelector("[data-testid=timeline-canvas]")?.dataset.dirty'), dirtyBefore, 'Observation refusal must preserve dirty live UI');
    evidence.scenarios.push({ kind: 'self-window-first-send-legacy-save-zero', dirtyBefore, dirtyAfter: dirtyBefore,
      legacySaveRequests: evidence.saveRequests.length - legacyBefore, savedPosition: await savedPosition(), live: await liveClip() });
    assert.fail('CUA_NOT_FOCUSED: actual own OpenScene window/contents lack focus; observed product tool refusal, zero product input, guard remains enabled');
  }
  await until('Frontend safe surface marker', () => js('!!document.querySelector("[data-cua-safe-surface]")'));
  if (process.env.CUA_AGENT_ORDINARY_SAVE_PROBE === '1') {
    const state = await bridge('cuaGetState');
    assert.ok(['idle', 'stopped'].includes(state.phase) && state.cleanupComplete, 'Ordinary Save fixture has no active CUA run');
    assert.equal(await js('!!document.querySelector(".agent-chat-approval")'), false);
    assert.equal(evidence.agentRequests.length, 0, 'Independent ordinary fixture submits no agent prompt');
    const before = await savedPosition(), live = await liveClip(), legacyBefore = evidence.saveRequests.length;
    await click('[aria-label="Audio 1 lane. Drop assets or clips here."]');
    await until('ordinary user pointer focus delivery', () => js('!!document.activeElement?.closest("[data-cua-safe-surface]")'));
    assert.equal(await js('!!document.activeElement?.closest("[data-cua-safe-surface]")'), true, 'Disclosed ordinary-user pointer established safe focus');
    input({ type: 'keyDown', keyCode: 'Up' });
    input({ type: 'keyUp', keyCode: 'Up' });
    await until('ordinary user remapped Save main acknowledgement', () => evidence.saves.some(save => save.ok === true && save.startedAt >= (evidence.saveRequests[legacyBefore]?.at ?? Infinity)));
    await until('ordinary user remapped Save clears dirty', () => js('document.querySelector("[data-testid=timeline-canvas]")?.dataset.dirty==="false"'));
    assert.ok(evidence.saveRequests.length > legacyBefore);
    assert.ok(live.timelineStartMs > before);
    assert.equal(await savedPosition(), live.timelineStartMs);
    assert.equal(JSON.parse(readFileSync(join(projectDirectory, 'project.json'), 'utf8')).timeline.tracks.flatMap(track => track.clips)[0].timelineStartMs, live.timelineStartMs);
    assert.deepEqual(heldInputs(), []);
    evidence.scenarios.push({ kind: 'ordinary-user-remapped-save', actor: 'harness-ui', actualHumanSelection: false,
      before, after: live.timelineStartMs, legacySaveRequests: evidence.saveRequests.length - legacyBefore, passed: true });
    await capture('ordinary-user-remapped-save-settled');
  } else if (process.env.CUA_AGENT_DIRTY_READ_PROBE === '1') {
    const legacyBefore = evidence.saveRequests.length;
    const liveBefore = await liveClip(), savedBefore = await savedPosition();
    await prompt('dirty-observe');
    await waitIdle();
    assert.equal(evidence.saveRequests.length, legacyBefore, 'Readonly CUA first turn must not save dirty UI');
    assert.equal((await liveClip()).timelineStartMs, liveBefore.timelineStartMs);
    assert.equal(await savedPosition(), savedBefore);
    assert.equal(await js('document.querySelector("[data-testid=timeline-canvas]")?.dataset.dirty'), 'true');
    assert.equal(productDowns(), 0);
    evidence.scenarios.push({ kind: 'dirty-observe-only', legacySaveRequests: 0, live: await liveClip(), savedPosition: savedBefore });
    await capture('dirty-observe-only-settled');
  } else {
  const scenarios = (process.env.CUA_AGENT_SCENARIOS || (process.env.CUA_AGENT_REMAP_SAVE_PROBE === '1' ? 'remap-deny,remap-cancel,remap-pending-click,remap-key' : 'deny,stale,duplicate,save-deny,move-save,cancel')).split(',');
  for (const kind of scenarios) {
    const before = await savedPosition();
    const liveBefore = await liveClip();
    const downs = productDowns();
    const legacyBefore = evidence.saveRequests.length;
    await prompt(kind);
    if (kind === 'stale') {
      await until('stale observation rejected', () => js('document.body.textContent.includes("CUA_FRAME_STALE")'));
      assert.equal(productDowns(), downs);
    } else {
      await until('exact CUA approval', () => js('document.querySelector(".agent-chat-approval")?.textContent.includes("executeCuaAction")'));
      await capture(`${kind}-pending`);
      assert.equal(evidence.saveRequests.length, legacyBefore, 'Opening a CUA proposal must not perform legacy Save');
      assert.equal(productDowns(), downs);
      const conversation = kind === 'duplicate' ? (await bridge('agentChatHistoryList')).find((entry) => entry.projectId === projectId && entry.title.includes('duplicate')) : null;
      if (kind === 'remap-pending-click') {
        const readSafeReturn = async () => ({
          state: await bridge('cuaGetState'), live: await liveClip(),
          dom: await js(`(() => {const active=document.activeElement;return {
            activeTag:active?.tagName,safeFocus:!!active?.closest('[data-cua-safe-surface]'),
            dirty:document.querySelector('[data-testid=timeline-canvas]')?.dataset.dirty,
            approval:document.querySelector('.agent-chat-approval')?.textContent??null};})()`),
          inputCount: evidence.inputs.length, productDowns: productDowns()
        });
        const beforeReturn = await readSafeReturn();
        // Explicit harness-user pointer action, not an agent action or a human
        // window selection. It receives no permit and cannot rebind a frame.
        await click('.timeline-clip');
        const afterReturn = await readSafeReturn();
        evidence.scenarios.push({ kind: 'explicit-harness-user-safe-return', actor: 'harness-ui',
          actualHumanSelection: false, before: beforeReturn, after: afterReturn });
        await capture('remap-pending-click-user-cancellation');
        assert.equal(afterReturn.live.timelineStartMs, beforeReturn.live.timelineStartMs, 'Safe return must not mutate content');
        assert.equal(afterReturn.dom.dirty, beforeReturn.dom.dirty);
        assert.equal(afterReturn.productDowns, beforeReturn.productDowns, 'Safe return is not guarded product input');
        const stopped = await until('pending external user click cancels and releases', async () => {
          const state = await bridge('cuaGetState');
          return state.phase === 'stopped' && state.cleanupComplete ? state : null;
        });
        assert.equal(stopped.error, 'user-input');
        assert.deepEqual(heldInputs(), []);
        assert.equal(await savedPosition(), before, 'Pending user click cancellation never publishes');
        assert.equal(evidence.saveRequests.length, legacyBefore);
        assert.equal(evidence.inputs.filter(event => event.source === 'product' && event.type === 'keyDown').length, 0);
        assert.equal(afterReturn.state.sessionId, beforeReturn.state.sessionId);
        assert.equal(afterReturn.state.runId, beforeReturn.state.runId);
        assert.equal(afterReturn.dom.approval, beforeReturn.dom.approval, 'Never reuse a replaced approval');
        evidence.scenarios.push({ kind, before, after: await savedPosition(), passed: true, held: heldInputs(),
          negativeOnly: true, actualHumanSelection: false, stopped });
        await capture('remap-pending-click-cancelled');
        await click('[aria-label="Reset conversation"]');
        continue; // Never approve, retry or rebind the cancelled request.
      }
      if (kind === 'remap-key') {
        const pointerApproval = [...evidence.agentRequests].reverse().find(record => record.response?.pendingApproval?.toolName === 'executeCuaAction')?.response.pendingApproval;
        assert.equal(pointerApproval?.cuaApproval?.actionKind, 'click');
        evidence.scenarios.push({ kind: 'disclosed-separate-pointer-approval', actor: 'harness-ui', actualHumanSelection: false, approval: pointerApproval });
        await click('.agent-chat-approval button', '한 번 승인');
        await until('new separately approved key after pointer settlement and observation', () => js('document.querySelector(".agent-chat-approval")?.textContent.includes("Press ArrowUp")'));
        const state = await bridge('cuaGetState');
        assert.equal(state.phase, 'ready');
        assert.equal(state.lastDispatchReceipt?.actionKind, 'click');
        assert.equal(state.lastDispatchReceipt?.rendererSettlement, 'acknowledged');
        assert.equal(state.cleanupComplete, true);
        assert.equal(await js('!!document.activeElement?.closest("[data-cua-safe-surface]")'), true, 'Separate pointer action established focus without user input during key approval');
        const keyApproval = [...evidence.agentRequests].reverse().find(record => record.response?.pendingApproval?.toolName === 'executeCuaAction')?.response.pendingApproval;
        assert.equal(keyApproval?.cuaApproval?.actionKind, 'key');
        assert.notEqual(keyApproval?.args?.frameId, pointerApproval?.args?.frameId, 'Key binds a fresh post-pointer observation');
        evidence.scenarios.push({ kind: 'disclosed-separate-key-approval', actor: 'harness-ui', actualHumanSelection: false, approval: keyApproval, pointerReceipt: state.lastDispatchReceipt });
        await capture('remap-key-separate-key-pending');
      }
      if (kind === 'remap-cancel') await click('[data-testid="cua-stop-btn"]');
      else await click('.agent-chat-approval button', ['deny', 'remap-deny'].includes(kind) ? '거절' : '한 번 승인');
      if (kind === 'duplicate') {
        assert.ok(conversation, 'Actual pending conversation was persisted');
        const duplicate = await bridge('agentChatApprove', { conversationId: conversation.conversationId, toolCallId: lastActionCallId, decision: 'approve' });
        evidence.scenarios.push({ kind: 'duplicate-approval-response', result: duplicate });
        assert.ok(duplicate.errorCode === 'CUA_BUSY' || /no longer matches|REPLAYED/.test(duplicate.error ?? ''), 'Duplicate approval was refused through actual IPC/session ledger');
      }
      if (kind === 'move-save' || kind === 'save-deny') {
        await until('separate explicit live snapshot Save approval', () => js('document.querySelector(".agent-chat-approval")?.textContent.includes("saveCuaEditorProject")'));
        assert.equal(evidence.saveRequests.length, legacyBefore, 'Preparing the dirty Save proposal cannot call legacy Save');
        await capture(`${kind}-save-pending`);
        const pending = [...evidence.agentRequests].reverse().find(record => record.response?.pendingApproval?.toolName === 'saveCuaEditorProject')?.response.pendingApproval;
        assert.equal(pending?.cuaApproval?.actionKind, 'save');
        assert.equal(pending.cuaApproval.dirty, true);
        assert.ok(pending.cuaApproval.snapshotId && pending.cuaApproval.timelineDigest, 'Main pinned the exact snapshot identity before approval');
        await click('.agent-chat-approval button', kind === 'save-deny' ? '거절' : '한 번 승인');
      }
      if (kind === 'cancel') {
        await until('actual held drag', async () => (await bridge('cuaGetState')).phase === 'acting' && heldInputs().length > 0);
        await click('[data-testid="cua-stop-btn"]');
        const stopped = await until('ack and physical release settlement', async () => {
          const state = await bridge('cuaGetState');
          return ['stopped', 'cleanup-failed'].includes(state.phase) ? state : null;
        });
        assert.equal(stopped.cleanupComplete, true, JSON.stringify(stopped));
        assert.deepEqual(heldInputs(), []);
      }
      await waitIdle();
      assert.equal(evidence.saveRequests.length, legacyBefore, 'CUA approval/denial/cancel must not call legacy project-timeline:save');
      if (kind === 'deny') assert.equal(productDowns(), downs);
      if (['move', 'move-save', 'save-deny', 'duplicate'].includes(kind)) {
        assert.equal(productDowns(), downs + 1, 'Only one approved pointer action dispatch');
        const state = await bridge('cuaGetState');
        assert.equal(state.phase, 'ready', JSON.stringify(state));
        assert.equal(state.cleanupComplete, true, JSON.stringify(state));
        await until('actual CUA clip selection', () => pointFor('.timeline-clip--selected'));
      }
    }
    const liveAfter = await liveClip();
    if (kind === 'move-save') {
      assert.ok(scenario.modeledSavedRead?.success, 'The actual model tool loop completed saved MCP verification');
      assert.equal(scenario.saveReceipt?.diskMatches, true);
      assert.equal(scenario.saveReceipt?.uiApplied, true);
      assert.equal(await js('document.querySelector("[data-testid=timeline-canvas]")?.dataset.dirty'), 'false');
      assert.equal(evidence.saveRequests.length, legacyBefore, 'The approved Save path bypasses no legacy approval boundary');
    } else if (kind === 'save-deny') {
      assert.equal(await savedPosition(), before, 'Denied Save publishes no live UI edit');
      assert.equal(await js('document.querySelector("[data-testid=timeline-canvas]")?.dataset.dirty'), 'true');
      evidence.scenarios.push({ kind: 'explicit-save-denied', live: liveAfter, saved: before, legacySaveRequests: evidence.saveRequests.length - legacyBefore });
      const undo = Menu.getApplicationMenu()?.getMenuItemById('timeline:undo');
      await nativeMenuReady('undo');
      assert.ok(undo?.enabled); undo.click(undefined, target, undefined);
      await until('user-role cleanup Undo after denied Save', async () => (await liveClip()).timelineStartMs === before);
    } else if (kind.startsWith('remap-')) {
      assert.equal(evidence.saveRequests.length, legacyBefore, 'Remapped allowed CUA key must never dispatch legacy Save');
      assert.equal(await savedPosition(), before, 'Remapped CUA key must not publish');
      const keyDowns = evidence.inputs.filter(event => event.source === 'product' && event.type === 'keyDown' && event.keyCode === 'Up');
      evidence.scenarios.push({ kind: 'remap-save-boundary', scenario: kind, productArrowUpDowns: keyDowns.length, legacySaveRequests: 0 });
      if (kind === 'remap-key') {
        assert.ok(keyDowns.length > 0, 'Focus/safety refusal is not proof of safe dispatched key semantics');
        const state = await bridge('cuaGetState');
        assert.equal(state.lastDispatchReceipt?.actionKind, 'key');
        assert.equal(state.lastDispatchReceipt?.dispatch, 'full-dispatch');
        assert.equal(state.lastDispatchReceipt?.rendererSettlement, 'acknowledged');
        assert.equal(state.cleanupComplete, true);
        assert.deepEqual(state.releaseFailures, []);
        assert.equal(liveAfter.timelineStartMs, liveBefore.timelineStartMs, 'Fixed ArrowUp semantics never publishes or moves the clip');
        evidence.scenarios.push({ kind: 'positive-key-terminal-receipt', receipt: state.lastDispatchReceipt });
      }
      else assert.equal(keyDowns.length, 0, 'Denied/cancelled key must dispatch zero inputs');
      assert.deepEqual(heldInputs(), []);
    } else await saveThroughUi();
    const after = await savedPosition();
    if (kind === 'move' || kind === 'move-save') {
      assert.ok(after > before, `MCP saved position changed: ${before} → ${after}`);
      const modifier = process.platform === 'darwin' ? 'meta' : 'control';
      input({ type: 'keyDown', keyCode: 'z', modifiers: [modifier] });
      input({ type: 'keyUp', keyCode: 'z', modifiers: [modifier] });
      await until('actual app native key Undo restores one live edit', async () => (await liveClip()).timelineStartMs === before);
      evidence.scenarios.push({ kind: 'user-role-native-key-undo', key: `${modifier}+z`, live: await liveClip(),
        savedBeforeUndoSave: await savedPosition(), productionCuaKeyValidated: false });
      const redo = Menu.getApplicationMenu()?.getMenuItemById('timeline:redo');
      await nativeMenuReady('redo');
      assert.ok(redo?.enabled, 'The single live edit can be redone through the actual app menu');
      const beforeRedoReport = evidence.menuReports.length;
      redo.click(undefined, target, undefined);
      await until('app menu Redo restores the moved live clip', async () => (await liveClip()).timelineStartMs === after);
      const undo = Menu.getApplicationMenu()?.getMenuItemById('timeline:undo');
      await nativeMenuReady('undo', beforeRedoReport);
      assert.ok(undo?.enabled, 'Actual app Undo menu is enabled');
      evidence.scenarios.push({ kind: 'ui-undo-menu', menuId: undo.id, at: performance.now() });
      undo.click(undefined, target, undefined);
      await until('live UI Undo restores clip position before saving', async () => Math.abs((await liveClip()).x - liveBefore.x) <= 0.5);
      evidence.scenarios.push({ kind: 'live-ui-undo-before-save', geometry: await liveClip(), savedPositionBeforeUndoSave: await savedPosition() });
      await saveThroughUi();
      assert.equal(await savedPosition(), before, 'One UI Undo restores the original saved timeline');
    } else assert.equal(after, before);
    evidence.scenarios.push({ kind, before, after, liveBefore, liveAfter, saveReceipt: scenario.saveReceipt,
      modeledSavedProjectId: scenario.modeledSavedRead?.project?.id,
      modeledSavedClips: scenario.modeledSavedRead?.project?.timeline?.tracks.flatMap(track => track.clips.map(clip => ({ id: clip.id, timelineStartMs: clip.timelineStartMs }))),
      driverDowns: productDowns() - downs, held: heldInputs(), passed: true });
    await capture(`${kind}-settled`);
    // Actual reset waits driver release and removes the old run/checkpoint.
    await click('[aria-label="Reset conversation"]');
  }
  }
  evidence.states = await js('window.__cuaAgentStates');
  evidence.domEvents = await js('window.__cuaAgentEvents');
  exitCode = 0;
} catch (error) {
  evidence.error = error instanceof Error ? error.stack : String(error);
  if (target && !target.isDestroyed()) {
    try { await capture('failure'); evidence.states = await js('window.__cuaAgentStates'); evidence.domEvents = await js('window.__cuaAgentEvents'); } catch { /* Keep the original failure. */ }
  }
} finally { await finish(exitCode); }
}
void runScenarios();
