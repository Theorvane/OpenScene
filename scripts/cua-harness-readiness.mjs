// Test-only synchronization. Reads state; never focuses, dispatches or retries.
export async function waitForNativeMenuReady({ command, read, timeoutMs = 10000, now = () => performance.now(), pause = () => new Promise(resolve => setTimeout(resolve, 25)) }) {
  const deadline = now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last.enabled === true && last.report?.senderMatches === true && last.report?.enabled === true) return last;
    if (now() >= deadline) break;
    await pause();
  } while (now() <= deadline);
  const error = new Error(`Timed out: native ${command} readiness`);
  error.telemetry = last;
  throw error;
}
