#!/usr/bin/env node
/**
 * Real mounted Chromium/Electron QA verification for OpenScene Phase 0 UI primitives.
 *
 * 1. Bundles a live React 19 verification harness that imports the real
 *    `src/renderer/styles/ui-tokens.css`, `src/renderer/styles/ui-primitives.css`,
 *    and all 9 components from `src/renderer/components/ui/index.ts`.
 * 2. Launches the installed Electron binary in a hidden, sandboxed BrowserWindow
 *    (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
 * 3. Verifies real computed Orca-neutral styles, real portal DOM rendering,
 *    z-index + hit-test CUA Stop non-obscuration, interactive Tabs/Dialog/Sheet/
 *    DropdownMenu/Tooltip/Button loading/Input error/ScrollArea, Escape/CUA
 *    coexistence, focus restoration, and 0 console/runtime errors.
 */

import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';

const REPO_ROOT = resolve(process.cwd());
const ELECTRON_BIN = resolve(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

const HARNESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenScene Phase 0 UI QA</title>
  </head>
  <body style="margin:0;padding:24px;background:var(--os-ui-bg);color:var(--os-ui-fg);font-family:var(--os-ui-font-sans);">
    <div id="root"></div>
    <script type="module" src="./entry.tsx"></script>
  </body>
</html>
`;

const HARNESS_ENTRY = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '${resolve(REPO_ROOT, 'src/renderer/styles/ui-tokens.css').replace(/\\/g, '/')}';
import '${resolve(REPO_ROOT, 'src/renderer/styles/ui-primitives.css').replace(/\\/g, '/')}';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '${resolve(REPO_ROOT, 'src/renderer/components/ui/index.ts').replace(/\\/g, '/')}';

declare global {
  interface Window {
    __QA_STATE__?: {
      cuaStopCount: number;
      saveLeakCount: number;
      menuActionCount: number;
      cuaCaptureActive: boolean;
    };
  }
}

function QaWorkbench() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  useEffect(() => {
    window.__QA_STATE__ = {
      cuaStopCount: 0,
      saveLeakCount: 0,
      menuActionCount: 0,
      cuaCaptureActive: false
    };

    const onCaptureEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.__QA_STATE__?.cuaCaptureActive) {
        window.__QA_STATE__.cuaStopCount += 1;
        event.preventDefault();
      }
    };
    const onBubbleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (window.__QA_STATE__) window.__QA_STATE__.saveLeakCount += 1;
      }
    };
    window.addEventListener('keydown', onCaptureEscape, { capture: true });
    window.addEventListener('keydown', onBubbleShortcut);
    return () => {
      window.removeEventListener('keydown', onCaptureEscape, { capture: true });
      window.removeEventListener('keydown', onBubbleShortcut);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={0}>
      <button
        id="cua-stop-sim"
        type="button"
        data-cua-protected="stop-button"
        onClick={() => {
          if (window.__QA_STATE__) window.__QA_STATE__.cuaStopCount += 1;
        }}
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 'var(--os-z-cua-stop)' as unknown as number,
          pointerEvents: 'auto',
          height: 30,
          padding: '0 10px'
        }}
      >
        Stop CUA
      </button>

      <main style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button id="btn-primary" variant="primary">Primary</Button>
          <Button id="btn-sm" variant="default" size="sm">Small</Button>
          <Button id="btn-ghost" variant="ghost">Ghost</Button>
          <Button id="btn-destructive" variant="destructive">Delete</Button>
          <Button id="btn-loading" variant="primary" loading>Loading</Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input id="input-error" error placeholder="Clip name" />
          <Textarea id="textarea-error" error placeholder="Edit instruction" />
        </div>

        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger id="tab-timeline" value="timeline">Timeline</TabsTrigger>
            <TabsTrigger id="tab-canvas" value="canvas">Canvas</TabsTrigger>
          </TabsList>
          <TabsContent id="panel-timeline" value="timeline">Timeline view active</TabsContent>
          <TabsContent id="panel-canvas" value="canvas">Canvas view active</TabsContent>
        </Tabs>

        <div style={{ display: 'flex', gap: 8 }}>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button id="open-dialog">Open Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Project Export</DialogTitle>
                <DialogDescription>Verify portal rendering and CUA safety.</DialogDescription>
              </DialogHeader>
              <Input id="dialog-input" placeholder="Export file name" />
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button variant="primary">Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button id="open-sheet">Open Sheet</Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Inspector Sheet</SheetTitle>
                <SheetDescription>Side drawer over neutral workbench.</SheetDescription>
              </SheetHeader>
              <Textarea id="sheet-textarea" placeholder="Notes" />
              <SheetFooter>
                <Button variant="primary">Done</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button id="open-menu">Open Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Clip Actions</DropdownMenuLabel>
              <DropdownMenuItem
                id="menu-item-split"
                onSelect={() => {
                  if (window.__QA_STATE__) window.__QA_STATE__.menuActionCount += 1;
                }}
              >
                Split clip
                <DropdownMenuShortcut>S</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
            <TooltipTrigger asChild>
              <Button id="open-tooltip" onClick={() => setTooltipOpen((v) => !v)}>Tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Monochrome tooltip</TooltipContent>
          </Tooltip>
        </div>

        <ScrollArea id="scroll-area" style={{ height: 80, border: '1px solid var(--os-ui-border)' }}>
          <div style={{ padding: 8 }}>
            {Array.from({ length: 12 }, (_, idx) => (
              <div key={idx}>Timeline track row {idx + 1}</div>
            ))}
          </div>
        </ScrollArea>
      </main>
    </TooltipProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QaWorkbench />
  </React.StrictMode>
);
`;

const ELECTRON_MAIN = `
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const htmlPath = process.argv[2];

app.whenReady().then(async () => {
  const consoleErrors = [];
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.on('console-message', (_event, level, message) => {
    // level 2 = warning, level 3 = error
    if (level >= 2) {
      consoleErrors.push({ level, message });
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    consoleErrors.push({ level: 3, message: 'render-process-gone: ' + JSON.stringify(details) });
  });

  await win.loadFile(htmlPath);

  const report = await win.webContents.executeJavaScript(\`
    (async () => {
      const wait = () => new Promise((r) => setTimeout(r, 40));
      const rootStyle = getComputedStyle(document.documentElement);
      const tokens = {
        bg: rootStyle.getPropertyValue('--os-ui-bg').trim(),
        canvas: rootStyle.getPropertyValue('--os-ui-canvas').trim(),
        surface: rootStyle.getPropertyValue('--os-ui-surface').trim(),
        ctaBg: rootStyle.getPropertyValue('--os-ui-cta-bg').trim(),
        zDialog: Number(rootStyle.getPropertyValue('--os-z-dialog').trim()),
        zSheet: Number(rootStyle.getPropertyValue('--os-z-sheet').trim()),
        zPopover: Number(rootStyle.getPropertyValue('--os-z-popover').trim()),
        zTooltip: Number(rootStyle.getPropertyValue('--os-z-tooltip').trim()),
        zCuaStop: Number(rootStyle.getPropertyValue('--os-z-cua-stop').trim())
      };

      const btnPrimary = document.getElementById('btn-primary');
      const btnSm = document.getElementById('btn-sm');
      const btnLoading = document.getElementById('btn-loading');
      const inputErr = document.getElementById('input-error');
      const textareaErr = document.getElementById('textarea-error');

      const computed = {
        primaryBg: getComputedStyle(btnPrimary).backgroundColor,
        primaryColor: getComputedStyle(btnPrimary).color,
        primaryHeight: getComputedStyle(btnPrimary).height,
        primaryRadius: getComputedStyle(btnPrimary).borderRadius,
        smHeight: getComputedStyle(btnSm).height,
        loadingDisabled: btnLoading.disabled,
        loadingBusy: btnLoading.getAttribute('aria-busy'),
        loadingSpinnerCount: btnLoading.querySelectorAll('.os-ui-button__spinner').length,
        inputErrorInvalid: inputErr.getAttribute('aria-invalid'),
        inputErrorHeight: getComputedStyle(inputErr).height,
        textareaErrorInvalid: textareaErr.getAttribute('aria-invalid'),
        scrollViewportPresent: Boolean(document.querySelector('#scroll-area .os-ui-scroll-area__viewport'))
      };

      // 1. Tabs interaction
      const tabCanvas = document.getElementById('tab-canvas');
      tabCanvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      tabCanvas.click();
      await wait();
      const tabsOk = tabCanvas.getAttribute('data-state') === 'active'
        && Boolean(document.getElementById('panel-canvas')?.textContent?.includes('Canvas view active'));

      // 2. Dialog portal, z-index, CUA Stop hit-test, Save isolation, capture Escape, normal Escape + focus restore
      const openDialogBtn = document.getElementById('open-dialog');
      openDialogBtn.focus();
      openDialogBtn.click();
      await wait();

      const dialogEl = document.querySelector('[data-os-portal="dialog"][role="dialog"]');
      const stopBtn = document.getElementById('cua-stop-sim');
      const stopRect = stopBtn.getBoundingClientRect();
      const topElAtStop = document.elementFromPoint(stopRect.left + stopRect.width / 2, stopRect.top + stopRect.height / 2);
      const dialogZ = Number(getComputedStyle(dialogEl).zIndex);
      const stopZ = Number(getComputedStyle(stopBtn).zIndex);

      const dialogInput = document.getElementById('dialog-input');
      dialogInput.focus();
      dialogInput.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      await wait();

      // CUA capture-phase Escape intercepts first
      window.__QA_STATE__.cuaCaptureActive = true;
      dialogEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const dialogStayedOpenUnderCua = Boolean(document.querySelector('[data-os-portal="dialog"][role="dialog"]'));
      const cuaCountAfterEscape = window.__QA_STATE__.cuaStopCount;

      // Normal Escape closes dialog & restores focus
      window.__QA_STATE__.cuaCaptureActive = false;
      dialogEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const dialogClosedNormally = !document.querySelector('[data-os-portal="dialog"][role="dialog"]');
      const dialogFocusRestored = document.activeElement === openDialogBtn;

      // 3. Sheet portal + z-index + Stop hit-test + Escape restore
      const openSheetBtn = document.getElementById('open-sheet');
      openSheetBtn.focus();
      openSheetBtn.click();
      await wait();
      const sheetEl = document.querySelector('[data-os-portal="sheet"][role="dialog"]');
      const sheetZ = Number(getComputedStyle(sheetEl).zIndex);
      const topElAtStopUnderSheet = document.elementFromPoint(stopRect.left + stopRect.width / 2, stopRect.top + stopRect.height / 2);
      const sheetSide = sheetEl.getAttribute('data-side');
      sheetEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await wait();
      const sheetClosed = !document.querySelector('[data-os-portal="sheet"][role="dialog"]');
      const sheetFocusRestored = document.activeElement === openSheetBtn;

      // 4. DropdownMenu portal + z-index + item action
      const openMenuBtn = document.getElementById('open-menu');
      openMenuBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }));
      openMenuBtn.click();
      await wait();
      const menuEl = document.querySelector('[data-os-portal="dropdown-menu"][role="menu"]');
      const menuZ = menuEl ? Number(getComputedStyle(menuEl).zIndex) : -1;
      const splitItem = document.getElementById('menu-item-split');
      if (splitItem) splitItem.click();
      await wait();

      // 5. Tooltip portal + z-index
      const openTooltipBtn = document.getElementById('open-tooltip');
      openTooltipBtn.click();
      await wait();
      const tooltipEl = document.querySelector('[data-os-portal="tooltip"]');
      const tooltipZ = tooltipEl ? Number(getComputedStyle(tooltipEl).zIndex) : -1;

      return {
        tokens,
        computed,
        tabsOk,
        dialog: {
          portalMounted: Boolean(dialogEl),
          cuaProtected: dialogEl?.getAttribute('data-cua-protected'),
          dialogZ,
          stopZ,
          stopNotObscured: topElAtStop === stopBtn,
          saveLeakCount: window.__QA_STATE__.saveLeakCount,
          cuaCountAfterEscape,
          dialogStayedOpenUnderCua,
          dialogClosedNormally,
          dialogFocusRestored
        },
        sheet: {
          portalMounted: Boolean(sheetEl),
          cuaProtected: sheetEl?.getAttribute('data-cua-protected'),
          sheetSide,
          sheetZ,
          stopNotObscured: topElAtStopUnderSheet === stopBtn,
          sheetClosed,
          sheetFocusRestored
        },
        dropdown: {
          portalMounted: Boolean(menuEl),
          cuaProtected: menuEl?.getAttribute('data-cua-protected'),
          menuZ,
          menuActionCount: window.__QA_STATE__.menuActionCount
        },
        tooltip: {
          portalMounted: Boolean(tooltipEl),
          cuaProtected: tooltipEl?.getAttribute('data-cua-protected'),
          tooltipZ
        }
      };
    })();
  \`);

  const output = { report, consoleErrors };
  process.stdout.write(JSON.stringify(output, null, 2) + '\\n');
  win.destroy();
  app.quit();
});
`;

async function run() {
  const workDir = await realpath(await mkdtemp(join(tmpdir(), 'openscene-ui-qa-')));
  const srcDir = join(workDir, 'src');
  const distDir = join(workDir, 'dist');
  try {
    await symlink(join(REPO_ROOT, 'node_modules'), join(workDir, 'node_modules'), 'dir');
    await writeFile(join(workDir, 'package.json'), JSON.stringify({ name: 'ui-qa', type: 'commonjs' }));
    await writeFile(join(workDir, 'electron-main.cjs'), ELECTRON_MAIN);
    await writeFile(join(workDir, 'index.html'), HARNESS_HTML);
    await writeFile(join(workDir, 'entry.tsx'), HARNESS_ENTRY);

    await viteBuild({
      configFile: false,
      root: workDir,
      base: './',
      logLevel: 'silent',
      plugins: [react()],
      resolve: {
        preserveSymlinks: false
      },
      build: {
        outDir: distDir,
        emptyOutDir: true
      }
    });

    const stdout = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(ELECTRON_BIN, [join(workDir, 'electron-main.cjs'), join(distDir, 'index.html')], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        err += chunk.toString();
      });
      child.on('error', rejectPromise);
      child.on('close', (code) => {
        if (code !== 0) {
          rejectPromise(new Error(`Electron QA exited with code ${code}: ${err}`));
          return;
        }
        resolvePromise(out);
      });
    });

    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) {
      throw new Error(`No JSON report from Electron QA: ${stdout}`);
    }
    const parsed = JSON.parse(stdout.slice(jsonStart));
    const { report, consoleErrors } = parsed;

    const assertions = [
      ['consoleErrors empty', consoleErrors.length === 0],
      ['token --os-ui-bg === #0a0a0a', report.tokens.bg === '#0a0a0a'],
      ['token --os-ui-canvas === #121212', report.tokens.canvas === '#121212'],
      ['token --os-ui-surface === #171717', report.tokens.surface === '#171717'],
      ['token --os-ui-cta-bg === #e5e5e5', report.tokens.ctaBg === '#e5e5e5'],
      ['zCuaStop > all portal layers', report.tokens.zCuaStop > Math.max(report.tokens.zDialog, report.tokens.zSheet, report.tokens.zPopover, report.tokens.zTooltip)],
      ['Button primary monochrome bg rgb(229, 229, 229)', report.computed.primaryBg === 'rgb(229, 229, 229)'],
      ['Button primary monochrome fg rgb(23, 23, 23)', report.computed.primaryColor === 'rgb(23, 23, 23)'],
      ['Button primary height 28px', report.computed.primaryHeight === '28px'],
      ['Button primary radius 5px', report.computed.primaryRadius === '5px'],
      ['Button sm height 26px', report.computed.smHeight === '26px'],
      ['Button loading disabled + aria-busy + spinner', report.computed.loadingDisabled === true && report.computed.loadingBusy === 'true' && report.computed.loadingSpinnerCount === 1],
      ['Input error aria-invalid + 28px height', report.computed.inputErrorInvalid === 'true' && report.computed.inputErrorHeight === '28px'],
      ['Textarea error aria-invalid', report.computed.textareaErrorInvalid === 'true'],
      ['ScrollArea viewport mounted', report.computed.scrollViewportPresent === true],
      ['Tabs interactive switch', report.tabsOk === true],
      ['Dialog portal mounted + CUA modal attr', report.dialog.portalMounted && report.dialog.cuaProtected === 'modal'],
      ['Dialog z-index < CUA Stop & Stop hit-test unobscured', report.dialog.dialogZ < report.dialog.stopZ && report.dialog.stopNotObscured === true],
      ['Dialog Input Cmd+S does not leak', report.dialog.saveLeakCount === 0],
      ['Dialog capture-phase CUA Escape fires first', report.dialog.cuaCountAfterEscape === 1 && report.dialog.dialogStayedOpenUnderCua === true],
      ['Dialog normal Escape closes & restores focus', report.dialog.dialogClosedNormally === true && report.dialog.dialogFocusRestored === true],
      ['Sheet portal mounted + right side + CUA modal attr', report.sheet.portalMounted && report.sheet.sheetSide === 'right' && report.sheet.cuaProtected === 'modal'],
      ['Sheet z-index < CUA Stop & Stop hit-test unobscured', report.sheet.sheetZ < report.dialog.stopZ && report.sheet.stopNotObscured === true],
      ['Sheet normal Escape closes & restores focus', report.sheet.sheetClosed === true && report.sheet.sheetFocusRestored === true],
      ['DropdownMenu portal mounted + CUA chrome-menu + action', report.dropdown.portalMounted && report.dropdown.cuaProtected === 'chrome-menu' && report.dropdown.menuZ < report.dialog.stopZ && report.dropdown.menuActionCount === 1],
      ['Tooltip portal mounted + CUA chrome-menu + z-index', report.tooltip.portalMounted && report.tooltip.cuaProtected === 'chrome-menu' && report.tooltip.tooltipZ < report.dialog.stopZ]
    ];

    const failures = assertions.filter(([, ok]) => !ok).map(([name]) => name);
    console.log(JSON.stringify({ passed: assertions.length - failures.length, total: assertions.length, failures, report, consoleErrors }, null, 2));
    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
    void srcDir;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
