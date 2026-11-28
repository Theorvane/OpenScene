import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { Button } from './ui';

type FirstRunOnboardingProps = {
  readonly onComplete: () => void;
};

type OnboardingStep = {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly bullets: readonly string[];
};

const ONBOARDING_STEPS = [
  {
    kicker: 'Welcome',
    title: 'Welcome to OpenScene',
    body: 'Edit your videos with natural-language requests, then refine the same project in the precision timeline or node canvas.',
    bullets: ['Create or open a project from the left sidebar.', 'Add footage and send editing requests in Natural mode.', 'Your project and editing history stay connected across all three modes.']
  },
  {
    kicker: 'Local readiness',
    title: 'Local readiness',
    body: 'Final MP4 export uses your local FFmpeg setup, and desktop capture depends on operating-system screen recording permission.',
    bullets: ['Check FFmpeg readiness in Settings → Local Tools.', 'Grant Screen Recording permission when macOS asks.', 'Imported source files are preserved during editing.']
  },
  {
    kicker: 'Analysis',
    title: 'Video analysis',
    body: 'Use frame inspection and timestamped transcripts to find the parts of your footage you want to keep.',
    bullets: ['A vision model reads extracted frames with source timecodes.', 'Local whisper.cpp transcribes the selected audio range.', 'Approve the proposed edit before applying it.']
  },
  {
    kicker: 'Edit Agent',
    title: 'Edit Agent',
    body: 'Send editing commands in the chat below your video in Natural mode. Precision and Nodes give you focused manual control.',
    bullets: ['Connect a provider such as Ollama in Settings, then select a model yourself.', 'Review proposed editing actions before approving them.', 'Request highlights or shorts in chat when you need them.']
  },
  {
    kicker: 'Privacy',
    title: 'Privacy boundary',
    body: 'Project media and exports stay local. Frame images and transcript text are shared with your selected chat model when you request analysis.',
    bullets: ['Connect your preferred model in Settings.', 'Review source analysis and editing approvals.', 'Manage saved projects inside the app.']
  },
  {
    kicker: 'Start',
    title: 'Start local editing',
    body: 'Open a project, import footage and connect clips on the canvas. Refine the result on the timeline.',
    bullets: ['Select a card to preview its source range.', 'Connect Output to Input and apply the new order.', 'Save your sequence, then export the finished cut.']
  }
] as const satisfies readonly OnboardingStep[];

export function FirstRunOnboarding({ onComplete }: FirstRunOnboardingProps): ReactElement {
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const step = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isFinalStep = stepIndex === ONBOARDING_STEPS.length - 1;
  const progressText = useMemo(() => `${stepIndex + 1} of ${ONBOARDING_STEPS.length}`, [stepIndex]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      className="first-run-onboarding"
      aria-labelledby="first-run-onboarding-title"
      ref={dialogRef}
      onCancel={onComplete}
      onKeyDown={event => event.stopPropagation()}
    >
      <section className="first-run-onboarding__panel">
        <header className="first-run-onboarding__header">
          <p className="section-kicker">First-run setup</p>
          <p className="first-run-onboarding__progress">Step {progressText}</p>
          <h1 id="first-run-onboarding-title">{step.title}</h1>
          <p>{step.body}</p>
        </header>
        <ol className="first-run-onboarding__rail" aria-label="Onboarding progress">
          {ONBOARDING_STEPS.map((item, index) => (
            <li key={item.kicker} className={index === stepIndex ? 'first-run-onboarding__rail-step first-run-onboarding__rail-step--active' : 'first-run-onboarding__rail-step'}>
              {item.kicker}
            </li>
          ))}
        </ol>
        <ul className="first-run-onboarding__bullets">
          {step.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
        <footer className="first-run-onboarding__actions">
          <Button onClick={onComplete} variant="ghost">Skip setup</Button>
          <div className="first-run-onboarding__step-actions">
            <Button disabled={isFirstStep} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>Back</Button>
            {isFinalStep ? (
              <Button onClick={onComplete} variant="primary">Start using OpenScene</Button>
            ) : (
              <Button autoFocus onClick={() => setStepIndex((current) => Math.min(ONBOARDING_STEPS.length - 1, current + 1))} variant="primary">Next</Button>
            )}
          </div>
        </footer>
      </section>
    </dialog>
  );
}
