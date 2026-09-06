// Voice mode's pure core: shaping a streamed reply into speech, and the
// decision-break policy that keeps the conversation flowing where it is safe and
// hands you back to the screen where it matters. These run without a device, so
// the logic the founder cares about (where voice breaks, what it reads) is
// pinned even though the native synthesizer is only provable on TestFlight.
import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from 'os-code/protocol';
import type { ThreadItem } from '../src/state/types.js';
import { toSpeakable, nextSentenceEnd } from '../src/lib/voice/spoken.js';
import {
  VOICE_BREAK_POLICY,
  detectVoiceBreak,
  matchOption,
  planIntent,
  type VoiceThreadView,
} from '../src/lib/voice/voiceBreaks.js';
import { mapWebRate, pickDefaultVoice, voiceLabel, type Voice } from '../src/lib/voice/tts.js';

const thread = (
  items: ThreadItem[],
  pendingApprovals: ApprovalRequest[] = [],
): VoiceThreadView => ({
  items,
  pendingApprovals,
});

describe('toSpeakable', () => {
  it('drops markdown syntax but keeps the words', () => {
    expect(toSpeakable('**Bold** and _italic_ and `code`')).toBe('Bold and italic and code');
  });
  it('speaks link text, not the URL', () => {
    expect(toSpeakable('See [the docs](https://example.com/x) now')).toBe('See the docs now');
  });
  it('names a code block instead of reading it', () => {
    const out = toSpeakable('Here is how:\n```ts\nconst x = 1\n```\nDone.');
    expect(out).toContain('code block');
    expect(out).not.toContain('const x');
    expect(out).toContain('Done.');
  });
  it('strips heading and list markers', () => {
    expect(toSpeakable('## Title\n- one\n- two')).toBe('Title one two');
  });
});

describe('nextSentenceEnd', () => {
  it('finds a sentence end at a terminator followed by a space', () => {
    const t = 'Hello there. How are you';
    expect(nextSentenceEnd(t, 0)).toBe('Hello there.'.length);
  });
  it('returns -1 when no sentence has finished', () => {
    expect(nextSentenceEnd('Still going', 0)).toBe(-1);
  });
  it('does not split a decimal number', () => {
    // The only terminator is the period in 8.5, which is a decimal, so no end.
    expect(nextSentenceEnd('Version 8.5 is fine', 0)).toBe(-1);
  });
  it('does not split inside an unclosed code fence', () => {
    const t = 'Look:\n```\nconst y = 1. more code';
    expect(nextSentenceEnd(t, 0)).toBe('Look:\n'.length);
    // Past the newline, the period is inside the open fence, so no further end.
    expect(nextSentenceEnd(t, 'Look:\n'.length)).toBe(-1);
  });
  it('ends a chunk on a newline so a heading stands alone', () => {
    expect(nextSentenceEnd('Title\nnext', 0)).toBe('Title\n'.length);
  });
});

