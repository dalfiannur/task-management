import { useEffect, useState } from "react";

/** `h:mm:ss` since `startedAt`, ticking once a second. */
export function Elapsed({ startedAt }: { startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const start = startedAt ? Date.parse(startedAt) : now;
  const total = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return <span className="text-num tabular-nums">{`${h}:${pad(m)}:${pad(s)}`}</span>;
}
