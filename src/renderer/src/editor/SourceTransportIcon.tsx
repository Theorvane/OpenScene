import type { ReactElement, ReactNode } from 'react';

type TransportIcon = 'start' | 'back' | 'play' | 'pause' | 'forward' | 'end' | 'sound' | 'muted';
const speaker = <path d="M3 9h4l5-4v14l-5-4H3z" />;
const five = <path d="M14 9h-4v3h2.2a2.2 2.2 0 1 1-2.1 2.9" />;
const icons: Record<TransportIcon, ReactNode> = {
  start: <><path d="M5 5v14" /><path d="m18 5-9 7 9 7z" fill="currentColor" stroke="none" /></>,
  back: <><path d="M4.5 7.5A8 8 0 1 1 4 14M4 3v5h5" />{five}</>,
  play: <path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  forward: <><path d="M19.5 7.5A8 8 0 1 0 20 14M20 3v5h-5" />{five}</>,
  end: <><path d="M19 5v14" /><path d="m6 5 9 7-9 7z" fill="currentColor" stroke="none" /></>,
  sound: <>{speaker}<path d="M16 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14" /></>,
  muted: <>{speaker}<path d="m17 9 5 6m0-6-5 6" /></>
};

export function SourceTransportIcon({ name }: { readonly name: TransportIcon }): ReactElement {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {icons[name]}
  </svg>;
}
