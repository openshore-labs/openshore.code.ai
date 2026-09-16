// The health layer, with a per-link error taxonomy. When the phone cannot
// reach a run, the failure is never "connection failed": it is one of these
// links, named, with the one action that fixes it.
import { spawnSync } from 'node:child_process';
import type { OscConfig } from '../config/schema.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { detectTailscale } from './tailscale.js';
import { loadOrCreateToken } from '../core/security/daemonAuth.js';
import { join } from 'node:path';
import { oscHome } from '../config/load.js';

export type LinkId = 'power' | 'ollama' | 'model' | 'tailnet' | 'ssh' | 'daemon';

export type LinkState = 'ok' | 'warn' | 'fail' | 'skip';

export interface LinkReport {
  id: LinkId;
  label: string;
  state: LinkState;
  detail: string;
  /** The one action that fixes it, runnable where possible. */
  fix?: string;
}

/** The one-line fixes doctor prints, per platform. Pure, so a Windows machine
 *  is pinned to PowerShell and powercfg by a test on any box: it must never be
 *  told apt, systemctl, or gsettings. */
export function platformFixes(platform: NodeJS.Platform = process.platform): {
  sshEnable: string;
  sleepOff: string;
  tailscaleInstall: string;
} {
  if (platform === 'win32') {
    return {
      sshEnable:
        'Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd',
      sleepOff: 'powercfg /change standby-timeout-ac 0',
      tailscaleInstall: 'Install Tailscale from https://tailscale.com/download/windows',
    };
  }
  if (platform === 'darwin') {
    return {
      sshEnable: 'sudo systemsetup -setremotelogin on',
      sleepOff: 'caffeinate -s osc serve',
      tailscaleInstall: 'Install Tailscale from the Mac App Store.',
    };
  }
  return {
    sshEnable: 'sudo apt install openssh-server && sudo systemctl enable --now ssh',
    sleepOff:
      "gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'",
    tailscaleInstall: 'curl -fsSL https://tailscale.com/install.sh | sh',
  };
}

