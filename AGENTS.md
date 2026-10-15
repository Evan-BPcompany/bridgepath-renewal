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

## 현재 구조 (수동 관리 — 위 블록의 "백엔드 없음"은 최신이 아님)

이 저장소는 두 부분으로 이루어져 있습니다.

- **프런트엔드**: 저장소 루트의 기존 정적 HTML/CSS/JS(`index.html`, `*-estimate.html`, `estimate-common.js` 등). 아직 백엔드 API에 연결되어 있지 않습니다(Phase 4 예정).
- **백엔드**: `src/`의 **Express + TypeScript + PostgreSQL** API (Node 20 이상, 빌드는 `tsc` → `dist/`).
  - 진입점·앱 조립: `src/index.ts`, `src/app.ts` / 라우트 `src/routes/` / 서비스 `src/services/` / 미들웨어 `src/middleware/` / 유틸 `src/utils/`
  - DB 마이그레이션(knex): `src/db/migrations/` (001~011)
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
