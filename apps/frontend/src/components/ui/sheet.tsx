import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-scrim backdrop-blur-sm",
        "data-[state=open]:overlay-enter",
        "data-[state=closed]:overlay-exit",
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // Base
          //
          // Height, for whoever uses this first — nothing does today, so none
          // of the below has ever been exercised:
          //
          // Left/right pin `inset-y-0` on a fixed element, so the browser
          // sizes them to the visual viewport. That is inherently correct on
          // mobile, where a `vh` length would overstate the visible area by
          // the collapsing address bar (`dialog.tsx` uses `dvh` to work around
          // exactly that; here it isn't needed).
          //
          // Top/bottom are `h-auto`: height follows content, with no `max-h`
          // and no `overflow` anywhere on this element. Tall content will grow
          // straight past the viewport with nothing able to scroll it — the
          // same gap `DialogContent` had before it gained
          // `max-h` + `overflow-y-auto`. Left/right have no `overflow` either,
          // so they overflow too once content exceeds the screen.
          //
          // Left unfixed on purpose rather than overlooked: the right shape
          // depends on the first real use (a bottom action sheet wants to hug
          // its content up to a cap; a side filter panel wants an internal
          // scroll region), and there is no consumer to verify a guess
          // against.
          "fixed z-50 flex flex-col gap-3",
          // Solid background
          "bg-surface-overlay shadow-4",
          // Side: right
          "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:sm:max-w-sm",
          "data-[side=right]:border-l data-[side=right]:border-border-strong",
          "data-[side=right]:data-[state=open]:[animation:slide-in-from-right_320ms_var(--ease-in-out)]",
          "data-[side=right]:data-[state=closed]:[animation:slide-out-to-right_120ms_var(--ease-out)]",
          // Side: left
          "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:sm:max-w-sm",
          "data-[side=left]:border-r data-[side=left]:border-border-strong",
          "data-[side=left]:data-[state=open]:[animation:slide-in-from-left_320ms_var(--ease-in-out)]",
          "data-[side=left]:data-[state=closed]:[animation:slide-out-to-left_120ms_var(--ease-out)]",
          // Side: top
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto",
          "data-[side=top]:border-b data-[side=top]:border-border-strong",
          "data-[side=top]:data-[state=open]:[animation:slide-in-from-top_320ms_var(--ease-in-out)]",
          "data-[side=top]:data-[state=closed]:[animation:slide-out-to-top_120ms_var(--ease-out)]",
          // Side: bottom
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto",
          "data-[side=bottom]:border-t data-[side=bottom]:border-border-strong",
          "data-[side=bottom]:data-[state=open]:[animation:slide-in-from-bottom_320ms_var(--ease-in-out)]",
          "data-[side=bottom]:data-[state=closed]:[animation:slide-out-to-bottom_120ms_var(--ease-out)]",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            className={cn(
              "absolute top-3 right-3 rounded-lg p-1 border-none",
              "text-text-muted cursor-pointer",
              // Interactive standards
              "transition-all duration-200 active:scale-95",
              "hover:bg-surface-hover hover:text-text",
              "focus:outline-none focus:ring-2 focus:ring-focus/40",
              "disabled:pointer-events-none",
            )}
          >
            <XIcon className="size-4 pointer-events-none shrink-0" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 p-3", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-1.5 p-3", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-bold tracking-tight text-text", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-5 text-text-muted", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
