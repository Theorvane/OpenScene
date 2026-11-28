import { useRef, useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui';

type Project = { readonly id: string; readonly name: string; readonly storage?: string };
type Props = {
  readonly projects: readonly Project[];
  readonly activeProjectId: string | null;
  readonly busy: boolean;
  readonly onSelect: (id: string) => void;
  readonly onCreate: (name: string) => Promise<boolean>;
  readonly onOpen: () => void;
  readonly onRename: (id: string, name: string) => Promise<boolean>;
  readonly onCloseProject: (id: string) => void;
  readonly onRemove: (id: string) => Promise<boolean>;
};
type Action = { kind: 'create' } | { kind: 'rename' | 'delete'; project: Project };

export function ProjectSidebar(props: Props): ReactElement {
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const restoreFocus = useRef<HTMLElement | null>(null);
  const busy = props.busy || pending;
  const openAction = (next: Action, trigger?: HTMLElement): void => {
    restoreFocus.current = trigger?.closest('details')?.querySelector('summary') ?? trigger ?? null;
    setError(''); setName(next.kind === 'rename' ? next.project.name : '새 프로젝트'); setAction(next);
  };
  const submit = async (): Promise<void> => {
    if (!action || busy || (action.kind !== 'delete' && !name.trim())) return;
    setPending(true); setError('');
    try {
      const success = action.kind === 'delete' ? await props.onRemove(action.project.id)
        : action.kind === 'rename' ? await props.onRename(action.project.id, name.trim()) : await props.onCreate(name.trim());
      if (success) setAction(null);
      else setError(action.kind === 'delete' ? '프로젝트를 삭제하지 못했습니다. 다시 시도하세요.' : '프로젝트 변경을 저장하지 못했습니다. 다시 시도하세요.');
    } catch { setError('프로젝트 작업을 완료하지 못했습니다. 다시 시도하세요.'); }
    finally { setPending(false); }
  };
  const external = action?.kind === 'delete' && action.project.storage === 'external';
  return <section className="desktop-projects" aria-label="프로젝트 목록">
    <div className="desktop-projects__heading"><span>프로젝트</span><div className="desktop-projects__actions">
      <button type="button" className="desktop-icon-button" aria-label="프로젝트 폴더 열기" title="프로젝트 폴더 열기" disabled={busy} onClick={props.onOpen}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 7v12h18V7h-9l-2-3H3z"/></svg></button>
      <button type="button" className="desktop-icon-button" aria-label="새 프로젝트" title="새 프로젝트" disabled={busy} onClick={event => openAction({ kind: 'create' }, event.currentTarget)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
    </div></div>
    <div className="desktop-projects__list">
      {props.projects.map(project => <div className="desktop-project-row" data-active={project.id === props.activeProjectId} key={project.id}>
        <button className="desktop-project-row__select" type="button" title={project.name} aria-current={project.id === props.activeProjectId ? 'page' : undefined} disabled={busy} onClick={() => props.onSelect(project.id)}>{project.name}</button>
        <details className="desktop-project-row__menu"><summary aria-label={`${project.name} 프로젝트 메뉴`} title="프로젝트 메뉴">⋯</summary><div>
          <button type="button" disabled={busy} onClick={event => { event.currentTarget.closest('details')!.open = false; openAction({ kind: 'rename', project }, event.currentTarget); }}>이름 변경</button>
          <button type="button" disabled={busy} onClick={event => { event.currentTarget.closest('details')!.open = false; props.onCloseProject(project.id); }}>닫기</button>
          <button type="button" disabled={busy} onClick={event => { event.currentTarget.closest('details')!.open = false; openAction({ kind: 'delete', project }, event.currentTarget); }}>삭제</button>
        </div></details>
      </div>)}
      {props.projects.length === 0 && <p className="desktop-projects__empty">프로젝트를 만들거나 폴더를 여세요.</p>}
    </div>
    <Dialog open={action !== null} onOpenChange={open => { if (!open && !pending) setAction(null); }}>
      <DialogContent closeLabel="프로젝트 작업 닫기" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus.current?.focus(); }}>
        <DialogTitle>{action?.kind === 'delete' ? '프로젝트 삭제' : action?.kind === 'rename' ? '프로젝트 이름 변경' : '새 프로젝트'}</DialogTitle>
        <DialogDescription>{action?.kind === 'delete' ? external ? '목록에서 제거합니다. 폴더와 파일은 보존됩니다.' : '앱 저장소의 프로젝트와 복사된 자산을 삭제합니다. 되돌릴 수 없습니다. 외부 원본 파일은 보존됩니다.' : '프로젝트 이름을 입력하세요.'}</DialogDescription>
        <form className="desktop-projects__form" onSubmit={event => { event.preventDefault(); void submit(); }}>
          {action?.kind !== 'delete' && <label>이름<input autoFocus value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>}
          {action?.kind === 'delete' && <strong>{action.project.name}</strong>}
          {error && <p role="alert">{error}</p>}
          <button className="button button--primary" type="submit" disabled={busy || (action?.kind !== 'delete' && !name.trim())}>{pending ? '처리 중…' : action?.kind === 'delete' ? external ? '목록에서 제거' : '영구 삭제' : '저장'}</button>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
