// The ComfyUI workflows behind the media jobs (the model library, 2026-10-12).
// The graphs themselves are data (graphData.ts); this file fills one in for a
// call: the person's words where the template says {{prompt}}, the uploaded
// picture's name where it says {{image}}, a seed, a length, and the files of
// the size placed when a family has several (SeedVR2's 3B and 7B, Stable
// Audio 3's Small and Medium). Pure, so a test reads every graph.
import type { MediaJob } from './jobs.js';
import { GRAPH_DATA } from './graphData.js';

/** One node of an API-format graph. */
export interface GraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type ApiGraph = Record<string, GraphNode>;

/** What a call may fill in. */
export type GraphSlot =
  'prompt' | 'negative' | 'tags' | 'lyrics' | 'image' | 'mask' | 'seed' | 'seconds';

export interface GraphSpec {
  graph: ApiGraph;
  /** Where each slot goes, as `<node id>.<input>`. */
  placeholders: Partial<Record<GraphSlot, string[]>>;
  /** The oldest ComfyUI that has every node this graph uses. */
  minComfyVersion: string;
  /** What the run saves: a picture, a clip, or a sound. */
  output: 'image' | 'video' | 'audio';
  defaults?: { negative?: string; seconds?: number };
  /** A custom node pack the graph needs beyond ComfyUI's core. */
  nodePack?: string;
}

export const GRAPHS: Record<string, GraphSpec> = GRAPH_DATA;

export function graphKey(family: string, job: MediaJob): string {
  return `${family}:${job}`;
}

export function graphFor(family: string, job: MediaJob): GraphSpec | undefined {
  return GRAPHS[graphKey(family, job)];
}

/** The families that have a graph for a job. */
export function familiesFor(job: MediaJob): string[] {
  return Object.keys(GRAPHS)
    .filter((key) => key.endsWith(`:${job}`))
    .map((key) => key.slice(0, key.lastIndexOf(':')));
}

// Each loader's file input, by the role a catalog entry names it with.
const LOADER_INPUTS: Record<string, Array<[input: string, role: string]>> = {
  UNETLoader: [['unet_name', 'unet']],
  CLIPLoader: [['clip_name', 'clip']],
  DualCLIPLoader: [
    ['clip_name1', 'clip'],
    ['clip_name2', 'clip2'],
  ],
  VAELoader: [['vae_name', 'vae']],
  CheckpointLoaderSimple: [['ckpt_name', 'checkpoint']],
  LoraLoaderModelOnly: [['lora_name', 'lora']],
  UpscaleModelLoader: [['model_name', 'upscale']],
  LoadBackgroundRemovalModel: [['bg_removal_name', 'model']],
  INPAINT_LoadInpaintModel: [['model_name', 'model']],
};

/** Every file a graph's loaders name, by role, in node order. A second loader
 *  of the same role takes the role with a number (`unet`, `unet2`). */
export function graphFiles(
  graph: ApiGraph,
): Record<string, { node: string; input: string; file: string }> {
  const out: Record<string, { node: string; input: string; file: string }> = {};
  const ids = Object.keys(graph).sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const node = graph[id]!;
    for (const [input, role] of LOADER_INPUTS[node.class_type] ?? []) {
      const file = node.inputs[input];
      if (typeof file !== 'string') continue;
      let name = role;
      for (let n = 2; out[name]; n++) name = `${role}${n}`;
      out[name] = { node: id, input, file };
    }
  }
  return out;
}

/** The node classes a graph needs, for a check against the person's ComfyUI
 *  (`/object_info/<class>`) before a run. */
export function graphNodes(spec: GraphSpec): string[] {
  return [...new Set(Object.values(spec.graph).map((n) => n.class_type))].sort();
}

export interface GraphInput {
  prompt?: string;
  negative?: string;
  tags?: string;
  lyrics?: string;
  /** The uploaded picture's name in ComfyUI's input folder. */
  image?: string;
  mask?: string;
  seed?: number;
  seconds?: number;
}

/** A filled-in copy of a graph, ready to post. `files` swaps a loader's file
 *  for another size of the same family, by role; a role the graph does not
 *  have is refused, so a wrong catalog entry fails loudly, not oddly. */
export function buildGraph(
  spec: GraphSpec,
  input: GraphInput,
  files: Record<string, string> = {},
  random: () => number = Math.random,
): ApiGraph {
  const graph = structuredClone(spec.graph);
  const loaders = graphFiles(graph);
  for (const [role, file] of Object.entries(files)) {
    const at = loaders[role];
    if (!at) throw new Error(`This workflow has no ${role} file to swap.`);
    graph[at.node]!.inputs[at.input] = file;
  }
  const values: Record<GraphSlot, unknown> = {
    prompt: input.prompt ?? '',
    negative: input.negative ?? spec.defaults?.negative ?? '',
    tags: input.tags ?? input.prompt ?? '',
    lyrics: input.lyrics ?? '',
    image: input.image,
    mask: input.mask,
    seed: input.seed ?? Math.floor(random() * 2 ** 31),
    seconds: input.seconds ?? spec.defaults?.seconds ?? 10,
  };
  for (const [slot, places] of Object.entries(spec.placeholders) as Array<[GraphSlot, string[]]>) {
    const value = values[slot];
    if (value === undefined)
      throw new Error(`This workflow needs ${slot === 'image' ? 'a picture' : `a ${slot}`}.`);
    for (const place of places) {
      const dot = place.indexOf('.');
      const node = graph[place.slice(0, dot)];
      if (!node) throw new Error(`The workflow names a node it does not have (${place}).`);
      node.inputs[place.slice(dot + 1)] = value;
    }
  }
  return graph;
}

/** Whether a ComfyUI version string is at least `min` (both "x.y.z"). */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
