// osc doctor's fixes are platform-true (A5): a Windows machine is told the
// PowerShell command that enables OpenSSH Server and holds the machine awake,
// never apt or systemctl. The fix table is pure so every platform is pinned
// here without a real service manager.
import { describe, expect, it } from 'vitest';
import { platformFixes } from '../src/connect/health.js';

describe('platformFixes', () => {
  it('Linux keeps the apt and gsettings fixes', () => {
    const f = platformFixes('linux');
    expect(f.sshEnable).toContain('apt install openssh-server');
    expect(f.sleepOff).toContain('gsettings set');
    expect(f.tailscaleInstall).toContain('tailscale.com/install.sh');
  });

  it('macOS names Remote Login and caffeinate', () => {
    const f = platformFixes('darwin');
    expect(f.sshEnable).toContain('systemsetup -setremotelogin on');
    expect(f.sleepOff).toContain('caffeinate');
    expect(f.tailscaleInstall).toContain('Mac App Store');
  });

  it('Windows gets PowerShell and powercfg, never apt or systemctl', () => {
    const f = platformFixes('win32');
    expect(f.sshEnable).toContain('Add-WindowsCapability');
    expect(f.sshEnable).toContain('OpenSSH.Server');
    expect(f.sleepOff).toContain('powercfg /change standby-timeout-ac 0');
    expect(f.tailscaleInstall).toContain('https://tailscale.com/download/windows');
    for (const line of [f.sshEnable, f.sleepOff, f.tailscaleInstall]) {
      expect(line).not.toMatch(/apt|systemctl|gsettings/);
    }
  });
});
