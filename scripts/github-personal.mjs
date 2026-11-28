#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Never inherit a token, host, debug setting, or account selection from a shell.
export function personalApi(args, spawn = spawnSync, sourceEnv = process.env) {
  const endpoint = args[0];
  if (!/^repos\/Theorvane\/OpenScene(?:\/|\?|$)/i.test(endpoint ?? '') ||
      /\\|\.\.|%/.test(endpoint?.split('?')[0] ?? '') ||
      args.some(arg => /^--(?:hostname|cache|header)(?:=|$)/.test(arg) || /^-H/.test(arg))) {
    throw new Error('Use a relative repos/Theorvane/OpenScene endpoint; host overrides and cached requests are forbidden.');
  }
  const clean = Object.fromEntries(Object.entries(sourceEnv).filter(([key]) => !/^(GH_|GITHUB_)/i.test(key)));
  const credential = spawn('gh', ['auth', 'token', '--hostname', 'github.com', '--user', 'sjungwon03'], { env: clean, encoding: 'utf8' });
  if (credential.status !== 0 || !credential.stdout?.trim()) {
    throw new Error('Explicit sjungwon03 credential unavailable; no target request sent.');
  }
  const env = { ...clean, GH_TOKEN: credential.stdout.trim(), GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' };
  const identity = spawn('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login'], { env, encoding: 'utf8' });
  if (identity.status !== 0 || identity.stdout?.trim() !== 'sjungwon03') {
    throw new Error('Expected GitHub actor sjungwon03; no target request sent.');
  }
  process.stderr.write('Verified GitHub actor: sjungwon03\n');
  return spawn('gh', ['api', '--hostname', 'github.com', ...args], { env, stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = personalApi(process.argv.slice(2)).status ?? 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
