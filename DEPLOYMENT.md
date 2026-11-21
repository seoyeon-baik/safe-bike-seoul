# GitHub · Vercel 배포 안내

실제 인증키와 `.env.local`은 로컬에만 유지합니다. 배포용 ZIP에는 값이 빈 `.env.example`만 포함됩니다. GitHub 업로드와 Vercel 배포는 아직 실행하지 않았습니다.

## 1. 업로드할 소스 준비

Node.js 24와 npm을 사용합니다. 프로젝트 디렉터리에서 실행하세요.

```bash
npm ci
npm run check:upload
npm test
npm run build:vercel
npm run pack:source
```

`artifacts/safe-bike-seoul-source.zip`의 **압축을 푼 내용**을 GitHub 저장소 루트에 업로드하세요. ZIP 파일 자체를 올리면 Vercel에서 앱을 빌드할 수 없습니다. 이 패키지는 명시된 소스 목록만 포함하며 실제 환경파일, node_modules, .next, 테스트 결과, .vercel을 제외합니다. `pack:source`에는 Python 3이 필요합니다. 소스를 바꿨으면 다시 검사하고 생성하세요.

Git으로 업로드하려면 `safe-bike-seoul` 디렉터리에서 아래 순서를 사용합니다. 빈 GitHub 저장소를 먼저 만들고 URL을 본인 것으로 바꾸세요.

```bash
git init -b main
git add .
git status --short
git diff --cached --name-only
# 위 목록에 실제 .env 파일이나 인증키 파일이 없는지 확인 후 실행
git commit -m "Prepare Safe Bike Seoul for deployment"
git remote add origin https://github.com/YOUR_ACCOUNT/safe-bike-seoul.git
git push -u origin main
```

`.gitignore`는 실제 환경파일과 로컬 산출물을 제외합니다. `git add -f`로 환경파일을 추가하지 마세요. 이미 별도 저장소에 인증키를 커밋한 경우 ignore만으로 과거 기록이 제거되지 않으므로 해당 키를 교체해야 합니다. 현재 검사 대상은 업로드 소스와 빌드이며 Git 과거 이력은 검사하지 않습니다.

## 2. Vercel 프로젝트 설정

GitHub 저장소를 Import한 뒤 다음 설정을 사용하세요.

| 항목 | 설정 |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | ZIP 내용을 저장소 루트에 올렸다면 `.` / 현재 상위 폴더 구조로 올렸다면 `safe-bike-seoul` |
| Node.js | 24.x (`package.json`에도 고정) |
| Install Command | `npm ci` |
| Build Command | `npm run build` (`vercel.json`에 지정) |
| Output Directory | Next.js 기본값 유지 |

`check:upload`와 `pack:source`는 로컬에서 업로드 소스를 검사·패키징하는 명령입니다. Vercel에서는 `.env.example` 등 로컬 패키징 파일이 제외될 수 있으므로 배포 빌드에서 실행하지 않습니다. 기본 배포 명령 `npm run build`는 Next.js 빌드만 실행합니다. 환경변수·브라우저 키 노출 검사도 함께 실행하려면 로컬에서 선택적으로 `npm run build:vercel`을 사용할 수 있습니다.

API Route가 있으므로 정적 사이트 내보내기를 사용하지 않습니다. API별 `maxDuration=120`을 설정했습니다. Vercel의 Fluid compute를 사용하고 선택한 요금제·프로젝트가 이 실행시간을 허용하는지 확인하세요. 사고지역 등 여러 외부 요청을 모으는 작업이 있어 짧은 실행 제한에서는 시간 초과가 날 수 있습니다. 메모리 캐시는 서버 인스턴스별로만 유지되어 외부 API 쿼터 사용량이 로컬과 다를 수 있습니다.

