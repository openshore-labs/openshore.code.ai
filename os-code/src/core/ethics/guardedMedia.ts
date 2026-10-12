// The ethics layer for the media jobs (the model library, 2026-10-12): photo
// editing, video, voices, music and sound. The same two promises the image
// maker keeps (GuardedImageProvider), kept here for every new kind of output:
//
//   1. Every prompt a media job sends is screened first: an instruction to
//      edit a photo, a description of a clip or a sound, the words a voice
//      will say. A block stops the job before anything reaches the server.
//   2. Every picture a job makes carries provenance marking it AI-made. A
//      clip or a sound cannot be labeled in its own format here, so where the
//      consent gate's promise requires provenance (an authorized likeness),
//      a video or sound is refused with a plain reason rather than produced
//      unlabeled. A voice that copies a person's voice runs only on a model
//      whose own watermark marks every output (media/jobs.ts, cloneAllowed).
//
// The registry hands this out (ProviderRegistry.mediaGuard), so the media
// tools get it the way every model call gets its guard: by construction.
import { ethicsGuard, type EthicsGuard, type ScreenResult } from './chokepoint.js';
import { EthicsBlocked, type GuardContext } from './guardedProvider.js';
import { labelGeneratedImage } from './provenance.js';

export interface MediaScreen {
  /** The screened result, for labeling the output. */
  result: ScreenResult;
}

export class MediaGuard {
  constructor(
    private readonly context: GuardContext = {},
    private readonly guard: EthicsGuard = ethicsGuard(),
  ) {}

  /** Screen what a media job is about to send. Throws EthicsBlocked on a
   *  block, after reporting it. Local compute, like the image maker. */
  async screen(text: string): Promise<MediaScreen> {
    const consents = this.context.consents?.();
    const screened = await this.guard.screenInput({ text, modelPath: 'local', consents });
    if (screened.newAssertion) this.context.onAssertion?.(screened.newAssertion);
    if (screened.decision.action === 'block') {
      this.context.onBlock?.(screened);
      throw new EthicsBlocked(screened);
    }
    return { result: screened };
  }

  /** Label a picture a job made. A likeness that cannot be labeled is
   *  refused; an ordinary picture is returned as is if labeling is a no-op. */
  labelImage(
    bytes: Uint8Array,
    screen: MediaScreen,
    opts: { model: string; mediaType: string },
  ): Uint8Array {
    const requires = screen.result.decision.requiresProvenance === true;
    const labeled = labelGeneratedImage(bytes, {
      model: opts.model,
      modelPath: 'local',
      format: opts.mediaType,
      likenessSubject: requires ? screen.result.decision.subject : undefined,
    });
    if (requires && !labeled.embedded) {
      throw this.refuse(
        screen,
        `authorized likeness output could not be provenance-labeled (${labeled.reason})`,
      );
    }
    return labeled.embedded ? labeled.bytes : bytes;
  }

  /** A clip or a sound: there is no provenance label for its format here, so
   *  a likeness the consent gate allowed is refused rather than made. */
  checkUnlabeled(screen: MediaScreen, kind: 'video' | 'audio'): void {
    if (screen.result.decision.requiresProvenance === true) {
      throw this.refuse(
        screen,
        `authorized likeness ${kind} cannot carry provenance in this format`,
      );
    }
  }

  private refuse(screen: MediaScreen, reason: string): EthicsBlocked {
    const failed: ScreenResult = {
      decision: {
        action: 'block',
        tier: 2,
        category: 'likeness',
        reason,
        message:
          'This was allowed only with a provenance label, and this kind of output cannot carry one here, so it was not made.',
        signals: screen.result.decision.signals,
        subject: screen.result.decision.subject,
      },
    };
    this.context.onBlock?.(failed);
    return new EthicsBlocked(failed);
  }
}
