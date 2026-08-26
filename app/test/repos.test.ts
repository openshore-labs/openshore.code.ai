// The repo registry's pure decisions: when a scheduled backup is due, how a
// clone URL maps to a platform connector, and the shared location vocabulary.
// These gate the backup scheduler and the reconnect wiring, so they are pinned
// away from the network.
import { describe, expect, it } from 'vitest';
import { backupDue, backupIntervalMs, connectorForUrl, type RepoRecord } from '../src/lib/repos.js';
import { describeLocation, locationParent } from '../src/lib/gitos/location.js';

function repo(over: Partial<RepoRecord>): RepoRecord {
  return {
    id: 'r1',
    name: 'repo',
    cwd: '/home/u/OSCode/repo',
    location: { kind: 'device' },
    defaultBranch: 'main',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const NOW = Date.parse('2026-08-26T12:00:00.000Z');

describe('backupIntervalMs', () => {
  it('maps intervals, manual is undefined', () => {
    expect(backupIntervalMs('daily')).toBe(86_400_000);
    expect(backupIntervalMs('weekly')).toBe(7 * 86_400_000);
    expect(backupIntervalMs('manual')).toBeUndefined();
  });
});

describe('backupDue', () => {
  it('is never due without an enabled schedule', () => {
    expect(backupDue(repo({}), NOW)).toBe(false);
    expect(
      backupDue(repo({ backup: { enabled: false, interval: 'daily', destParent: '/b' } }), NOW),
    ).toBe(false);
    expect(
      backupDue(repo({ backup: { enabled: true, interval: 'manual', destParent: '/b' } }), NOW),
    ).toBe(false);
  });

  it('is due immediately when never run', () => {
    expect(
      backupDue(repo({ backup: { enabled: true, interval: 'daily', destParent: '/b' } }), NOW),
    ).toBe(true);
  });

  it('respects the interval since the last run', () => {
    const recent = new Date(NOW - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    const old = new Date(NOW - 30 * 60 * 60 * 1000).toISOString(); // 30h ago
    expect(
      backupDue(
        repo({
          backup: { enabled: true, interval: 'daily', destParent: '/b', lastBackupAt: recent },
        }),
        NOW,
      ),
    ).toBe(false);
    expect(
      backupDue(
        repo({ backup: { enabled: true, interval: 'daily', destParent: '/b', lastBackupAt: old } }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe('connectorForUrl', () => {
  it('maps known hosts', () => {
    expect(connectorForUrl('https://github.com/o/r')).toBe('github');
    expect(connectorForUrl('git@gitlab.com:o/r.git')).toBe('gitlab');
    expect(connectorForUrl('https://bitbucket.org/o/r')).toBe('bitbucket');
    expect(connectorForUrl('https://example.com/o/r')).toBeUndefined();
  });
});

describe('storage location', () => {
  it('describes and resolves the parent', () => {
    expect(describeLocation({ kind: 'device' })).toBe('This device');
    expect(locationParent({ kind: 'device' })).toBeUndefined();
    expect(describeLocation({ kind: 'folder', path: '/mnt/nas' })).toBe('/mnt/nas');
    expect(locationParent({ kind: 'folder', path: '/mnt/nas' })).toBe('/mnt/nas');
  });
});
