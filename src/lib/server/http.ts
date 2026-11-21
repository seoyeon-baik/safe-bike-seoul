import 'server-only';
import { ApiError, redact } from './env';

export function json(value: unknown, status = 200) {
  return new Response(redact(JSON.stringify(value)), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}
export async function endpoint(action: () => unknown | Promise<unknown>) {
  try { return json(await action()); }
  catch (error) {
    // Never log or forward raw fetch errors, upstream bodies, URLs, or headers.
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.' } }, 500);
  }
}
export function params(request: Request, allowed: string[]) {
  const result = new URL(request.url).searchParams;
  for (const key of result.keys()) if (!allowed.includes(key) || result.getAll(key).length > 1) {
    throw new ApiError(400, 'INVALID_PARAMETER', '지원하지 않거나 중복된 요청 매개변수입니다.');
  }
  return result;
}
export function integer(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new ApiError(400, 'INVALID_PARAMETER', '숫자 매개변수는 지정된 범위의 정수여야 합니다.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ApiError(400, 'INVALID_PARAMETER', '숫자 매개변수가 허용 범위를 벗어났습니다.');
  return n;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw upstreamError();
  return value as Record<string, unknown>;
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw upstreamError();
  return value.map(record);
}
export function text(value: unknown) {
  if (typeof value !== 'string') throw upstreamError();
  return value;
}
export function number(value: unknown) {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') throw upstreamError();
  const n = Number(value);
  if (!Number.isFinite(n)) throw upstreamError();
  return n;
}
export function upstreamError() { return new ApiError(502, 'UPSTREAM_ERROR', '외부 데이터 제공 서비스의 응답을 확인하지 못했습니다.'); }
export async function fetchJson(url: URL, headers?: Record<string, string>): Promise<unknown> {
  try {
    const response = await fetch(url, { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw upstreamError();
    return await response.json();
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ApiError(504, 'UPSTREAM_TIMEOUT', '외부 데이터 제공 서비스의 응답 시간이 초과되었습니다.');
    }
    throw upstreamError();
  }
}
export function result<T>(data: T, source: string, demo: boolean, extra: Record<string, unknown> = {}) {
  return { data, meta: { source, isDemo: demo, fetchedAt: new Date().toISOString(), ...extra } };
}
