// The speech server: transcription, who said what, and voices, in the OpenAI
// audio format (the model library, 2026-10-12). LocalAI is the one OpenShore
// recommends, since it serves every pick in the Transcription and Voice
// shelves and fetches a model when asked; any server that answers the two
// OpenAI routes works for transcription and reading aloud.
//
// The routes it calls, and nothing else:
//   POST /v1/audio/transcriptions   multipart: file, model, language,
//                                   response_format (the OpenAI shape)
//   POST /v1/audio/diarization      multipart: file, model, include_text,
//                                   min_speakers, max_speakers (LocalAI's own)
//   POST /v1/audio/speech           JSON: model, input, voice, response_format
//   GET  /v1/models                 the health check
//   POST /models/apply, GET /models/jobs/<uuid>   LocalAI fetching a model
//                                   from its own gallery, on Get
//
// It talks only to the address the person set (media.speech.baseUrl, machine
// config); every request goes there and nowhere else.

export interface SpeechClientOptions {
  baseUrl: string;
  /** The server's key, when it wants one (LocalAI is deny-by-default). */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** How long one request may take before it is given up, in ms. */
  timeoutMs?: number;
}

export type TranscriptFormat = 'text' | 'srt' | 'vtt';

export interface SpeakerLine {
  speaker: string;
  start?: number;
  end?: number;
  text: string;
}

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SpeechError';
  }
}

