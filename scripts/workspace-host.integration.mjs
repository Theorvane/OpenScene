// Isolated mounted-renderer QA. Every UI action is synthetic, never human selection.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { installWorkspaceQaNetworkGuard } from './workspace-qa-network-guard.mjs';

const baseline = process.env.WORKSPACE_QA_BASELINE === '1';
const dir = resolve(process.env.WORKSPACE_QA_DIR);
mkdirSync(dir, { recursive: true });
const profile = mkdtempSync(join(dir, 'profile-'));
app.setPath('userData', profile);
const id = randomUUID(), emptyId = randomUUID(), assetId = randomUUID(), timestamp = new Date().toISOString();
const projectName = '합성 QA 원본 · 긴 한국어 프로젝트 이름과 수동 정밀 편집 보존 확인';
const assetDirectory = join(profile, 'projects', id, 'assets', assetId);
mkdirSync(assetDirectory, { recursive: true });
const source = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const sourcePath = join(assetDirectory, 'original.png');
writeFileSync(sourcePath, source);
const projectPath = join(profile, 'projects', id, 'project.json');
writeFileSync(projectPath, JSON.stringify({ schemaVersion: 4, id, name: projectName, projectType: 'editing', createdAt: timestamp, updatedAt: timestamp,
  assets: [{ id: assetId, displayName: '합성 QA 원본.png', projectRelativePath: `assets/${assetId}/original.png`, kind: 'image', mimeType: 'image/png', byteLength: source.length, metadata: { durationMs: 60000, width: 1, height: 1 }, createdAt: timestamp, updatedAt: timestamp }],
  timeline: { schemaVersion: 3, tracks: [{ id: 'video-track-1', name: 'Video 1', kind: 'video', clips: [{ id: 'clip-qa', assetId, timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 60000, sourceDurationMs: 60000, effects: { opacity: 1, scale: 1, positionX: 0, positionY: 0, rotation: 0, volume: 1 }, keyframes: [] }] }, { id: 'audio-track-1', name: 'Audio 1', kind: 'audio', clips: [], mix: { gainDb: 0, pan: 0, muted: false } }], transitions: [] },
  ai: { schemaVersion: 1, scripts: [], scenes: [], shots: [], characters: [], styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] }, referenceAssets: [], generations: [], provenance: [] }
}));
// An actual empty local fixture exercises intake and explicit deletion without
// creating a fake completed job/media result or touching the source image.
const emptyDirectory = join(profile, 'projects', emptyId);
mkdirSync(join(emptyDirectory, 'assets'), { recursive: true });
const originalProject = JSON.parse(readFileSync(projectPath, 'utf8'));
writeFileSync(join(emptyDirectory, 'project.json'), JSON.stringify({ ...originalProject, id: emptyId, name: '합성 QA 빈 프로젝트', assets: [],
  timeline: { ...originalProject.timeline, tracks: originalProject.timeline.tracks.map(track => ({ ...track, clips: [] })) } }));
