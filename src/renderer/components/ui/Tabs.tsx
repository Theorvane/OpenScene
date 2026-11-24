import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from './cn';

export type TabsProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;
export type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;
export type TabsTriggerProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>;
export type TabsContentProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;

export const Tabs = forwardRef<ElementRef<typeof TabsPrimitive.Root>, TabsProps>(function Tabs(
  { className, ...props },
  ref
) {
  return <TabsPrimitive.Root ref={ref} className={cn('os-ui-tabs', className)} {...props} />;
});

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, TabsListProps>(function TabsList(
  { className, ...props },
  ref
) {
  return <TabsPrimitive.List ref={ref} className={cn('os-ui-tabs__list', className)} {...props} />;
});

export const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(function TabsTrigger(
  { className, ...props },
  ref
) {
  return <TabsPrimitive.Trigger ref={ref} className={cn('os-ui-tabs__trigger', className)} {...props} />;
});

export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, TabsContentProps>(function TabsContent(
  { className, ...props },
  ref
) {
  return <TabsPrimitive.Content ref={ref} className={cn('os-ui-tabs__content', className)} {...props} />;
});
