// Tenet 9: a shell command never lands in a toast. The engine now puts a
// command on its own paragraph after the sentence; the app splits it out and
// renders a card with a copy block. An older engine's inline form ("Install it
// first: curl ...") is still recognized, so no build regresses to a toast.
import { describe, expect, it } from 'vitest';
import { splitCommandDetail } from '../src/lib/commandDetail.js';

describe('splitCommandDetail', () => {
  it('splits a trailing command paragraph from the message', () => {
    const r = splitCommandDetail(
      'Could not run ollama. Install it first.\n\ncurl -fsSL https://ollama.com/install.sh | sh',
    );
    expect(r).toEqual({
      message: 'Could not run ollama. Install it first.',
      command: 'curl -fsSL https://ollama.com/install.sh | sh',
    });
  });

  it('recognizes the older inline form', () => {
    const r = splitCommandDetail(
      'Could not run ollama. Install it first: curl -fsSL https://ollama.com/install.sh | sh',
    );
    expect(r.command).toBe('curl -fsSL https://ollama.com/install.sh | sh');
    expect(r.message).toBe('Could not run ollama. Install it first.');
  });

  it('pulls "ollama serve" out of the connect hint', () => {
    const r = splitCommandDetail(
      'Nothing is answering at http://localhost:11434. If this is Ollama, start it.\n\nollama serve',
    );
    expect(r.command).toBe('ollama serve');
    expect(r.message).toBe(
      'Nothing is answering at http://localhost:11434. If this is Ollama, start it.',
    );
  });

  it('leaves a plain sentence alone', () => {
    const r = splitCommandDetail('qwen2.5-coder:3b is pulled and ready.');
    expect(r).toEqual({ message: 'qwen2.5-coder:3b is pulled and ready.' });
  });

  it('never mistakes a model ref in prose for a command', () => {
    const r = splitCommandDetail('Ollama could not pull qwen3:8b: model not found');
    expect(r.command).toBeUndefined();
  });
});
