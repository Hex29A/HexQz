import { useEffect, useState } from 'react';

// Seconds remaining of a timer that started at `startedAt` (unix seconds) and
// runs for `seconds`. Null when there is no timer. Driven by wall-clock time,
// so a reloaded page shows the right value (issue #26).
export function useCountdown(startedAt, seconds, active = true) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!active || !startedAt || !seconds) {
      setRemaining(null);
      return undefined;
    }
    const tick = () => {
      const elapsed = (Date.now() - startedAt * 1000) / 1000;
      setRemaining(Math.max(0, seconds - elapsed));
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [active, startedAt, seconds]);

  return remaining;
}

// Whole-second countdown for the "Get Ready" screen (5, 4, 3, 2, 1, 0).
export function useGetReadyCountdown(startedAt, seconds = 5, active = true) {
  const remaining = useCountdown(startedAt, seconds, active);
  return remaining === null ? null : Math.ceil(remaining);
}
