import { cn } from "@/lib/utils";

interface PropertyRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  className?: string;
}

export function PropertyRow({ icon: Icon, label, children, className }: PropertyRowProps) {
  return (
    <div className={cn("flex items-center gap-1.5 min-h-7", className)}>
      <div className="flex items-center gap-[0.3125rem] w-[68px] shrink-0">
        <Icon className="size-[0.8125rem] text-muted-foreground/50" />
        <span className="text-sm leading-4 font-mono text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