참고: [Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [함수 실행시간](https://vercel.com/docs/functions/configuring-functions/duration).

## 3. 배포 환경변수

Vercel 프로젝트의 Settings → Environment Variables에 다음 이름으로 값을 입력하세요. **Production**에 설정하고, Preview에서도 실제 API를 쓸 경우 Preview 범위에도 별도로 설정하세요. 로컬 `.env`를 GitHub에 올려 전달하지 않습니다.

| 이름 | 값 / 용도 | 브라우저 공개 |
| --- | --- | --- |
| `API_DATA_MODE` | `live` | 비밀값 아님 |
| `SEOUL_API_KEY` | 서울 열린데이터광장 bikeList 인증키 | 아니요 |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 일반 인증키 **Decoding** 값, 기상청 단기예보 | 아니요 |
| `KAKAO_REST_API_KEY` | 카카오 REST API 키, 장소 검색·자전거 경로 | 아니요 |
| `NEXT_PUBLIC_KAKAO_MAP_APP_KEY` | 카카오 **JavaScript 키**, 지도 SDK | 예 |
| `TAAS_API_KEY` | 선택: 자전거 사고다발지역 전용 포털 Decoding 키 | 아니요 |

`TAAS_API_KEY`가 비면 `DATA_GO_KR_SERVICE_KEY`를 사용합니다. 어느 키를 쓰든 해당 사고 API와 기상청 API의 활용 신청·승인이 필요합니다. 기존 로컬의 `DATA_GO_KR_API_KEY`, `NEXT_PUBLIC_KAKAO_JS_KEY` 대신 표의 프로젝트 변수명을 사용하세요. OPENAI_API_KEY, PORT는 배포에 필요하지 않습니다.

서버 키에는 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. JavaScript 키는 SDK 동작상 브라우저에 보이며 아래 도메인 제한으로 관리합니다. REST 키나 Admin 키를 JavaScript 변수에 넣으면 안 됩니다. 공개 키도 소스에는 하드코딩하지 않습니다.

환경변수를 바꾸면 **Redeploy**하세요. 특히 `NEXT_PUBLIC_` 값은 빌드 시 브라우저 코드에 포함됩니다. 기본 배포 빌드에서는 환경변수와 인증키 노출 검사를 별도로 실행하지 않습니다. 필요하면 로컬에서 `npm run check:deploy-env`와 빌드 후 `npm run check:secrets`를 실행하세요. 이 검사가 API 권한 성공을 보장하지는 않습니다.

참고: [Vercel 환경변수 관리](https://vercel.com/docs/environment-variables/managing-environment-variables).

## 4. 카카오 서비스와 허용 도메인

동일한 카카오 앱에서 REST 키와 JavaScript 키를 확인하세요.

1. Kakao Developers → 해당 앱 → **카카오맵 → 사용 설정 → 상태 ON**.
2. JavaScript 키의 **JavaScript SDK 도메인**에 실제 접속 origin을 등록하세요. 경로나 쿼리 없이 프로토콜·호스트·로컬 포트를 정확히 입력합니다.
   - `http://localhost:3000`
   - `http://127.0.0.1:3000` (이 주소로 개발할 경우)
   - `https://YOUR_PROJECT.vercel.app`
   - `https://YOUR_CUSTOM_DOMAIN` (사용할 경우)
3. Preview URL도 지도를 사용하려면 그 정확한 도메인을 등록하세요. 임의로 생성되는 모든 Preview URL이 자동 허용된다고 가정하지 마세요. 고정 Preview 도메인을 사용하는 편이 관리하기 쉽습니다.
4. REST API 키의 사용 설정·권한을 확인하세요. SDK 도메인 등록은 서버 REST API 권한 설정과 별개이며, 카카오 로그인 Redirect URI 설정으로 대체할 수 없습니다. REST 키에 허용 IP 제한을 설정했다면 Vercel 서버의 네트워크 구성과 맞는지도 확인해야 합니다.

이전 실제 호출에서는 카카오 REST가 `disabled OPEN_MAP_AND_LOCAL service`로 403을 반환했고, SDK도 도메인/권한 오류가 있었습니다. 빌드가 성공해도 이 콘솔 설정을 해결해야 장소 검색·지도·실제 경로가 작동합니다. 실패 시 임의 경로는 생성하지 않습니다.

참고: [카카오맵 공식 사용 설정 안내](https://developers.kakao.com/docs/ko/kakaomap/common), [JavaScript SDK 가이드](https://apis.map.kakao.com/web/guide/).

## 5. 배포 후 확인

배포 URL에서 지도 로딩, 출발지·목적지 검색, 실제 따릉이 수량과 거리순 목록, 대여소 선택 후 두 경로, 사고 기준연도·주변 개수, 날씨 발표/예보시각을 확인하세요. 모바일에서도 확인하고, Vercel Logs에서 인증 오류·시간 초과를 확인하되 인증키나 키가 담긴 외부 요청 URL을 공유하지 마세요.

서버 키를 URL에 넣지 않고 다음 앱 API를 확인할 수 있습니다.

```text
/api/stations?lat=37.5271&lng=126.9328&radius=2000&limit=30
/api/places?query=여의도공원
/api/accidents?year=2025
/api/weather?lat=37.5271&lng=126.9328
```

경로는 UI에서 실제 대여소를 선택해 확인합니다. 응답 없음과 인증 실패는 서로 다른 상태이며 예시 데이터로 대체되지 않습니다. 과거 사고정보와 경로 주변 지역 수만으로 실제 안전성을 단정하지 않습니다.

## Production API 자동 점검

기본 로컬 검사 외에 배포 주소도 점검할 수 있습니다. 아래 명령은 실제 API를 호출하고 `test-results/live-api-results.json`에 키 값 없는 결과를 저장합니다. SDK 검사는 로컬 JavaScript 키의 해당 도메인 허용 여부이며 브라우저 렌더링 검사와는 다릅니다.

```bash
TEST_BASE_URL=https://safe-bike-seoul-inky.vercel.app npm run test:live
```

지도 사용 시 고정 Production 주소를 우선 사용하세요. 개별 배포 주소는 별도 origin이므로 그 주소로 접속하려면 카카오 SDK 허용 도메인에도 별도로 등록해야 합니다.