const evidence = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), baseline, profile, syntheticUserRole: true, actualHumanSelection: false, noOsActivation: true, liveModelCalls: false, captures: [], console: [], snapshots: [], ipc: [], checks: [] };
const networkGuard = installWorkspaceQaNetworkGuard();
await networkGuard.verifyBeforeStartup();
evidence.tripwire = networkGuard.telemetry;
app.once('ready', () => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, networkGuard.chromiumRequest));
let target;
app.on('browser-window-created', (_event, win) => {
  assert.equal(target, undefined, 'one Electron app window'); target = win;
  win.webContents.on('console-message', (_event, level, message) => evidence.console.push({ level, message }));
  win.webContents.on('render-process-gone', (_event, details) => evidence.console.push({ kind: 'render-process-gone', details }));
});
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
  if (channel === 'cua:report-surface-snapshot') evidence.snapshots.push(args[0]);
  const observed = ['shorts:list', 'project-timeline:save', 'agent-chat:send', 'agent-chat:approve', 'agent-chat:cancel'].includes(channel);
  const record = observed ? { channel, projectId: args[0]?.projectId, startedAt: performance.now() } : null;
  if (record) evidence.ipc.push(record);
  const result = await handler(event, ...args);
  if (record) Object.assign(record, { ok: result?.ok, value: channel === 'shorts:list' ? result?.value : undefined, error: result?.value?.error ?? result?.error?.message });
  return result;
});
const js = code => target.webContents.executeJavaScript(code);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(label, predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await wait(30); }
  throw new Error(`Timed out: ${label}`);
}
async function point(selector, text) {
  return js(`(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>{const r=e.getBoundingClientRect();return !e.disabled&&!e.closest('[hidden]')&&r.width>0&&r.height>0&&${text ? `e.textContent.trim()===${JSON.stringify(text)}` : 'true'}});if(!e)return null;const r=e.getBoundingClientRect();const x=Math.max(0,r.x)+Math.min(r.width,120)/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&(hit===e||e.contains(hit))?{x,y}:null;})()`);
}
async function click(selector, text) {
  const p = await until(`click ${selector} ${text ?? ''}`, () => point(selector, text));
  const z = target.webContents.getZoomFactor();
  const location = { x: Math.round(p.x*z), y: Math.round(p.y*z), button: 'left', clickCount: 1 };
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) target.webContents.sendInputEvent({ type, ...location });
}
async function key(keyCode, modifiers = []) {
  target.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  target.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
async function capture(label) {
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  writeFileSync(join(dir, `${label}.png`), (await target.webContents.capturePage()).toPNG());
  const layout = await js(`(() => {const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};const visible=e=>!e.closest('[hidden]')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;return {viewport:{width:innerWidth,height:innerHeight},docWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,mode:document.querySelector('[data-workspace-mode]')?.dataset.workspaceMode,project:document.querySelector('[data-testid=workspace-project-name]')?.textContent,dirty:document.querySelector('[data-testid=timeline-canvas]')?.dataset.dirty,safe:[...document.querySelectorAll('[data-cua-safe-surface]')].filter(visible).map(e=>({kind:e.dataset.cuaSafeSurface,rect:rect(e)})),tabs:[...document.querySelectorAll('[data-testid^=mode-tab-]')].map(e=>({id:e.dataset.testid,rect:rect(e)})),stop:[...document.querySelectorAll('[data-cua-stop]')].map(e=>({rect:rect(e),hit:(()=>{const r=e.getBoundingClientRect();const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return h===e||e.contains(h)})()})),shell:document.querySelector('.os-ws-shell')&&rect(document.querySelector('.os-ws-shell')),main:document.querySelector('.os-ws-main')&&rect(document.querySelector('.os-ws-main')),text:document.body.innerText.slice(0,18000)}})()`);
  const controls = await js(`(() => {
    const rects=selector=>[...document.querySelectorAll(selector)].filter(e=>!e.closest('[hidden]')&&e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent?.trim(),x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}});
    const overlaps=rs=>rs.flatMap((r,i)=>rs.slice(i+1).filter(s=>r.x<s.right-1&&s.x<r.right-1&&r.y<s.bottom-1&&s.y<r.bottom-1).map(s=>({a:r,b:s})));
    return {monitorOverlaps:overlaps(rects('.monitor-controls > div')),nodeOverlaps:overlaps(rects('.canvas-stage > .video-canvas__toolbar button, .canvas-stage > .video-canvas__toolbar select, .canvas-layout-tools button, .canvas-layout-tools select'))};
  })()`);
  const record = { label, width: target.getContentSize()[0], height: target.getContentSize()[1], zoom: target.webContents.getZoomFactor(), layout, controls, lastSnapshot: evidence.snapshots.at(-1) };
  evidence.captures.push(record); writeFileSync(join(dir, `${label}.json`), JSON.stringify(record, null, 2));
  return record;
}
async function mode(value) {
  await click(`[data-testid="mode-tab-${value}"]`);
  await until(`mode ${value}`, () => js(`document.querySelector('[data-workspace-mode]')?.dataset.workspaceMode===${JSON.stringify(value)}`));
}
async function resize(width, height, zoom) {
  target.webContents.setZoomFactor(zoom); target.setContentSize(width, height);
  await until('viewport resized', () => js(`Math.abs(innerWidth-${width/zoom})<3`));
}
const liveStart = () => js('Number(document.querySelector(".timeline-clip")?.dataset.timelineStartMs)');
const diskStart = () => JSON.parse(readFileSync(projectPath, 'utf8')).timeline.tracks[0].clips[0].timelineStartMs;
let finished = false;
async function finish(code) {
  if (finished) return; finished = true;
  evidence.sourceHash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  evidence.sourcePreserved = readFileSync(sourcePath).equals(source);
  evidence.gpuStatus = app.getGPUFeatureStatus();
  writeFileSync(join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ dir, head: evidence.head, code, error: evidence.error }));
  app.once('will-quit', () => app.exit(code));
  app.quit(); setTimeout(() => app.exit(code), 1500).unref();
}
const timeout = setTimeout(() => { evidence.error = 'Harness overall deadline'; void finish(1); }, 180000);
await import(pathToFileURL(resolve('out/main/index.js')).href);
async function run() {
  let code = 1;
  try {
    await app.whenReady();
    await until('renderer', () => target && !target.webContents.isLoading() && js('!!window.videoTool&&!!document.querySelector("#root")'));
    await resize(1440, 900, 1);
    evidence.nativeFocusObserved = { window: target.isFocused(), contents: target.webContents.isFocused() };
    if (await point('button', 'Skip setup')) await click('button', 'Skip setup');
    await click('.projects-home__project-name', projectName);
    await until('project open', () => js('!!document.querySelector(".timeline-clip")'));
    await capture(baseline ? 'before-1440-100' : 'after-default-natural-1440-100');
    if (baseline) { code = 0; return; }
    assert.equal(evidence.captures.at(-1).layout.mode, 'natural');
    assert.equal(evidence.captures.at(-1).layout.safe.length, 0);
    await until('actual Shorts list response', () => evidence.ipc.some(r => r.channel === 'shorts:list' && r.ok));
    assert.ok(evidence.ipc.filter(r => r.channel === 'shorts:list').every(r => r.value.length === 0));
    evidence.checks.push('Natural default; actual empty Shorts list; no fabricated job or safe surface');
    if (!await point('[aria-label="Edit Agent prompt"]')) await click('button', 'Assistant');
    await click('[aria-label="Edit Agent prompt"]');
    await target.webContents.insertText('긴 한국어 입력 · 조합 중 Enter는 보내지 않음');
    await js(`(()=>{const e=document.querySelector('[aria-label="Edit Agent prompt"]');e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'한'}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true}));e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한'}));})()`);
    assert.equal(evidence.ipc.filter(r => r.channel === 'agent-chat:send').length, 0);
    const draft = await js(`document.querySelector('[aria-label="Edit Agent prompt"]').value`);
    await mode('precision'); await until('clip visible', () => point('.timeline-clip'));
    await until('precision safe snapshot', () => evidence.snapshots.at(-1)?.safeSurface?.kind === 'timeline');
    const monitorLoaded = await until('actual preview image', () => js('(()=>{const e=document.querySelector(".program-monitor img");return e?.complete&&e.naturalWidth>0})()'));
    evidence.previewLoaded = monitorLoaded;
    const p = await point('.timeline-clip'), zoom = target.webContents.getZoomFactor();
    target.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(p.x*zoom), y: Math.round(p.y*zoom), button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step++) { target.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((p.x+step*5)*zoom), y: Math.round(p.y*zoom), modifiers: ['leftbuttondown'] }); await wait(12); }
    target.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round((p.x+60)*zoom), y: Math.round(p.y*zoom), button: 'left', clickCount: 1 });
    await until('dirty edit', () => js('document.querySelector("[data-testid=timeline-canvas]").dataset.dirty==="true"'));
    const editedStart = await liveStart(); assert.ok(editedStart > 0); assert.equal(diskStart(), 0);
    await capture('after-dirty-precision');
    for (const tab of ['natural', 'node', 'precision']) { await mode(tab); assert.equal(await liveStart(), editedStart); assert.equal(await js(`document.querySelector('[aria-label="Edit Agent prompt"]').value`), draft); }
    await click('[data-testid="workspace-undo-btn"]'); await until('shared Undo', async () => await liveStart() === 0);
    await click('[data-testid="timeline-redo-btn"]'); await until('shared Redo', async () => await liveStart() === editedStart);
    await click('[data-testid="workspace-save-btn"]'); await until('disk Save', () => diskStart() === editedStart);
    await until('clean Save UI', () => js('document.querySelector("[data-testid=timeline-canvas]").dataset.dirty==="false"'));
    evidence.checks.push({ sharedProjectDirtyUndoRedoSave: true, editedStart, diskStart: diskStart(), draftPreserved: true, syntheticImeNoSend: true });
    await click('[aria-label="Play timeline playback"]');
    await mode('natural'); await mode('node'); await mode('precision');
    await until('playback still running', () => point('[aria-label="Pause timeline playback"]'));
    await click('[aria-label="Pause timeline playback"]'); evidence.checks.push('Playback survived tab changes');
    await mode('natural');
    const reviewRequestsBeforeIntake = evidence.ipc.filter(r=>r.channel==='shorts:list').length;
    await click(`[data-testid="sidebar-project-${emptyId}"]`);
    await until('real empty project intake', () => point('[data-testid="workspace-intake-view"]'));
    await capture('after-empty-project-intake');
    assert.equal(await js('document.querySelectorAll("[data-testid=shorts-review-workspace]").length'), 0);
    assert.equal(evidence.ipc.filter(r=>r.channel==='shorts:list').length, reviewRequestsBeforeIntake);
    await click('summary', 'Project'); await click('button', 'Project settings');
    await click('.project-settings__danger button', 'Delete');
    await click('.project-settings__confirm button', 'Delete');
    await until('empty fixture deletion returns to projectless Projects', () => js('!document.querySelector("#app-page-panel-projects").hidden'));
    await capture('after-empty-fixture-deleted');
    assert.equal(evidence.ipc.filter(r=>r.channel==='shorts:list').length, reviewRequestsBeforeIntake);
    await click('.projects-home__project-name', projectName);
    await until('source review restored after intake/projectless', () => point('[data-testid="shorts-review-workspace"]'));
    assert.equal(await liveStart(), editedStart);
    evidence.checks.push('Actual empty intake and explicit empty-fixture deletion made zero review requests; original source restored with saved position');
    const layoutCases = process.env.WORKSPACE_QA_IMPACT_ONLY === '1'
      ? [[1280,800,1.5], [1440,900,1]]
      : [[1280,800], [1440,900], [1920,1080]].flatMap(([width,height])=>[1,1.25,1.5].map(zoom=>[width,height,zoom]));
    for (const [width, height, zoom] of layoutCases) {
      await resize(width,height,zoom);
      for (const tab of ['natural','precision','node']) {
        await mode(tab); const record = await capture(`after-${width}-${Math.round(zoom*100)}-${tab}`);
        assert.ok(record.layout.docWidth <= record.layout.viewport.width+1, 'no document horizontal overflow');
        assert.equal(record.layout.tabs.length, 3);
        assert.ok(record.layout.tabs.every(t=>t.rect.width>0&&t.rect.x>=0&&t.rect.right<=record.layout.viewport.width), 'all mode tabs visible');
        assert.ok(record.layout.stop.some(s=>s.hit), 'visible workspace Stop hit target');
        assert.equal(record.controls.monitorOverlaps.length, 0, 'preview transport groups do not overlap');
        assert.equal(record.controls.nodeOverlaps.length, 0, 'node controls do not overlap');
        if (tab === 'natural') assert.equal(record.layout.safe.length, 0);
        if (tab === 'node' && width === 1280 && zoom === 1.5) {
          assert.equal(await js('getComputedStyle(document.querySelector(".os-ws-node__body")).overflowY'), 'auto', 'compact node body supports user scrolling');
          const beforeRevision = evidence.snapshots.at(-1).layoutRevision;
          await js('document.querySelector(".os-ws-node__body").scrollTop=100');
          await until('compact node scroll invalidates old scope', async () => evidence.snapshots.at(-1)?.layoutRevision > beforeRevision && await js('document.querySelector(".os-ws-node__body").scrollTop>0'));
          evidence.checks.push({ compactNodeScrollInvalidated: true, beforeRevision, afterRevision: evidence.snapshots.at(-1).layoutRevision });
          await js('document.querySelector(".os-ws-node__body").scrollTop=0');
        }
      }
    }
    await resize(1440,900,1); await mode('node');
    await click('[aria-label="Create Quick highlight"]');
    await click('.video-canvas__toolbar button', '적용 영향 확인');
    await until('actual node impact', () => point('[data-testid="node-impact-confirm-btn"]'));
    await capture('after-node-impact');
    assert.equal(await js('!!document.querySelector("[data-testid=node-preserve-captions-checkbox]")'), false);
    await click('[data-testid="node-impact-cancel-btn"]');
    await mode('precision');
    await click('[data-testid="workspace-project-menu-trigger"]'); await capture('after-menu-portal');
    assert.ok(await point('[data-testid="workspace-cua-stop-btn"]')); await key('Escape');
    await click('summary', 'Project'); await click('button', 'Project settings'); await capture('after-project-modal');
    await click('[aria-label="Close project settings"]');
    await click('[data-testid="sidebar-settings-btn"]'); await until('Settings/Jev', () => js('!document.querySelector("#app-page-panel-settings").hidden'));
    await capture('after-settings-jev');
    assert.equal(evidence.ipc.filter(r => r.channel === 'agent-chat:send' || r.channel === 'agent-chat:approve').length, 0);
    networkGuard.assertNoProductAttempts();
    assert.ok(readFileSync(sourcePath).equals(source));
    evidence.checks.push('Node impact cancel; no unsupported caption checkbox; menu portal; project modal; Settings/Jev; original bytes unchanged; zero model/approval requests');
    code = 0;
  } catch (error) { evidence.error = error.stack; if (target && !target.isDestroyed()) await capture('failure').catch(()=>{}); }
  finally { clearTimeout(timeout); await finish(code); }
}
void run();
