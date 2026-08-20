// Hardware detection and the resource budget. Running several large local
// models at once thrashes as the server loads and unloads per hop, so OS Code
// detects VRAM once, picks a profile, and never assumes more than the budget
// allows to be resident at the same time.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { totalmem } from 'node:os';

export interface GpuInfo {
  name: string;
  vramGB: number;
}

export interface Hardware {
  gpus: GpuInfo[];
  totalVramGB: number;
  systemRamGB: number;
  /** Where the numbers came from, for doctor. */
  source: 'nvidia-smi' | 'rocm-sysfs' | 'none';
}

export type VramProfile = 'single' | 'dual' | 'fleet';

export interface ResourceBudget {
  profile: VramProfile;
  maxResidentModels: number;
  keepAlive: string;
  /** Largest single model (GB on disk) that fits comfortably. */
  maxModelGB: number;
  /** One warm sentence describing the machine for init and doctor. */
  summary: string;
}

export function detectHardware(): Hardware {
  const systemRamGB = Math.round(totalmem() / 1024 ** 3);

  // NVIDIA first: nvidia-smi is the reliable path.
  const nv = spawnSync(
    'nvidia-smi',
    ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
    {
      encoding: 'utf8',
      timeout: 4000,
    },
  );
  if (nv.status === 0 && nv.stdout.trim()) {
    const gpus: GpuInfo[] = nv.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [name, mem] = line.split(',').map((s) => s.trim());
        return { name: name ?? 'NVIDIA GPU', vramGB: Math.round(Number(mem ?? 0) / 1024) };
      });
    return {
      gpus,
      totalVramGB: gpus.reduce((a, g) => a + g.vramGB, 0),
      systemRamGB,
      source: 'nvidia-smi',
    };
  }

  // AMD: sysfs exposes VRAM totals without extra tooling.
  try {
    const gpus: GpuInfo[] = [];
    for (const card of readdirSync('/sys/class/drm')) {
      if (!/^card\d+$/.test(card)) continue;
      try {
        const bytes = Number(
          readFileSync(`/sys/class/drm/${card}/device/mem_info_vram_total`, 'utf8').trim(),
        );
        if (bytes > 0) gpus.push({ name: `GPU (${card})`, vramGB: Math.round(bytes / 1024 ** 3) });
      } catch {}
    }
    if (gpus.length) {
      return {
        gpus,
        totalVramGB: gpus.reduce((a, g) => a + g.vramGB, 0),
        systemRamGB,
        source: 'rocm-sysfs',
      };
    }
  } catch {}

  return { gpus: [], totalVramGB: 0, systemRamGB, source: 'none' };
}

export function pickProfile(vramGB: number): VramProfile {
  if (vramGB >= 24) return 'fleet';
  if (vramGB >= 16) return 'dual';
  return 'single';
}

/** VRAM at or below this is almost always an integrated-GPU carve-out (an AMD
 *  APU reports 0.5-2 GB), not a real dedicated accelerator worth budgeting the
 *  whole machine around. */
const DEDICATED_VRAM_FLOOR_GB = 4;

export function budgetFor(hardware: Hardware, profileOverride?: VramProfile): ResourceBudget {
  // With no usable dedicated GPU, Ollama runs on CPU from system RAM; be honest
  // and conservative. A tiny iGPU VRAM figure must NOT mask that fallback, or a
  // 64 GB machine gets capped at 2 GB models. Take the larger of the (small)
  // VRAM and half of system RAM whenever VRAM is below the dedicated floor.
  const ramBudgetGB = Math.floor(hardware.systemRamGB / 2);
  const effectiveGB =
    hardware.totalVramGB >= DEDICATED_VRAM_FLOOR_GB
      ? hardware.totalVramGB
      : Math.max(hardware.totalVramGB, ramBudgetGB);
  const profile = profileOverride ?? pickProfile(effectiveGB);

  const budgets: Record<
    VramProfile,
    { resident: number; keepAlive: string; modelFraction: number }
  > = {
    single: { resident: 1, keepAlive: '10m', modelFraction: 0.75 },
    dual: { resident: 2, keepAlive: '10m', modelFraction: 0.55 },
    fleet: { resident: 3, keepAlive: '30m', modelFraction: 0.5 },
  };
  const b = budgets[profile];

  const gpuLine = hardware.gpus.length
    ? `${hardware.gpus.map((g) => `${g.name} (${g.vramGB} GB)`).join(' + ')}`
    : `no dedicated GPU detected, ${hardware.systemRamGB} GB system RAM (CPU inference works, it is just slower)`;

  return {
    profile,
    maxResidentModels: b.resident,
    keepAlive: b.keepAlive,
    maxModelGB: Math.max(2, Math.floor(effectiveGB * b.modelFraction)),
    summary: `${gpuLine}. Comfortable profile: ${profile === 'single' ? 'one strong model at a time' : profile === 'dual' ? 'a main model plus one small specialist' : 'a resident fleet'}.`,
  };
}

/** Can a model of this download size run comfortably on this budget? */
export function fitsBudget(
  modelSizeGB: number,
  budget: ResourceBudget,
): 'fits' | 'tight' | 'too-big' {
  // Runtime footprint runs a bit above download size (KV cache, buffers).
  const needed = modelSizeGB * 1.2;
  if (needed <= budget.maxModelGB) return 'fits';
  if (needed <= budget.maxModelGB * 1.35) return 'tight';
  return 'too-big';
}
