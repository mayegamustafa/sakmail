/**
 * The schools' wordmark. Crimson on white, with "SINCE 1996" as the decks use it.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-crimson-500 text-sm font-bold tracking-tight text-white">
        SAK
      </span>
      {compact ? null : (
        <span className="leading-tight">
          <span className="block text-[13px] font-bold uppercase tracking-[0.06em] text-ink">
            Sir Apollo Kaggwa Schools
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-crimson-700">
            Since 1996
          </span>
        </span>
      )}
    </span>
  );
}
