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
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(url.toString(), init);

  // Build the response, forwarding all Set-Cookie headers from upstream
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    // Forward content-type and all set-cookie headers
    const lower = key.toLowerCase();
    if (lower === 'content-type' || lower === 'set-cookie') {
      responseHeaders.append(key, value);
    }
  });

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
