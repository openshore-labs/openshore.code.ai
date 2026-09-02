// "Compact" is the phone layout: the sidebar becomes a slide-over drawer and
// every top bar grows a hamburger to open it. One breakpoint, shared by the
// App shell and the room top bars so they never disagree.
import { useEffect, useState } from 'react';

export const COMPACT_BREAKPOINT = 900;

export function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth < COMPACT_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < COMPACT_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return compact;
}
