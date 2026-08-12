import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium shrink-0",
    "cursor-pointer border-none no-underline",
    // Durasi & easing dari token — motion.md §1. Hover adalah perubahan mikro,
    // jadi --duration-fast.
    "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)]",
    // outline:none DIIZINKAN hanya karena diganti ring yang terlihat
    // (accessibility.md §3). Offset-nya wajib sewarna permukaan di belakang,
    // bukan putih bawaan Tailwind — kalau tidak, di dark mode ia menggambar
    // cincin putih.
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        // Hover memakai --brand-hover / bukan --brand beralpha: pasangan
        // --text-on-brand di atas --brand-hover sudah diukur (9.64 light /
        // 6.16 dark), sedangkan hasil komposit alpha tidak pernah diukur.
        // Hanya `default` yang terangkat. Kalau semua tombol punya bayangan,
        // tidak ada yang menonjol dan aksi utama kehilangan targetnya
        // (aturan 4).
        default: "bg-brand text-text-on-brand shadow-1 hover:bg-brand-hover",
        secondary: "bg-surface-sunken text-text hover:bg-surface-hover",
        destructive:
          "bg-danger text-text-on-danger hover:bg-danger/90",
        outline:
          "border border-border bg-surface-raised text-text hover:bg-surface-hover",
        ghost: "text-text hover:bg-surface-hover",
        link: "text-brand-text underline underline-offset-4",
      },
      // Target sentuh ≥ 44×44 — accessibility.md §4.1, tidak ditawar untuk
      // kontrol berdiri sendiri. Ukuran padat mempertahankan kotak visualnya
      // dan memakai `.hit-area` (§4.4) supaya area kliknya tetap 44×44.
      size: {
        default: "h-11 px-6 has-[>svg]:px-5",
        lg: "h-12 px-8 has-[>svg]:px-6",
        sm: "hit-area h-9 gap-1.5 px-4 has-[>svg]:px-3",
        xs: "hit-area h-8 gap-1 px-3 has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        icon: "size-11",
        "icon-lg": "size-12",
        "icon-sm": "hit-area size-9",
        "icon-xs": "hit-area size-8 [&_svg:not([class*='size-'])]:size-3",
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
