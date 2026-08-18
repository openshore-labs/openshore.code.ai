// osc auth github: device flow when a client id is configured, PAT always.
import { t } from '../brand/theme.js';
import {
  githubClientId,
  isGithubConnected,
  loginWithPat,
  logoutGithub,
  pollDeviceFlow,
  startDeviceFlow,
} from '../auth/github.js';
import { askSecret, confirm, okLine, out, warnLine } from './util.js';

export interface AuthGithubOptions {
  pat?: boolean;
  logout?: boolean;
}

export async function authGithubCommand(options: AuthGithubOptions): Promise<void> {
  if (options.logout) {
    logoutGithub();
    okLine('GitHub is disconnected.');
    return;
  }
  if (isGithubConnected()) {
    okLine('GitHub is already connected.');
    if (!(await confirm('Replace the stored token?', false))) return;
  }

  const clientId = githubClientId();
  if (clientId && !options.pat) {
    out(t.text('Connecting through the GitHub device flow.'));
    try {
      const device = await startDeviceFlow(clientId);
      out();
      out(t.text(`  1. Open ${t.link(device.verificationUri)} on any device`));
      out(t.text(`  2. Enter the code ${t.bold(device.userCode)}`));
      out(t.muted('  Waiting for the approval...'));
      await pollDeviceFlow(clientId, device);
      okLine('GitHub is connected.');
      return;
    } catch (err) {
      warnLine(`${(err as Error).message} Falling back to a personal access token.`);
    }
  } else if (!options.pat) {
    out(
      t.muted(
        'No OAuth client id set (OSC_GITHUB_CLIENT_ID), so using the token path; it works just as well.',
      ),
    );
  }

  out(
    t.text('Create a token at github.com/settings/tokens (classic, repo scope) and paste it here.'),
  );
  const token = await askSecret('Token:');
  if (!token) {
    warnLine('Nothing entered, nothing changed.');
    return;
  }
  const result = await loginWithPat(token);
  if (result.ok) okLine(result.detail);
  else {
    warnLine(result.detail);
    process.exitCode = 1;
  }
}
