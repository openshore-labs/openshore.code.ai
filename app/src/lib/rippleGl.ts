// Slack Water's surface (components/SlackWater.tsx, docs/slack-water.md): one
// full-screen fragment shader draws clear water over the whole app. Where the
// water is still it draws nothing; where a ring passes it draws only light and
// shade, the way a pond's surface lights and shades the floor under it, so the
// app reads as the bottom of the pond. lib/slackWater.ts decides where the water
// is at each moment (waterFrame); this file only draws it on the GPU.

import type { WaterFrame } from './slackWater.js';

/** The light on a crest and the shade in a trough, each with its strongest
 *  alpha. Read from the theme (waterInk) so it follows light and dark. */
export interface WaterInk {
  glint: [number, number, number];
  glintAlpha: number;
  shade: [number, number, number];
  shadeAlpha: number;
}

export interface RippleRenderer {
  draw(frame: WaterFrame): void;
  dispose(): void;
}

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// The height of the water at a radius: the train behind its leading crest (a
// soft rise, a long decay, crests drifting back through it), weakened as the
// ring spreads, plus the touch's dimple. Light comes from the slope (the side
// of a ring facing the upper left is lit, as the app's shadows fall) and from
// the curvature (a crest gathers light, a trough spreads it thin).
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_size;
uniform float u_px;
uniform vec2 u_origin;
uniform float u_reach;
uniform float u_front;
uniform float u_lambda;
uniform float u_train;
uniform float u_phase;
uniform float u_amp;
uniform float u_dip;
uniform vec3 u_glint;
uniform float u_glintA;
uniform vec3 u_shade;
uniform float u_shadeA;

const float TAU = 6.2831853;

float height(float r) {
  float s = u_front - r;
  float train = 0.0;
  if (s > 0.0) {
    float rise = 1.0 - exp(-s / (0.14 * u_train));
    float fall = exp(-s / (0.38 * u_train));
    train = 1.9 * rise * fall * sin(TAU * s / u_lambda - u_phase);
  }
  float spread = inversesqrt(1.0 + r / (0.25 * u_reach));
  float dimple = -u_dip * exp(-(r * r) / 900.0);
  return u_amp * spread * train + 0.6 * dimple;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_px;
  vec2 d = p - u_origin;
  float r = length(d);
  float e = 1.5;
  float h0 = height(r);
  float hi = height(r + e);
  float lo = height(max(r - e, 0.0));
  float k = u_lambda / TAU;
  float slope = (hi - lo) / (2.0 * e) * k;
  float curve = (hi - 2.0 * h0 + lo) / (e * e) * k * k;
  vec2 dir = r > 0.5 ? d / r : vec2(0.0);
  float facing = dot(dir, vec2(-0.5446, -0.8387));
  float v = clamp(-0.75 * curve - 0.55 * slope * facing, -1.0, 1.0);
  float glint = max(v, 0.0);
  glint = glint * (0.65 + 0.35 * glint);
  float shade = max(-v, 0.0);
  float a = glint * u_glintA + shade * u_shadeA;
  vec3 c = glint * u_glintA * u_glint + shade * u_shadeA * u_shade;
  gl_FragColor = vec4(c, a);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Start the water on a canvas that covers the window. Null when this device
 *  cannot draw it (no WebGL, a lost context, a shader that will not build);
 *  the caller falls back to the CSS crests. */
export function createRippleRenderer(
  canvas: HTMLCanvasElement,
  opts: { x: number; y: number; reach: number; ink: WaterInk },
): RippleRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  // Twice the CSS pixel at most: the water is soft, so a 3x phone gains
  // nothing it can see from the third, and pays for it every frame.
  const px = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const w = Math.max(1, Math.round(window.innerWidth * px));
  const h = Math.max(1, Math.round(window.innerHeight * px));
  canvas.width = w;
  canvas.height = h;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // One triangle that covers the screen.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl!.getUniformLocation(program, name);
  const at = {
    front: u('u_front'),
    lambda: u('u_lambda'),
    train: u('u_train'),
    phase: u('u_phase'),
    amp: u('u_amp'),
    dip: u('u_dip'),
  };
  gl.uniform2f(u('u_size'), w, h);
  gl.uniform1f(u('u_px'), w / Math.max(1, window.innerWidth));
  gl.uniform2f(u('u_origin'), opts.x, opts.y);
  gl.uniform1f(u('u_reach'), opts.reach);
  gl.uniform3f(u('u_glint'), ...opts.ink.glint);
  gl.uniform1f(u('u_glintA'), opts.ink.glintAlpha);
  gl.uniform3f(u('u_shade'), ...opts.ink.shade);
  gl.uniform1f(u('u_shadeA'), opts.ink.shadeAlpha);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);

  let gone = false;
  return {
    draw(f) {
      if (gone || !gl || gl.isContextLost()) return;
      gl.uniform1f(at.front, f.front);
      gl.uniform1f(at.lambda, f.lambda);
      gl.uniform1f(at.train, f.train);
      gl.uniform1f(at.phase, f.phase);
      gl.uniform1f(at.amp, f.amp);
      gl.uniform1f(at.dip, f.dip);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      if (gone || !gl) return;
      gone = true;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Hand the context back now rather than at garbage collection: a
      // WebView keeps only a few alive.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/** A colour token from the stylesheet as 0..1 channels, or undefined. */
function tokenRgb(style: CSSStyleDeclaration, name: string): [number, number, number] | undefined {
  const raw = style.getPropertyValue(name).trim();
  const hex = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = raw.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return undefined;
}

/** The water's light and shade for the current theme: on paper the shade of
 *  deep water carries the rings and the light is a bright sheen; at night the
 *  pale water light carries them and the shade is the dark below. */
export function waterInk(): WaterInk {
  const style = getComputedStyle(document.documentElement);
  const bg = tokenRgb(style, '--bg') ?? [0.965, 0.957, 0.937];
  const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  if (lum < 0.4) {
    return {
      glint: tokenRgb(style, '--current-4') ?? [0.659, 0.867, 0.914],
      glintAlpha: 0.42,
      shade: [0, 0, 0],
      shadeAlpha: 0.5,
    };
  }
  return {
    glint: [1, 1, 1],
    glintAlpha: 0.95,
    shade: tokenRgb(style, '--current-2') ?? [0.184, 0.353, 0.4],
    shadeAlpha: 0.24,
  };
}
