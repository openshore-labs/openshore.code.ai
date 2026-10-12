// Computer (founder, 2026-10-07; once Pairing, named by CX 2026-10-01, and
// before that "Desktop + phone"). Docking is the word for linking a device to
// a machine that does the work. On the desktop: phone access on or off, a QR
// that is a link the iPhone Camera opens, and docking this computer to a
// server. On the phone: every way in (lib/docking.ts), with the computer at
// home and a server you rent docked right here, by a scan or a typed code the
// device trades for its own credential. The daemon owns the run, so a dropped
// connection reattaches with nothing lost. Free, like everything in OpenShore.
// docs/design/pairing-review.md, docs/design/connect-anywhere-proposal.md.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import { hubList, useApp, type HubRole } from '../state/store.js';
import { bridge, type DaemonInfo } from '../lib/electronBridge.js';
import { isDesktop, platform } from '../lib/platform.js';
import { PAIRING_REJECTED, daemonHealth } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';
import { Switch } from '../components/Switch.js';
import { pairingLink } from '../lib/qrDecode.js';
import { hapticApproval } from '../lib/haptics.js';
import { Icon } from '../components/Icon.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { ReplaceSharedKey } from '../components/ReplaceSharedKey.js';
import { hubStatusLine, onLinux } from '../lib/hubStatus.js';
import { DockForm, hostOf } from '../components/DockForm.js';
import { ServerSetup } from '../components/ServerSetup.js';
import { ServerKeysLeftSheet, type KeysLeft } from '../components/ServerKeys.js';
import type { HubKeysCleared } from '../state/serverKeysOps.js';
import {
  DOCK_PATHS,
  dockedNoun,
  machineFactsLine,
  machineKindLabel,
  machineKindOf,
  unreachableLine,
  type DockPath,
  type DockPlace,
} from '../lib/docking.js';
import { projectsOn } from '../lib/runsOn.js';
import { sheetExitMs } from '../lib/motion.js';

export { phoneDeviceName } from '../components/DockForm.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';

// Each platform's page title, said once for its h1 and the bar it tucks into,
// so the bar shows the same words that scrolled away. The nav row keeps the
// room's name, Computer.
const DESKTOP_TITLE = 'Dock your phone';
const PHONE_TITLE = 'Dock to a computer';

