// The LLM Library intro: OS Code's take on the house enablement pattern shared
// with Uki. A short, self-paced full-screen sequence, eyebrow -> serif headline
// -> benefit body over a dark caption dock, that explains the Library and the
// stack and introduces Harbor while it downloads. It ends by returning the user
// to setup, with the download continuing in the background.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { BrandMark } from './BrandMark.js';

interface Beat {
  id: string;
  eyebrow: string;
  headline: string;
  body: string;
  art: 'library' | 'stack' | 'harbor' | 'ready';
  cta?: string;
}

const BEATS: Beat[] = [
  {
    id: 'library',
    eyebrow: 'The Marketplace',
    headline: 'Every model, in plain language.',
    body: 'The Marketplace is where you choose the models you own. Each one downloads straight from its source and runs on your hardware, never ours.',
    art: 'library',
  },
  {
    id: 'stack',
    eyebrow: 'Your stack',
    headline: 'One quarterback, a few specialists.',
    body: 'You build a stack. One model plans and routes the work; optional specialists take coding, writing, vision, and more. Anything missing, the quarterback covers itself.',
    art: 'stack',
  },
  {
    id: 'harbor',
    eyebrow: 'Meet Harbor',
    headline: 'Your first model is on its way.',
    body: 'Harbor is a small guide, downloading now. It runs on your device, helps you get set up, and is built to be replaced by the bigger models you add.',
    art: 'harbor',
  },
  {
    id: 'ready',
    eyebrow: 'Ready',
    headline: "Let's build your stack.",
    body: 'Harbor keeps downloading while you set up. When it lands, start chatting to shape your OS Code.',
    art: 'ready',
    cta: 'Continue setup',
  },
];

function StageArt({ art, label }: { art: Beat['art']; label?: string }) {
  if (art === 'library') {
    return (
      <div className="lib-art">
        <div className="lib-art-tiles">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }
  if (art === 'stack') {
    return (
      <div className="lib-art">
        <div className="lib-art-qb">QB</div>
        <div className="lib-art-specialists">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }
  // harbor + ready: the wave-mark, with the live download underneath.
  return (
    <div className="lib-art">
      <BrandMark size={96} />
      {label ? (
        <div className="lib-art-progress">
          <div className="progress-track">
            <div className="progress-fill indeterminate" />
          </div>
          <div className="hint" style={{ marginTop: 6, textAlign: 'center' }}>
            {label}
          </div>
        </div>
      ) : (
        <div className="hint">On your device. Offline once it lands.</div>
      )}
    </div>
  );
}

export function LibraryIntro({ onDone }: { onDone: () => void }) {
  const { harborDownload } = useApp();
  const [beat, setBeat] = useState(0);
  const b = BEATS[beat]!;
  const isLast = beat === BEATS.length - 1;
  const advance = () => (isLast ? onDone() : setBeat((n) => n + 1));

  // On the Harbor/ready beats, show the live download so the user sees it
  // happening. A finished download reads as ready.
  const progressLabel =
    b.art === 'harbor' || b.art === 'ready'
      ? harborDownload && !harborDownload.failed
        ? harborDownload.label
        : undefined
      : undefined;

  return (
    <div className="lib-intro" role="dialog" aria-label="The Marketplace and your stack">
      <div className="lib-masthead">
        <span className="brand-lockup">
          <BrandMark size={24} />
          <span className="wordmark" style={{ fontSize: 16 }}>
            <span className="accent">OS</span> Code
          </span>
        </span>
        {!isLast ? (
          <button className="lib-skip" onClick={onDone}>
            Skip
          </button>
        ) : null}
      </div>

      <div className="lib-stage" onClick={isLast ? undefined : advance}>
        <StageArt art={b.art} label={progressLabel} />
      </div>

      <div className="lib-dock">
        <div className="lib-caption" key={beat}>
          <div className="lib-eyebrow">{b.eyebrow}</div>
          <div className="lib-headline">{b.headline}</div>
          <div className="lib-body">{b.body}</div>
        </div>
        {isLast ? (
          <button className="lib-cta" onClick={onDone}>
            {b.cta}
          </button>
        ) : (
          <div className="lib-foot">
            <div className="lib-pager">
              {BEATS.map((_, i) => (
                <span key={i} className={`lib-dot${i === beat ? ' active' : ''}`} />
              ))}
            </div>
            <button className="lib-next" onClick={advance}>
              Next <span aria-hidden>{'→'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