export class SpeechClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: SpeechClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10 * 60_000;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.options.apiKey
      ? { authorization: `Bearer ${this.options.apiKey}`, ...extra }
      : extra;
  }

  private signal(outer?: AbortSignal): AbortSignal {
    const own = AbortSignal.timeout(this.timeoutMs);
    return outer ? AbortSignal.any([own, outer]) : own;
  }

  private async fail(res: Response, what: string): Promise<never> {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {}
    if (res.status === 401 || res.status === 403) {
      throw new SpeechError(
        `The speech server turned the request down (${res.status}). If it asks for a key, set its key variable in Stack, Media servers.`,
        res.status,
      );
    }
    throw new SpeechError(`${what} failed: ${res.status}${detail ? ` ${detail}` : ''}`, res.status);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { ok: false, detail: `The speech server answered ${res.status}.` };
      return { ok: true, detail: `The speech server is up at ${this.baseUrl}` };
    } catch {
      return {
        ok: false,
        detail: `No speech server at ${this.baseUrl}. Start it, or take the job out of your Stack.`,
      };
    }
  }

  /** Speech to text. Returns the transcript as plain text, or as subtitles. */
  async transcribe(input: {
    audio: Uint8Array;
    filename: string;
    model: string;
    language?: string;
    format?: TranscriptFormat;
    signal?: AbortSignal;
  }): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([input.audio]), input.filename);
    form.append('model', input.model);
    if (input.language) form.append('language', input.language);
    form.append('response_format', input.format ?? 'text');
    const res = await this.fetchImpl(`${this.baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: this.signal(input.signal),
    });
    if (!res.ok) return this.fail(res, 'Transcription');
    const body = await res.text();
    // A server that ignores response_format=text answers JSON with a text field.
    if ((input.format ?? 'text') === 'text') {
      try {
        const json = JSON.parse(body) as { text?: unknown };
        if (typeof json.text === 'string') return json.text;
      } catch {}
    }
    return body;
  }

  /** Who said what: each speaker's turns, with the words when the server
   *  gives them. LocalAI's own route; a server without it answers 404. */
  async diarize(input: {
    audio: Uint8Array;
    filename: string;
    model: string;
    minSpeakers?: number;
    maxSpeakers?: number;
    signal?: AbortSignal;
  }): Promise<SpeakerLine[]> {
    const form = new FormData();
    form.append('file', new Blob([input.audio]), input.filename);
    form.append('model', input.model);
    form.append('include_text', 'true');
    form.append('response_format', 'json');
    if (input.minSpeakers) form.append('min_speakers', String(input.minSpeakers));
    if (input.maxSpeakers) form.append('max_speakers', String(input.maxSpeakers));
    const res = await this.fetchImpl(`${this.baseUrl}/v1/audio/diarization`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: this.signal(input.signal),
    });
    if (res.status === 404) {
      throw new SpeechError(
        'This speech server has no way to tell speakers apart. LocalAI does; transcription still works here.',
        404,
      );
    }
    if (!res.ok) return this.fail(res, 'Telling the speakers apart');
    return speakerLines(await res.json());
  }

  /** Text to speech. Returns the audio bytes. */
  async speak(input: {
    text: string;
    model: string;
    voice?: string;
    format?: 'mp3' | 'wav';
    signal?: AbortSignal;
  }): Promise<{ audio: Uint8Array; mediaType: string }> {
    const format = input.format ?? 'mp3';
    const res = await this.fetchImpl(`${this.baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: input.model,
        input: input.text,
        ...(input.voice ? { voice: input.voice } : {}),
        response_format: format,
      }),
      signal: this.signal(input.signal),
    });
    if (!res.ok) return this.fail(res, 'Reading aloud');
    const audio = new Uint8Array(await res.arrayBuffer());
    if (audio.byteLength === 0) throw new SpeechError('The speech server returned no audio.');
    return {
      audio,
      mediaType: res.headers.get('content-type') ?? `audio/${format === 'mp3' ? 'mpeg' : 'wav'}`,
    };
  }

  /** Ask LocalAI to fetch a model from its own gallery. Returns the job id to
   *  poll. A server without the route answers 404. */
  async install(galleryId: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/models/apply`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ id: galleryId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      throw new SpeechError(
        'This speech server cannot fetch models on its own. Add the model there, then place it.',
        404,
      );
    }
    if (!res.ok) return this.fail(res, 'Getting the model');
    const body = (await res.json()) as { uuid?: unknown };
    if (typeof body.uuid !== 'string')
      throw new SpeechError('The speech server gave no job to follow.');
    return body.uuid;
  }

  /** Where a gallery fetch stands. */
  async installStatus(uuid: string): Promise<{ done: boolean; percent?: number; error?: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/models/jobs/${encodeURIComponent(uuid)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return this.fail(res, 'Reading the download');
    const body = (await res.json()) as {
      processed?: unknown;
      progress?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const error = typeof body.error === 'string' && body.error ? body.error : undefined;
    return {
      done: body.processed === true || Boolean(error),
      ...(typeof body.progress === 'number' ? { percent: body.progress } : {}),
      ...(error ? { error } : {}),
    };
  }
}

/** Read a diarization answer into lines, whichever of the common shapes it
 *  takes (a `segments` list with speaker and text, or a bare list). */
export function speakerLines(body: unknown): SpeakerLine[] {
  const list: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray((body as { segments?: unknown })?.segments)
      ? (body as { segments: unknown[] }).segments
      : [];
  const out: SpeakerLine[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as Record<string, unknown>;
    const speaker = seg.speaker ?? seg.label ?? seg.speaker_id;
    if (speaker === undefined) continue;
    out.push({
      speaker: String(speaker),
      ...(typeof seg.start === 'number' ? { start: seg.start } : {}),
      ...(typeof seg.end === 'number' ? { end: seg.end } : {}),
      text: typeof seg.text === 'string' ? seg.text.trim() : '',
    });
  }
  return out;
}

/** Speaker lines as a readable transcript: "Speaker 1 (0:03): words". */
export function formatSpeakerLines(lines: SpeakerLine[]): string {
  const names = new Map<string, string>();
  return lines
    .map((line) => {
      if (!names.has(line.speaker)) names.set(line.speaker, `Speaker ${names.size + 1}`);
      const at = line.start !== undefined ? ` (${clock(line.start)})` : '';
      return `${names.get(line.speaker)}${at}: ${line.text || '(no words)'}`;
    })
    .join('\n');
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
