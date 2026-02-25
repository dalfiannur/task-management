import * as React from "react"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import styles from "./toggle.module.css"

type ToggleVariant = "default" | "outline"
type ToggleSize = "default" | "sm" | "lg"

/**
 * No-op compatibility shim for consumers that imported `toggleVariants`.
 * Returns an empty string; callers should migrate to using `<Toggle>` directly
 * or apply toggle styles via CSS.
 */
function toggleVariants(_opts?: {
  variant?: ToggleVariant
  size?: ToggleSize
  className?: string
}): string {
  return ""
}

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & {
  variant?: ToggleVariant
  size?: ToggleSize
}) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      data-variant={variant}
      data-size={size}
      className={cn(styles.toggle, className)}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
