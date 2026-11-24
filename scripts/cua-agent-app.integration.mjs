/**
 * Test-only entry: npm run build && node_modules/.bin/electron scripts/cua-agent-app.integration.mjs
 * Only the model's invoke is substituted. The actual built main, renderer,
 * approval IPC, safety snapshots, driver and release settlement stay intact.
 * A fresh local fixture is written before app startup; no existing user data is used.
 */
import { app, ipcMain, Menu } from 'electron';
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
  syntheticModel: true, liveModelQualityTested: false, profile, projectId, inputs: [], states: [], snapshots: [], surfaceReports: [], saves: [], modelCalls: [], scenarios: [] };
let target;
let source = 'product';
let scenario = { kind: 'move', stage: 0 };
let callSequence = 0;
let lastActionCallId = null;
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel === 'project-timeline:save') return originalHandle(channel, async (event, payload) => {
    const startedAt = performance.now();
    const response = await handler(event, payload);
    evidence.saves.push({ startedAt, completedAt: performance.now(), projectId: payload?.projectId,
      ok: response?.ok, updatedAt: response?.value?.updatedAt,
      clips: response?.value?.timeline?.tracks.flatMap(track => track.clips.map(clip => ({ id: clip.id, timelineStartMs: clip.timelineStartMs }))) });
    return response;
  });
  return originalHandle(channel, channel !== 'cua:report-surface-snapshot' ? handler : (event, snapshot) => {
  // Passive evidence tap: original sender, payload, handler and return value.
  evidence.surfaceReports.push({ at: performance.now(), snapshot: structuredClone(snapshot) });
  return handler(event, snapshot);
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
async function mcp(name, args) {
  const result = await bridge('mcpExecuteTool', name, args);
  assert.equal(result?.success, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}
async function pointFor(selector, text) {
  return js(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => {
      const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&${text === undefined ? 'true' : `e.textContent.trim()===${JSON.stringify(text)}`};
    });
    if(!element||element.disabled) return null;
    const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
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
  if (scenario.stage === 2) {
    const frame = lastFrame(messages);
    if (!frame) return new AIMessage('Synthetic planner stopped after the actual observation tool refused. No input was requested.');
    const point = await pointFor('.timeline-clip');
    assert.ok(point, 'Fixture clip is visible to the deterministic synthetic planner');
    const action = ['move', 'cancel'].includes(scenario.kind)
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
  return new AIMessage(`Synthetic ${scenario.kind} scenario settled. Verify the saved timeline separately.`);
};

async function prompt(kind) {
  scenario = { kind, stage: 0 };
  await click('[aria-label="Edit Agent prompt"]');
  target.webContents.insertText(`CUA integration scenario ${kind}`);
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
  // Test setup explicitly selects only this own app once. Never bypass the
  // production driver's focus checks or refocus during an approved action.
  app.focus({ steal: true }); target.focus(); target.webContents.focus();
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
  await until('MCP-created timeline clip', () => pointFor('.timeline-clip'));
  if (!await pointFor('[aria-label="Edit Agent prompt"]')) await click('button', 'Assistant');
  await capture('00-actual-app-before-observe');
  const focusWaitMs = Number(process.env.CUA_AGENT_WAIT_FOR_FOCUS_MS || 0);
  assert.ok(Number.isFinite(focusWaitMs) && focusWaitMs >= 0 && focusWaitMs <= 60000, 'Focus wait must be between 0 and 60000 ms');
  if (focusWaitMs && (!target.isFocused() || !target.webContents.isFocused())) {
    console.log(JSON.stringify({ waitingForUserSelection: true, windowId: target.id, title: target.getTitle(), evidenceDirectory, focusWaitMs }));
    await until('one explicit user selection of the test OpenScene window', () => target.isFocused() && target.webContents.isFocused(), focusWaitMs);
    await capture('explicit-user-window-selection');
  }
  if (!target.isFocused() || !target.webContents.isFocused()) {
    await prompt('focus-probe');
    await until('actual product focus refusal', () => js('document.body.textContent.includes("CUA_NOT_FOCUSED")'));
    await capture('actual-product-focus-refusal');
    assert.fail('CUA_NOT_FOCUSED: actual own OpenScene window/contents lack focus; observed product tool refusal, zero product input, guard remains enabled');
  }
  await until('Frontend safe surface marker', () => js('!!document.querySelector("[data-cua-safe-surface]")'));
  const scenarios = (process.env.CUA_AGENT_SCENARIOS || 'deny,stale,duplicate,move,cancel').split(',');
  for (const kind of scenarios) {
    const before = await savedPosition();
    const liveBefore = await liveClip();
    const downs = productDowns();
    await prompt(kind);
    if (kind === 'stale') {
      await until('stale observation rejected', () => js('document.body.textContent.includes("CUA_FRAME_STALE")'));
      assert.equal(productDowns(), downs);
    } else {
      await until('exact CUA approval', () => js('document.querySelector(".agent-chat-approval")?.textContent.includes("executeCuaAction")'));
      await capture(`${kind}-pending`);
      assert.equal(productDowns(), downs);
      const conversation = kind === 'duplicate' ? (await bridge('agentChatHistoryList')).find((entry) => entry.projectId === projectId && entry.title.includes('duplicate')) : null;
      await click('.agent-chat-approval button', kind === 'deny' ? 'Deny' : 'Run once');
      if (kind === 'duplicate') {
        assert.ok(conversation, 'Actual pending conversation was persisted');
        const duplicate = await bridge('agentChatApprove', { conversationId: conversation.conversationId, toolCallId: lastActionCallId, decision: 'approve' });
        evidence.scenarios.push({ kind: 'duplicate-approval-response', result: duplicate });
        assert.ok(duplicate.errorCode === 'CUA_BUSY' || /no longer matches|REPLAYED/.test(duplicate.error ?? ''), 'Duplicate approval was refused through actual IPC/session ledger');
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
      if (kind === 'deny') assert.equal(productDowns(), downs);
      if (kind === 'move' || kind === 'duplicate') {
        assert.equal(productDowns(), downs + 1, 'Only one approved pointer action dispatch');
        const state = await bridge('cuaGetState');
        assert.equal(state.phase, 'ready', JSON.stringify(state));
        assert.equal(state.cleanupComplete, true, JSON.stringify(state));
        await until('actual CUA clip selection', () => pointFor('.timeline-clip--selected'));
      }
    }
    const liveAfter = await liveClip();
    await saveThroughUi();
    const after = await savedPosition();
    if (kind === 'move') {
      assert.ok(after > before, `MCP saved position changed: ${before} → ${after}`);
      const undo = Menu.getApplicationMenu()?.getMenuItemById('timeline:undo');
      assert.ok(undo?.enabled, 'Actual app Undo menu is enabled');
      evidence.scenarios.push({ kind: 'ui-undo-menu', menuId: undo.id, at: performance.now() });
      undo.click(undefined, target, undefined);
      await until('live UI Undo restores clip position before saving', async () => Math.abs((await liveClip()).x - liveBefore.x) <= 0.5);
      evidence.scenarios.push({ kind: 'live-ui-undo-before-save', geometry: await liveClip(), savedPositionBeforeUndoSave: await savedPosition() });
      await saveThroughUi();
      assert.equal(await savedPosition(), before, 'One UI Undo restores the original saved timeline');
    } else assert.equal(after, before);
    evidence.scenarios.push({ kind, before, after, liveBefore, liveAfter, driverDowns: productDowns() - downs, held: heldInputs(), passed: true });
    await capture(`${kind}-settled`);
    // Actual reset waits driver release and removes the old run/checkpoint.
    await click('[aria-label="Reset conversation"]');
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
