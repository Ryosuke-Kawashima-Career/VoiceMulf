/** Display formats for navigation info. */

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatDuration(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
