// Slack Water (Creative Studio, 2026-10-01; the third pass 2026-10-02;
// docs/slack-water.md): the one-time transition from the setup walk's chat to
// the main chat page when the person chooses to just chat. Where they tapped
// the surface dips, then a train of ripples crosses the app itself.
//
// On a phone or the desktop the shell pictures the screen first, and that
// picture becomes the floor of the pond: the rings bend every word and button
// in it the way real water does (lib/rippleGl.ts), the main chat page goes in
// underneath at once (with one soft tick), and the calm water behind the train
// opens onto it while the greeting lands. Where nothing can picture the screen
// (the plain web), the room's own blocks heave as each crest passes and the
// old chat thins away before the swap; a device whose GPU cannot draw the
// water gets the CSS crests. The room moves on transform and opacity only,
// through the Web Animations API on the tokens' clocks and curves. Reduced
// motion never mounts it (the store lands on the greeting directly).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../state/store.js';
import { hapticTick } from '../lib/haptics.js';
import { durationMs, easing } from '../lib/motion.js';
import { createRippleRenderer, waterInk } from '../lib/rippleGl.js';
import { captureScreen } from '../lib/screenSnapshot.js';
import {
  REFRACT_PX,
  SNAPSHOT_WAIT_MS,
  HEAVE_KEYS,
  HEAVE_MS,
  SWAP_BACKSTOP_MS,
  WATER_MS,
  heaveFor,
  revealRadius,
  slackWaterGeometry,
  thinAtMs,
  waterFrame,
} from '../lib/slackWater.js';

/** The chat room the water crosses: the screen under the room's fade. */
function chatRoom(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.room-swap > .shell-main');
}

/** The blocks that heave: the header's slots, each paragraph-sized piece of
 *  the transcript, and the composer, as far as they are on screen. */
function roomBlocks(room: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const add = (el: Element | null) => {
    if (el instanceof HTMLElement) out.push(el);
  };
  room.querySelectorAll('.topbar > *').forEach(add);
  room.querySelectorAll('.thread-inner > *').forEach((item) => {
    const blocks = item.querySelectorAll('.md > *');
    if (blocks.length) blocks.forEach(add);
    else add(item);
  });
  add(room.querySelector('.composer'));
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return out.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  });
}

/** Each block heaves as the train passes under it: out from the tap with the
 *  crest, back through the trough, settling, stretched a hair along the line
 *  from the tap by the crest's lens. Added to whatever transform it wears. */
function heaveRoom(
  room: HTMLElement,
  x: number,
  y: number,
  reach: number,
): Map<Element, Animation> {
  const heaves = new Map<Element, Animation>();
  const curve = easing('--ease-loop', 'cubic-bezier(0.45, 0, 0.55, 1)');
  for (const el of roomBlocks(room)) {
    if (typeof el.animate !== 'function') break;
    const box = el.getBoundingClientRect();
    const dx = box.left + box.width / 2 - x;
    const dy = box.top + box.height / 2 - y;
    const d = Math.hypot(dx, dy);
    const ux = d > 1 ? dx / d : 0;
    const uy = d > 1 ? dy / d : 1;
    const turn = (Math.atan2(uy, ux) * 180) / Math.PI;
    const { delay, px } = heaveFor(d, reach);
    const keys = HEAVE_KEYS.map((k) => ({
      offset: k.at,
      easing: curve,
      transform:
        `translate(${(ux * k.push * px).toFixed(2)}px, ${(uy * k.push * px).toFixed(2)}px) ` +
        `rotate(${turn.toFixed(1)}deg) scale(${(1 + k.stretch).toFixed(4)}, 1) rotate(${(-turn).toFixed(1)}deg)`,
    }));
    heaves.set(el, el.animate(keys, { duration: HEAVE_MS, delay, composite: 'add' }));
  }
  return heaves;
}

