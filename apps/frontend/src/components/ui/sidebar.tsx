"use client"

import * as React from "react"
import { PanelLeftIcon } from "lucide-react"
import { Slot } from "radix-ui"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "14.5rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

/**
 * No-op compatibility shim for consumers that imported `sidebarMenuButtonVariants`.
 * Returns an empty string; callers should migrate to using `<SidebarMenuButton>` directly.
 */
function sidebarMenuButtonVariants(_opts?: {
  variant?: "default" | "outline"
  size?: "default" | "sm" | "lg"
  className?: string
}): string {
  return ""
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "flex flex-col w-[var(--sidebar-width)] h-full bg-sidebar text-sidebar-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
              width: "var(--sidebar-width)",
              padding: 0,
              backgroundColor: "var(--sidebar)",
              color: "var(--sidebar-foreground)",
            } as React.CSSProperties
          }
          side={side}
          showCloseButton={false}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  const gapVariant =
    variant === "floating" || variant === "inset" ? "floating" : "sidebar"

  return (
    <div
      className="hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        data-gap-variant={gapVariant}
        className={cn(
          "relative w-[var(--sidebar-width)] bg-transparent transition-[width] duration-200 ease-linear",
          "[[data-collapsible=offcanvas]_&]:w-0",
          "[[data-side=right]_&]:rotate-180",
          "[[data-collapsible=icon]_&[data-gap-variant=sidebar]]:w-[var(--sidebar-width-icon)]",
          "[[data-collapsible=icon]_&[data-gap-variant=floating]]:w-[calc(var(--sidebar-width-icon)+1rem)]",
        )}
      />
      <div
        data-slot="sidebar-container"
        data-container-side={side}
        data-container-variant={
          variant === "floating" || variant === "inset" ? "floating" : "sidebar"
        }
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex",
          // Side: left
          "data-[container-side=left]:left-0",
          "[[data-collapsible=offcanvas]_&[data-container-side=left]]:left-[calc(var(--sidebar-width)*-1)]",
          // Side: right
          "data-[container-side=right]:right-0",
          "[[data-collapsible=offcanvas]_&[data-container-side=right]]:right-[calc(var(--sidebar-width)*-1)]",
          // Floating/inset variant
          "data-[container-variant=floating]:p-2",
          "[[data-collapsible=icon]_&[data-container-variant=floating]]:w-[calc(var(--sidebar-width-icon)+1rem+2px)]",
          // Sidebar variant
          "[[data-collapsible=icon]_&[data-container-variant=sidebar]]:w-[var(--sidebar-width-icon)]",
          "[[data-side=left]_&[data-container-variant=sidebar]]:border-r [[data-side=left]_&[data-container-variant=sidebar]]:border-sidebar-border",
          "[[data-side=right]_&[data-container-variant=sidebar]]:border-l [[data-side=right]_&[data-container-variant=sidebar]]:border-sidebar-border",
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className={cn(
            "flex h-full w-full flex-col bg-sidebar",
            "[[data-variant=floating]_&]:rounded-lg [[data-variant=floating]_&]:border [[data-variant=floating]_&]:border-sidebar-border [[data-variant=floating]_&]:shadow-sm",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 cursor-pointer bg-transparent border-none p-0 outline-none transition-all duration-200 ease-linear sm:flex",
        // Rail line (::after)
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:content-[''] hover:after:bg-sidebar-border",
        // Side positioning
        "[[data-side=left]_&]:right-[-1rem] [[data-side=left]_&]:cursor-w-resize",
        "[[data-side=right]_&]:left-0 [[data-side=right]_&]:cursor-e-resize",
        // Collapsed cursor flip
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize",
        "[[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        // Offcanvas adjustments
        "[[data-collapsible=offcanvas]_&]:translate-x-0 [[data-collapsible=offcanvas]_&]:after:left-full [[data-collapsible=offcanvas]_&]:hover:bg-sidebar",
        "[[data-side=left][data-collapsible=offcanvas]_&]:right-[-0.5rem]",
        "[[data-side=right][data-collapsible=offcanvas]_&]:left-[-0.5rem]",
        className,
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background",
        "md:[[data-variant=inset]~&]:m-2 md:[[data-variant=inset]~&]:ml-0 md:[[data-variant=inset]~&]:rounded-xl md:[[data-variant=inset]~&]:shadow-sm",
        "md:[[data-variant=inset][data-state=collapsed]~&]:ml-2",
        className,
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("h-8 w-full bg-background shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-1.5 p-1.5", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-1.5 p-1.5", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("mx-1.5 w-auto bg-sidebar-border", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto",
        "[[data-collapsible=icon]_&]:overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-1.5", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "flex h-7 shrink-0 items-center rounded-sm px-2 text-sm leading-4 font-medium font-mono uppercase tracking-[0.06em] text-sidebar-foreground/70 outline-none transition-[margin,opacity] duration-200 ease-linear",
        "focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:-outline-offset-2",
        "[&>svg]:size-4 [&>svg]:shrink-0",
        "[[data-collapsible=icon]_&]:-mt-7 [[data-collapsible=icon]_&]:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-sm p-0 text-sidebar-foreground bg-transparent border-none cursor-pointer outline-none transition-transform duration-200 ease-out",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:-outline-offset-2",
        "[&>svg]:size-4 [&>svg]:shrink-0",
        // Mobile hit area
        "after:absolute after:-inset-2 after:content-[''] md:after:hidden",
        "[[data-collapsible=icon]_&]:hidden",
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-[0.1875rem] list-none p-0 m-0", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("relative list-none", className)}
      {...props}
    />
  )
}

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  variant?: "default" | "outline"
  size?: "default" | "sm" | "lg"
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
}) {
  const Comp = asChild ? Slot.Root : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-variant={variant}
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-1.5 overflow-hidden rounded-sm px-2 py-1.5 text-left text-sm outline-none bg-transparent border-none cursor-pointer text-inherit no-underline",
        "transition-[width,height,padding] duration-200 ease-out",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:-outline-offset-2",
        "active:bg-sidebar-accent active:text-sidebar-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        // Active state
        "data-[active=true]:bg-sidebar-primary/8 data-[active=true]:font-medium data-[active=true]:text-sidebar-primary",
        // Open state
        "data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground",
        // Has menu-action sibling → extra right padding
        "[.group\\/menu-item:has([data-sidebar=menu-action])_&]:pr-8",
        // SVG and span children
        "[&>svg]:size-4 [&>svg]:shrink-0",
        "[&>span:last-child]:truncate",
        // Variant: outline
        "data-[variant=outline]:bg-background data-[variant=outline]:shadow-[0_0_0_1px_var(--sidebar-border)]",
        "data-[variant=outline]:hover:bg-sidebar-accent data-[variant=outline]:hover:text-sidebar-accent-foreground data-[variant=outline]:hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
        // Size: default
        "data-[size=default]:h-[1.875rem] data-[size=default]:text-sm",
        // Size: sm
        "data-[size=sm]:h-[1.625rem] data-[size=sm]:text-sm data-[size=sm]:leading-4",
        // Size: lg
        "data-[size=lg]:h-11 data-[size=lg]:text-sm",
        // Collapsed icon mode
        "[[data-collapsible=icon]_&]:!size-[1.875rem] [[data-collapsible=icon]_&]:!p-1.5",
        "[[data-collapsible=icon]_&[data-size=lg]]:!p-0",
        className,
      )}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      data-show-on-hover={showOnHover || undefined}
      className={cn(
        "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-sm p-0 text-sidebar-foreground bg-transparent border-none cursor-pointer outline-none transition-transform duration-200 ease-out",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:-outline-offset-2",
        "[&>svg]:size-4 [&>svg]:shrink-0",
        // Mobile hit area
        "after:absolute after:-inset-2 after:content-[''] md:after:hidden",
        // Peer-hover from menu-button sibling
        "[[data-sidebar=menu-button]:hover~&]:text-sidebar-accent-foreground",
        // Position based on peer menu-button size
        "[[data-sidebar=menu-button][data-size=sm]~&]:top-1",
        "[[data-sidebar=menu-button][data-size=default]~&]:top-1.5",
        "[[data-sidebar=menu-button][data-size=lg]~&]:top-2.5",
        "[[data-collapsible=icon]_&]:hidden",
        // showOnHover variant
        "data-[show-on-hover=true]:opacity-0 max-md:data-[show-on-hover=true]:opacity-100",
        "data-[show-on-hover=true]:data-[state=open]:opacity-100",
        "[[data-sidebar=menu-button][data-active=true]~&[data-show-on-hover=true]]:text-sidebar-accent-foreground",
        "[[data-sidebar=menu-item]:hover_&[data-show-on-hover=true]]:opacity-100",
        "[[data-sidebar=menu-item]:focus-within_&[data-show-on-hover=true]]:opacity-100",
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "absolute right-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm px-1 text-sm leading-4 font-medium font-mono tabular-nums text-sidebar-foreground pointer-events-none select-none",
        // Peer-hover from menu-button sibling
        "[[data-sidebar=menu-button]:hover~&]:text-sidebar-accent-foreground",
        // Active peer
        "[[data-sidebar=menu-button][data-active=true]~&]:text-sidebar-accent-foreground",
        // Position based on peer menu-button size
        "[[data-sidebar=menu-button][data-size=sm]~&]:top-1",
        "[[data-sidebar=menu-button][data-size=default]~&]:top-1.5",
        "[[data-sidebar=menu-button][data-size=lg]~&]:top-2.5",
        "[[data-collapsible=icon]_&]:hidden",
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  }, [])

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-[1.875rem] items-center gap-2 rounded-sm px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-sm"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-[var(--skeleton-width)] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "mx-3 flex min-w-0 translate-x-px flex-col gap-[0.1875rem] border-l border-sidebar-border px-2 py-0.5 list-none",
        "[[data-collapsible=icon]_&]:hidden",
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("relative list-none", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  size?: "sm" | "md"
  isActive?: boolean
}) {
  const Comp = asChild ? Slot.Root : "a"

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "flex h-[1.625rem] min-w-0 -translate-x-px items-center gap-1.5 overflow-hidden rounded-sm px-2 text-sidebar-foreground bg-transparent border-none cursor-pointer outline-none no-underline",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:-outline-offset-2",
        "active:bg-sidebar-accent active:text-sidebar-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        // Active state
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        // SVG and span children
        "[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        "[&>span:last-child]:truncate",
        // Size variants
        "data-[size=sm]:text-sm data-[size=sm]:leading-4",
        "data-[size=md]:text-sm",
        "[[data-collapsible=icon]_&]:hidden",
        className,
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  sidebarMenuButtonVariants,
  useSidebar,
}
