export function ms(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v < 1000) return `${Math.round(v)} ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function clock(v: number): string {
  const s = Math.floor(v / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  return v == null ? '—' : v.toFixed(digits);
}
