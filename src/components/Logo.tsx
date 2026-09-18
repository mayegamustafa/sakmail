/* eslint-disable @next/next/no-img-element */

/**
 * The schools' badge and wordmark.
 *
 * A plain img rather than next/image: the badge is a 12KB square that never
 * changes, so the optimiser has nothing to save and would only add a round trip
 * through /_next/image on every page.
 */
export function Logo({ compact = false, size = 34 }: { compact?: boolean; size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <img
        src="/sak.jpg"
        alt="Sir Apollo Kaggwa Schools"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-lg object-contain"
      />
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
