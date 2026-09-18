'use client';

/** Fetch that returns null instead of throwing, since every caller wants that. */
export async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  }).catch(() => null);

  // A dead session should land on sign-in rather than an empty screen.
  if (res?.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/sign-in';
    return null;
  }
  if (!res || !res.ok) return null;
  return (await res.json()) as T;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function initialsOf(first: string, last?: string): string {
  const source = `${first ?? ''} ${last ?? ''}`.trim();
  const parts = source.split(/[\s.@]+/).filter(Boolean);
  const pair = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return (pair || source.slice(0, 2)).toUpperCase();
}
