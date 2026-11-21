import fs from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const names = ['SEOUL_API_KEY', 'DATA_GO_KR_SERVICE_KEY', 'KAKAO_REST_API_KEY', 'TAAS_API_KEY'];
const secrets = [];
for (const name of names) {
  const value = process.env[name]?.trim();
  if (!value) continue;
  const variants = new Set([value, encodeURIComponent(value)]);
  try { variants.add(decodeURIComponent(value)); } catch {}
  for (const v of variants) if (v) { secrets.push(v, JSON.stringify(v).slice(1, -1)); }
}
if (!fs.existsSync('.next/static')) throw Error('먼저 npm run build를 실행하세요.');
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else {
      const content = fs.readFileSync(file).toString('utf8');
      if (secrets.some(secret => content.includes(secret))) throw Error('브라우저 산출물에서 서버 인증키가 감지되었습니다. 값은 출력하지 않습니다.');
    }
  }
}
check('.next/static');
console.log(`브라우저 산출물 검사 통과 (설정된 서버 키 ${names.filter(n => process.env[n]?.trim()).length}개).`);
if (!secrets.length) console.log('현재 서버 키가 비어 있어 실제 키 값에 대한 검사는 수행하지 않았습니다.');