// Clean glyphs for the Tailscale download rows, drawn in the tile's ink on a
// solid accent tile (iOS-app-icon feel). One per platform.
const GLYPHS: Record<string, JSX.Element> = {
  apple: (
    <Icon variant="fill">
      <path
        fill="currentColor"
        d="M15.77 12.9c-.02-2.13 1.74-3.15 1.82-3.2-.99-1.45-2.54-1.65-3.09-1.67-1.31-.13-2.56.77-3.23.77-.66 0-1.69-.75-2.78-.73-1.43.02-2.75.83-3.48 2.11-1.48 2.57-.38 6.38 1.06 8.47.7 1.02 1.54 2.17 2.63 2.13 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.04 2.55-2.07.8-1.19 1.13-2.34 1.15-2.4-.03-.01-2.2-.85-2.22-3.36zM13.7 6.3c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.88 2.56.93.07 1.88-.47 2.46-1.16z"
      />
    </Icon>
  ),
  windows: (
    <Icon variant="fill">
      <rect x="3.5" y="4" width="7.4" height="7.4" rx="0.8" />
      <rect x="13.1" y="4" width="7.4" height="7.4" rx="0.8" />
      <rect x="3.5" y="12.6" width="7.4" height="7.4" rx="0.8" />
      <rect x="13.1" y="12.6" width="7.4" height="7.4" rx="0.8" />
    </Icon>
  ),
  // Tux, the same penguin the marketing site's download tile draws
  // (OpenShore.ai-marketing-site, src/index.njk, getGlyph "linux").
  linux: (
    <Icon variant="fill">
      <path
        fill="currentColor"
        d="M11.51,1.03C11.18,1.05 10.78,1.12 10.48,1.22C9.86,1.42 9.27,2.07 9.03,2.84C8.89,3.29 8.87,3.49 8.87,4.44C8.87,5.33 8.89,5.59 9.00,6.72C9.10,7.67 9.09,7.95 8.95,8.36C8.80,8.79 8.65,9.01 7.70,10.16C7.04,10.95 6.91,11.19 6.66,12.10C6.43,12.99 6.30,13.29 5.76,14.28C5.43,14.88 5.32,15.13 5.25,15.41C5.19,15.65 5.18,16.01 5.24,16.12C5.27,16.19 5.27,16.20 5.23,16.26C5.18,16.32 5.00,16.75 4.95,16.92C4.94,16.94 4.88,16.99 4.82,17.02C4.71,17.08 4.65,17.08 4.16,17.09C3.65,17.11 3.61,17.11 3.52,17.17C3.30,17.30 3.14,17.56 3.09,17.88C3.05,18.08 3.06,18.19 3.17,18.95C3.24,19.43 3.25,19.52 3.22,19.67C3.19,19.85 3.04,20.18 2.88,20.44C2.63,20.81 2.64,21.13 2.89,21.33C3.10,21.49 3.56,21.63 4.26,21.75C5.01,21.88 5.44,22.00 6.69,22.41C7.14,22.56 7.62,22.71 7.76,22.74C8.59,22.95 9.11,22.85 9.60,22.38C9.72,22.27 9.85,22.18 9.92,22.15C10.76,21.80 12.03,21.75 14.08,21.97C14.70,22.04 14.64,22.02 14.76,22.21C14.95,22.52 15.30,22.77 15.69,22.88C15.96,22.96 16.37,23.00 16.58,22.97C17.06,22.89 17.28,22.75 18.23,21.92C18.76,21.46 19.11,21.18 19.43,20.97C19.64,20.83 20.52,20.38 20.78,20.28C20.94,20.22 21.20,19.98 21.26,19.84C21.30,19.78 21.33,19.65 21.33,19.56C21.37,19.22 21.20,19.01 20.65,18.73C20.25,18.52 19.93,18.27 19.82,18.08C19.77,17.98 19.74,17.88 19.71,17.67C19.61,16.98 19.46,16.63 19.25,16.59L19.16,16.57L19.21,16.40C19.50,15.38 19.40,13.90 18.98,12.85C18.65,12.04 18.46,11.64 18.21,11.24C18.03,10.96 17.68,10.48 17.50,10.28C17.36,10.12 16.91,9.49 16.55,8.94C16.22,8.44 15.89,7.81 15.81,7.52C15.72,7.20 15.57,6.18 15.54,5.66C15.43,4.14 15.21,3.06 14.90,2.56C14.55,1.99 14.25,1.70 13.70,1.40C13.33,1.21 12.96,1.11 12.32,1.03C12.11,1.00 11.92,1.00 11.51,1.03ZM13.20,4.36C13.58,4.53 13.71,4.82 13.71,5.49C13.71,5.75 13.69,5.94 13.65,6.18C13.57,6.63 13.59,6.60 13.44,6.52C13.37,6.49 13.28,6.46 13.25,6.46C13.22,6.46 13.17,6.44 13.13,6.42L13.07,6.39L13.14,6.36C13.38,6.27 13.49,6.07 13.49,5.74C13.49,5.23 13.22,4.86 12.84,4.86C12.62,4.86 12.39,5.04 12.31,5.27C12.27,5.41 12.25,5.76 12.28,5.92C12.29,6.00 12.30,6.06 12.30,6.07C12.29,6.07 12.25,6.06 12.20,6.03C12.12,6.00 12.10,5.97 12.05,5.85C11.96,5.61 11.92,5.38 11.91,5.13C11.91,4.90 11.91,4.89 12.01,4.69C12.10,4.52 12.13,4.48 12.24,4.42C12.54,4.25 12.92,4.23 13.20,4.36ZM10.31,4.49C10.45,4.56 10.62,4.79 10.69,5.00C10.75,5.20 10.75,5.84 10.69,5.86C10.67,5.87 10.66,5.89 10.66,5.91C10.66,5.93 10.65,5.94 10.64,5.94C10.62,5.94 10.61,5.86 10.60,5.75C10.57,5.43 10.47,5.15 10.35,5.05C10.15,4.88 9.96,4.89 9.78,5.07C9.62,5.23 9.60,5.31 9.58,5.59C9.57,5.93 9.62,6.10 9.79,6.26C9.86,6.33 9.91,6.39 9.91,6.39C9.91,6.40 9.87,6.43 9.82,6.46L9.72,6.52L9.62,6.41C9.57,6.35 9.49,6.22 9.44,6.13C9.25,5.74 9.35,4.89 9.62,4.59C9.78,4.42 10.08,4.38 10.31,4.49ZM10.16,5.12C10.27,5.18 10.34,5.33 10.36,5.52L10.38,5.67L10.31,5.66C10.24,5.65 10.23,5.63 10.19,5.47L10.15,5.29L10.05,5.28C9.92,5.27 9.90,5.21 9.98,5.12C10.04,5.06 10.06,5.06 10.16,5.12ZM13.10,5.12C13.21,5.19 13.27,5.28 13.29,5.44C13.30,5.51 13.31,5.59 13.32,5.61C13.34,5.65 13.33,5.66 13.28,5.66C13.23,5.66 13.21,5.64 13.17,5.55C13.11,5.40 13.04,5.30 12.98,5.30C12.96,5.30 12.92,5.27 12.89,5.23C12.85,5.16 12.85,5.16 12.92,5.12C13.01,5.06 13.00,5.06 13.10,5.12ZM11.79,6.04C11.94,6.09 12.20,6.18 12.36,6.24C12.52,6.30 12.79,6.40 12.95,6.46C13.36,6.61 13.64,6.74 13.79,6.88C13.91,6.99 13.93,7.01 13.93,7.11C13.93,7.25 13.87,7.38 13.74,7.51C13.61,7.65 12.51,8.38 12.19,8.55C11.51,8.90 11.01,8.94 10.52,8.68C10.27,8.55 9.72,8.02 9.60,7.80L9.52,7.64L9.68,7.75C10.16,8.09 10.70,8.25 11.19,8.18C11.62,8.13 12.23,7.88 12.82,7.51C13.19,7.28 13.23,7.24 13.18,7.20C13.15,7.18 13.13,7.14 13.13,7.10C13.13,7.05 13.13,7.05 13.07,7.09C12.18,7.74 11.46,8.05 10.90,8.05C10.34,8.06 9.45,7.52 9.45,7.19C9.45,6.93 9.90,6.51 10.50,6.20C11.07,5.92 11.26,5.89 11.79,6.04ZM13.70,7.98C13.73,8.03 13.82,8.26 13.91,8.47C14.00,8.69 14.20,9.11 14.36,9.41C14.61,9.90 14.64,9.97 14.66,10.13C14.72,10.69 14.87,11.05 15.39,11.83C15.70,12.30 15.81,12.57 15.95,13.15C16.07,13.68 16.09,13.87 16.11,14.58C16.12,15.12 16.09,16.02 16.05,16.31L16.03,16.42L15.90,16.35C15.49,16.14 15.11,16.39 14.94,16.99C14.89,17.19 14.88,17.83 14.93,18.32L14.96,18.62L14.85,18.76C13.93,19.95 12.82,20.53 11.35,20.59C10.50,20.62 9.85,20.46 9.49,20.13C9.39,20.04 9.32,19.94 9.23,19.77C9.11,19.53 9.10,19.49 9.20,19.49C9.37,19.49 9.79,19.16 9.89,18.96C10.03,18.67 9.85,18.36 9.14,17.68C8.82,17.37 8.69,17.27 8.25,16.98C7.37,16.39 6.87,15.95 6.71,15.62C6.47,15.14 6.48,14.62 6.72,13.86C6.89,13.32 7.43,12.16 7.65,11.86C7.75,11.72 7.76,11.71 7.80,11.75C7.82,11.77 7.86,11.79 7.89,11.79C7.96,11.79 7.93,11.86 7.80,12.04C7.44,12.52 6.99,13.55 6.85,14.24C6.78,14.55 6.75,15.03 6.79,15.21C6.84,15.42 6.95,15.61 7.10,15.76C7.17,15.83 7.24,15.89 7.24,15.88C7.25,15.88 7.24,15.76 7.23,15.63C7.18,15.21 7.26,14.55 7.43,14.02C7.58,13.52 7.74,13.16 8.18,12.27C8.63,11.37 8.66,11.30 8.71,11.03C8.80,10.62 8.99,10.13 9.29,9.56C9.57,9.03 9.67,8.77 9.70,8.54C9.71,8.46 9.72,8.39 9.73,8.39C9.75,8.39 10.09,8.68 10.23,8.81C10.43,9.00 10.70,9.09 11.13,9.09C11.79,9.09 12.46,8.79 13.31,8.11C13.47,7.98 13.61,7.88 13.62,7.88C13.64,7.88 13.67,7.92 13.70,7.98ZM16.41,11.42C16.72,11.57 17.09,12.01 17.27,12.44C17.55,13.12 17.56,14.12 17.30,15.18C17.26,15.36 17.22,15.50 17.23,15.51C17.23,15.51 17.42,15.54 17.63,15.56C18.23,15.62 18.56,15.75 18.82,16.01C18.99,16.18 19.08,16.35 19.09,16.50C19.09,16.65 19.02,16.68 18.96,16.55C18.94,16.50 18.86,16.37 18.79,16.27C18.67,16.10 18.63,16.07 18.47,15.98C18.11,15.81 17.70,15.72 17.30,15.73C17.09,15.74 17.03,15.75 16.86,15.83C16.69,15.92 16.64,15.96 16.43,16.20C16.29,16.35 16.17,16.47 16.16,16.47C16.00,16.42 16.45,15.82 16.79,15.63L16.93,15.55L17.03,15.25C17.43,13.99 17.33,12.70 16.79,12.02C16.63,11.82 16.24,11.51 16.15,11.51C16.14,11.51 16.11,11.49 16.08,11.47C16.04,11.44 16.04,11.43 16.07,11.38C16.10,11.30 16.20,11.32 16.41,11.42ZM6.26,16.20C6.72,16.39 7.03,16.75 7.58,17.72C7.74,17.99 7.96,18.32 8.26,18.72C9.22,20.00 9.56,20.65 9.63,21.35C9.65,21.58 9.63,21.92 9.58,22.01C9.53,22.10 9.17,22.41 9.02,22.50C8.83,22.59 8.51,22.68 8.34,22.68C8.17,22.68 7.88,22.60 7.32,22.41C7.06,22.32 6.58,22.16 6.27,22.05C5.56,21.81 5.04,21.68 4.34,21.56C3.59,21.43 3.30,21.34 3.07,21.17C2.85,21.00 2.87,20.84 3.27,20.11C3.47,19.71 3.51,19.37 3.38,18.77C3.28,18.26 3.27,18.04 3.34,17.82C3.42,17.58 3.55,17.41 3.68,17.38C3.85,17.33 4.15,17.30 4.47,17.30C5.02,17.30 5.19,17.20 5.25,16.85C5.31,16.48 5.48,16.29 5.83,16.18C5.98,16.13 6.10,16.14 6.26,16.20ZM15.92,16.61C16.01,16.67 16.05,16.71 16.07,16.79C16.18,17.25 16.28,17.46 16.44,17.63C16.65,17.85 16.82,17.93 17.20,17.97C17.71,18.03 17.98,17.89 18.64,17.21C18.82,17.03 18.99,16.87 19.03,16.85C19.12,16.80 19.22,16.80 19.25,16.84C19.29,16.88 19.40,17.32 19.44,17.56C19.54,18.19 19.84,18.59 20.39,18.85C20.99,19.14 21.18,19.47 20.97,19.87C20.90,20.02 20.74,20.12 20.44,20.23C20.17,20.33 19.44,20.71 19.14,20.91C18.87,21.09 18.84,21.12 18.05,21.80C17.72,22.09 17.40,22.35 17.34,22.38C17.28,22.41 17.20,22.46 17.15,22.50C16.86,22.72 16.29,22.82 15.86,22.72C15.51,22.64 15.12,22.35 14.95,22.06L14.88,21.94L14.96,21.52C15.01,21.26 15.04,21.01 15.04,20.87C15.04,20.75 15.05,20.56 15.07,20.46C15.09,20.36 15.12,20.20 15.14,20.12C15.15,20.02 15.16,19.50 15.16,18.78C15.17,17.11 15.20,16.86 15.41,16.64C15.51,16.53 15.53,16.53 15.66,16.53C15.77,16.53 15.82,16.54 15.92,16.61ZM10.85,6.13C10.81,6.14 10.76,6.16 10.74,6.17C10.70,6.18 10.65,6.37 10.67,6.42C10.69,6.49 10.80,6.46 10.91,6.35C11.01,6.25 11.03,6.21 11.02,6.13C11.02,6.09 10.96,6.09 10.85,6.13ZM11.33,6.15C11.33,6.25 11.50,6.46 11.57,6.46C11.66,6.46 11.70,6.42 11.68,6.35C11.66,6.26 11.51,6.13 11.41,6.11C11.34,6.09 11.33,6.10 11.33,6.15Z"
      />
    </Icon>
  ),
  phone: (
    <Icon>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <path d="M10.5 5h3" strokeLinecap="round" />
    </Icon>
  ),
  android: (
    <Icon weight="hairline" variant="fill">
      <path
        fill="currentColor"
        d="M8 8.5a4 4 0 0 1 8 0zM8 9h8v6.4a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"
      />
      <rect x="4.6" y="9.6" width="1.8" height="5.4" rx="0.9" fill="currentColor" />
      <rect x="17.6" y="9.6" width="1.8" height="5.4" rx="0.9" fill="currentColor" />
      <rect x="9.4" y="16" width="1.8" height="3.2" rx="0.9" fill="currentColor" />
      <rect x="12.8" y="16" width="1.8" height="3.2" rx="0.9" fill="currentColor" />
      <path d="M9.2 5.6l1.3 1.9M14.8 5.6l-1.3 1.9" stroke="currentColor" strokeLinecap="round" />
      <circle cx="10.3" cy="6.9" r="0.65" fill="var(--accent)" />
      <circle cx="13.7" cy="6.9" r="0.65" fill="var(--accent)" />
    </Icon>
  ),
};

