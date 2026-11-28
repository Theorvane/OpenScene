import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn, composeEscapeHandler, type PortalSurfaceKind } from './cn';

export type TooltipProviderProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>;
export type TooltipProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;
export type TooltipTriggerProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>;
export type TooltipPortalProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Portal>;

export interface TooltipContentProps extends ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> {
  readonly container?: HTMLElement | null;
  readonly surfaceKind?: Extract<PortalSurfaceKind, 'chrome-menu' | 'modal'>;
}

export function TooltipProvider({ delayDuration = 250, ...props }: TooltipProviderProps) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

export const TooltipContent = forwardRef<ElementRef<typeof TooltipPrimitive.Content>, TooltipContentProps>(
  function TooltipContent(
    { className, container, surfaceKind = 'chrome-menu', onEscapeKeyDown, sideOffset = 6, ...props },
    ref
  ) {
    return (
      <TooltipPrimitive.Portal {...(container !== undefined ? { container } : {})}>
        <TooltipPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn('os-ui-tooltip__content', className)}
          data-os-portal="tooltip"
          onEscapeKeyDown={composeEscapeHandler(onEscapeKeyDown)}
          {...props}
        />
      </TooltipPrimitive.Portal>
    );
  }
);
