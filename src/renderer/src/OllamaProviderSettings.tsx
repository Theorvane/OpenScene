import type { ReactElement } from 'react';
import { useLlmModel } from './LlmProviderContext';
import { Button } from './ui';

export function OllamaProviderSettings(): ReactElement {
  const { ollama, providerConfig, updateProviderConfig, connectOllama, disconnectOllama } = useLlmModel();
  return <section className="settings-group" aria-label="Ollama 제공자 연결">
    <h3 className="settings-subheading">Ollama</h3>
    <p>실행 중인 Ollama 서버에 연결합니다. OpenScene은 LLM을 설치하거나 직접 실행하지 않습니다.</p>
    <label className="field-label" htmlFor="ollama-base-url">서버 주소</label>
    <input id="ollama-base-url" type="url" value={providerConfig.ollamaBaseUrl ?? ''} placeholder="http://localhost:11434" onChange={event => updateProviderConfig({ ollamaBaseUrl: event.target.value })} />
    <div className="settings-list__actions">
      <Button disabled={ollama.status === 'connecting' || !providerConfig.ollamaBaseUrl?.trim()} onClick={() => { void connectOllama(); }}>{ollama.status === 'connecting' ? '연결 확인 중…' : ollama.status === 'connected' ? '모델 목록 새로고침' : '연결'}</Button>
      {ollama.status === 'connected' && <Button variant="ghost" onClick={disconnectOllama}>연결 해제</Button>}
    </div>
    <p role="status">{ollama.status === 'connected' ? `연결됨 · ${ollama.models.length}개 모델. 사용할 모델은 직접 선택하세요.` : ollama.status === 'connecting' ? '서버와 모델 기능 확인 중…' : ollama.error ?? '모델 제공자 연결이 필요합니다.'}</p>
    {ollama.status === 'connected' && ollama.models.length === 0 && <p>서버에 사용 가능한 모델이 없습니다. Ollama에서 모델을 준비한 뒤 목록을 새로고침하세요.</p>}
    {ollama.models.map(model => <div className="settings-list__row" key={model.name}><strong>{model.name}</strong><small>{model.tools ? '편집 도구 지원' : '편집 도구 미지원'}{model.vision ? ' · 비전 지원' : ''}</small></div>)}
  </section>;
}
