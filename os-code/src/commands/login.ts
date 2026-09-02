// osc login: connect the Claude account. The API key is the real,
// documented path; the key never leaves this machine. The subscription flag
// exists, labeled experimental, and only explains itself.
import { banner, t } from '../brand/theme.js';
import {
  isClaudeConnected,
  loginWithApiKey,
  logoutClaude,
  subscriptionSignInStub,
} from '../auth/claude.js';
import { saveGlobalConfig, loadConfig } from '../config/load.js';
import { askSecret, confirm, okLine, out, warnLine } from './util.js';

export interface LoginOptions {
  logout?: boolean;
  subscription?: boolean;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  if (options.logout) {
    logoutClaude();
    okLine('Claude is disconnected and the key is gone from this machine.');
    return;
  }
  if (options.subscription) {
    out(t.warn('EXPERIMENTAL'));
    out(t.text(subscriptionSignInStub()));
    return;
  }

  out(banner('osc login'));
  out();
  if (isClaudeConnected()) {
    okLine('Claude is already connected.');
    if (!(await confirm('Replace the stored key?', false))) return;
  }
  out(t.text('Paste your Anthropic API key. Get one at console.anthropic.com under API Keys.'));
  out(
    t.muted(
      'It is stored on this machine only (OS keychain, or an encrypted local file) and used only when YOU approve a cloud step.',
    ),
  );
  const key = await askSecret('API key:');
  if (!key) {
    warnLine('Nothing entered, nothing changed.');
    return;
  }
  let result = await loginWithApiKey(key);
  if (!result.ok && result.needsWorkspace) {
    out(t.text(result.detail));
    const workspace = await askSecret('Workspace id (wrkspc_...):');
    if (workspace) result = await loginWithApiKey(key, undefined, workspace);
  }
  if (!result.ok) {
    warnLine(result.detail);
    process.exitCode = 1;
    return;
  }
  okLine(
    `${result.detail} (stored in the ${result.backend === 'keychain' ? 'OS keychain' : 'encrypted local store'})`,
  );

  // Make sure an anthropic provider exists so escalation can find it.
  const { config } = loadConfig();
  const hasAnthropic = Object.values(config.providers).some((p) => p.kind === 'anthropic');
  if (!hasAnthropic) {
    saveGlobalConfig({ providers: { anthropic: { kind: 'anthropic' } } });
    okLine('Added the anthropic provider to your config.');
  }
  out();
  out(
    t.muted(
      'Cloud stays one deliberate keystroke away: OS Code always asks before spending, and the local stack remains the default engine. Enable automatic escalation with routing.escalation.enabled if you want it offered when the local model struggles.',
    ),
  );
}
