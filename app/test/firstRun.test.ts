// The desktop first run (v1 Phase 1): no terminal between a download and a
// working chat. Ollama is started when it is installed but stopped, fetched
// and opened when it is not (the official installer, falling back to the
// download page), and the First Seat carries on by itself once Ollama
// answers. The sample page gives a first-time person something safe to try.
import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bringUpOllama, type HarborDownload, type OllamaBridge } from '../src/state/store.js';
import { DITTO, XATTR, downloadOllamaInstaller, ollamaInstallers } from '../electron/ollama.js';
import {
  createSampleProject,
  SAMPLE_FILES,
  SAMPLE_FOLDER_NAME,
} from '../electron/sampleProject.js';
import { SAMPLE_PROMPT } from '../src/lib/sampleProject.js';

function fakeBridge(
  statuses: Array<{ installed: boolean; running: boolean }>,
  opts: { start?: boolean; opened?: boolean } = {},
) {
  const calls: string[] = [];
  let i = 0;
  const b: OllamaBridge = {
    ollamaStatus: async () => {
      calls.push('status');
      return statuses[Math.min(i++, statuses.length - 1)]!;
    },
    ollamaStart: async () => {
      calls.push('start');
      return opts.start ?? false;
    },
    ollamaInstall: async () => {
      calls.push('install');
      return {
        started: true,
        command: 'open x',
        mode: 'download' as const,
        installerOpened: opts.opened ?? true,
      };
    },
  };
  return { b, calls };
}

describe('bringing Ollama up from the First Seat', () => {
  it('goes straight on when Ollama already answers', async () => {
    const { b, calls } = fakeBridge([{ installed: true, running: true }]);
    expect(await bringUpOllama(b, () => {})).toBe(true);
    expect(calls).toEqual(['status']);
  });

  it('starts an installed Ollama, and says so plainly when it will not start', async () => {
    const started = fakeBridge([{ installed: true, running: false }], { start: true });
    expect(await bringUpOllama(started.b, () => {})).toBe(true);
    expect(started.calls).toEqual(['status', 'start']);
    const reports: HarborDownload[] = [];
    const stuck = fakeBridge([{ installed: true, running: false }], { start: false });
    expect(await bringUpOllama(stuck.b, (d) => reports.push(d))).toBe(false);
    expect(reports.at(-1)).toMatchObject({
      failed: true,
      label: expect.stringMatching(/Open the Ollama app/),
    });
  });

  it('opens the installer, waits, and carries on by itself once Ollama answers', async () => {
    const reports: HarborDownload[] = [];
    const { b, calls } = fakeBridge(
      [
        { installed: false, running: false },
        { installed: false, running: false },
        { installed: true, running: true },
      ],
      { opened: true },
    );
    expect(
      await bringUpOllama(b, (d) => reports.push(d), { pollMs: 1, platform: 'MacIntel' }),
    ).toBe(true);
    expect(calls).toContain('install');
    const waiting = reports.find((r) => r.note);
    expect(waiting?.note).toMatch(/installer is open/);
    expect(waiting?.label).toBe('Waiting for Ollama');
  });

  it('names the download page when the installer could not be fetched, and gives up plainly', async () => {
    const reports: HarborDownload[] = [];
    const { b } = fakeBridge([{ installed: false, running: false }], { opened: false });
    expect(
      await bringUpOllama(b, (d) => reports.push(d), { pollMs: 1, waitMs: 20, platform: 'Win32' }),
    ).toBe(false);
    expect(reports.find((r) => r.note)?.note).toMatch(/download page is open/);
    expect(reports.at(-1)).toMatchObject({ failed: true });
  });

  it('on Linux names the one command and waits, never running an installer itself', async () => {
    const reports: HarborDownload[] = [];
    const { b, calls } = fakeBridge([
      { installed: false, running: false },
      { installed: true, running: true },
    ]);
    expect(
      await bringUpOllama(b, (d) => reports.push(d), { pollMs: 1, platform: 'Linux x86_64' }),
    ).toBe(true);
    expect(calls).not.toContain('install');
    expect(reports.find((r) => r.note)?.note).toContain(
      'curl -fsSL https://ollama.com/install.sh | sh',
    );
  });

  it('an older shell without the Ollama bridge fails plainly', async () => {
    const reports: HarborDownload[] = [];
    expect(await bringUpOllama({} as OllamaBridge, (d) => reports.push(d))).toBe(false);
    expect(reports[0]).toMatchObject({ failed: true });
  });
});

