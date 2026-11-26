import type { ReaVideoAnalysisService } from './reaVideoAnalysisService';
import { fail, ok } from './ipcResponses';
import { REA_ANALYSIS_CHANNELS } from '../shared/reaVideoAnalysis';
export function registerReaAnalysisIpc(service: ReaVideoAnalysisService, register: (channel: string, handler: (payload: unknown) => Promise<unknown>) => void): void {
  for (const action of ['runtime', 'start', 'get', 'cancel', 'prepareImport'] as const) {
    register(REA_ANALYSIS_CHANNELS[action], async payload => {
      try {
        if (action === 'runtime') return ok(await service.runtime());
        if (action === 'start') return ok(service.start(payload));
        if (action === 'prepareImport') return ok(await service.prepareImport(payload));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || !('jobId' in payload) || typeof payload.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.jobId)) return fail('INVALID_INPUT', 'Choose an analysis job.');
        return ok(service[action](payload.jobId));
      } catch { return fail('INVALID_INPUT', 'Analysis request unavailable. Choose an imported video and wait for any running job.'); }
    });
  }
}