export function SlackWater() {
  const water = useApp((s) => s.slackWater);
  const covered = useApp((s) => s.slackWaterCovered);
  const end = useApp((s) => s.endSlackWater);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The CSS crests, for the play whose water the GPU could not draw.
  const [crestsFor, setCrestsFor] = useState<number>();
  const thinning = useRef<Animation[]>([]);
  const heaves = useRef(new Map<Element, Animation>());
  const ticked = useRef(0);
  // The play whose water bends a picture of the screen: the page under it is
  // already the new one, so it needs no surfacing, and the overlay holds taps
  // until the water is still, since the picture is not what is underneath.
  const floored = useRef<number>();
  const seq = water?.seq;
  const phase = water?.phase;

  const geometry = useMemo(() => {
    if (!water) return undefined;
    return slackWaterGeometry(water.x, water.y, window.innerWidth, window.innerHeight);
    // The geometry is fixed for one play: its origin and the window it began in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // The play. First the shell pictures the screen (a few dozen milliseconds
  // on a phone); with that picture as the pond's floor, the old chat is swapped
  // for the new page underneath at once, the rings bend the picture as they
  // cross it, and the calm water behind them opens onto the page. Without a
  // picture (the plain web, a slow or failed snapshot) the room's own blocks
  // heave instead and the old chat thins away before the swap. Every step is
  // on a clock, so a backgrounded WebView only ever runs late, never strands
  // anyone.
  useEffect(() => {
    const w = useApp.getState().slackWater;
    if (seq === undefined || !w || !geometry) return;
    const reach = geometry.reach;
    const renderer = canvas.current
      ? createRippleRenderer(canvas.current, {
          x: w.x,
          y: w.y,
          reach,
          ink: waterInk(),
          refract: REFRACT_PX,
        })
      : null;
    if (!renderer) setCrestsFor(seq);
    let raf = 0;
    let live = true;
    const timers: number[] = [];

    const play = (floor: HTMLImageElement | undefined) => {
      if (!live) return;
      const start = performance.now();
      const glass = Boolean(renderer && floor);
      const draw = () => {
        const t = performance.now() - start;
        renderer?.draw(waterFrame(t, reach), glass ? revealRadius(t, reach) : 0);
        if (t < WATER_MS) raf = requestAnimationFrame(draw);
      };
      if (glass && renderer && floor) {
        floored.current = seq;
        renderer.setFloor(floor);
        // The picture covers the screen in this very frame, so the new page
        // can go in under it now.
        draw();
        covered();
      } else {
        if (renderer) raf = requestAnimationFrame(draw);
        const room = chatRoom();
        heaves.current = room ? heaveRoom(room, w.x, w.y, reach) : new Map();
        const thinAt = thinAtMs(reach);
        const thinMs = durationMs('--dur-7', 520);
        const glide = easing('--ease-glide', 'cubic-bezier(0.3, 0.1, 0.15, 1)');
        thinning.current = [];
        for (const el of room?.querySelectorAll<HTMLElement>('.chat-body, .topbar-title') ?? []) {
          if (typeof el.animate !== 'function') continue;
          thinning.current.push(
            el.animate([{ opacity: 1 }, { opacity: 0 }], {
              duration: thinMs,
              delay: thinAt,
              easing: glide,
              fill: 'forwards',
            }),
          );
        }
        timers.push(window.setTimeout(covered, Math.min(SWAP_BACKSTOP_MS, thinAt + thinMs + 20)));
      }
      // Still water: the overlay goes. The swap first, in case its clock was late.
      timers.push(
        window.setTimeout(() => {
          covered();
          end();
        }, WATER_MS),
      );
    };
    // The picture is taken before anything is drawn, so it is the app alone.
    if (renderer) void captureScreen(SNAPSHOT_WAIT_MS).then(play);
    else play(undefined);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      for (const t of timers) window.clearTimeout(t);
      renderer?.dispose();
    };
    // One play per sequence; the store's actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // The swap has landed (the store started the new chat in the same commit):
  // the old chat is gone under the water, so the new page surfaces, its
  // header slot and composer with it, and the greeting lands on its own swell
  // (ChatScreen holds it a beat first). Before paint, so nothing flashes.
  useLayoutEffect(() => {
    if (seq === undefined || phase !== 'clearing') return;
    if (ticked.current !== seq) {
      ticked.current = seq;
      hapticTick();
    }
    for (const a of thinning.current) a.cancel();
    thinning.current = [];
    if (floored.current === seq) return;
    const room = chatRoom();
    if (!room) return;
    const composer = room.querySelector('.composer');
    if (composer) heaves.current.get(composer)?.cancel();
    const clock = durationMs('--dur-7', 520);
    const glide = easing('--ease-glide', 'cubic-bezier(0.3, 0.1, 0.15, 1)');
    for (const el of room.querySelectorAll<HTMLElement>(
      '.chat-body, .topbar-spacer, .topbar-title',
    )) {
      if (typeof el.animate !== 'function') continue;
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: clock,
        easing: glide,
        fill: 'backwards',
      });
    }
    if (composer instanceof HTMLElement && typeof composer.animate === 'function') {
      composer.animate([{ transform: 'translateY(10px)' }, { transform: 'translateY(0)' }], {
        duration: clock,
        delay: durationMs('--dur-1', 120),
        easing: glide,
        fill: 'backwards',
        composite: 'add',
      });
    }
  }, [seq, phase]);

  const style = useMemo(() => {
    if (!water || !geometry) return undefined;
    return {
      '--slack-x': `${water.x}px`,
      '--slack-y': `${water.y}px`,
      '--slack-ring': `${geometry.ring}px`,
    } as CSSProperties;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  if (!water) return null;
  const crests = crestsFor === water.seq;
  return (
    <div
      key={water.seq}
      className={`slack-water${water.phase === 'clearing' && floored.current !== water.seq ? ' clearing' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {crests ? (
        <>
          <span className="slack-dip" />
          <span className="slack-ring a" />
          <span className="slack-ring b" />
          <span className="slack-ring c" />
        </>
      ) : (
        <canvas ref={canvas} className="slack-surface" />
      )}
    </div>
  );
}
