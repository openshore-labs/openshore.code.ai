// Keep the app's build-time env honest: every VITE_ var the code reads must be
// documented in .env.example, and no server-only secret may ever be listed
// there (only VITE_-prefixed, public values reach the client bundle). This is
// the lean version of Uki's serverMap drift test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY'];

// Names that would be a leak if they appeared as a client (VITE_) var.
const NEVER_CLIENT = ['SERVICE_ROLE', 'STRIPE_SECRET', 'ENTITLEMENT_SIGNING', 'WEBHOOK_SECRET'];

describe('.env.example', () => {
  it('documents every VITE_ var the app reads', () => {
    for (const key of REQUIRED) {
      expect(envExample).toContain(key);
    }
  });

  it('never lists a server-only secret as a client (VITE_) var', () => {
    for (const line of envExample.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('VITE_')) continue;
      for (const secret of NEVER_CLIENT) {
        expect(trimmed.toUpperCase()).not.toContain(secret);
      }
    }
  });
});
