// A static guard over the native plugins' Swift, since no Mac runs in CI
// (Vault M2, CTO G2 and G7 wave 0). It reads the Swift as text and holds the
// two halves of each plugin together:
//
// 1. In every plugin's Swift sources, the plugin file (named after its SPM
//    target folder) opens with an `@objc(` that names its own class, and that
//    class is the CAPPlugin the file declares; a helper file (Keychain,
//    ModelStore, and the like) carries no `@objc(` at all, so no helper can
//    register itself under a plugin's name.
// 2. The `CAPPluginMethod(name:)` set equals the method keys of the plugin's
//    JS contract (the interface handed to registerPlugin), less the listener
//    methods Capacitor bridges itself, and the Swift jsName is the name JS
//    registers. Drift between the halves fails here, not on a phone.
//
// This is the first version, against today's Swift. Wave 1 tightens it with
// CoordinatedTree.swift's own rules (no `import Capacitor`, no
// `.skipsHiddenFiles`, the swap and exclusive renames present).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import ts from 'typescript';

const APP = new URL('..', import.meta.url).pathname;
const PLUGINS = join(APP, 'plugins');

/** Every .swift file under a plugin's ios/Sources. */
function swiftSources(plugin: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.swift')) out.push(abs);
    }
  };
  walk(join(PLUGINS, plugin, 'ios', 'Sources'));
  return out.sort();
}

const plugins = readdirSync(PLUGINS).filter((name) =>
  statSync(join(PLUGINS, name, 'ios', 'Sources'), { throwIfNoEntry: false })?.isDirectory(),
);

// A plugin file is the one named after its SPM target folder
// (Sources/OscodeIcloudPlugin/OscodeIcloudPlugin.swift); the rest are helpers.
const isPluginFile = (file: string) => basename(file, '.swift') === basename(dirname(file));

/** The JS half of each plugin: the file that registers it and its contract. */
const CONTRACTS: Record<string, { file: string; contract: string }> = {
  'oscode-authsession': {
    file: 'src/lib/authSessionPlugin.ts',
    contract: 'OscodeAuthSessionContract',
  },
  'oscode-applock': { file: 'src/lib/appLock.ts', contract: 'OscodeAppLockContract' },
  'oscode-icloud': { file: 'src/lib/gitos/icloudPlugin.ts', contract: 'IcloudPluginContract' },
  'oscode-passkey': { file: 'src/lib/passkeys.ts', contract: 'OscodePasskeyContract' },
  'oscode-llama': { file: 'src/lib/llamaPlugin.ts', contract: 'LlamaPluginContract' },
  'oscode-media': { file: 'src/lib/mediaPlugin.ts', contract: 'MediaPluginContract' },
  'oscode-speech': { file: 'src/lib/speechPlugin.ts', contract: 'OscodeSpeechContract' },
  'oscode-tts': { file: 'src/lib/ttsPlugin.ts', contract: 'OscodeTtsContract' },
};

// Capacitor bridges these for every plugin, so the Swift never lists them.
const BRIDGED = new Set(['addListener', 'removeAllListeners', 'removeListener']);

/** The member names of an exported interface, read with the TS parser. */
function contractKeys(file: string, name: string): string[] {
  const src = ts.createSourceFile(
    file,
    readFileSync(join(APP, file), 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
  let keys: string[] | undefined;
  src.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      keys = node.members
        .map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : undefined))
        .filter((k): k is string => Boolean(k));
    }
  });
  if (!keys) throw new Error(`${name} is not declared in ${file}`);
  return keys;
}

/** The name JS registers the plugin under: registerPlugin<Contract>('Name'. */
function registeredName(file: string, contract: string): string | undefined {
  const text = readFileSync(join(APP, file), 'utf8');
  return new RegExp(`registerPlugin<${contract}>\\(\\s*'([^']+)'`).exec(text)?.[1];
}

describe('native plugins: the Swift and the JS agree', () => {
  it('finds every plugin and a JS contract for each', () => {
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins.sort()).toEqual(Object.keys(CONTRACTS).sort());
  });

  for (const plugin of plugins) {
    const files = swiftSources(plugin);

    it(`${plugin}: one plugin file, and its first @objc( names its own class`, () => {
      const own = files.filter(isPluginFile);
      expect(own).toHaveLength(1);
      const text = readFileSync(own[0]!, 'utf8');
      const cls = basename(own[0]!, '.swift');
      expect(/@objc\(([^)]*)\)/.exec(text)?.[1]).toBe(cls);
      expect(text).toMatch(new RegExp(`public class ${cls}\\s*:\\s*CAPPlugin\\b`));
    });

    it(`${plugin}: helper files carry no @objc(`, () => {
      for (const file of files.filter((f) => !isPluginFile(f))) {
        expect({
          file: basename(file),
          objc: readFileSync(file, 'utf8').includes('@objc('),
        }).toEqual({ file: basename(file), objc: false });
      }
    });

    it(`${plugin}: CAPPluginMethod names equal the JS contract's methods`, () => {
      const js = CONTRACTS[plugin]!;
      const text = readFileSync(files.find(isPluginFile)!, 'utf8');
      const swift = [...text.matchAll(/CAPPluginMethod\(\s*name:\s*"([^"]+)"/g)].map((m) => m[1]!);
      expect(new Set(swift).size).toBe(swift.length);
      const keys = contractKeys(js.file, js.contract).filter((k) => !BRIDGED.has(k));
      expect(swift.sort()).toEqual([...new Set(keys)].sort());
      // The Swift jsName is the name JS registers the plugin under.
      const jsName = /public let jsName = "([^"]+)"/.exec(text)?.[1];
      expect(jsName).toBeTruthy();
      expect(registeredName(js.file, js.contract)).toBe(jsName);
    });
  }
});
