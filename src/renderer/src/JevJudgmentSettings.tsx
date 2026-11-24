import { useEffect, useRef, useState, type ReactElement } from 'react';
import { DEFAULT_JEV_CONFIG, type JevConfig } from '../../shared/jevConfig';
import { JEV_API_KEY_MAX_LENGTH, type JevCredentialApi } from '../../shared/jevCredentials';
import type { ApiResponse } from '../../shared/models';
import { Button, StatusCard } from './ui';
import './JevJudgmentSettings.css';

/** Settings port only; the backend owns its final IPC names and persistence. */
export interface JevConfigSettingsPort {
  getConfig(): Promise<ApiResponse<JevConfig>>;
  setConfig(config: JevConfig): Promise<ApiResponse<JevConfig>>;
}

export function JevJudgmentSettings({ configApi, credentialApi = window.videoTool }: {
  readonly configApi: JevConfigSettingsPort;
  readonly credentialApi?: JevCredentialApi;
}): ReactElement {
  const [config, setConfig] = useState<JevConfig>({ ...DEFAULT_JEV_CONFIG });
  const [draft, setDraft] = useState<JevConfig>({ ...DEFAULT_JEV_CONFIG });
  const [configured, setConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([configApi.getConfig(), credentialApi.getJevCredentialStatus()]).then(([settings, status]) => {
      if (!active) return;
      if (!settings.ok || !status.ok) { setFailed(true); setMessage('Jev settings could not be loaded.'); return; }
      setConfig(settings.value); setDraft(settings.value); setConfigured(status.value.configured); setReady(true);
    }).catch(() => { if (active) { setFailed(true); setMessage('Jev settings could not be loaded.'); } });
    return () => { active = false; if (keyInput.current) keyInput.current.value = ''; };
  }, [configApi, credentialApi]);

  const saveConfig = async (): Promise<void> => {
    setBusy(true); setMessage('');
    try {
      const response = await configApi.setConfig(draft);
      if (!response.ok) { setDraft(config); setFailed(true); setMessage('Jev settings were not saved.'); return; }
      setConfig(response.value); setDraft(response.value); setFailed(false); setMessage('Jev settings saved.');
    } catch { setDraft(config); setFailed(true); setMessage('Jev settings were not saved.'); }
    finally { setBusy(false); }
  };
  const saveKey = async (): Promise<void> => {
    const input = keyInput.current;
    if (!input?.value.trim()) return;
    setBusy(true); setMessage('');
    try {
      const pending = credentialApi.setJevCredential(input.value);
      input.value = '';
      const response = await pending;
      if (!response.ok) { setFailed(true); setMessage('The Jev key was not saved.'); return; }
      setConfigured(response.value.configured); setFailed(false); setMessage('Jev key saved securely.');
    } catch { setFailed(true); setMessage('The Jev key was not saved.'); }
    finally { input.value = ''; setBusy(false); }
  };
  const clearKey = async (): Promise<void> => {
    if (keyInput.current) keyInput.current.value = '';
    setBusy(true); setMessage('');
    try {
      const response = await credentialApi.clearJevCredential();
      if (!response.ok) { setFailed(true); setMessage('The Jev key could not be cleared.'); return; }
      setConfigured(response.value.configured); setFailed(false); setMessage('Jev key cleared.');
    } catch { setFailed(true); setMessage('The Jev key could not be cleared.'); }
    finally { setBusy(false); }
  };

  return <>
    <StatusCard tone="neutral">Optional typed judgments help decide whether an explicit editor observation needs more information. Your existing editing model stays selected. This feature is off by default.</StatusCard>
    <StatusCard tone={config.enabled && configured ? 'success' : 'neutral'}>
      {ready ? `${config.enabled ? 'Enabled' : 'Off'} · ${configured ? 'Key configured' : 'No key configured; existing model fallback'}` : 'Loading Jev settings…'}
    </StatusCard>
    <fieldset className="jev-judgment-fields" disabled={!ready || busy}>
      <label className="jev-judgment-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> Enable Jev observation judgments</label>
      <label className="field-label" htmlFor="jev-model">Model</label>
      <select id="jev-model" value={draft.model} onChange={() => undefined}><option value="jev-1.14.0">Jev 1.14.0 (pinned)</option></select>
      <label className="field-label" htmlFor="jev-threshold">Minimum selected-option probability</label>
      <input id="jev-threshold" type="number" min="0.5" max="1" step="0.01" value={draft.minSelectedProbability}
        onChange={event => setDraft({ ...draft, minSelectedProbability: event.target.valueAsNumber })} />
      <p>This is an uncalibrated fallback cutoff, not a measured accuracy guarantee. Uncertain judgments use the existing model.</p>
      <label className="field-label" htmlFor="jev-timeout">Request timeout (milliseconds)</label>
      <input id="jev-timeout" type="number" min="1" max="5000" step="1" value={draft.timeoutMs}
        onChange={event => setDraft({ ...draft, timeoutMs: event.target.valueAsNumber })} />
      <Button variant="default" onClick={() => void saveConfig()}>Save judgment settings</Button>
      <label className="field-label" htmlFor="jev-key">TypeSafe API key</label>
      <input ref={keyInput} id="jev-key" type="password" autoComplete="off" maxLength={JEV_API_KEY_MAX_LENGTH} placeholder="Enter a new key" />
      <div className="jev-judgment-actions">
        <Button variant="default" onClick={() => void saveKey()}>Save key securely</Button>
        <Button variant="default" disabled={!configured} onClick={() => void clearKey()}>Clear key</Button>
      </div>
    </fieldset>
    <StatusCard tone="neutral">When enabled, explicit editor observations can send their metadata to TypeSafe. Screenshots are not sent by this setting. No action runs automatically, and every existing approval remains required. Desktop window observation is unavailable on mobile.</StatusCard>
    {message ? <StatusCard tone={failed ? 'danger' : 'success'}>{message}</StatusCard> : null}
  </>;
}
