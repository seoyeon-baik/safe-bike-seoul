import 'server-only';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type SecretName = 'SEOUL_API_KEY' | 'DATA_GO_KR_SERVICE_KEY' | 'KAKAO_REST_API_KEY' | 'TAAS_API_KEY';
export function secret(name: SecretName): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError(503, 'API_NOT_CONFIGURED', '외부 API 인증키가 설정되지 않았습니다.');
  return value;
}
export function isDemo(): boolean {
  const mode = process.env.API_DATA_MODE?.trim() || 'demo';
  if (mode !== 'demo' && mode !== 'live') throw new ApiError(503, 'INVALID_SERVER_CONFIG', '서버 데이터 모드 설정을 확인해 주세요.');
  return mode === 'demo';
}
// Includes encoded forms because Seoul and data.go.kr carry credentials in URLs.
export function redact(text: string): string {
  for (const name of ['SEOUL_API_KEY', 'DATA_GO_KR_SERVICE_KEY', 'KAKAO_REST_API_KEY', 'TAAS_API_KEY'] as const) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    const forms = new Set([value, encodeURIComponent(value)]);
    try { forms.add(decodeURIComponent(value)); } catch { /* Raw keys need not be URL encoded. */ }
    for (const form of forms) if (form) text = text.split(JSON.stringify(form).slice(1, -1)).join('[REDACTED]');
  }
  return text;
}
