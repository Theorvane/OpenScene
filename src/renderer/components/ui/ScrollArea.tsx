import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from './cn';

export type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both';

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  readonly orientation?: ScrollAreaOrientation;
  readonly viewportClassName?: string;
}

export type ScrollBarProps = ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>;

export const ScrollBar = forwardRef<ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>, ScrollBarProps>(
  function ScrollBar({ className, orientation = 'vertical', ...props }, ref) {
    return (
      <ScrollAreaPrimitive.ScrollAreaScrollbar
        ref={ref}
        orientation={orientation}
        className={cn('os-ui-scroll-area__scrollbar', className)}
        {...props}
      >
        <ScrollAreaPrimitive.ScrollAreaThumb className="os-ui-scroll-area__thumb" />
      </ScrollAreaPrimitive.ScrollAreaScrollbar>
    );
  }
);

export const ScrollArea = forwardRef<ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  function ScrollArea({ children, className, orientation = 'vertical', viewportClassName, ...props }, ref) {
    const showVertical = orientation === 'vertical' || orientation === 'both';
    const showHorizontal = orientation === 'horizontal' || orientation === 'both';

    return (
      <ScrollAreaPrimitive.Root ref={ref} className={cn('os-ui-scroll-area', className)} {...props}>
        <ScrollAreaPrimitive.Viewport className={cn('os-ui-scroll-area__viewport', viewportClassName)}>
          {children}
        </ScrollAreaPrimitive.Viewport>
        {showVertical && <ScrollBar orientation="vertical" />}
        {showHorizontal && <ScrollBar orientation="horizontal" />}
        {orientation === 'both' && <ScrollAreaPrimitive.Corner />}
      </ScrollAreaPrimitive.Root>
    );
  }
);
