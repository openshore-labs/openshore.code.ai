// osc trust: trust this folder's own os-code.config.json on this machine, so
// its settings (a check command, allow rules, its model choices) apply from the
// next session. Until then a repo's file can only make OpenShore stricter.
// Trust is kept in ~/.os-code/trust.json, never in the repo, and a change to
// what it vouched for (a pull that edits the check command) asks again.
import { forgetProjectFolder, loadConfig, trustProjectFolder } from '../config/load.js';
import { confirm, failLine, header, okLine, out, skipLine, warnLine } from './util.js';

export async function trustCommand(options: {
  forget?: boolean;
  status?: boolean;
  yes?: boolean;
}): Promise<void> {
  const cwd = process.cwd();
  if (options.forget) {
    forgetProjectFolder(cwd);
    okLine(
      'This folder is no longer trusted on this computer. Its own settings can only make OpenShore stricter now.',
    );
    return;
  }
  let loaded;
  try {
    loaded = loadConfig(cwd);
  } catch (err) {
    failLine((err as Error).message);
    process.exitCode = 1;
    return;
  }
  const { projectTrust } = loaded;
  header('Project trust');
  if (projectTrust.state === 'trusted') {
    okLine('This folder is trusted on this computer. Its own settings apply.');
    return;
  }
  if (projectTrust.state === 'none' && !projectTrust.waiting.length) {
    skipLine('Nothing to trust here: this folder asks for no settings beyond yours.');
    return;
  }
  if (projectTrust.state === 'changed') {
    warnLine('You trusted this folder before, but its settings changed since.');
  }
  out("This folder's os-code.config.json:");
  for (const line of projectTrust.waiting) out(`  - ${line}`);
  if (options.status) return;
  const yes = options.yes || (await confirm('Trust this folder and use these settings?', false));
  if (!yes) {
    skipLine('Left as is. Its settings stay off.');
    return;
  }
  trustProjectFolder(cwd);
  okLine('Trusted on this computer. These settings apply from your next session here.');
}
