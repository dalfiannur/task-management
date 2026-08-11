import { cn } from "@/lib/utils"
import styles from "./skeleton.module.css"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // `rounded-md` di sini, BUKAN di skeleton.module.css: sebagai utility ia
      // masuk ke jangkauan tailwind-merge, jadi `rounded-xl`/`rounded-full` dari
      // pemanggil bisa mengalahkannya. Dari dalam modul ia tidak bisa ditimpa
      // sama sekali — lihat catatan panjang di skeleton.module.css.
      className={cn(styles.skeleton, "rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
