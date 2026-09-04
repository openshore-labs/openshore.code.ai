// The LLM Library intro: OpenShore's take on the house enablement pattern shared
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

function beatsFor(guideName: string): Beat[] {
  return [
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
      eyebrow: `Meet ${guideName}`,
      headline: 'Your first model is on its way.',
      body: `${guideName} is a guide, downloading now. It runs on your device, helps you get set up, and is built to be replaced by the bigger models you add.`,
      art: 'harbor',
    },
    {
      id: 'ready',
      eyebrow: 'Ready',
      headline: "Let's build your stack.",
      body: `${guideName} keeps downloading while you set up. When it lands, start chatting to shape your stack.`,
      art: 'ready',
      cta: 'Continue setup',
    },
  ];
}

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
  const { harborDownload, harborMiniDownload, settings } = useApp();
  // beginHarborWithIntro / beginHarborMiniWithIntro set the matching download
  // state synchronously before this ever mounts, so whichever is present (or,
  // once finished, whichever is not yet ready) tells us which guide this run
  // is for. Harbor is the default when neither has started yet.
  const isHarbor = Boolean(harborDownload) || (!harborMiniDownload && !settings.harborReady);
  const guideName = isHarbor ? 'Harbor' : 'Harbor Light';
  const guideDownload = isHarbor ? harborDownload : harborMiniDownload;
  const BEATS = beatsFor(guideName);
  const [beat, setBeat] = useState(0);
  const b = BEATS[beat]!;
  const isLast = beat === BEATS.length - 1;
  const advance = () => (isLast ? onDone() : setBeat((n) => n + 1));

  // On the guide/ready beats, show the live download so the user sees it
  // happening. A finished download reads as ready.
  const progressLabel =
    b.art === 'harbor' || b.art === 'ready'
      ? guideDownload && !guideDownload.failed
        ? guideDownload.label
        : undefined
      : undefined;

  return (
    <div className="lib-intro" role="dialog" aria-label="The Marketplace and your stack">
      <div className="lib-masthead">
        <span className="brand-lockup">
          <BrandMark size={24} />
          <span className="wordmark" style={{ fontSize: 16 }}>
            Open<span className="accent">Shore</span>
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
              Next{' '}
              <svg
                className="icon-inline"
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
