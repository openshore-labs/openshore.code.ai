// Where are we running? One question, answered once. The same web build
// serves Electron (desktop), Capacitor (iOS), and a plain browser (dev).
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export type Platform = 'electron' | 'ios' | 'web';

export function platform(): Platform {
  if (typeof window !== 'undefined' && (window as any).oscode?.platform === 'electron') {
    return 'electron';
  }
  if (Capacitor.isNativePlatform()) return 'ios';
  return 'web';
}

export const isDesktop = () => platform() === 'electron';
export const isPhone = () => platform() === 'ios';

// ---------------------------------------------------------------------------
// Small async key-value storage that uses the right home per platform:
// Capacitor Preferences on iOS (survives app updates), localStorage elsewhere.
// ---------------------------------------------------------------------------

export async function storeGet(key: string): Promise<string | null> {
  if (platform() === 'ios') {
    const { value } = await Preferences.get({ key });
    return value;
  }
  return localStorage.getItem(key);
}

export async function storeSet(key: string, value: string): Promise<void> {
  if (platform() === 'ios') {
    await Preferences.set({ key, value });
    return;
  }
  localStorage.setItem(key, value);
}

export async function storeDelete(key: string): Promise<void> {
  if (platform() === 'ios') {
    await Preferences.remove({ key });
    return;
  }
  localStorage.removeItem(key);
}

export async function storeGetJson<T>(key: string): Promise<T | undefined> {
  const raw = await storeGet(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function storeSetJson(key: string, value: unknown): Promise<void> {
  await storeSet(key, JSON.stringify(value));
}