describe('detectVoiceBreak', () => {
  it('is null when nothing is pending', () => {
    expect(
      detectVoiceBreak(thread([{ kind: 'assistant', id: 'a', text: 'hi', streaming: false }])),
    ).toBeNull();
  });

  it('reads a plan and stays in voice', () => {
    const b = detectVoiceBreak(
      thread([{ kind: 'plan', id: 'p', text: 'do things', status: 'proposed' }]),
    );
    expect(b?.kind).toBe('plan');
    expect(b?.where).toBe('voice');
  });

  it('does not break on an already-approved plan', () => {
    expect(
      detectVoiceBreak(thread([{ kind: 'plan', id: 'p', text: 'x', status: 'approved' }])),
    ).toBeNull();
  });

  it('reads a clarify question and offers its options in voice', () => {
    const b = detectVoiceBreak(
      thread([
        {
          kind: 'clarify',
          id: 'c',
          summary: 'One thing first.',
          questions: [{ id: 'q1', question: 'Which target?', options: ['iOS', 'Android'] }],
        },
      ]),
    );
    expect(b?.kind).toBe('clarify');
    expect(b?.where).toBe('voice');
    expect(b?.options).toEqual(['iOS', 'Android']);
    expect(b?.say).toContain('Which target?');
  });

  it('breaks to the screen for a tool approval', () => {
    const approval: ApprovalRequest = {
      id: 'r1',
      kind: 'tool',
      toolName: 'runShell',
      risk: 'medium',
      summary: 'run npm test',
    };
    const b = detectVoiceBreak(thread([], [approval]));
    expect(b?.kind).toBe('approval-tool');
    expect(b?.where).toBe('screen');
  });

  it('breaks to the screen for cloud spend', () => {
    const approval: ApprovalRequest = {
      id: 'r2',
      kind: 'cloud-spend',
      toolName: 'claude',
      risk: 'low',
      summary: 'spend about $0.40',
    };
    const b = detectVoiceBreak(thread([], [approval]));
    expect(b?.kind).toBe('approval-spend');
    expect(b?.where).toBe('screen');
  });

  it('prefers an approval over a trailing card', () => {
    const approval: ApprovalRequest = {
      id: 'r3',
      kind: 'tool',
      toolName: 'runShell',
      risk: 'low',
      summary: 'ls',
    };
    const b = detectVoiceBreak(
      thread([{ kind: 'plan', id: 'p', text: 'x', status: 'proposed' }], [approval]),
    );
    expect(b?.kind).toBe('approval-tool');
  });

  it('breaks to the screen when the turn stopped', () => {
    const b = detectVoiceBreak(thread([{ kind: 'stopped', id: 's', message: 'Out of context.' }]));
    expect(b?.kind).toBe('stopped');
    expect(b?.where).toBe('screen');
  });
});

describe('the break policy is the one table', () => {
  it('keeps clarify and plan in voice, authorizations and selection on screen', () => {
    expect(VOICE_BREAK_POLICY.clarify).toBe('voice');
    expect(VOICE_BREAK_POLICY.plan).toBe('voice');
    expect(VOICE_BREAK_POLICY['approval-tool']).toBe('screen');
    expect(VOICE_BREAK_POLICY['approval-spend']).toBe('screen');
    expect(VOICE_BREAK_POLICY.stopped).toBe('screen');
  });
});

describe('matchOption', () => {
  const opts = ['Use iOS', 'Use Android'];
  it('matches a near-quote of an option', () => {
    expect(matchOption('use ios', opts)).toBe('Use iOS');
  });
  it('matches an ordinal', () => {
    expect(matchOption('the second one', opts)).toBe('Use Android');
  });
  it('returns null to send verbatim when nothing matches', () => {
    expect(matchOption('actually something else entirely', opts)).toBeNull();
  });
  it('returns null with no options', () => {
    expect(matchOption('anything', undefined)).toBeNull();
  });
});

describe('planIntent', () => {
  it('reads a go-ahead as approve', () => {
    expect(planIntent('yeah go ahead')).toBe('approve');
    expect(planIntent('start building')).toBe('approve');
  });
  it('reads a hesitation as revise', () => {
    expect(planIntent('wait, change the second step')).toBe('revise');
    expect(planIntent('no')).toBe('revise');
  });
  it('is null when unclear', () => {
    expect(planIntent('what does the third step do')).toBeNull();
  });
});

describe('tts helpers', () => {
  it('maps the normalized rate so 0.5 is natural', () => {
    expect(mapWebRate(0.5)).toBe(1);
    expect(mapWebRate(0)).toBe(0.5);
    expect(mapWebRate(1)).toBe(2);
  });
  it('labels a premium voice with its tier', () => {
    expect(voiceLabel({ id: 'v', name: 'Ava', lang: 'en-US', quality: 'premium' })).toBe(
      'Ava (Premium)',
    );
    expect(voiceLabel({ id: 'v', name: 'Sam', lang: 'en-US', quality: 'default' })).toBe('Sam');
  });
  it('picks a default voice matching the language, best quality first', () => {
    const voices: Voice[] = [
      { id: 'de', name: 'Anna', lang: 'de-DE', quality: 'premium' },
      { id: 'en1', name: 'Ava', lang: 'en-US', quality: 'premium' },
      { id: 'en2', name: 'Sam', lang: 'en-GB', quality: 'default' },
    ];
    expect(pickDefaultVoice(voices, 'en-US')?.id).toBe('en1');
    expect(pickDefaultVoice([], 'en-US')).toBeUndefined();
  });
});
