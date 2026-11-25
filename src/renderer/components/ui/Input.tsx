import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { 'aria-invalid': ariaInvalid, className, error = false, type = 'text', ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn('os-ui-input', className)}
      aria-invalid={error ? true : ariaInvalid}
      data-error={error ? 'true' : undefined}
      {...props}
    />
  );
});
