<!-- bmad:context -->
<!-- Verified 2026-09-04 against 2f427455785458d5e7a7eb84adb2bb7ca9556b15. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## bridgepath-renewal

Bridge Path의 정적 회사소개 + OEM/ODM 제작 견적 문의 사이트(리뉴얼 프로젝트). 순수 HTML/CSS/JS이며 빌드 도구·백엔드가 없음(견적 폼은 서버 전송이 아직 구현되지 않아 `console.log`만 함). 아직 배포되지 않은 로컬 개발 프로젝트이며, 실제 운영 중인 회사 홈페이지는 카페24에 호스팅된 별도의 워드프레스 사이트(외주 제작)로 이 저장소와 무관함. 계획 문서(PRD 등)는 아직 없음.

## Policy

- 수리/AS 요청 사이트가 아니라 신규 제작(OEM/ODM) 견적 문의 사이트입니다 — 카피나 기능을 수리 접수처럼 보이게 만들지 말 것.

## Where things are

- 홈페이지: `index.html` (회사소개 `#about`, 서비스 `#services`, 문의 `#contact` 섹션)
- 견적 허브: `estimate.html` → 카테고리별 `sunglasses-estimate.html` / `shoes-estimate.html` / `golf-estimate.html`(2단계 스텝 폼, `estimate-common.js`/`estimate-common.css` 공유) / `other-inquiry.html`(단일 스텝, 별도 구조)

## Running and verifying

- 빌드 도구·패키지 매니저 없음 — HTML 파일을 브라우저로 직접 열거나 정적 서버(예: VSCode Live Server)로 서빙해서 확인.

## Conventions that differ from defaults

- 새 제품 견적 카테고리를 추가할 때는 `<product>-estimate.html` + `<product>-estimate.js` 페어를 만들고, `estimate-common.js`/`estimate-common.css`를 공유하는 기존 3종(선글라스/신발/골프)의 2단계 스텝 패턴을 따를 것. `other-inquiry.*`만 예외적으로 단일 스텝 구조.

## Known pitfalls

- `index.html`이 불러오는 `script.js`가 존재하지 않는 `#estimateForm`을 참조해 홈페이지 로드 시마다 콘솔 에러 발생(레거시 코드로 추정). 다음 build 작업 때 수정 예정 — 그 전까지는 알려진 이슈로 취급할 것.

<!-- /bmad:context -->

<!-- Everything below is maintained by hand, outside the bmad:context block. Where it differs from the block above, this section is the newer one. -->

## 서비스 방향 (2026-11-11 사용자 결정)

이 웹서비스는 **골프용품 소싱 에이전트**입니다. 다루는 품목은 **골프 선글라스, 골프화, 골프티** 세 가지입니다. 위 블록의 "회사소개 + OEM/ODM 제작 견적 문의 사이트"보다 이 절이 최신입니다.

- 문구와 화면은 "골프용품을 소싱해 주는 에이전트" 기준으로 씁니다. 직접 제조하는 것처럼 읽히는 문구를 쓰지 않습니다. 수리/AS처럼 보이게 하지 않는 원칙은 그대로입니다.
- **수출 대행을 약속하는 문구를 넣지 않습니다.** 장기 목표이지만 아직 제공하지 않습니다(`homePage.dom.test.ts`가 홈에서 확인).
- **서비스 이름은 "FINDER GREEN · 파인더그린"입니다(2026-11-11 사용자 결정).** "Bridge Path(주식회사 브릿지패스)"는 운영 회사 이름이고, 고객 화면에서는 푸터의 사업자 정보에만 나옵니다. 설명 문구는 사용자가 정한 "골프 브랜드를 위한 소싱·제작 파트너"입니다. 여기서 "제작"은 협력 공장을 통한 제작을 뜻하며, 직접 제조한다고 쓰지 않는 원칙은 그대로입니다.
  - 로고는 사용자가 넣어 준 로고 키트(`finder-green-logo-kit.zip`, 사용 안내는 그 안의 `usage-guide.md`)에서 가져와 `assets/logo/`에 둡니다. 로고 색은 Pine `#183D35`(`--brand`)입니다.
  - 상표는 2026-11-11에 KIPRIS에서 같은 이름만 찾아봤습니다(살아 있는 동일 상표 없음). 유사 상표 판단과 출원은 하지 않았습니다.
  - 아직 Bridge Path로 남아 있는 곳: 이메일 제목(`[Bridge Path] …`), 관리자 화면, `privacy-consent.html`, 코드 안의 `BridgePath…` 이름. 필요해지면 따로 바꿉니다.
