import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import styles from "./badge.module.css"

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "ghost"
  | "link"

/**
 * No-op compatibility shim for consumers that imported `badgeVariants`.
 * Returns an empty string; callers should migrate to using `<Badge>` directly
 * or apply badge styles via CSS.
 */
function badgeVariants(_opts?: {
  variant?: BadgeVariant
  className?: string
}): string {
  return ""
}

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & {
  variant?: BadgeVariant
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(styles.badge, className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
export type { BadgeVariant }
