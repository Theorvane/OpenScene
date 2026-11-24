import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from './cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { 'aria-invalid': ariaInvalid, className, error = false, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn('os-ui-textarea', className)}
      aria-invalid={error ? true : ariaInvalid}
      data-error={error ? 'true' : undefined}
      {...props}
    />
  );
});
