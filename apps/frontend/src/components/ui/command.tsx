import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "bg-surface-overlay text-text",
        "flex h-full w-full flex-col overflow-hidden rounded-xl",
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={showCloseButton}
      >
        <Command className={cn(
          "[&_[data-slot=command-input-wrapper]]:h-12",
          "[&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium",
          "[&_[cmdk-group]]:px-2",
          "[&_[cmdk-group]:not([hidden])~[cmdk-group]]:pt-0",
          "[&_[cmdk-input-wrapper]_svg]:size-5",
          "[&_[cmdk-input]]:h-12",
          "[&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3",
          "[&_[cmdk-item]_svg]:size-5",
        )}>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-8 items-center gap-1.5 border-b border-border-subtle px-3"
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-8 w-full rounded-xl bg-transparent py-2 text-sm leading-5 outline-none border-none text-text",
          "placeholder:text-text-muted",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto", className)}
      {...props}
    />
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-[1.125rem] text-center text-sm leading-5 text-text-muted"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "text-text overflow-hidden p-1",
        "[&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:leading-4 [&_[cmdk-group-heading]]:font-medium",
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("bg-border-subtle -mx-1 h-px", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-xl px-1.5 py-1 text-sm leading-5 outline-none select-none",
        // Interactive standards
        "transition-all duration-200",
        // Sejajar dengan .item:focus di dropdown-menu/select — lihat catatan
        // di sana soal ring global yang kalah spesifisitas.
        "data-[selected=true]:bg-brand-subtle data-[selected=true]:text-brand-text",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        "[&_svg:not([class*=text-])]:text-text-muted",
        "[&_svg:not([class*=size-])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("text-text-muted ml-auto text-sm leading-4 tracking-widest", className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
