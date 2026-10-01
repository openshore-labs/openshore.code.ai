// The Pairing screen's two cleanup changes (CX cleanup 5): the status
// line says what a failed bind means, without blaming Tailscale when Tailscale
// is up and without the raw error; and "Replace the shared key" asks once,
// replaces the key through main, and says how it went.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hubStatusLine, portTaken } from '../src/lib/hubStatus.js';
import type { DaemonInfo } from '../src/lib/electronBridge.js';
import { mountDom, type TestDom } from './support/dom.js';

const base: DaemonInfo = { running: true, port: 4816, tailscaleUp: true, mode: 'tailscale' };

describe('the phone connection status line', () => {
  it('says only this computer can reach it when the Tailscale address would not open', () => {
    const line = hubStatusLine({
      ...base,
      mode: 'loopback',
      bindError: 'listen EADDRNOTAVAIL: address not available 100.64.1.2:4816',
    });
    expect(line).toBe(
      'On, but only for this computer. It could not open its Tailscale address, so the phone cannot reach it yet. It keeps trying.',
    );
    // Tailscale is up: the old line blamed it anyway.
    expect(line).not.toMatch(/Tailscale is not up/);
    // The raw error never reaches the screen.
    expect(line).not.toMatch(/EADDRNOTAVAIL/);
  });

  it('says it could not turn on, and names the port another program holds', () => {
    expect(hubStatusLine({ ...base, running: false, bindError: 'boom' })).toBe(
      'Could not turn on. It keeps trying.',
    );
    const taken = 'listen EADDRINUSE: address already in use 127.0.0.1:4816';
    expect(portTaken(taken)).toBe(true);
    expect(hubStatusLine({ ...base, running: false, bindError: taken })).toBe(
      'Could not turn on. It keeps trying. Another program is using port 4816. If OpenShore is also running in a terminal, close it there.',
    );
    expect(hubStatusLine({ ...base, mode: 'loopback', bindError: taken })).toMatch(
      /^On, but only for this computer\. .* Another program is using port 4816\. /,
    );
  });

  it('keeps the older lines when nothing failed', () => {
    expect(hubStatusLine(base)).toBe('On. Your phone can reach this computer over Tailscale.');
    expect(hubStatusLine({ ...base, mode: 'loopback' })).toMatch(
      /^On, but only for this computer\. Tailscale is not up/,
    );
    expect(hubStatusLine({ ...base, running: false })).toBe(
      'Off. Turn it on and the phone app can connect.',
    );
    expect(hubStatusLine(undefined)).toMatch(/^Tailscale is not up on this computer\./);
  });

  // CX 2026-10-01: the Linux command only on Linux.
  it('shows sudo tailscale up on Linux only', () => {
    const off = { ...base, running: false, tailscaleUp: false };
    expect(hubStatusLine(off)).toBe(
      'Tailscale is not up on this computer. Open the Tailscale app and sign in, then turn this on.',
    );
    expect(hubStatusLine(off, { linux: true })).toMatch(/or run sudo tailscale up/);
    expect(hubStatusLine({ ...base, mode: 'loopback' })).not.toMatch(/sudo/);
  });

  it('the screen reads the line from hubStatusLine and never toasts the raw start error', () => {
    const screen = readFileSync(join(process.cwd(), 'src', 'screens', 'PairScreen.tsx'), 'utf8');
    expect(screen).toContain('{hubStatusLine(info, { linux: onLinux() })}');
    expect(screen).not.toMatch(/showToast\(result\.error\)/);
    // The replace link sits outside the paired-devices card, so it shows with
    // no device paired too.
    const devices = screen.indexOf('info?.devices && info.devices.length > 0');
    const link = screen.indexOf('<ReplaceSharedKey');
    expect(link).toBeGreaterThan(screen.indexOf('</div>\n        ) : null}', devices));
  });
});

describe('Replace the shared key', () => {
  let dom: TestDom;
  let toasts: string[];
  beforeEach(async () => {
    dom = await mountDom();
    toasts = [];
  });
  afterEach(async () => {
    await dom.unmount();
  });

  async function show(rotate: () => Promise<{ rotated: true } | { error: string }>) {
    const { ReplaceSharedKey, REPLACE_KEY_COPY } =
      await import('../src/components/ReplaceSharedKey.js');
    await dom.render(<ReplaceSharedKey rotate={rotate} onToast={(t) => toasts.push(t)} />);
    return REPLACE_KEY_COPY;
  }

  it('asks once, with the exact words, and replaces nothing on Cancel', async () => {
    const rotate = vi.fn(async () => ({ rotated: true as const }));
    const c = await show(rotate);
    expect(dom.buttons()).toEqual([c.link]);
    await dom.click(c.link);
    expect(dom.text()).toContain('Replace the shared key?');
    expect(dom.text()).toContain(
      'Older setups connected with one shared key instead of pairing. Replacing it cuts off anything still using the old one. The devices listed here keep working, and OpenShore in a terminal on this computer picks up the new key by itself.',
    );
    const buttons = dom.buttons();
    expect(buttons.indexOf('Cancel')).toBeLessThan(buttons.indexOf('Replace key'));
    expect(dom.container.querySelector('.btn.danger')?.textContent).toBe('Replace key');
    await dom.click('Cancel');
    await dom.settle();
    expect(rotate).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });

  it('replaces the key and says anything on the old one must pair again', async () => {
    const rotate = vi.fn(async () => ({ rotated: true as const }));
    const c = await show(rotate);
    await dom.click(c.link);
    await dom.click('Replace key');
    await dom.settle();
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual([
      'Shared key replaced. Anything that used the old one must pair again.',
    ]);
  });

  it('says nothing changed when main could not replace it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = await show(async () => ({ error: 'Could not replace the shared token: EACCES' }));
    await dom.click(c.link);
    await dom.click('Replace key');
    await dom.settle();
    expect(toasts).toEqual(['The key was not replaced, so nothing changed.']);
    // The raw reason is logged, never shown.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
