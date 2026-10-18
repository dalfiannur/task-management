// Durations: minutes on the wire, "1h 30m" on screen. Pure. Used by task
// estimates and by time tracking.

/** Same bound as the server (`domain::task::MAX_ESTIMATE_MINUTES`). */
export const MAX_ESTIMATE_MINUTES = 1000 * 60;

/** `45m`, `2h`, `1h 30m`. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Read what someone types into the estimate field: `2h`, `30m`, `1h 30m`,
 * `1h30`, or a bare number of hours (`1.5`, `1,5`). Blank is 0 — no estimate.
 * `null` when it is neither, or outside 0…1000 hours.
 */
export function parseEstimate(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (!s) return 0;
  let minutes: number;
  const bare = /^\d+(\.\d+)?$/.exec(s);
  if (bare) {
    minutes = Math.round(parseFloat(s) * 60);
  } else {
    const m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m?)?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return null;
    // "30" alone is caught as hours above; here a trailing number without
    // a unit only follows hours ("1h30"), so it is minutes.
    minutes = Math.round(parseFloat(m[1] ?? "0") * 60) + parseInt(m[2] ?? "0", 10);
  }
  return minutes <= MAX_ESTIMATE_MINUTES ? minutes : null;
}
