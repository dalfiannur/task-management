import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl text-sm font-medium shrink-0 cursor-pointer border-none no-underline transition-all duration-300 active:scale-95 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-white/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-white text-indigo-600 dark:bg-indigo-500 dark:text-white font-bold hover:shadow-lg hover:shadow-white/20",
        secondary:
          "bg-white/20 dark:bg-white/5 backdrop-blur-md border border-white/30 dark:border-white/10 text-white hover:bg-white/30",
        destructive:
          "bg-red-500/80 backdrop-blur-md text-white border border-red-400/30 hover:bg-red-500/90 hover:shadow-lg hover:shadow-red-500/20",
        outline:
          "bg-white/10 backdrop-blur-md border border-white/30 dark:border-white/10 text-white hover:bg-white/20",
        ghost:
          "bg-transparent text-white hover:bg-white/10 backdrop-blur-md",
        link:
          "bg-transparent text-white underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5 py-1.5 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 px-2 text-sm has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 has-[>svg]:px-2",
        lg: "h-9 px-5 has-[>svg]:px-3.5",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>

function Button({
  className,
  variant,
  size,
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
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonVariant, ButtonSize }
