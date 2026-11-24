import type { CuaAgentOrchestrator } from './cuaAgentOrchestration';
import type { CuaDriver } from './cuaDriver';
import { createJevObservationHook, JEV_REOBSERVE_CANDIDATES } from './jevObservationJudgment';

/** Trusted main composition only. No renderer/tool arguments supply policy,
 * run bindings, disclosure consent, credentials or input authority. */
export function createMainJevObservationHook(options: {
  readonly runtime: Pick<Parameters<typeof createJevObservationHook>[0], 'getConfig' | 'getApiKey'>;
  readonly agent: Pick<CuaAgentOrchestrator, 'getObservationBinding'>;
  readonly getDriver: () => CuaDriver | null;
  readonly fetch?: typeof globalThis.fetch;
}) {
  return createJevObservationHook({
    ...options.runtime,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    getObservationContext: conversationId => {
      const binding = options.agent.getObservationBinding(conversationId), driver = options.getDriver();
      if (!binding || !driver) return null;
      const state = driver.getState();
      if (state.sessionId !== binding.frame.sessionId || state.runId !== binding.frame.runId
        || state.windowId !== binding.frame.windowId || state.phase !== 'ready' || !state.cleanupComplete || state.targetGone) return null;
      // This is identity metadata, not a fresh-frame assertion. The adapter
      // checks the driver's ordinary getter before acquiring and the exact
      // owner's getter during/post transport. No self-lease BUSY exception here.
      return { currentFrame: binding.frame, heldInputCount: driver.getHeldInputCount(), cleanupComplete: state.cleanupComplete,
        signal: binding.signal, kind: 'reobserve', imageTransmissionAuthorized: false,
        instructions: 'Choose whether the supplied metadata calls for another explicit observation. No image was supplied. Never infer visual correctness or authorize an action.',
        candidates: JEV_REOBSERVE_CANDIDATES };
    },
    acquireJudgmentLease: (conversationId, identity) => {
      const binding = options.agent.getObservationBinding(conversationId), driver = options.getDriver();
      if (!binding || !driver || binding.signal.aborted) return null;
      const frame = binding.frame;
      if (identity.sessionId !== frame.sessionId || identity.runId !== frame.runId || identity.windowId !== frame.windowId
        || identity.frameId !== frame.frameId || identity.layoutRevision !== frame.layoutRevision
        || identity.contentRevision !== frame.contentRevision || identity.capturedAt !== frame.capturedAt
        || !driver.getCurrentFrame(frame)) return null;
      return driver.acquireObservationLease(frame, binding.signal);
    }
  });
}
