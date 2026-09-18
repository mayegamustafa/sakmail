'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps the screen current without anyone pressing refresh.
 *
 * This polls rather than holding a stream open. A mailbox needs to feel live,
 * but a long-lived connection through a platform proxy is the kind of thing that
 * works in testing and quietly dies in production, and a mail client that has
 * silently stopped updating is worse than one that visibly never did.
 *
 * Two things make polling behave like a push:
 *
 * - Nothing runs while the tab is hidden. Somebody with the mailbox open in a
 *   background tab all day would otherwise generate thousands of pointless
 *   requests, and see nothing for them.
 * - Coming back refreshes immediately. Returning to the tab is exactly when a
 *   person wants the truth, and waiting out the rest of an interval to get it is
 *   what makes an app feel stale.
 */
export function useLive(refresh: () => void, intervalMs = 12_000) {
  // Held in a ref so a caller passing an inline arrow does not restart the
  // timer on every render.
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const start = () => {
      stop();
      timer = setInterval(() => latest.current(), intervalMs);
    };

    const onVisible = () => {
      if (document.hidden) {
        stop();
        return;
      }
      latest.current();
      start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [intervalMs]);
}
