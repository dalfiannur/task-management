interface DateProgressProps {
  startDate: Date;
  dueDate: Date;
}

export function DateProgress({ startDate, dueDate }: DateProgressProps) {
  const now = new Date();
  const total = dueDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const daysLeft = Math.max(0, Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="space-y-1.5">
      <div className="bg-muted h-2 rounded-full overflow-hidden">
        <div
          className="bg-primary h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wide text-right">
        <span>{daysLeft} Days Left</span>
      </div>
    </div>
  );
}
