// Secret redaction. Applied to every transcript line, log line, and persisted
// session before it touches disk, and to shell output before it is fed back to
// a model. Local models never need your keys to reason about your code.

interface RedactionRule {
  kind: string;
  pattern: RegExp;
}

// Order matters: specific token shapes first, generic assignments last.
const RULES: RedactionRule[] = [
  { kind: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{10,}/g },
  { kind: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/g },
  { kind: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'github-pat', pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  { kind: 'google-key', pattern: /AIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    kind: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { kind: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  {
    kind: 'assignment',
    // KEY=value / key: "value" where the name says secret-ish and the value is long enough to matter.
    pattern:
      /\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
  },
];

/** Replace anything that looks like a credential with a labeled placeholder. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const rule of RULES) {
    if (rule.kind === 'assignment') {
      out = out.replace(rule.pattern, (_m, name: string) => `${name}=[redacted:${rule.kind}]`);
    } else {
      out = out.replace(rule.pattern, `[redacted:${rule.kind}]`);
    }
  }
  return out;
}

/** True when the text contains anything the redactor would scrub. */
export function containsSecret(text: string): boolean {
  return RULES.some((rule) => {
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(text);
  });
}
