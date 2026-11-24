// Local Electron API experiment. No debugger, OS input, or external window control.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 700, height: 400, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const before = []; let injecting = false;
  win.webContents.on('before-input-event', (_, input) => before.push({ event: 'key', injecting, ...input }));
  win.webContents.on('before-mouse-event', (_, input) => before.push({ event: 'mouse', injecting, ...input }));
  await win.loadURL('data:text/html,' + encodeURIComponent(`<style>#clip{width:100px;height:50px;background:coral}#lane{height:150px;background:gray}</style><div id="clip" draggable="true">clip</div><div id="lane">lane</div><script>window.events=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','mousedown','mouseup','dragstart','dragover','drop','dragend','keydown','keyup'])document.addEventListener(type,e=>{events.push({type,x:e.clientX,y:e.clientY,trusted:e.isTrusted,buttons:e.buttons,key:e.key});if(type==='dragstart')e.dataTransfer.setData('text/plain','clip');if(type==='dragover')e.preventDefault();if(type==='drop')e.preventDefault();});</script>`));
  if (process.env.CUA_PROBE_POINTER === '1') await win.webContents.executeJavaScript(`document.getElementById('clip').draggable=false;document.getElementById('clip').onpointerdown=e=>{e.currentTarget.setPointerCapture(e.pointerId);};void 0;`);
  if (process.env.CUA_PROBE_ZOOM) win.webContents.setZoomFactor(Number(process.env.CUA_PROBE_ZOOM));
  win.focus();
  await delay(300);
  const focused = { window: win.isFocused(), contents: win.webContents.isFocused() };
  const send = (type,x,y,down=false) => {injecting=true;try{win.webContents.sendInputEvent({type,x,y,button:'left',clickCount:1,modifiers:down?['leftbuttondown']:[]});}finally{injecting=false;}};
  send('mouseMove',40,30); send('mouseDown',40,30,true);
  for(let y=35;y<=150;y+=5){send('mouseMove',40,y,true);await delay(16);}
  send('mouseUp',40,150);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'z',modifiers:['meta']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'z',modifiers:['meta']});
  await delay(300);
  const events = await win.webContents.executeJavaScript('window.events');
  const out = process.env.CUA_PROBE_DIR || '/tmp/openscene-cua-probe';
  fs.mkdirSync(out,{recursive:true});
  const viewport = await win.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
  fs.writeFileSync(path.join(out,'input.json'),JSON.stringify({focused,viewport,zoom:win.webContents.getZoomFactor(),before,events},null,2));
  fs.writeFileSync(path.join(out,'capture.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({out,focused,beforeTypes:before.map(e=>e.type),domTypes:events.map(e=>e.type)}));
  win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
