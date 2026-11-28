import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { cn, composeEscapeHandler, isolateMenuKeyDown, type PortalSurfaceKind } from './cn';

export type DropdownMenuProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>;
export type DropdownMenuTriggerProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>;
export type DropdownMenuGroupProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>;
export type DropdownMenuPortalProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Portal>;
export type DropdownMenuSubProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Sub>;

export interface DropdownMenuContentProps extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  readonly container?: HTMLElement | null;
  readonly surfaceKind?: Extract<PortalSurfaceKind, 'chrome-menu' | 'modal'>;
}

export interface DropdownMenuSubContentProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> {
  readonly surfaceKind?: Extract<PortalSurfaceKind, 'chrome-menu' | 'modal'>;
}

export type DropdownMenuItemVariant = 'default' | 'destructive';

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  readonly inset?: boolean;
  readonly variant?: DropdownMenuItemVariant;
}

export interface DropdownMenuSubTriggerProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> {
  readonly inset?: boolean;
}

export type DropdownMenuLabelProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>;
export type DropdownMenuSeparatorProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>;
export type DropdownMenuShortcutProps = HTMLAttributes<HTMLSpanElement>;

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { className, container, surfaceKind = 'chrome-menu', onEscapeKeyDown, onKeyDown, sideOffset = 4, ...props },
  ref
) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    isolateMenuKeyDown(event);
  };

  return (
    <DropdownMenuPrimitive.Portal {...(container !== undefined ? { container } : {})}>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('os-ui-dropdown__content', className)}
        data-os-portal="dropdown-menu"
        onEscapeKeyDown={composeEscapeHandler(onEscapeKeyDown)}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  DropdownMenuSubTriggerProps
>(function DropdownMenuSubTrigger({ className, inset = false, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn('os-ui-dropdown__item', inset && 'os-ui-dropdown__item--inset', className)}
      {...props}
    />
  );
});

export const DropdownMenuSubContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  DropdownMenuSubContentProps
>(function DropdownMenuSubContent({ className, surfaceKind = 'chrome-menu', onKeyDown, ...props }, ref) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    isolateMenuKeyDown(event);
  };

  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn('os-ui-dropdown__content', className)}
      data-os-portal="dropdown-menu"
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
});

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(function DropdownMenuItem({ className, inset = false, variant = 'default', ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'os-ui-dropdown__item',
        inset && 'os-ui-dropdown__item--inset',
        variant === 'destructive' && 'os-ui-dropdown__item--destructive',
        className
      )}
      data-variant={variant}
      {...props}
    />
  );
});

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Label>,
  DropdownMenuLabelProps
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return <DropdownMenuPrimitive.Label ref={ref} className={cn('os-ui-dropdown__label', className)} {...props} />;
});

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  DropdownMenuSeparatorProps
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator ref={ref} className={cn('os-ui-dropdown__separator', className)} {...props} />
  );
});

export function DropdownMenuShortcut({ className, ...props }: DropdownMenuShortcutProps) {
  return <span className={cn('os-ui-dropdown__shortcut', className)} {...props} />;
}