- 화면에 나오는 종류: 선글라스는 `sports`(골프·스포츠 선글라스)와 `sunglasses`(일반 선글라스), 신발은 골프화 하나, 골프티 하나. 그 밖의 골프용품은 `other-inquiry.html`(홈과 견적 허브의 작은 링크)로 문의만 받습니다.
- **골프화는 임시 상태입니다.** 골프화 종류와 가격 자료가 없어서 요청은 신발 종류 `other`로 저장되고(관리자 화면에는 "기타"), 가격 상자는 "담당자가 확인"이라고 안내합니다. 서버와 API는 예전 종류(`optical`, `kids`, `sneakers`, `heels` …)를 그대로 알고 있습니다. 골프화 종류와 가격을 제대로 넣으려면 프런트 검증(`estimate-api.js`), 서버 타입(`src/utils/specification.ts`), 가격 규칙(`src/config/shoesGolfPricingRules.ts`), 기준가 마이그레이션이 함께 바뀌어야 하므로 실제 공장 견적을 받은 뒤에 합니다.
- 디자인 기준: `design-system/bridgepath/MASTER.md`.

## 현재 구조 (수동 관리 — 위 블록의 "백엔드 없음"은 최신이 아님)

이 저장소는 두 부분으로 이루어져 있습니다.

- **프런트엔드**: 저장소 루트의 기존 정적 HTML/CSS/JS(`index.html`, `*-estimate.html`, `estimate-common.js` 등). 아직 백엔드 API에 연결되어 있지 않습니다(Phase 4 예정).
- **백엔드**: `src/`의 **Express + TypeScript + PostgreSQL** API (Node 20 이상, 빌드는 `tsc` → `dist/`).
  - 진입점·앱 조립: `src/index.ts`, `src/app.ts` / 라우트 `src/routes/` / 서비스 `src/services/` / 미들웨어 `src/middleware/` / 유틸 `src/utils/`
  - DB 마이그레이션(knex): `src/db/migrations/` (001~012)
  - 고객 API `/api/estimates`(견적 접수·조회), 관리자 API `/admin/*`(JWT HttpOnly 쿠키)
  - 문서: `README.md`, `docs/TESTING.md`, `docs/SECURITY.md`, `docs/OPERATIONS.md`, 기획 산출물 `_bmad-output/planning-artifacts/`(PRD 포함)

## 검증 명령

| 명령 | 용도 |
|---|---|
| `npm run build` | 타입 검사·컴파일 |
| `npm test -- --runInBand` | 단위 테스트 (가짜 DB, 외부 연결 없음) |
| `npm run test:integration` | 로컬 PostgreSQL 통합 테스트. `TEST_DATABASE_URL`이 있을 때만 실행되고 없으면 skip |
| `npm run audit:prod` | 운영 의존성 취약점 점검 |
| `npm run secret-scan` | 비밀정보 스캔 |

- 통합 테스트는 `TEST_DATABASE_URL`(로컬 호스트, DB 이름에 `test` 포함)만 사용합니다. 이 값은 사용자의 터미널 세션에만 두고 파일·채팅·git에 남기지 않습니다. 에이전트 세션에는 없을 수 있으며, 그 경우 사용자가 실행한 결과를 기록으로 씁니다. `DATABASE_URL`을 테스트에 쓰지 않습니다.
- 자세한 내용: `docs/TESTING.md`

## Git 작업 규칙

- 작업 브랜치는 `develop/bmad-setup`. 커밋과 push는 사용자가 명시적으로 요청했을 때만 합니다.
- force push, rebase, reset, clean은 사용하지 않습니다.
- 기능 커밋과 문서 커밋을 분리하고, 커밋 전 staged 파일을 확인합니다. 커밋 메시지는 `type(scope): ...` 형식이고 끝에 Co-Authored-By 줄을 붙입니다.
- 미추적 `.claude/.claude/`는 Claude가 만든 것이 아니므로 staging·삭제하지 않습니다.
- 커밋 후에는 build, 단위 테스트, audit, secret-scan을 확인합니다.

## 비밀정보·외부 서비스 제한

- `.env`, 비밀번호, 토큰, 접속 문자열은 읽어서 출력하거나 커밋하지 않습니다(`.env`는 `.gitignore` 대상).
- AWS(S3), SendGrid 등 실제 외부 서비스는 **아직 검증되지 않았으며**, 사용자의 명시적 승인 없이 호출하지 않습니다. 테스트는 `jest.setup.js`의 네트워크 가드로 로컬 외 연결이 막혀 있습니다.
- 마이그레이션이나 DB 작업을 실제 운영·개발 DB에 실행하지 않습니다.

## 이어서 작업할 때 (2026-11-13 이후)

- 가장 최근 인수인계는 `docs/HANDOFF-2026-11-13.md`입니다(다른 컴퓨터에서 이어 가는 방법, 프로젝트 맥락, 남은 결정). 이전 인수인계는 `docs/HANDOFF-2026-11-12.md` 등입니다.
- 홈과 견적 시작 화면의 디자인 규칙과 이유는 `design-system/bridgepath/MASTER.md`와 `home.css` 첫머리 주석에 있습니다.
- 위의 `bmad:context` 블록은 2026-09-04 기준이라 홈·견적 화면 설명이 낡았습니다(홈은 `#about`/`#services`/`#contact` 구조가 아닙니다).
