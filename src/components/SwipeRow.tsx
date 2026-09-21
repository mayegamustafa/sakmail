'use client';

import { useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/**
 * A conversation row you can swipe or hold, the way a phone mail app behaves.
 *
 * Three judgements matter here:
 *
 * - A swipe must never fight the list's own scrolling. The direction is decided
 *   once, on the first few pixels of movement, and a gesture that starts
 *   vertically is left alone for the rest of the touch.
 * - A hold must not fire while the finger is moving, or scrolling the list would
 *   constantly select things. Any real movement cancels it.
 * - Releasing short of the threshold springs back rather than doing nothing
 *   silently, so a half-swipe reads as "not yet" rather than "broken".
 */

const COMMIT_PX = 96;
const DIRECTION_LOCK_PX = 10;
const HOLD_MS = 500;

export type SwipeAction = { label: string; icon: IconName; tone: 'positive' | 'danger' };

export function SwipeRow({
  children,
  left,
  right,
  onLeft,
  onRight,
  onHold,
  disabled,
}: {
  children: React.ReactNode;
  /** Revealed by swiping right, the gentler action. */
  left?: SwipeAction;
  /** Revealed by swiping left, usually the destructive one. */
  right?: SwipeAction;
  onLeft?: () => void;
  onRight?: () => void;
  onHold?: () => void;
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);

  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'undecided' | 'x' | 'y'>('undecided');
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  function clearHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  function onTouchStart(e: React.TouchEvent) {
    if (disabled) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    axis.current = 'undecided';
    held.current = false;
    setSettling(false);

    if (onHold) {
      holdTimer.current = setTimeout(() => {
        held.current = true;
        // A short buzz, where the device offers one, so the selection is felt
        // rather than only seen.
        navigator.vibrate?.(12);
        onHold();
      }, HOLD_MS);
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (disabled || !start.current) return;
    const t = e.touches[0];
    const dX = t.clientX - start.current.x;
    const dY = t.clientY - start.current.y;

    // Any real movement means this is not a hold.
    if (Math.abs(dX) > 6 || Math.abs(dY) > 6) clearHold();

    if (axis.current === 'undecided') {
      if (Math.abs(dX) < DIRECTION_LOCK_PX && Math.abs(dY) < DIRECTION_LOCK_PX) return;
      // Locked for the rest of this touch, so a diagonal drag cannot flip
      // between scrolling and swiping halfway through.
      axis.current = Math.abs(dX) > Math.abs(dY) ? 'x' : 'y';
    }
    if (axis.current !== 'x') return;

    // Only offer a direction that has somewhere to go.
    if ((dX > 0 && !left) || (dX < 0 && !right)) return;
    setDx(dX);
  }

  function onTouchEnd() {
    clearHold();
    if (disabled || axis.current !== 'x') {
      start.current = null;
      return;
    }

    const travelled = dx;
    setSettling(true);
    setDx(0);
    start.current = null;
    axis.current = 'undecided';

    if (travelled > COMMIT_PX && onLeft) onLeft();
    else if (travelled < -COMMIT_PX && onRight) onRight();
  }

  const revealing = dx > 0 ? left : dx < 0 ? right : null;
  const armed = Math.abs(dx) > COMMIT_PX;

  return (
    <div className="relative overflow-hidden">
      {revealing ? (
        <div
          aria-hidden
          className={[
            'absolute inset-0 flex items-center px-5 text-white transition-colors',
            dx > 0 ? 'justify-start' : 'justify-end',
            revealing.tone === 'danger'
              ? armed
                ? 'bg-crimson-600'
                : 'bg-crimson-400'
              : armed
                ? 'bg-emerald-600'
                : 'bg-emerald-400',
          ].join(' ')}
        >
          <span className="flex items-center gap-2 text-xs font-semibold">
            <Icon name={revealing.icon} size={18} />
            {revealing.label}
          </span>
        </div>
      ) : null}

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{ transform: `translateX(${dx}px)` }}
        className={[
          'relative bg-paper',
          settling ? 'transition-transform duration-200' : '',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
