import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';

// An explicit source manifest keeps local configuration and build outputs out of the archive.
const roots = ['src', 'public', 'scripts', 'tests'];
const files = ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'eslint.config.mjs', '.gitignore', '.vercelignore', '.env.example', '.nvmrc', 'vercel.json', 'AGENTS.md', 'README.md', 'DEPLOYMENT.md'];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error(`업로드 대상 심볼릭 링크를 확인하세요: ${file}`);
    if (/^\.env/.test(entry.name) || /\.(pem|key|p12|pfx|zip|log)$/.test(entry.name)) throw Error(`업로드 금지 파일: ${file}`);
    if (entry.isDirectory()) walk(file); else files.push(file);
  }
}
roots.forEach(walk);
const secrets = new Set();
// Include legacy aliases and parent workspace keys without logging any values.
for (const directory of [path.resolve('..'), process.cwd()]) {
  const { combinedEnv } = nextEnv.loadEnvConfig(directory, false, { info() {}, error() {} }, true);
  for (const [name, value] of Object.entries(combinedEnv)) {
    if (!/(KEY|SECRET|TOKEN)$/.test(name) || !value || value.length < 8) continue;
    secrets.add(value); secrets.add(encodeURIComponent(value));
    try { secrets.add(decodeURIComponent(value)); } catch { /* literal key */ }
  }
}
for (const file of files) {
  const content = fs.readFileSync(file).toString('utf8');
  if ([...secrets].some(value => content.includes(value) || content.includes(JSON.stringify(value).slice(1, -1)))) {
    throw Error(`업로드 대상에서 인증키 감지: ${file} (값은 출력하지 않습니다.)`);
  }
}
for (const line of fs.readFileSync('.env.example', 'utf8').split('\n')) {
  if (/^[A-Z_]*(KEY|SECRET|TOKEN)=.+/.test(line)) throw Error('.env.example 인증키 값은 비워 두세요.');
}
console.log(`업로드 소스 ${files.length}개 검사 통과. 실제 환경파일·빌드·의존성은 패키지에서 제외됩니다.`);
if (process.argv.includes('--pack')) {
  fs.mkdirSync('artifacts', { recursive: true });
  const result = spawnSync('python3', ['-c', 'import sys,json,zipfile\nwith zipfile.ZipFile("artifacts/safe-bike-seoul-source.zip","w",zipfile.ZIP_DEFLATED) as z:\n for p in json.load(sys.stdin): z.write(p,p)'], { input: JSON.stringify(files.sort()), encoding: 'utf8' });
  if (result.status !== 0) throw Error('소스 ZIP 생성 실패. Python 3 설치를 확인하세요.');
  console.log('생성: artifacts/safe-bike-seoul-source.zip');
}
