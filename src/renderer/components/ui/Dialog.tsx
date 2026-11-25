import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn, composeCuaSafeEscapeHandler, isolateModalKeyDown, type CuaProtectedKind } from './cn';

export type DialogProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;
export type DialogTriggerProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>;
export type DialogPortalProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>;
export type DialogCloseProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Close>;

export interface DialogOverlayProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> {
  readonly cuaProtectedKind?: Extract<CuaProtectedKind, 'modal' | 'settings' | 'approval-ui'>;
}

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  readonly container?: HTMLElement | null;
  readonly cuaProtectedKind?: Extract<CuaProtectedKind, 'modal' | 'settings' | 'approval-ui'>;
  readonly showCloseButton?: boolean;
  readonly closeLabel?: string;
}

export type DialogHeaderProps = HTMLAttributes<HTMLDivElement>;
export type DialogFooterProps = HTMLAttributes<HTMLDivElement>;
export type DialogTitleProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;
export type DialogDescriptionProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = forwardRef<ElementRef<typeof DialogPrimitive.Overlay>, DialogOverlayProps>(
  function DialogOverlay({ className, cuaProtectedKind = 'modal', ...props }, ref) {
    return (
      <DialogPrimitive.Overlay
        ref={ref}
        className={cn('os-ui-dialog__overlay', className)}
        data-cua-protected={cuaProtectedKind}
        data-os-portal="dialog"
        {...props}
      />
    );
  }
);

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent(
    {
      children,
      className,
      closeLabel = 'Close dialog',
      container,
      cuaProtectedKind = 'modal',
      onEscapeKeyDown,
      onKeyDown,
      showCloseButton = true,
      ...props
    },
    ref
  ) {
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      onKeyDown?.(event);
      isolateModalKeyDown(event);
    };

    return (
      <DialogPortal {...(container !== undefined ? { container } : {})}>
        <DialogOverlay cuaProtectedKind={cuaProtectedKind} />
        <DialogPrimitive.Content
          ref={ref}
          aria-modal="true"
          className={cn('os-ui-dialog__content', className)}
          data-cua-protected={cuaProtectedKind}
          data-os-portal="dialog"
          onEscapeKeyDown={composeCuaSafeEscapeHandler(onEscapeKeyDown)}
          onKeyDown={handleKeyDown}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close type="button" className="os-ui-dialog__close" aria-label={closeLabel}>
              <span aria-hidden="true">&times;</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }
);

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div className={cn('os-ui-dialog__header', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <div className={cn('os-ui-dialog__footer', className)} {...props} />;
}

export const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, DialogTitleProps>(
  function DialogTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn('os-ui-dialog__title', className)} {...props} />;
  }
);

export const DialogDescription = forwardRef<ElementRef<typeof DialogPrimitive.Description>, DialogDescriptionProps>(
  function DialogDescription({ className, ...props }, ref) {
    return (
      <DialogPrimitive.Description ref={ref} className={cn('os-ui-dialog__description', className)} {...props} />
    );
  }
);
