import { type NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function proxyRequest(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = `${API_URL}/${path.join('/')}`;
  const url = new URL(target);

  // Forward query parameters
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  // Build headers, forwarding cookie from the client
  const headers = new Headers();
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  // Only forward body (and content-type) when there is actual content.
  // Sending an empty body with content-type: application/json causes
  // Fastify to reject it as invalid JSON (400 Bad Request).
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bodyBuf = await request.arrayBuffer();
    if (bodyBuf.byteLength > 0) {
      init.body = bodyBuf;
      const contentType = request.headers.get('content-type');
      if (contentType) headers.set('content-type', contentType);
    }
  }

  const upstream = await fetch(url.toString(), init);

  // Build the response headers
  const responseHeaders = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) responseHeaders.set('content-type', ct);

  // Forward Set-Cookie headers using getSetCookie() — Headers.forEach()
  // does not reliably expose set-cookie in Node.js fetch implementation
  const setCookies = (upstream.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (setCookies) {
    for (const sc of setCookies) {
      responseHeaders.append('set-cookie', sc);
    }
  }

  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
