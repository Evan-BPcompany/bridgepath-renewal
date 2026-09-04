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