describe("fetching Ollama's own installer", () => {
  const body = (text: string) => new Response(new Blob([text]).stream(), { status: 200 });

  it('knows the official installers, in order', () => {
    expect(ollamaInstallers('darwin').map((i) => i.url)).toEqual([
      'https://ollama.com/download/Ollama.dmg',
      'https://ollama.com/download/Ollama-darwin.zip',
    ]);
    expect(ollamaInstallers('win32')[0]!.url).toBe('https://ollama.com/download/OllamaSetup.exe');
    expect(ollamaInstallers('linux')).toEqual([]);
  });

  // The D2 shell package: the installer used to land in ~/Downloads under a
  // fixed name, overwriting whatever was there, and the app then opened that
  // path. Each try now gets a fresh folder of its own under the temp root.
  it('saves the Windows installer in a fresh folder of its own and returns its path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osc-dl-'));
    const path = await downloadOllamaInstaller({
      platform: 'win32',
      tempRoot: root,
      fetch: async () => body('MZ installer'),
      run: async () => {},
    });
    const [folder] = readdirSync(root);
    expect(folder).toMatch(/^openshore-ollama-/);
    expect(path).toBe(join(root, folder!, 'OllamaSetup.exe'));
    expect(readFileSync(path!, 'utf8')).toBe('MZ installer');
    if (process.platform !== 'win32') {
      expect(statSync(join(root, folder!)).mode & 0o777).toBe(0o700);
    }
    const again = await downloadOllamaInstaller({
      platform: 'win32',
      tempRoot: root,
      fetch: async () => body('MZ second'),
      run: async () => {},
    });
    expect(again).not.toBe(path);
    expect(readFileSync(path!, 'utf8')).toBe('MZ installer');
  });

  it('on macOS marks the download for Gatekeeper with the system tools, and falls back to the zip', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osc-dl-'));
    const ran: string[][] = [];
    const path = await downloadOllamaInstaller({
      platform: 'darwin',
      tempRoot: root,
      fetch: async (url) =>
        url.endsWith('.dmg') ? new Response(null, { status: 404 }) : body('zip'),
      run: async (cmd, args) => {
        ran.push([cmd, ...args]);
        if (cmd === DITTO) mkdirSync(join(args[3]!, 'Ollama.app'), { recursive: true });
      },
    });
    const [folder] = readdirSync(root);
    expect(path).toBe(join(root, folder!, 'Ollama.app'));
    expect(XATTR).toBe('/usr/bin/xattr');
    expect(DITTO).toBe('/usr/bin/ditto');
    expect(ran.map((r) => r[0])).toEqual([XATTR, DITTO, XATTR]);
    expect(ran.filter((r) => r.includes('com.apple.quarantine'))).toHaveLength(2);
    expect(ran[1]).toEqual([
      DITTO,
      '-x',
      '-k',
      join(root, folder!, 'Ollama-darwin.zip'),
      join(root, folder!),
    ]);
  });

  it('returns nothing when every download fails, so the page opens instead', async () => {
    const root = mkdtempSync(join(tmpdir(), 'osc-dl-'));
    expect(
      await downloadOllamaInstaller({
        platform: 'win32',
        tempRoot: root,
        fetch: async () => {
          throw new Error('offline');
        },
      }),
    ).toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
    expect(await downloadOllamaInstaller({ platform: 'linux', tempRoot: root })).toBeUndefined();
  });

  it('the host never fetches into Downloads', () => {
    const host = readFileSync(join(process.cwd(), 'electron', 'engineHost.ts'), 'utf8');
    expect(host).toMatch(/downloadOllamaInstaller\(\{ platform: this\.deps\.platform \}\)/);
    expect(host).not.toMatch(/'Downloads'/);
  });

  it('main opens the fetched installer, and the page only when that fails', () => {
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const block = main.slice(
      main.indexOf("guarded('osc:ollamaInstall'"),
      main.indexOf("guarded('osc:hardware'"),
    );
    expect(block).toContain('shell.openPath(plan.installerPath)');
    expect(block).toMatch(/if \(!opened && plan\.downloadUrl\) void shell\.openExternal/);
  });
});

describe('the sample page', () => {
  it('writes a small page whose button does nothing, and never overwrites a second time', () => {
    const root = mkdtempSync(join(tmpdir(), 'osc-sample-'));
    const first = createSampleProject(root);
    expect(first).toEqual({ path: join(root, SAMPLE_FOLDER_NAME), created: true });
    for (const rel of Object.keys(SAMPLE_FILES))
      expect(existsSync(join(first.path, rel))).toBe(true);
    // The bug a beginner meets: the script looks for an id the page lacks.
    expect(SAMPLE_FILES['script.js']).toContain("'join-button'");
    expect(SAMPLE_FILES['index.html']).toContain('id="join"');
    writeFileSync(join(first.path, 'script.js'), 'fixed by the agent\n');
    const again = createSampleProject(root);
    expect(again.created).toBe(false);
    expect(readFileSync(join(first.path, 'script.js'), 'utf8')).toBe('fixed by the agent\n');
  });

  it('opens a chat that asks for the fix, from a row that presses like every tappable', () => {
    expect(SAMPLE_PROMPT).toMatch(/Join the list button/);
    const chat = readFileSync(join(process.cwd(), 'src', 'screens', 'ChatScreen.tsx'), 'utf8');
    const row = chat.slice(
      chat.indexOf('The first try (v1 Phase 1)'),
      chat.indexOf('SAMPLE_ROW_LABEL}') + 20,
    );
    expect(row).toContain('press-fb');
    expect(row).toContain('trySampleProject');
    const preload = readFileSync(join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
    expect(preload).toContain("createSample: invoke('osc:createSample')");
  });
});