export async function checkLinks(
  config: OscConfig,
  providers: ProviderRegistry,
): Promise<LinkReport[]> {
  const reports: LinkReport[] = [];

  // Desktop power: sleep silently kills a phone user's in-flight run.
  reports.push(checkSleep());

  // Local inference server.
  const orchestratorRef = config.stack.orchestrator;
  const localProviderId = orchestratorRef?.provider ?? 'ollama';
  if (providers.has(localProviderId) && providers.get(localProviderId).kind === 'local') {
    const health = await providers.get(localProviderId).health();
    reports.push({
      id: 'ollama',
      label: 'Local model server',
      state: health.ok ? 'ok' : 'fail',
      detail: health.detail,
      fix: health.ok ? undefined : 'ollama serve',
    });

    // The orchestrator model itself.
    if (orchestratorRef && health.ok) {
      try {
        const models = await providers.get(localProviderId).listModels();
        const present = models.some(
          (m) => m === orchestratorRef.model || m.startsWith(`${orchestratorRef.model}:`),
        );
        reports.push({
          id: 'model',
          label: `Orchestrator (${orchestratorRef.model})`,
          state: present ? 'ok' : 'fail',
          detail: present
            ? 'Pulled and ready.'
            : `${orchestratorRef.model} is not on this machine.`,
          fix: present ? undefined : `ollama pull ${orchestratorRef.model}`,
        });
      } catch {
        reports.push({
          id: 'model',
          label: 'Orchestrator model',
          state: 'warn',
          detail: 'Could not list local models to confirm the orchestrator is pulled.',
        });
      }
    }
  } else if (orchestratorRef) {
    reports.push({
      id: 'ollama',
      label: 'Orchestrator provider',
      state: 'ok',
      detail: `Orchestrator runs on ${localProviderId} (cloud).`,
    });
  }

  // Tailnet.
  const ts = detectTailscale();
  reports.push({
    id: 'tailnet',
    label: 'Tailscale',
    state: ts.running ? 'ok' : ts.installed ? 'fail' : 'warn',
    detail: ts.running
      ? `Up as ${ts.dnsName ?? ts.ip ?? 'this machine'}.`
      : (ts.hint ?? 'Not running.'),
    fix: ts.running
      ? undefined
      : ts.installed
        ? process.platform === 'win32'
          ? 'Open the Tailscale app and sign in.'
          : 'sudo tailscale up'
        : platformFixes().tailscaleInstall,
  });

  // SSH server, the phone's way in.
  reports.push(checkSsh());

  // Daemon reachability on the configured bind.
  const host = config.daemon.bind === 'tailscale' ? (ts.ip ?? '127.0.0.1') : '127.0.0.1';
  try {
    const token = loadOrCreateToken(join(oscHome(), 'daemon.token'));
    const res = await fetch(`http://${host}:${config.daemon.port}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
    });
    reports.push({
      id: 'daemon',
      label: 'OS Code daemon',
      state: res.ok ? 'ok' : 'warn',
      detail: res.ok
        ? `Serving on ${host}:${config.daemon.port}.`
        : `Something answered on ${host}:${config.daemon.port} but not correctly.`,
    });
  } catch {
    reports.push({
      id: 'daemon',
      label: 'OS Code daemon',
      state: 'skip',
      detail: 'Not running. Sessions survive dropped connections only while it runs.',
      fix: 'osc serve',
    });
  }

  return reports;
}

function checkSsh(): LinkReport {
  if (process.platform === 'darwin') return checkSshMac();
  if (process.platform === 'win32') return checkSshWindows();
  for (const unit of ['sshd', 'ssh']) {
    const res = spawnSync('systemctl', ['is-active', unit], { encoding: 'utf8', timeout: 3000 });
    if (res.stdout?.trim() === 'active') {
      return { id: 'ssh', label: 'SSH server', state: 'ok', detail: `${unit} is running.` };
    }
  }
  return {
    id: 'ssh',
    label: 'SSH server',
    state: 'warn',
    detail: 'No sshd detected, so a phone cannot connect.',
    fix: platformFixes('linux').sshEnable,
  };
}

// Windows ships OpenSSH Server as an optional capability and runs it as the
// sshd service; PowerShell (not systemctl) is how it is asked and enabled.
function checkSshWindows(): LinkReport {
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', '(Get-Service sshd -ErrorAction SilentlyContinue).Status'],
    { encoding: 'utf8', timeout: 5000 },
  );
  if (res.status === 0 && /running/i.test(res.stdout)) {
    return { id: 'ssh', label: 'SSH server', state: 'ok', detail: 'OpenSSH Server is running.' };
  }
  return {
    id: 'ssh',
    label: 'SSH server',
    state: 'warn',
    detail:
      'OpenSSH Server is not running, so a phone cannot connect. Run this in an admin PowerShell:',
    fix: platformFixes('win32').sshEnable,
  };
}

// macOS runs sshd through launchd ("Remote Login"), not systemd, and enables it
// with systemsetup rather than apt, so a Mac user needs Mac hints.
function checkSshMac(): LinkReport {
  const res = spawnSync('systemsetup', ['-getremotelogin'], { encoding: 'utf8', timeout: 3000 });
  if (res.status === 0 && /\bon\b/i.test(res.stdout)) {
    return { id: 'ssh', label: 'SSH server', state: 'ok', detail: 'Remote Login is on.' };
  }
  return {
    id: 'ssh',
    label: 'SSH server',
    state: 'warn',
    detail: 'Remote Login is off, so a phone cannot connect.',
    fix: 'sudo systemsetup -setremotelogin on',
  };
}

function checkSleep(): LinkReport {
  if (process.platform === 'darwin') return checkSleepMac();
  if (process.platform === 'win32') return checkSleepWindows();
  // GNOME: suspend on AC power kills in-flight runs for remote users.
  const res = spawnSync(
    'gsettings',
    ['get', 'org.gnome.settings-daemon.plugins.power', 'sleep-inactive-ac-type'],
    {
      encoding: 'utf8',
      timeout: 3000,
    },
  );
  if (res.status === 0) {
    const value = res.stdout.trim().replace(/'/g, '');
    if (value !== 'nothing') {
      return {
        id: 'power',
        label: 'Desktop sleep',
        state: 'warn',
        detail: `This desktop suspends when idle (${value}), which kills runs mid-flight for phone users.`,
        fix: platformFixes('linux').sleepOff,
      };
    }
    return { id: 'power', label: 'Desktop sleep', state: 'ok', detail: 'Stays awake on AC power.' };
  }
  return {
    id: 'power',
    label: 'Desktop sleep',
    state: 'skip',
    detail: 'Could not read power settings; if this desktop sleeps, remote runs will die with it.',
    fix: 'systemd-inhibit --what=sleep osc serve',
  };
}

// Windows: powercfg reports the plugged-in sleep timeout in seconds (hex) for
// the active scheme; 0 means never. The fix is powercfg too, never gsettings.
function checkSleepWindows(): LinkReport {
  const res = spawnSync('powercfg', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (res.status === 0) {
    const match = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(res.stdout);
    const seconds = match ? parseInt(match[1]!, 16) : undefined;
    if (seconds !== undefined && seconds > 0) {
      return {
        id: 'power',
        label: 'Desktop sleep',
        state: 'warn',
        detail: `This PC sleeps after ${Math.round(seconds / 60)} min plugged in, which kills runs mid-flight for phone users.`,
        fix: platformFixes('win32').sleepOff,
      };
    }
    if (seconds === 0) {
      return {
        id: 'power',
        label: 'Desktop sleep',
        state: 'ok',
        detail: 'Stays awake plugged in.',
      };
    }
  }
  return {
    id: 'power',
    label: 'Desktop sleep',
    state: 'skip',
    detail: 'Could not read power settings; if this PC sleeps, remote runs will die with it.',
    fix: platformFixes('win32').sleepOff,
  };
}

// macOS: pmset reports idle sleep in minutes, and caffeinate (not systemd) is
// the tool that holds a Mac awake for the lifetime of a wrapped command.
function checkSleepMac(): LinkReport {
  const res = spawnSync('pmset', ['-g'], { encoding: 'utf8', timeout: 3000 });
  if (res.status === 0) {
    const match = /^\s*sleep\s+(\d+)/m.exec(res.stdout);
    const minutes = match ? Number(match[1]) : undefined;
    if (minutes !== undefined && minutes > 0) {
      return {
        id: 'power',
        label: 'Desktop sleep',
        state: 'warn',
        detail: `This Mac sleeps after ${minutes} min idle, which kills runs mid-flight for phone users.`,
        fix: 'caffeinate -s osc serve',
      };
    }
    return {
      id: 'power',
      label: 'Desktop sleep',
      state: 'ok',
      detail: 'Stays awake while serving.',
    };
  }
  return {
    id: 'power',
    label: 'Desktop sleep',
    state: 'skip',
    detail: 'Could not read power settings; if this Mac sleeps, remote runs will die with it.',
    fix: 'caffeinate -s osc serve',
  };
}
