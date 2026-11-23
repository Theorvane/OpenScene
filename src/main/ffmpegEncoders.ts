import { spawn } from 'node:child_process';

/** A bounded local capability listing; resolve only after the process has exited. */
export function inspectFfmpegEncoders(executablePath: string): Promise<string> {
  return new Promise(resolve => {
    const child = spawn(executablePath, ['-hide_banner', '-encoders'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let listing = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (listing.length + chunk.byteLength > 1024 * 1024) child.kill('SIGKILL');
      else listing += chunk.toString();
    });
    child.once('error', () => { clearTimeout(timer); resolve(''); });
    child.once('close', code => { clearTimeout(timer); resolve(code === 0 ? listing : ''); });
  });
}
