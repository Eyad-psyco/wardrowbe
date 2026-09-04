import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resolved per request, not at module scope: next.config.js rewrites are serialized into
// routes-manifest.json at build time, so a rewrite cannot honor a runtime BACKEND_URL in the
// prebuilt image. Route handlers are the only proxy layer that reads env at request time.
function backendUrl(): string {
  const url =
    process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000';
  return url.replace(/\/+$/, '');
}

const STRIPPED_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  // Browsers add this for POST bodies over ~1MB (e.g. bulk image uploads); undici's fetch
  // doesn't support forwarding it and throws UND_ERR_NOT_SUPPORTED, turning the request
  // into a 502 before it ever reaches the backend.
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// content-encoding and content-length must go: fetch has already decoded the body (the backend
// runs GZipMiddleware), so forwarding them would describe bytes the client never receives.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);

// The incoming request, or the stream carrying its body, went away.
const CLIENT_GONE_CODES = new Set([
  'ECONNRESET',
  'ECANCELED',
  'ABORT_ERR',
  'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_ABORTED',
  'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
]);

// The host itself cannot be reached - the only case where BACKEND_URL is
// plausibly the thing that needs fixing.
const UNREACHABLE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

function errorCode(error: unknown): string {
  const own = (error as { code?: unknown })?.code;
  if (typeof own === 'string') return own;
  const cause = (error as { cause?: { code?: unknown; name?: unknown } })?.cause;
  if (typeof cause?.code === 'string') return cause.code;
  if (typeof cause?.name === 'string') return cause.name === 'AbortError' ? 'ABORT_ERR' : cause.name;
  return '';
}

function buildRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  return headers;
}

function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  headers.delete('set-cookie');
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    headers.append('set-cookie', cookie);
  }

  return headers;
}

async function proxy(request: NextRequest): Promise<NextResponse> {
  const target = new URL(request.url);
  const backend = backendUrl();
  // pathname/search rather than the decoded `params.path`, so signed image URLs survive intact.
  const url = `${backend}${target.pathname}${target.search}`;

  const hasBody = !METHODS_WITHOUT_BODY.has(request.method);
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: buildRequestHeaders(request),
    // Manual because the default 'follow' throws on auth/mobile-callback, which redirects to
    // a wardrobe:// app scheme that fetch cannot follow.
    redirect: 'manual',
  };

  if (hasBody && request.body) {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (error) {
    // undici collapses everything into "fetch failed" - the cause carries the
    // only part worth reading (ECONNREFUSED vs a dead source stream).
    const cause = error instanceof Error ? error.cause : undefined;
    const reason = [
      error instanceof Error ? error.message : String(error),
      cause instanceof Error ? `${cause.name}: ${cause.message}` : cause ? String(cause) : null,
    ]
      .filter(Boolean)
      .join(' <- ');
    const code = errorCode(error);

    // The request died on the way in, not on the way out: tab closed, upload
    // cancelled, or - in dev - the server recompiled and dropped everything
    // in flight. Streaming a body whose source is gone fails here with the
    // same bare "fetch failed" as a real outage. Nobody is left to read a
    // response, so don't answer with the "check BACKEND_URL" advice: that
    // message sends people hunting a networking problem that doesn't exist.
    if (request.signal.aborted || CLIENT_GONE_CODES.has(code)) {
      console.warn(`Proxy to ${url} dropped mid-request: ${reason}`);
      return new NextResponse(null, { status: 499 });
    }

    console.error(`Proxy to ${url} failed: ${reason}`);
    // Name BACKEND_URL only for failures that really mean the host cannot be
    // reached - anything else is a request that broke in transit and is worth
    // retrying against the same host.
    const detail = UNREACHABLE_CODES.has(code)
      ? `Unable to reach the backend at ${backend} (${reason}). ` +
        `Set BACKEND_URL if the backend service is not named "backend".`
      : `The request to the backend did not complete (${reason}). Please try again.`;
    return NextResponse.json({ detail }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream),
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
