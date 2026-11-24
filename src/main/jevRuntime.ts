import { resolveJevConfig } from '../shared/jevConfig';
import type { JevService } from './jevCredentialService';

/**
 * Main-only closures consumed by createJevObservationHook. Neither secrets nor
 * this object belong in settings, IPC responses, graph state or saved projects.
 * No configuration source means default-off. Credential reads happen only when
 * the adapter requests a key after checking its own observation/held-input gate.
 */
export function createJevRuntime({ service, readConfig = () => undefined }: {
  service: Pick<JevService, 'getApiKey'>;
  readConfig?: () => unknown;
}) {
  return {
    getConfig: () => {
      try {
        return resolveJevConfig(readConfig());
      } catch {
        return resolveJevConfig(undefined);
      }
    },
    getApiKey: () => service.getApiKey()
  };
}
