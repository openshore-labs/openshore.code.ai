// The iPhone app ships a privacy manifest (App Store requirement since 2024):
// it is in the project's resources, it says the app does not track, and it
// declares each required-reason API the plugins use. Missing it risks an
// ITMS-91053 email or a rejection.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ios = join(process.cwd(), 'ios', 'App');
const manifest = readFileSync(join(ios, 'App', 'PrivacyInfo.xcprivacy'), 'utf8');
const project = readFileSync(join(ios, 'App.xcodeproj', 'project.pbxproj'), 'utf8');

describe('the iPhone privacy manifest', () => {
  it('is a resource of the app target', () => {
    expect(project).toMatch(/PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile/);
    expect(project).toMatch(/path = PrivacyInfo\.xcprivacy; sourceTree = "<group>"/);
  });

  it('says the app does not track, with no tracking domains', () => {
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    expect(manifest).not.toMatch(/Tracking<\/key>\s*<true\/>/);
  });

  it('declares every required-reason API the iOS plugins use', () => {
    for (const category of ['UserDefaults', 'FileTimestamp', 'DiskSpace']) {
      expect(manifest).toContain(`NSPrivacyAccessedAPICategory${category}`);
    }
    const sources = [
      ['plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin/Notices.swift', 'UserDefaults'],
      [
        'plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/OscodeIcloudPlugin.swift',
        'ModificationDate',
      ],
      [
        'plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin/OscodeLlamaPlugin.swift',
        'volumeAvailableCapacity',
      ],
    ] as const;
    for (const [file, api] of sources) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain(api);
    }
  });

  it('marks the notification token linked, since our server keeps it with the account id', () => {
    const entry = manifest.slice(manifest.indexOf('NSPrivacyCollectedDataTypeDeviceID'));
    expect(entry).toMatch(
      /^NSPrivacyCollectedDataTypeDeviceID<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/,
    );
    const search = manifest.slice(manifest.indexOf('NSPrivacyCollectedDataTypeSearchHistory'));
    expect(search).toMatch(
      /^NSPrivacyCollectedDataTypeSearchHistory<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<false\/>/,
    );
  });

  it('names no collected data a purchase would add while the pay gates are off', () => {
    expect(manifest).not.toContain('PurchaseHistory');
  });
});
