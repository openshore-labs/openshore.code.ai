// Sign-in without passwords (founder, CTO and CX, 2026-10-12), held across
// the app, the auth server's config, the email template and the migration.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, PENDING_AUTH_TTL_MS, RESEND_WAIT_S } from '../src/state/emailSignInOps.js';

const ROOT = join(process.cwd(), '..');
const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
// What the person reads: the file without its leading comment.
const template = readFileSync(join(ROOT, 'supabase/templates/sign-in.html'), 'utf8').replace(
  /<!--[\s\S]*?-->/g,
  '',
);
const migration = readFileSync(join(ROOT, 'supabase/migrations/0028_passwordless.sql'), 'utf8');

/** One `key = value` line from a [section] of config.toml. */
function tomlValue(section: string, key: string): string | undefined {
  const at = config.indexOf(`[${section}]\n`);
  if (at < 0) return undefined;
  const body = config.slice(at).split('\n').slice(1);
  for (const line of body) {
    if (line.startsWith('[')) break;
    const m = new RegExp(`^${key}\\s*=\\s*(.+)$`).exec(line.trim());
    if (m) return m[1]!.trim();
  }
  return undefined;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('the app asks for no password, anywhere', () => {
  const src = sourceFiles(join(process.cwd(), 'src')).map((f) => [f, readFileSync(f, 'utf8')]);

  it('never calls the password grant, sign-up with a password, or a password reset', () => {
    for (const [file, text] of src) {
      for (const banned of ['grant_type=password', '/auth/v1/recover', '/auth/v1/signup']) {
        expect(text.includes(banned), `${file} names ${banned}`).toBe(false);
      }
    }
  });

  it('never takes session tokens out of a link address', () => {
    for (const [file, text] of src) {
      expect(/get\(['"]access_token['"]\)/.test(text), file).toBe(false);
    }
  });
});

describe("the app's numbers are the auth server's", () => {
  it('the code is six digits', () => {
    expect(tomlValue('auth.email', 'otp_length')).toBe(String(CODE_LENGTH));
  });

  it('the request lives exactly as long as the code', () => {
    expect(Number(tomlValue('auth.email', 'otp_expiry')) * 1000).toBe(PENDING_AUTH_TTL_MS);
  });

  it('the resend wait is the server limit', () => {
    expect(tomlValue('auth.email', 'max_frequency')).toBe(`"${RESEND_WAIT_S}s"`);
  });

  it('confirmations stay on (P0-4)', () => {
    expect(tomlValue('auth.email', 'enable_confirmations')).toBe('true');
  });
});

describe('the sign-in email', () => {
  it('both templates are the one file', () => {
    for (const t of ['magic_link', 'confirmation']) {
      expect(tomlValue(`auth.email.template.${t}`, 'content_path')).toBe(
        '"./supabase/templates/sign-in.html"',
      );
    }
  });

  it('puts the code first and sends the link through the scanner-safe page', () => {
    expect(template.indexOf('{{ .Token }}')).toBeGreaterThan(0);
    expect(template.indexOf('{{ .Token }}')).toBeLessThan(template.indexOf('ConfirmationURL'));
    expect(template).toContain(
      'href="https://openshore.ai/sign-in/continue/#u={{ .ConfirmationURL }}"',
    );
    // html/template refuses its own escapers in a pipeline on some versions.
    expect(template).not.toMatch(/\|\s*(urlquery|html)\b/);
    expect(template).not.toMatch(/<img|password/i);
  });
});

describe('the reset-password email', () => {
  it('says there are no passwords, with no link and no code', () => {
    expect(tomlValue('auth.email.template.recovery', 'content_path')).toBe(
      '"./supabase/templates/no-password.html"',
    );
    const body = readFileSync(join(ROOT, 'supabase/templates/no-password.html'), 'utf8').replace(
      /<!--[\s\S]*?-->/g,
      '',
    );
    expect(body).toContain('no passwords');
    expect(body).not.toMatch(/\{\{|href=/);
  });
});

describe('passkeys wait for the founder gate', () => {
  it('the relying party is openshore.ai, and the server switch is off', () => {
    expect(tomlValue('auth.webauthn', 'rp_id')).toBe('"openshore.ai"');
    expect(tomlValue('auth.webauthn', 'rp_origins')).toBe('["https://openshore.ai"]');
    expect(tomlValue('auth.passkey', 'enabled')).toBe('false');
  });

  it('0028 clears every password, keeps it clear, and steps up a new passkey', () => {
    expect(migration).toMatch(/update auth\.users\s+set encrypted_password = ''/);
    expect(migration).toContain('before insert or update of encrypted_password on auth.users');
    expect(migration).toContain('before insert on auth.webauthn_credentials');
    expect(migration).toContain("interval '10 minutes'");
  });
});

describe("no way in but a person's own email or passkey (CTO, App Review ruling)", () => {
  const FUNCTIONS = join(ROOT, 'supabase/functions');
  const functionFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? functionFiles(p) : /\.(ts|js)$/.test(name) ? [p] : [];
    });

  it('no edge function can mint a session', () => {
    for (const file of functionFiles(FUNCTIONS)) {
      const text = readFileSync(file, 'utf8');
      for (const banned of [
        /generateLink/,
        /verifyOtp/,
        /signInWith\w+/,
        /\/auth\/v1\/verify/,
        /grant_type=/,
      ]) {
        expect(banned.test(text), `${file} matches ${banned}`).toBe(false);
      }
    }
  });

  it("0028's triggers exempt no address", () => {
    expect(migration).not.toMatch(/new\.email|\bemail\s*(=|<>|in\b|like\b)/i);
  });
});
