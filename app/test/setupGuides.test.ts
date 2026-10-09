// Guided setup chats open with the goal, the numbered plan, and how to know it
// worked, so a person can act on step one immediately. Pin that shape.
import { describe, expect, it } from 'vitest';
import { SETUP_GUIDES, guideOpening } from '../src/lib/setupGuides.js';
import { BYOM_FORWARDS_NAME } from '../src/lib/byom.js';
import { VAULT_PRIVATE_OFF_MARKED } from '../src/lib/vaultCopy.js';

describe('setup guides', () => {
  it('every guide has a goal, at least three one-action steps, and a done line', () => {
    for (const g of Object.values(SETUP_GUIDES)) {
      expect(g.goal.length, g.id).toBeGreaterThan(10);
      expect(g.steps.length, g.id).toBeGreaterThanOrEqual(3);
      expect(g.done.length, g.id).toBeGreaterThan(10);
    }
  });

  it('the opening names the goal, numbers every step, and asks for step one', () => {
    for (const g of Object.values(SETUP_GUIDES)) {
      const text = guideOpening(g);
      expect(text).toContain(g.goal);
      g.steps.forEach((_, i) => expect(text).toContain(`${i + 1}. `));
      expect(text).toContain(g.done);
      expect(text).toMatch(/step 1/i);
    }
  });
});

// Bring your own keys, Part 4 (founder, 2026-10-09): Bedrock, Azure and Vertex
// come through a gateway the person runs, with their own keys, connected at
// its address with the mark on. OpenShore runs nothing.
describe('the own-gateway guide', () => {
  const g = SETUP_GUIDES['connect-own-gateway']!;
  const all = [
    g.goal,
    ...g.steps.map((s) => (typeof s === 'string' ? s : `${s.text} ${s.paste}`)),
    g.done,
  ].join(' ');

  it('is titled plainly, for the three that sign in their own way', () => {
    expect(g.title).toBe('Use Bedrock, Azure, or Vertex');
    for (const name of ['Bedrock', 'Azure', 'Vertex']) expect(all).toContain(name);
  });

  it("is the person's own gateway and keys, with LiteLLM's quick start", () => {
    expect(all).toContain('https://docs.litellm.ai/docs/proxy/quick_start');
    expect(all).toContain('OpenShore runs nothing here and never sees those keys.');
  });

  // LiteLLM listens on 0.0.0.0 by default, which on a rented server is the
  // open internet, so the gateway is started on the Tailscale address alone
  // (docking's rule: the tailnet only, never a public bind), behind a long
  // random master key (review, 2026-10-09).
  const pastes = g.steps.flatMap((s) => (typeof s === 'string' ? [] : [s.paste]));

  it('starts the gateway on its Tailscale address only, never every network', () => {
    expect(pastes).toContain('tailscale ip -4');
    expect(pastes).toContain('litellm --config config.yaml --host 100.x.y.z');
    for (const p of pastes) {
      if (p.startsWith('litellm ')) expect(p).toMatch(/--host 100\.x\.y\.z$/);
      expect(p).not.toContain('0.0.0.0');
    }
    expect(all).toContain('on a rented server that is the open internet');
  });

  it('asks for a long random master key, written into a config to paste', () => {
    expect(pastes).toContain('echo "sk-$(openssl rand -hex 24)"');
    const config = pastes.find((p) => p.startsWith('model_list:'))!;
    expect(config).toContain('model: bedrock/');
    expect(config).toContain('general_settings:\n  master_key: sk-your-master-key');
    expect(all).not.toContain('sk-1234');
    // The master key is the gateway's admin key: said so, with the narrower
    // key where LiteLLM can make one.
    expect(all).toContain("It is the gateway's admin key");
    expect(all).toContain('a virtual key limited to these models');
  });

  it('connects it in the Stack at its address, either format, with the mark on', () => {
    expect(all).toContain('Connect a model');
    expect(all).toContain('`http://100.x.y.z:4000/v1`');
    expect(all).toContain('Pick either format');
    expect(all).toContain(`turn on ${BYOM_FORWARDS_NAME}`);
    expect(g.done).toContain(VAULT_PRIVATE_OFF_MARKED);
  });
});
