// A page fetch whose connection is checked by the same name lookup it
// connects with (tech review security review 2026-10-01, F4, DNS rebinding). The
// global fetch resolves a name again after the egress policy checked it, so
// a name could answer a public address to the check and this computer's own
// network to the connection. Here the lookup Node calls to connect is the
// check: an answer on this computer's own network is refused unless the
// person allowed that host for this fetch.
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export type AddressCheck = (address: string) => boolean;

export interface PinnedFetchOptions {
  /** True for an address on this computer's own network. */
  onOwnNetwork: AddressCheck;
  /** The person allowed this host's own-network address for this fetch. */
  allowOwnNetwork: boolean;
  /** A name's addresses (tests stand it in). Defaults to the system resolver. */
  lookup?: (hostname: string) => Promise<string[]>;
}

/** Raised from inside the connection's lookup when the answer is local. */
export class RebindRefused extends Error {
  constructor(public readonly host: string) {
    super(
      `${host} answered with an address on this computer's own network when it was opened, so it was not opened.`,
    );
    this.name = 'RebindRefused';
  }
}

function family(address: string): 4 | 6 {
  return address.includes(':') ? 6 : 4;
}

/** The lookup Node's connect calls: resolve, refuse a local answer unless
 *  allowed, hand back exactly what was checked. */
function checkedLookup(options: PinnedFetchOptions) {
  return (
    hostname: string,
    opts: { all?: boolean } | number | undefined,
    cb: (
      err: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    const resolve = options.lookup
      ? options.lookup(hostname)
      : dnsLookup(hostname, { all: true, verbatim: true }).then((found) =>
          found.map((a) => a.address),
        );
    resolve.then(
      (addresses) => {
        if (!addresses.length) {
          cb(Object.assign(new Error(`${hostname} did not resolve.`), { code: 'ENOTFOUND' }));
          return;
        }
        if (!options.allowOwnNetwork && addresses.some(options.onOwnNetwork)) {
          cb(new RebindRefused(hostname) as NodeJS.ErrnoException);
          return;
        }
        if (typeof opts === 'object' && opts?.all) {
          cb(
            null,
            addresses.map((address) => ({ address, family: family(address) })),
          );
        } else {
          cb(null, addresses[0]!, family(addresses[0]!));
        }
      },
      (err: NodeJS.ErrnoException) => cb(err),
    );
  };
}

function decoded(res: IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(createGunzip());
  if (encoding === 'br') return res.pipe(createBrotliDecompress());
  if (encoding === 'deflate') return res.pipe(createInflate());
  return res;
}

/** One request, no redirects followed (the egress policy follows them hop
 *  by hop), answered as a web Response. */
export function pinnedFetch(
  url: string,
  init: RequestInit,
  options: PinnedFetchOptions,
): Promise<Response> {
  const target = new URL(url);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers: Record<string, string> = {};
  new Headers(init.headers ?? undefined).forEach((value, name) => {
    headers[name] = value;
  });
  headers['accept-encoding'] ??= 'gzip, deflate, br';
  const body = typeof init.body === 'string' ? init.body : undefined;
  return new Promise<Response>((resolve, reject) => {
    const req = send(
      target,
      {
        method: (init.method ?? 'GET').toUpperCase(),
        headers,
        lookup: checkedLookup(options) as never,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          if (name === 'content-encoding' || name === 'content-length') continue;
          for (const v of Array.isArray(value) ? value : [value]) out.append(name, v);
        }
        const empty = status === 204 || status === 304 || (status >= 100 && status < 200);
        if (empty) res.resume();
        const stream = empty
          ? null
          : (Readable.toWeb(decoded(res)) as unknown as ReadableStream<Uint8Array>);
        resolve(
          new Response(stream, { status, statusText: res.statusMessage ?? '', headers: out }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
