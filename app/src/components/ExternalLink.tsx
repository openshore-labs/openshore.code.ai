// A link that leaves the app: the system browser on iOS and the OS browser on
// the desktop, through openExternal, the same way every other outbound link
// opens. A real anchor, so it reads as a link to assistive tech and keeps its
// address on hover; the tap rides the house press physics (.linklike).
import type { ReactNode } from 'react';
import { openExternal } from '../lib/platform.js';

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="linklike"
      href={href}
      rel="noreferrer noopener"
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
    >
      {children}
    </a>
  );
}
