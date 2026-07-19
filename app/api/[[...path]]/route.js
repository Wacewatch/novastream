import { NextResponse } from 'next/server';

const BACKEND = process.env.INTERNAL_BACKEND_URL || 'http://localhost:8001';

const HOP_BY_HOP = new Set([
  'connection','keep-alive','proxy-authenticate','proxy-authorization',
  'te','trailers','transfer-encoding','upgrade','content-length','content-encoding','host',
]);

async function proxy(request, { params }) {
  const resolved = await params;
  const segs = resolved?.path || [];
  const path = Array.isArray(segs) ? segs.join('/') : String(segs || '');
  const url = new URL(request.url);
  const target = `${BACKEND}/api/${path}${url.search || ''}`;

  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (!['GET','HEAD'].includes(request.method)) {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 0) init.body = buf;
  }

  let res;
  try {
    res = await fetch(target, init);
  } catch (e) {
    return NextResponse.json({ error: 'upstream_unavailable', detail: String(e) }, { status: 502 });
  }

  const outHeaders = new Headers();
  for (const [k, v] of res.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: outHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
