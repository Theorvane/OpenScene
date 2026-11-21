import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

type PropertyGroupProps = {
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultExpanded?: boolean;
  readonly onReset?: () => void;
};

/* Collapsible property group: hairline separators, xs medium title, −/+ toggle. */
export function PropertyGroup({ title, children, defaultExpanded = true, onReset }: PropertyGroupProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="property-group">
      <div className="property-group__heading">
      <button
        className="property-group__header"
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
      >
        <span className={`property-group__title${isExpanded ? ' property-group__title--expanded' : ''}`}>{title}</span>
        <span aria-hidden="true" className="property-group__toggle">{isExpanded ? '−' : '+'}</span>
      </button>
      {onReset && <button type="button" className="property-group__reset" aria-label={`Reset ${title.toLowerCase()}`} onClick={onReset}>Reset</button>}
      </div>
      {isExpanded && <div className="property-group__body">{children}</div>}
    </div>
  );
}

export function TimingInput({ label, valueMs, onCommit }: { readonly label: string; readonly valueMs: number; readonly onCommit: (ms: number) => void }): ReactElement {
  const [draft, setDraft] = useState((valueMs / 1000).toFixed(3));
  useEffect(() => setDraft((valueMs / 1000).toFixed(3)), [valueMs]);
  return <input type="number" className="property-number-input" aria-label={label} min={0} step={0.001} value={draft}
    onChange={event => setDraft(event.currentTarget.value)}
    onBlur={() => {
      const ms = Math.round(Number(draft) * 1000);
      if (draft.trim() && Number.isFinite(ms) && ms >= 0 && ms !== valueMs) onCommit(ms);
      setDraft((valueMs / 1000).toFixed(3));
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft((valueMs / 1000).toFixed(3)); } }} />;
}

type PropertyRowProps = {
  readonly label: string;
  readonly children: ReactNode;
};

/* Label/value property row: muted caption label left, value right. */
export function PropertyRow({ label, children }: PropertyRowProps): ReactElement {
  return (
    <div className="property-row">
      <span className="property-row__label">{label}</span>
      <div className="property-row__value">{children}</div>
    </div>
  );
}

