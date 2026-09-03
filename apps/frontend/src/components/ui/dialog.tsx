import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
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

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      {/* Content is a direct Portal child — not wrapped in a centering div.
          DialogPortal gives each of its direct children its own Presence; a
          wrapper with no animation of its own would have its Presence
          unmount it (and Content inside it) the instant state flips to
          closed, before Content's own Presence could wait out its exit
          animation. That is what silently ate `data-[state=closed]:dialog-
          exit` before (CSS rule generated correctly — see
          styles/dialog-utilities.css — just never given the chance to run).

          Centering is `inset-0 m-auto h-fit` instead: for a fixed element
          with all four insets at 0, an explicit (non-auto) width/height plus
          `margin: auto` is the classic way auto-margins center an
          absolutely/fixed positioned box, on both axes, without a translate
          that would fight the enter/exit `zoom-in`/`zoom-out` transform.
          `max-h` + `overflow-y-auto` is the load-bearing part: it's what
          keeps a dialog taller than the viewport scrollable to its top,
          which is the property shadcn's translate + no-overflow-handling
          centering lacks. A consumer that manages its own internal scroll
          region (e.g. task-dialog.tsx) overrides both. */}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // Position + centering. `dvh` rather than `vh`: mobile Safari counts
          // its collapsing address bar in `vh`, so `vh` overstates the visible
          // viewport and would clip the dialog. And `fixed` makes Content its
          // own positioning context, which is what the absolutely positioned
          // close button below anchors to — the `relative` that used to sit
          // here is redundant now, not missing.
          "fixed inset-0 z-50 m-auto h-fit max-h-[calc(100dvh-2rem)] overflow-y-auto",
          // Width. `%` here resolves against the viewport (Content has no
          // padded wrapper around it anymore), so the gutter that used to
          // come from the wrapper's `p-4` (1rem/side) is folded into this
          // calc directly — 4rem, not 2rem, to land on the same ~2rem
          // margin per side the old wrapper+content combination produced.
          "w-full max-w-[calc(100%-4rem)] sm:max-w-lg",
          "grid gap-4 p-6 text-text outline-none",
          // Permukaan overlay + elevasi modal (depth.md §3). Sebelumnya
          // background-nya di-hardcode hsl(228 20% 10% / .9) — dark-only,
          // sehingga dialog tetap gelap saat tema light aktif.
          "bg-surface-overlay border border-border-strong shadow-4 rounded-xl",
          // Animation
          "data-[state=open]:dialog-enter",
          "data-[state=closed]:dialog-exit",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn(
              "absolute top-3.5 right-3.5 rounded-lg p-1 border-none",
              "text-text-muted cursor-pointer",
              // Interactive standards
              "transition-all duration-200 active:scale-95",
              "hover:bg-surface-hover hover:text-text",
              "focus:outline-none focus:ring-2 focus:ring-focus/40",
              "disabled:pointer-events-none",
              "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4",
            )}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-bold tracking-tight text-text", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-5 text-text-muted", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
