import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
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

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      {/* Content is a direct Portal child — not wrapped in a centering div.
          Same structure and same reasoning as `dialog.tsx`: AlertDialogPortal
          gives each of its direct children its own Presence, so a wrapper
          div with no animation of its own would unmount (taking Content with
          it) the instant state flips to closed, before Content's own
          Presence could wait out `data-[state=closed]:dialog-exit`.

          Centering is `inset-0 m-auto h-fit` — the auto-margin trick for a
          fixed element with all insets at 0 and an explicit width/height —
          instead of a wrapper div or a translate that would fight the
          enter/exit `zoom-in`/`zoom-out`. `max-h` + `overflow-y-auto` keeps
          a dialog taller than the viewport scrollable to its top rather than
          clipped, which is what the removed wrapper existed to protect. */}
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          // Position + centering. `dvh` rather than `vh`: mobile Safari counts
          // its collapsing address bar in `vh`, so `vh` overstates the visible
          // viewport and would clip the dialog.
          "fixed inset-0 z-50 m-auto h-fit max-h-[calc(100dvh-2rem)] overflow-y-auto",
          // Width. `%` resolves against the viewport now that there's no
          // padded wrapper, so the wrapper's old `p-4` (1rem/side) gutter is
          // folded into this calc — 4rem, not 2rem — to land on the same
          // ~2rem margin per side as before.
          "w-full max-w-[calc(100%-4rem)] sm:max-w-lg",
          "grid gap-4 p-6 text-text outline-none",
          // Solid background + frosted border
          "bg-surface-overlay border border-border-strong shadow-4 rounded-xl",
          // Animation
          "data-[state=open]:dialog-enter",
          "data-[state=closed]:dialog-exit",
          // Size variant
          "data-[size=sm]:max-w-xs",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
}) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "flex flex-col gap-1.5 text-center",
        size !== "sm" && "sm:text-left sm:place-items-start",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
}) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        size === "sm"
          ? "grid grid-cols-2 gap-2"
          : "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-base leading-5 font-bold tracking-tight text-text", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-5 text-text-muted", className)}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
}) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        // Subtle nested surface
        "bg-surface-hover border border-border",
        "w-14 h-14 inline-flex items-center justify-center rounded-xl mb-1.5",
        "[&_svg:not([class*=size-])]:size-8",
        size !== "sm" && "sm:row-span-2",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