// Tailscale download links. The full list lives in the phone's Get Tailscale
// sheet, so a new user can install it on their computer without hunting; the
// desktop shows only its own row. Desktop platforms use Tailscale's own per-OS
// download pages; mobile points at the app stores.
const TAILSCALE_LINKS: { label: string; glyph: keyof typeof GLYPHS; href: string }[] = [
  { label: 'macOS', glyph: 'apple', href: 'https://tailscale.com/download/macos' },
  { label: 'Windows', glyph: 'windows', href: 'https://tailscale.com/download/windows' },
  { label: 'Linux', glyph: 'linux', href: 'https://tailscale.com/download/linux' },
  {
    label: 'iPhone / iPad',
    glyph: 'phone',
    href: 'https://apps.apple.com/app/tailscale/id1470499037',
  },
  {
    label: 'Android',
    glyph: 'android',
    href: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn',
  },
];

export function PairScreen() {
  return isDesktop() ? <DesktopPair /> : <PhonePair />;
}

function DesktopPair() {
  const { showToast } = useApp();
  // The pairing code is the paid moment on this side: it shows only while
  // Plus is open. Revoking a phone stays free.
  const [info, setInfo] = useState<DaemonInfo | undefined>();
  const [qr, setQr] = useState<string | undefined>();
  const [showToken, setShowToken] = useState(false);
  // The "it worked" moment (CX 2026-10-01): a phone that pairs while this
  // room is open is named at the top, and the QR folds into a quiet "Pair
  // another phone" until it is asked for again.
  const knownDevices = useRef<Set<string> | undefined>(undefined);
  const [justPaired, setJustPaired] = useState<string | undefined>();
  const [qrFolded, setQrFolded] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; label: string } | undefined>();
  const [more, setMore] = useState(false);
  const [login, setLogin] = useState<{ on: boolean; supported: boolean } | undefined>();
  const titleRef = useRef<HTMLHeadingElement>(null);

  const refresh = async () => {
    const b = bridge();
    if (!b) return;
    const next = await b.daemonInfo();
    setInfo(next);
    const ids = new Set((next.devices ?? []).map((d) => d.id));
    if (knownDevices.current) {
      const fresh = (next.devices ?? []).find((d) => !knownDevices.current!.has(d.id));
      if (fresh) {
        setJustPaired(fresh.label);
        setQrFolded(true);
        hapticApproval();
      }
    }
    knownDevices.current = ids;
    // Only publish a QR the phone can actually reach: a loopback-only fallback
    // (Tailscale down) would hand out an address that points at the phone itself.
    if (next.running && next.host && next.mode !== 'loopback' && next.claim) {
      // A link, so the iPhone's own Camera app opens OpenShore with it.
      const payload = pairingLink(`http://${next.host}:${next.port}`, next.claim);
      setQr(
        await QRCode.toDataURL(payload, {
          margin: 1,
          width: 240,
          color: { dark: '#1c2a33', light: '#f6f4ef' },
        }),
      );
    } else {
      setQr(undefined);
    }
  };

  useEffect(() => {
    void refresh();
    void bridge()
      ?.launchAtLogin?.()
      .then(setLogin)
      .catch(() => {});
    // Poll so starting Tailscale after opening this screen updates the state
    // (the daemon can move from loopback-only to the tailnet without a reload),
    // and so a phone that pairs is seen here within a few seconds.
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tailscaleHere = TAILSCALE_LINKS.find((l) => l.label === thisDesktopOs());

  return (
    <div className="screen">
      <BackBar title={DESKTOP_TITLE} titleHiddenUntil={titleRef} />
      <div className="screen-inner">
        <h1 ref={titleRef}>{DESKTOP_TITLE}</h1>
        <p className="lead">
          Your phone reaches your computer over Tailscale, a free app that privately links your own
          devices. Work stays on your computer, so losing signal loses nothing.
        </p>

        {justPaired ? (
          <p className="pair-done" role="status">
            <span className="pill ok pill-pop">{justPaired} docked</span> It can reach this computer
            now.
          </p>
        ) : null}

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Phone access</h3>
              <div className="sub">{hubStatusLine(info, { linux: onLinux() })}</div>
            </div>
            <button
              className={`btn sm ${info?.running ? 'ghost' : 'primary'} press-fb`}
              onClick={async () => {
                const b = bridge();
                if (!b) return;
                if (info?.running) {
                  await b.daemonStop();
                } else {
                  const result = await b.daemonStart();
                  // The status line says it could not turn on (hubStatusLine);
                  // the raw reason is for the log, not the screen.
                  if ('error' in result) console.warn('[pair] hub did not start:', result.error);
                }
                await refresh();
              }}
            >
              {info?.running ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          {info && !info.tailscaleUp && tailscaleHere ? (
            <a
              className="dl-item"
              href={tailscaleHere.href}
              target="_blank"
              rel="noreferrer noopener"
              style={{ marginTop: 12 }}
            >
              <span className="dl-tile">{GLYPHS[tailscaleHere.glyph]}</span>
              <span className="dl-name">Tailscale for {tailscaleHere.label}</span>
              <span className="dl-get">GET</span>
            </a>
          ) : null}
          {login?.supported ? (
            <div className="card-row" style={{ marginTop: 12 }}>
              <div className="grow">
                <div>{LAUNCH_AT_LOGIN_LABEL}</div>
                <div className="sub">
                  Your phone reaches this computer only while OpenShore is open on it.
                </div>
              </div>
              <Switch
                checked={login.on}
                label={LAUNCH_AT_LOGIN_LABEL}
                onChange={async (next) => {
                  const b = bridge();
                  if (!b?.setLaunchAtLogin) return;
                  const result = await b.setLaunchAtLogin(next);
                  setLogin((l) => (l ? { ...l, on: result.on } : l));
                  if (result.detail && result.on !== next) showToast(result.detail);
                }}
              />
            </div>
          ) : null}
        </div>

        {info?.running && qr ? (
          qrFolded ? (
            <button
              type="button"
              className="btn ghost block press-fb"
              style={{ marginBottom: 12 }}
              onClick={() => {
                setQrFolded(false);
                setJustPaired(undefined);
              }}
            >
              Dock another phone
            </button>
          ) : (
            <div className="card" style={{ textAlign: 'center' }}>
              <h3>Scan this with your phone</h3>
              <div className="sub" style={{ marginBottom: 12 }}>
                {SCAN_HOW}
              </div>
              <img src={qr} alt="Docking QR code" className="pair-qr-img" />
              <div className="sub" style={{ marginTop: 12, wordBreak: 'break-all' }}>
                Address: http://{info.host}:{info.port}
              </div>
              <button
                className="hint press-fb"
                onClick={() => setShowToken((s) => !s)}
                style={{ marginTop: 6 }}
              >
                {showToken ? `Code: ${info.claim}` : 'Show the code'}
              </button>
              {showToken ? (
                <div className="sub" style={{ marginTop: 6 }}>
                  A one-time code, good for five minutes and only on your Tailscale network. The
                  phone trades it for its own credential, so it is never a lasting key.
                </div>
              ) : null}
            </div>
          )
        ) : null}

        {info?.devices && info.devices.length > 0 ? (
          <div className="card">
            <h3>Docked devices</h3>
            <div className="sub" style={{ marginBottom: 12 }}>
              Each docked phone gets its own credential. Lost a phone? Revoke just that one. The
              rest stay connected.
            </div>
            {info.devices.map((d) => (
              <div key={d.id} className="card-row" style={{ alignItems: 'center' }}>
                <div className="grow">
                  <div>{d.label}</div>
                  <div className="sub">
                    Docked {pairedWhen(d.createdAt)}
                    {d.expiresAt ? ` · expires ${new Date(d.expiresAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <button
                  className="btn ghost sm press-fb"
                  onClick={() => setRevoking({ id: d.id, label: d.label })}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <Sheet open={Boolean(revoking)} onClose={() => setRevoking(undefined)} variant="confirm">
          <h3>Revoke {revoking?.label ?? 'this device'}?</h3>
          <p>It can no longer reach this computer, and anything it has open is cut off.</p>
          <div className="confirm-row">
            <button
              type="button"
              className="btn ghost press-fb"
              onClick={() => setRevoking(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger press-fb"
              onClick={async () => {
                const b = bridge();
                const target = revoking;
                setRevoking(undefined);
                if (!b || !target) return;
                await b.revokeDeviceCredential(target.id);
                showToast(`${target.label} revoked. It can no longer connect.`);
                await refresh();
              }}
            >
              Revoke
            </button>
          </div>
        </Sheet>

        <p className="hint">
          Both devices sign in to the same Tailscale account, free for personal use. Work started
          from the phone asks before every command, and before a cloud model's first step in each
          task.
        </p>

        {/* A server for this computer's projects (founder, 2026-10-12): in
            the room, not folded away, since a project can now choose to run
            on one. The bare address and key stay under More options. */}
        <DesktopServerCard />

        {/* The expert tools, folded away from a first pairing (CX 2026-10-01). */}
        <button
          type="button"
          className="linklike press-fb"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          {more ? 'Fewer options' : 'More options'}
        </button>
        {more ? (
          <>
            {bridge()?.rotateSharedToken ? (
              <ReplaceSharedKey rotate={() => bridge()!.rotateSharedToken!()} onToast={showToast} />
            ) : null}
            <RemoteHubPanel />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The three ways to dock, short enough to sit side by side on a phone. */
export const DOCK_CHOICE_LABEL: Record<'computer' | DockPlace, string> = {
  computer: 'Your computer',
  home: 'Home server',
  rented: 'Rented server',
};

/** The switch that keeps phone access honest: "while your computer is on"
 *  means while OpenShore is open on it. */
export const LAUNCH_AT_LOGIN_LABEL = 'Open OpenShore when this computer starts';

/** How to scan, on the desktop's QR card. */
export const SCAN_HOW =
  'On your iPhone, point the Camera at this code, or open OpenShore, then Menu, Computer, Scan.';

/** When a device paired, to the minute, so two phones are told apart. */
function pairedWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** This desktop's Tailscale download row, by the page's own platform. */
function thisDesktopOs(): 'macOS' | 'Windows' | 'Linux' | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return undefined;
}

// On a desktop that is not your computer, the one the work runs on (a laptop
// away from the hub): point it at a remote hub and it runs sessions there over
// the tailnet, the way the phone does, instead of on this machine. Off by default, so a desktop stays
// its own engine unless you say otherwise.
function RemoteHubPanel() {
  const { settings, saveHub, setPreferRemoteHub, showToast } = useApp();
  const [address, setAddress] = useState(settings.daemon?.baseUrl ?? '');
  const [token, setToken] = useState(settings.daemon?.token ?? '');
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState<string | undefined>();
  const prefer = settings.preferRemoteHub === true;

  const connect = async () => {
    const baseUrl = address.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(baseUrl) || !token.trim()) {
      setState("Enter the other computer's address and its access key.");
      return;
    }
    setTesting(true);
    const health = await daemonHealth({ baseUrl, token: token.trim() });
    setTesting(false);
    setState(health.detail);
    if (health.ok) {
      // The hub's /health names this credential's role (admin or member); an
      // older hub says nothing and the daemon decides per request.
      await saveHub(
        { baseUrl, token: token.trim() },
        { role: (health as { role?: HubRole }).role },
      );
      showToast('Connected. This computer now runs sessions on the other one.');
    }
  };

  return (
    <div className="card">
      <div className="card-row">
        <div className="grow">
          <h3 style={{ margin: 0 }}>Run on another computer</h3>
          <div className="sub">
            {prefer
              ? 'On. This computer runs sessions on the computer below, not on itself.'
              : 'Off. Sessions run on this computer. Turn on to run them on another one.'}
          </div>
        </div>
        <Switch
          checked={prefer}
          label="Run on another computer"
          onChange={(next) => void setPreferRemoteHub(next)}
        />
      </div>

      {prefer ? (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="pair-hub-address">Address</label>
            <input
              id="pair-hub-address"
              placeholder="http://100.x.y.z:4816"
              value={address}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pair-hub-key">Access key</label>
            <input
              id="pair-hub-key"
              placeholder="osc_..."
              value={token}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <button
            className="btn primary block press-fb"
            disabled={testing}
            onClick={() => void connect()}
          >
            {testing ? 'Checking...' : 'Connect to the other computer'}
          </button>
          {state ? (
            <p className="hint" style={{ marginTop: 10 }}>
              {state}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The desktop's door to a server (founder, 2026-10-12): a server at home or
 *  a rented one, docked here so this computer's projects can run on it, and
 *  every machine docked so far. */
function DesktopServerCard() {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<DockPlace>('rented');
  return (
    <>
      <h2 className="dock-other-head">Run projects on a server</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        A server at home or one you rent keeps working while this computer sleeps. Dock to it here,
        then choose it under Runs on in a project.
      </p>
      <HubList min={1} />
      {open ? (
        <>
          <div className="segmented dock-choice" role="tablist" aria-label="Where the server is">
            {(['home', 'rented'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={place === id}
                className={`seg press-fb${place === id ? ' active' : ''}`}
                onClick={() => setPlace(id)}
              >
                {DOCK_CHOICE_LABEL[id]}
              </button>
            ))}
          </div>
          <ServerSetup key={place} place={place} />
          <DockForm key={`dock-${place}`} expect="server" place={place} />
        </>
      ) : (
        <button type="button" className="btn block press-fb" onClick={() => setOpen(true)}>
          Set up a server
        </button>
      )}
    </>
  );
}

function PhonePair() {
  const { settings, removeHub, showToast, startGuideChat, setView } = useApp();
  const [tailscaleOpen, setTailscaleOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  // A forgotten server whose keys could not be deleted there.
  const [left, setLeft] = useState<KeysLeft | undefined>();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const paired = settings.daemon;
  // Which way in the person is looking at: the founder's three (2026-10-12),
  // your computer, a server at home, a server you rent. A device already
  // docked to a server opens on its path, everyone else on the computer.
  const [path, setPath] = useState<'computer' | DockPlace>(
    paired?.kind === 'server' ? (paired.place === 'home' ? 'home' : 'rented') : 'computer',
  );

  return (
    <div className="screen">
      <BackBar title={PHONE_TITLE} titleHiddenUntil={titleRef} />
      <div className="screen-inner">
        <h1 ref={titleRef}>{PHONE_TITLE}</h1>
        <p className="lead">
          Docking links {thisDeviceNoun()} to a machine that does the work: your computer, a server
          at home, or a server you rent. Dock to as many as you like; each project can choose the
          one it runs on. It runs over your own private network, so a long task keeps going even
          when you close the app.
          {!paired ? (
            <>
              {' '}
              <button
                type="button"
                className="linklike press-fb"
                onClick={() => void startGuideChat('pair-computer')}
              >
                Walk me through it
              </button>
            </>
          ) : null}
        </p>

        {paired ? <ConnectedCard onTerminal={() => setView('terminalroom')} /> : null}

        {/* Scan sits in the first screen (2026-10-07 review): the two ways to
            dock are one small choice above it, and the other ways to give
            OpenShore a brain wait below. */}
        <div className="segmented dock-choice" role="tablist" aria-label="Dock to">
          {(['computer', 'home', 'rented'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={path === id}
              className={`seg press-fb${path === id ? ' active' : ''}`}
              onClick={() => setPath(id)}
            >
              {DOCK_CHOICE_LABEL[id]}
            </button>
          ))}
        </div>

        {path === 'computer' ? (
          <>
            {!paired ? (
              <div className="card">
                <h3>Before you scan</h3>
                <ol className="setup-steps">
                  <li>Install Tailscale on both devices and sign in to the same account.</li>
                  <li>
                    On your computer, open OpenShore, then Computer. The QR is there. If it says
                    Off, choose Turn on.
                  </li>
                </ol>
                <button
                  type="button"
                  className="linklike door press-fb"
                  onClick={() => setTailscaleOpen(true)}
                >
                  Get Tailscale
                </button>
              </div>
            ) : null}
            <DockForm expect="desktop" offers />
          </>
        ) : (
          <>
            <ServerSetup key={path} place={path} />
            <DockForm key={`dock-${path}`} expect="server" place={path} offers />
          </>
        )}

        <HubList />

        <OtherWaysIn onPick={(id) => setView(id === 'cloud' ? 'connections' : 'stack')} />

        {paired ? (
          <button
            type="button"
            className="btn quiet block press-fb"
            onClick={() => setForgetting(true)}
          >
            {paired.kind === 'server' ? 'Forget this server' : 'Forget this computer'}
          </button>
        ) : null}

        <ForgetComputerConfirm
          name={forgetting && paired ? computerLabel(paired) : undefined}
          keys={Boolean(paired && keysGoFirst(paired, settings.hubRoles))}
          projects={paired ? projectsOn(settings.projects, paired.baseUrl) : 0}
          onKeep={() => setForgetting(false)}
          onForget={async () => {
            setForgetting(false);
            if (!paired) return;
            const keys = await removeHub(paired.baseUrl);
            showToast(forgottenLine(dockedNoun(paired), keys));
            // Sheets never stack: a fast failure waits for the confirm to leave.
            const where = computerLabel(paired);
            if (keys.kind === 'failed') setTimeout(() => setLeft({ where }), sheetExitMs());
          }}
        />
        <ServerKeysLeftSheet left={left} onClose={() => setLeft(undefined)} />

        <Sheet open={tailscaleOpen} onClose={() => setTailscaleOpen(false)}>
          <SheetHead title="Get Tailscale" onClose={() => setTailscaleOpen(false)} />
          <p className="sheet-sub">
            Free for personal use. Install it on this device and on your computer, then sign in to
            the same account on both.
          </p>
          <div className="dl-list">
            {TAILSCALE_LINKS.filter((l) => !(platform() === 'ios' && l.glyph === 'android')).map(
              (l) => (
                <a
                  key={l.label}
                  className="dl-item"
                  href={l.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="dl-tile">{GLYPHS[l.glyph]}</span>
                  <span className="dl-name">{l.label}</span>
                  <span className="dl-get">GET</span>
                </a>
              ),
            )}
          </div>
        </Sheet>
      </div>
    </div>
  );
}

/** The other ways to give OpenShore a brain (lib/docking.ts): a cloud key
 *  and a model on this device, each in the room that holds it. */
function OtherWaysIn({ onPick }: { onPick: (id: DockPath) => void }) {
  return (
    <>
      <h2 className="dock-other-head">Other ways in</h2>
      <div className="dock-paths" role="list">
        {DOCK_PATHS.filter((p) => p.id === 'cloud' || p.id === 'device').map((p) => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            className="dock-path press-fb"
            onClick={() => onPick(p.id)}
          >
            <span className="dock-path-title">{p.title}</span>
            <span className="sub">{p.detail}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Forgetting a server deletes the provider keys it keeps first, unless
 *  this device is only a member there (keys on your server, 2026-10-09;
 *  serverKeysOps.dockedServers, the same rule). */
function keysGoFirst(
  hub: { baseUrl: string; kind?: string },
  roles: Record<string, HubRole> | undefined,
): boolean {
  return hub.kind === 'server' && roles?.[hub.baseUrl] !== 'member';
}

/** The toast once a hub is forgotten, and what became of a server's keys. */
function forgottenLine(noun: string, keys: HubKeysCleared): string {
  if (keys.kind === 'cleared' && keys.removed.length) {
    return `${noun} forgotten on this device, and the provider keys it kept were deleted there.`;
  }
  return `${noun} forgotten on this device.`;
}

/** What a saved computer is called: its own name, or its host. */
function computerLabel(hub: { baseUrl: string; name?: string }): string {
  return hub.name?.trim() || hostOf(hub.baseUrl);
}

/** Forgetting a computer asks first. The revoke on the computer is best
 *  effort (a computer that is off keeps its row until it is revoked there), so
 *  the line says "if the computer is on". Open while a name is set. */
function ForgetComputerConfirm({
  name,
  keys = false,
  projects = 0,
  onKeep,
  onForget,
}: {
  name?: string;
  /** A server this device is the admin of: every provider key it keeps is
   *  deleted there first. */
  keys?: boolean;
  /** How many projects run on it (lib/runsOn.ts). */
  projects?: number;
  onKeep: () => void;
  onForget: () => void;
}) {
  return (
    <Sheet open={name !== undefined} onClose={onKeep} variant="confirm">
      <h3>Forget {name}?</h3>
      {projects > 0 ? (
        <p>
          {projects === 1 ? 'One project runs' : `${projects} projects run`} on it. New chats there
          go back to running where this device runs; chats already started there stop until you dock
          to it again.
        </p>
      ) : null}
      {keys ? (
        <p>
          This device stops reaching it. If the server answers, every provider key it keeps is
          deleted there first, then it drops this device from its list. To use it again, scan a new
          QR.
        </p>
      ) : (
        <p>
          This device stops reaching it. If the computer is on, it drops this device from its list
          too. To use it again, scan a new QR.
        </p>
      )}
      <div className="confirm-row">
        <button type="button" className="btn ghost press-fb" onClick={onKeep}>
          Keep
        </button>
        <button type="button" className="btn danger press-fb" onClick={onForget}>
          Forget
        </button>
      </div>
    </Sheet>
  );
}

/** The paired computer, live (CX 2026-10-01): who it is and whether it
 *  answers right now, so the screen after pairing never looks like the
 *  screen before it. */
function ConnectedCard({ onTerminal }: { onTerminal: () => void }) {
  const daemon = useApp((s) => s.settings.daemon);
  const noteMachineFacts = useApp((s) => s.noteMachineFacts);
  const [reach, setReach] = useState<'checking' | 'yes' | 'no' | 'refused'>('checking');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!daemon) return;
    let alive = true;
    const check = async () => {
      const h = await daemonHealth(daemon);
      if (!alive) return;
      setReach(h.ok ? 'yes' : h.detail === PAIRING_REJECTED ? 'refused' : 'no');
      // A resized server says so here (many machines, 2026-10-12).
      if (h.machine) void noteMachineFacts(daemon.baseUrl, h.machine);
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [daemon, noteMachineFacts]);
  if (!daemon) return null;
  const name = computerLabel(daemon);
  return (
    <div className="card">
      <div className="card-row" style={{ alignItems: 'center' }}>
        <div className="grow">
          <h3 style={{ margin: 0 }}>Docked to {name}</h3>
          <div className="sub">{machineLine(daemon)}</div>
          <div className="sub">
            {reach === 'refused'
              ? PAIRING_REJECTED
              : reach === 'no'
                ? unreachableLine(daemon)
                : `${dockedNoun(daemon)} runs the work; this device reaches it.`}
          </div>
        </div>
        <span className={`pill ${reach === 'yes' ? 'ok' : 'muted'}`}>
          {reach === 'yes'
            ? 'Reachable'
            : reach === 'checking'
              ? 'Checking'
              : reach === 'refused'
                ? 'Not accepted'
                : 'Not reachable'}
        </span>
      </div>
      {reach === 'yes' ? (
        <button className="btn block press-fb" style={{ marginTop: 12 }} onClick={onTerminal}>
          {daemon.kind === 'server'
            ? 'Open a terminal on your server'
            : 'Open a terminal on your computer'}
        </button>
      ) : null}
      <button
        type="button"
        className="linklike press-fb"
        style={{ marginTop: 10 }}
        onClick={() => setEditing(true)}
      >
        {daemon.kind === 'server' ? 'Name it, or say where it is' : 'Name it'}
      </button>
      <Sheet open={editing} onClose={() => setEditing(false)}>
        {editing ? (
          <HubNameForm
            key={daemon.baseUrl}
            hub={{ ...daemon, host: hostOf(daemon.baseUrl) }}
            onDone={() => setEditing(false)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

/** A machine's second line: what kind it is, and its size once it said. */
function machineLine(hub: {
  kind?: 'desktop' | 'server';
  place?: DockPlace;
  machine?: Parameters<typeof machineFactsLine>[0];
}): string {
  const kind = machineKindLabel(machineKindOf(hub));
  const size = machineFactsLine(hub.machine);
  return size ? `${kind}, ${size}` : kind;
}

// Your machines (many machines, 2026-10-12): every docked computer and server
// with its kind and size and the projects that run on it. On a phone it shows
// once a second machine exists (the card above covers one); the desktop's
// server section shows it from the first. The active one is marked; tapping
// another makes it active, and each can be edited or forgotten.
function HubList({ min = 2 }: { min?: number }) {
  const { settings, selectHub, removeHub, showToast } = useApp();
  // The machine being named, while its sheet is open.
  const [naming, setNaming] = useState<{
    baseUrl: string;
    name?: string;
    host: string;
    kind?: 'desktop' | 'server';
    place?: DockPlace;
  }>();
  // The computer being forgotten, while its confirm is open, and whether its
  // provider keys go first (a server this device is the admin of).
  const [forgetting, setForgetting] = useState<{
    baseUrl: string;
    name: string;
    server: boolean;
    keys: boolean;
    projects: number;
  }>();
  // A forgotten server whose keys could not be deleted there.
  const [left, setLeft] = useState<KeysLeft | undefined>();
  const hubs = hubList(settings);
  // On the desktop the active machine matters only while this computer runs
  // its sessions elsewhere; on a phone it always does.
  const activeUrl = isDesktop() && !settings.preferRemoteHub ? undefined : settings.daemon?.baseUrl;
  // The confirm sits outside the list: forgetting the second of two machines
  // hides the list, and the confirm still plays its exit.
  return (
    <>
      {hubs.length >= min ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your machines</h3>
          <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            {isDesktop()
              ? 'A project runs on the one it chooses under Runs on.'
              : 'The active one runs the Stack, the Vault on it, Crew, and every project that does not choose its own under Runs on.'}
          </p>
          {hubs.map((h, i) => {
            const active = h.baseUrl === activeUrl;
            const host = hostOf(h.baseUrl);
            const runs = projectsOn(settings.projects, h.baseUrl);
            return (
              <div
                className="card-row machine-row stagger-in"
                key={h.baseUrl}
                style={{ '--i': Math.min(i, 8) } as CSSProperties}
              >
                <button
                  className="linklike grow press-fb machine-row-main"
                  disabled={active || (isDesktop() && !settings.preferRemoteHub)}
                  onClick={() => void selectHub(h.baseUrl)}
                >
                  <span className="machine-row-name">{h.name?.trim() || host}</span>
                  <span className="sub">
                    {machineLine(h)}
                    {runs ? `. Runs ${runs === 1 ? 'one project' : `${runs} projects`}.` : ''}
                  </span>
                </button>
                {active ? <span className="pill ink">Active</span> : null}
                <span className="machine-row-actions">
                  <button
                    className="linklike press-fb"
                    onClick={() =>
                      setNaming({
                        baseUrl: h.baseUrl,
                        name: h.name,
                        host,
                        kind: h.kind,
                        place: h.place,
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="linklike press-fb"
                    onClick={() =>
                      setForgetting({
                        baseUrl: h.baseUrl,
                        name: computerLabel(h),
                        server: h.kind === 'server',
                        keys: keysGoFirst(h, settings.hubRoles),
                        projects: runs,
                      })
                    }
                  >
                    Forget
                  </button>
                </span>
              </div>
            );
          })}
          <Sheet open={Boolean(naming)} onClose={() => setNaming(undefined)}>
            {naming ? (
              <HubNameForm key={naming.baseUrl} hub={naming} onDone={() => setNaming(undefined)} />
            ) : null}
          </Sheet>
        </div>
      ) : null}
      <ForgetComputerConfirm
        name={forgetting?.name}
        keys={forgetting?.keys}
        projects={forgetting?.projects}
        onKeep={() => setForgetting(undefined)}
        onForget={async () => {
          const target = forgetting;
          setForgetting(undefined);
          if (!target) return;
          const keys = await removeHub(target.baseUrl);
          showToast(forgottenLine(target.server ? 'Server' : 'Computer', keys));
          // Sheets never stack: a fast failure waits for the confirm to leave.
          if (keys.kind === 'failed') {
            setTimeout(() => setLeft({ where: target.name }), sheetExitMs());
          }
        }}
      />
      <ServerKeysLeftSheet left={left} onClose={() => setLeft(undefined)} />
    </>
  );
}

// Naming a computer: one field, Save and Cancel, the Vault rename sheet's
// shape. (window.prompt did this before; Electron never implements it, so the
// desktop's rename did nothing.) An empty name goes back to the address.
function HubNameForm({
  hub,
  onDone,
}: {
  hub: {
    baseUrl: string;
    name?: string;
    host: string;
    kind?: 'desktop' | 'server';
    place?: DockPlace;
  };
  onDone: () => void;
}) {
  const { renameHub, setHubPlace } = useApp();
  const [name, setName] = useState(hub.name ?? '');
  const [place, setPlace] = useState<DockPlace | undefined>(hub.place);
  const server = hub.kind === 'server';
  const save = () => {
    void renameHub(hub.baseUrl, name);
    if (server && place && place !== hub.place) void setHubPlace(hub.baseUrl, place);
    onDone();
  };
  return (
    <>
      <SheetHead title={server ? 'This server' : 'Name this computer'} onClose={onDone} />
      <div className="field">
        <label htmlFor="pair-hub-name">Name</label>
        <input
          id="pair-hub-name"
          autoFocus
          value={name}
          placeholder={hub.host}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
      </div>
      {/* Where a server lives: a server cannot tell, so this device asks.
          Rented adds the line about renting where its notes are. */}
      {server ? (
        <div className="field">
          <label>Where it is</label>
          <div className="segmented" role="tablist" aria-label="Where it is">
            {(['home', 'rented'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={place === id}
                className={`seg press-fb${place === id ? ' active' : ''}`}
                onClick={() => setPlace(id)}
              >
                {id === 'home' ? 'At home' : 'Rented'}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {/* One way out, the round close above (the 2026-10-07 form-sheet
          rule), so the foot holds Save alone. */}
      <div className="sheet-actions">
        <button type="button" className="btn primary press-fb" onClick={save}>
          Save
        </button>
      </div>
    </>
  );
}
