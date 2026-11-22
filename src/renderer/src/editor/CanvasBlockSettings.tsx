import { useEffect, useState } from 'react';
import { CANVAS_BLOCK_CATALOG, canvasSettings, type CanvasSetting } from '../../../shared/canvasBlockCatalog';
import type { CanvasBlock } from '../../../shared/videoCanvasGraph';

function NumericSetting({ label, value, spec, disabled, onChange }: { label: string; value: number; spec: CanvasSetting; disabled: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input type="number" aria-label={label} value={draft} disabled={disabled} min={spec.min} max={spec.max} step={spec.step ?? 1}
    onChange={event => setDraft(event.currentTarget.value)} onBlur={() => {
      const next = Number(draft);
      if (draft.trim() && Number.isFinite(next) && next >= (spec.min ?? -Infinity) && next <= (spec.max ?? Infinity) && next !== value) onChange(next);
      else setDraft(String(value));
    }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(value)); } }} />;
}
export function CanvasBlockSettings({ block, disabled, onChange }: { block: CanvasBlock; disabled: boolean; onChange: (settings: Readonly<Record<string, number | string>>) => void }) {
  const specs = CANVAS_BLOCK_CATALOG[block.kind].settings;
  if (!specs) return null;
  const values = canvasSettings(block);
  return <div className="canvas-block-settings" aria-label={`${block.id} settings`}>
    {Object.entries(specs).map(([key, spec]) => <label key={key}><span>{spec.label}</span>
      {spec.options ? <select aria-label={`${block.id} ${spec.label}`} disabled={disabled} value={String(values[key])} onChange={event => onChange({ [key]: event.currentTarget.value })}>
        {spec.options.map(option => <option key={option} value={option}>{option}</option>)}
      </select> : <NumericSetting label={`${block.id} ${spec.label}`} disabled={disabled} spec={spec} value={Number(values[key])} onChange={value => onChange({ [key]: value })} />}
    </label>)}
  </div>;
}
