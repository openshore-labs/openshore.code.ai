#!/usr/bin/env node
// The osc CLI. Bare `osc` opens a session in the current directory; every
// bigger flow is a subcommand with its own premium onboarding.
import { Command } from 'commander';
import { setColorEnabled, t } from '../src/brand/theme.js';
import { runCommand } from '../src/commands/run.js';
import { initCommand } from '../src/commands/init.js';
import { loginCommand } from '../src/commands/login.js';
import { authGithubCommand } from '../src/commands/authGithub.js';
import { pairCommand } from '../src/commands/pair.js';
import { doctorCommand } from '../src/commands/doctor.js';
import { serveCommand } from '../src/commands/serve.js';
import { attachCommand } from '../src/commands/attach.js';
import {
  stackDisableCommand,
  stackEnableCommand,
  stackShowCommand,
  stackUseCommand,
} from '../src/commands/stack.js';
import {
  marketBrowseCommand,
  marketDetailsCommand,
  marketInstallCommand,
  marketPresetsCommand,
} from '../src/commands/market.js';
import {
  licenseActivateCommand,
  licenseDeactivateCommand,
  licenseShowCommand,
} from '../src/commands/license.js';
import { evalCommand } from '../src/commands/eval.js';
import { attachImageCommand } from '../src/commands/attachImage.js';
import {
  tokenListCommand,
  tokenMintCommand,
  tokenRevokeCommand,
} from '../src/commands/token.js';
import { logger } from '../src/util/log.js';

const log = logger('cli');
const program = new Command();

program
  .name('osc')
  .description(
    'OS Code: a terminal coding agent for your own stack of local LLMs. Your machine, your models, your keys.',
  )
  .version('0.1.0')
  .option('--plain', 'plain renderer: no cursor tricks, works on any terminal')
  .option('--no-color', 'disable color output');

program
  .command('run', { isDefault: true })
  .description('open a session in this directory (the default when you just type osc)')
  .argument('[prompt...]', 'optional first message, e.g. osc run "fix the failing test"')
  .option('--cwd <dir>', 'workspace directory (default: here)')
  .action(async (prompt: string[], options: { cwd?: string }) => {
    await runCommand({
      prompt: prompt.length ? prompt.join(' ') : undefined,
      plain: program.opts().plain,
      cwd: options.cwd,
    });
  });

program
  .command('init')
  .description('set up your stack: detect hardware, pick a preset, pull a starter model')
  .action(initCommand);

program
  .command('login')
  .description('connect your Claude account (API key; stays on this machine)')
  .option('--logout', 'disconnect and delete the stored key')
  .option('--subscription', 'about the experimental subscription sign-in')
  .action(loginCommand);

const auth = program.command('auth').description('accounts');
auth
  .command('github')
  .description('connect GitHub (device flow or a personal access token)')
  .option('--pat', 'skip the device flow, paste a token')
  .option('--logout', 'disconnect GitHub')
  .action(authGithubCommand);

program
  .command('pair')
  .description('put OS Code on your phone (Tailscale + Termius walkthrough)')
  .action(pairCommand);
program
  .command('doctor')
  .description('check every link in the chain, with one-line fixes')
  .action(doctorCommand);

program
  .command('serve')
  .description('run the daemon so sessions survive dropped connections')
  .option('--bind <mode>', 'loopback or tailscale')
  .option('--port <port>', 'port (default 4816)')
  .action(async (options: { bind?: string; port?: string }) => {
    await serveCommand({
      bind:
        options.bind === 'tailscale'
          ? 'tailscale'
          : options.bind === 'loopback'
            ? 'loopback'
            : undefined,
      port: options.port ? Number(options.port) : undefined,
    });
  });

program
  .command('attach')
  .description('reattach to a running or stored session (latest, or by id)')
  .argument('[id]', 'session id (osc attach with none picks the latest)')
  .option('--url <url>', 'daemon URL (default: the local daemon)')
  .option('--token <token>', 'daemon token (default: ~/.os-code/daemon.token)')
  .option('--new', 'start a fresh session on the daemon')
  .action(
    async (id: string | undefined, options: { url?: string; token?: string; new?: boolean }) => {
      await attachCommand({
        id,
        url: options.url,
        token: options.token,
        new: options.new,
        plain: program.opts().plain,
      });
    },
  );

const stack = program.command('stack').description('view and edit the model stack');
stack.command('show', { isDefault: true }).description('show the stack').action(stackShowCommand);
stack
  .command('use')
  .description('set the orchestrator model')
  .argument('<model>')
  .argument('[provider]')
  .action(stackUseCommand);
stack
  .command('enable')
  .description('enable a specialist: coding, vision, embedding, fast')
  .argument('<role>')
  .argument('<model>')
  .argument('[provider]')
  .action(stackEnableCommand);
stack
  .command('disable')
  .description('disable a specialist')
  .argument('<role>')
  .action(stackDisableCommand);

const market = program
  .command('market')
  .description('browse and install models from the curated catalog');
market
  .command('browse', { isDefault: true })
  .description('browse the catalog, rated for this machine')
  .action(marketBrowseCommand);
market
  .command('details')
  .description('benchmark and license detail for one model')
  .argument('<id>')
  .action(marketDetailsCommand);
market
  .command('install')
  .description('pull a model straight from its source')
  .argument('<id>')
  .action(marketInstallCommand);
market
  .command('presets')
  .description('curated starter stacks')
  .option('--apply <id>', 'write a preset into your config')
  .action((options: { apply?: string }) => marketPresetsCommand(options.apply));
program.command('models').description('alias for osc market').action(marketBrowseCommand);

const license = program.command('license').description('license and entitlement');
license
  .command('activate')
  .description('activate a key')
  .argument('<key>')
  .action(licenseActivateCommand);
license
  .command('show', { isDefault: true })
  .description('current state')
  .action(licenseShowCommand);
license
  .command('deactivate')
  .description('remove the license from this machine')
  .action(licenseDeactivateCommand);

program
  .command('eval')
  .description('probe a model: can it hold up as an OS Code orchestrator?')
  .option('--model <model>', 'model to test (default: the orchestrator)')
  .option('--provider <id>', 'provider (default: the orchestrator provider)')
  .action(evalCommand);

program
  .command('attach-image')
  .description('drop an image into the vision inbox (no path lists the inbox)')
  .argument('[path]')
  .action(attachImageCommand);

const tokenCmd = program
  .command('token')
  .description('per-user daemon credentials for a team (mint, list, revoke)');
tokenCmd
  .command('mint')
  .description('mint a credential for a teammate, printed once')
  .option('--role <role>', 'admin or member (default: member)')
  .option('--label <label>', 'a name for the device, e.g. "Alice iPhone"')
  .option('--ttl <days>', 'expire after N days (default: never)')
  .action((options: { role?: string; label?: string; ttl?: string }) => tokenMintCommand(options));
tokenCmd.command('list', { isDefault: true }).description('list minted credentials').action(tokenListCommand);
tokenCmd
  .command('revoke')
  .description('revoke by label or token-hash prefix')
  .argument('<match>')
  .action(tokenRevokeCommand);

program.hook('preAction', () => {
  if (program.opts().color === false) setColorEnabled(false);
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('command failed', { message });
    process.stderr.write(`${t.danger(message)}\n`);
    process.stderr.write(
      `${t.muted('osc doctor usually knows which link broke and how to fix it.')}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
