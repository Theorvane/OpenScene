import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn, composeCuaSafeEscapeHandler, isolateModalKeyDown, type CuaProtectedKind } from './cn';

export type SheetSide = 'right' | 'left';
export type SheetProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;
export type SheetTriggerProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>;
export type SheetPortalProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>;
export type SheetCloseProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Close>;

export interface SheetOverlayProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> {
  readonly cuaProtectedKind?: Extract<CuaProtectedKind, 'modal' | 'settings' | 'approval-ui'>;
}

export interface SheetContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  readonly side?: SheetSide;
  readonly container?: HTMLElement | null;
  readonly cuaProtectedKind?: Extract<CuaProtectedKind, 'modal' | 'settings' | 'approval-ui'>;
  readonly showCloseButton?: boolean;
  readonly closeLabel?: string;
}

export type SheetHeaderProps = HTMLAttributes<HTMLDivElement>;
export type SheetFooterProps = HTMLAttributes<HTMLDivElement>;
export type SheetTitleProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;
export type SheetDescriptionProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetPortal = DialogPrimitive.Portal;
export const SheetClose = DialogPrimitive.Close;

export const SheetOverlay = forwardRef<ElementRef<typeof DialogPrimitive.Overlay>, SheetOverlayProps>(
  function SheetOverlay({ className, cuaProtectedKind = 'modal', ...props }, ref) {
    return (
      <DialogPrimitive.Overlay
        ref={ref}
        className={cn('os-ui-sheet__overlay', className)}
        data-cua-protected={cuaProtectedKind}
        data-os-portal="sheet"
        {...props}
      />
    );
  }
);

export const SheetContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  function SheetContent(
    {
      children,
      className,
      closeLabel = 'Close sheet',
      container,
      cuaProtectedKind = 'modal',
      onEscapeKeyDown,
      onKeyDown,
      showCloseButton = true,
      side = 'right',
      ...props
    },
    ref
  ) {
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      onKeyDown?.(event);
      isolateModalKeyDown(event);
    };

    return (
      <SheetPortal {...(container !== undefined ? { container } : {})}>
        <SheetOverlay cuaProtectedKind={cuaProtectedKind} />
        <DialogPrimitive.Content
          ref={ref}
          aria-modal="true"
          className={cn(
            'os-ui-sheet__content',
            side === 'left' ? 'os-ui-sheet__content--left' : 'os-ui-sheet__content--right',
            className
          )}
          data-cua-protected={cuaProtectedKind}
          data-os-portal="sheet"
          data-side={side}
          onEscapeKeyDown={composeCuaSafeEscapeHandler(onEscapeKeyDown)}
          onKeyDown={handleKeyDown}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close type="button" className="os-ui-sheet__close" aria-label={closeLabel}>
              <span aria-hidden="true">&times;</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </SheetPortal>
    );
  }
);

export function SheetHeader({ className, ...props }: SheetHeaderProps) {
  return <div className={cn('os-ui-sheet__header', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: SheetFooterProps) {
  return <div className={cn('os-ui-sheet__footer', className)} {...props} />;
}

export const SheetTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, SheetTitleProps>(
  function SheetTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn('os-ui-sheet__title', className)} {...props} />;
  }
);

export const SheetDescription = forwardRef<ElementRef<typeof DialogPrimitive.Description>, SheetDescriptionProps>(
  function SheetDescription({ className, ...props }, ref) {
    return (
      <DialogPrimitive.Description ref={ref} className={cn('os-ui-sheet__description', className)} {...props} />
    );
  }
);
