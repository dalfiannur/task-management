import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import styles from "./button.module.css"

type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link"

type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg"

/**
 * No-op compatibility shim for consumers that imported `buttonVariants`.
 * Returns an empty string; callers should migrate to using `<Button>` directly
 * or apply button styles via CSS.
 */
function buttonVariants(_opts?: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}): string {
  return ""
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(styles.button, className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonVariant, ButtonSize }
