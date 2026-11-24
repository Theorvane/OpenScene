import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from './cn';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'default' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly asChild?: boolean;
}

const variantClassMap: Readonly<Record<ButtonVariant, string>> = {
  primary: 'os-ui-button--primary',
  default: 'os-ui-button--default',
  ghost: 'os-ui-button--ghost',
  destructive: 'os-ui-button--destructive'
};

const sizeClassMap: Readonly<Record<ButtonSize, string>> = {
  sm: 'os-ui-button--sm',
  default: 'os-ui-button--default-size',
  icon: 'os-ui-button--icon'
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    children,
    className,
    disabled = false,
    loading = false,
    onClick,
    size = 'default',
    type = 'button',
    variant = 'default',
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading;
  const classes = cn('os-ui-button', variantClassMap[variant], sizeClassMap[size], className);

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (isDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  if (asChild) {
    return (
      <Slot
        ref={ref}
        className={classes}
        aria-busy={loading ? true : undefined}
        aria-disabled={isDisabled ? true : undefined}
        data-loading={loading ? 'true' : undefined}
        onClick={handleClick}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      data-loading={loading ? 'true' : undefined}
      onClick={handleClick}
      {...props}
    >
      {loading && <span className="os-ui-button__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});
