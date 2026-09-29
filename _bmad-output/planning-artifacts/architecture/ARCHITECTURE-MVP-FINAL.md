# Bridge Path MVP 최종 아키텍처 (v3)

**작성일**: 2026-09-29  
**상태**: ✅ 설계 확정 (Phase 1 개발 준비 완료)

---

## 📋 최종 결정사항

### 기술 스택 (확정)

| 계층 | 기술 | 버전 |
|------|------|------|
| **프론트엔드** | HTML5/CSS3/JavaScript (현재 코드 재사용) | - |
| **백엔드** | Node.js + Express + TypeScript | 18.x, 4.18.x, 5.0.x |
| **데이터베이스** | PostgreSQL | 14+ (Heroku managed) |
| **파일 저장소** | AWS S3 (비공개 객체) | - |
| **호스팅** | Heroku 앱 + Heroku PostgreSQL | - |
| **이메일** | Sendgrid API | - |
| **로깅** | Winston + Sentry | 3.8.x, 7.50.x |

---

## 💾 데이터베이스 (9개 테이블)

### 1. admin_users (관리자)
- 초기: 1명 (`master`/`admin` 역할)
- 향후: 2~3명 추가 시 `manager` 역할 추가
- 로그인 제한: 5회 실패 후 15분 잠금
- 비밀번호: bcryptjs (rounds=12)

### 2. admin_sessions (세션 관리) ⭐
- Refresh token 저장 (해시)
- 세션 취소 기능 (revoke)
- 다중 기기 로그아웃 (revoke-all)
- 활동 추적 (last_activity_at)

### 3. estimates (견적 요청)
- 4개 카테고리 모두 지원
- 상담형 플래그 (`is_consultation`)
- 상태: 10가지 (new_receipt → completed/cancelled)
- specification_json: 카테고리별 다른 필드

### 4. estimate_access_tokens (조회 토큰) ⭐
- receipt_id만으로 개인정보 노출 방지
- 일회성 토큰 (7일 유효)
- 토큰 + receipt_id 함께 필요
- 방문 기록 추적

### 5. base_prices (기준가) ⭐
- 관리자 전용 (공개 API 제거)
- 카테고리별 + 제품 변형별
- is_active 토글 (AI 활성화/비활성화)
- 고객에게는 "AI 지원 여부"만 노출

### 6. files (첨부 파일)
- 상태: quarantine → pending_scan → approved/rejected ⭐
- 검사: virus_scan_status (pending/passed/failed)
- S3 저장: 비공개 객체
- 다운로드: 서명된 URL (1시간 유효)

### 7. quotations (정식 견적서)
- PDF 파일 첨부
- 상태: draft → sent → reviewed → confirmed
- 고객 발송 시 자동 이메일

### 8. status_history (상태 변경)
- 모든 상태 변경 감시
- 변경자, 변경 시간, 사유 기록

### 9. email_events (이메일 발송) ⭐
- Idempotency key (중복 발송 방지)
- 상태: pending → sending → sent/failed
- 재시도: 3회 (1, 2, 4분 지수 백오프)
- 비동기 발송 큐 (Bull)

### 추가 테이블
- admin_memos (내부 메모)

---

## 🔐 보안 기능 (7가지 개선)

| # | 기능 | 방식 |
|----|------|------|
| 1 | 인증 | JWT (HS256, 8시간) + HttpOnly 쿠키 |
| 2 | 세션 | admin_sessions (취소/갱신 가능) |
| 3 | 조회 보안 | receipt_id + 일회성 토큰 (7일) |
| 4 | 기준가 보안 | 관리자 전용 API (공개 제거) |
| 5 | 파일 검증 | MIME + 매직바이트 + ClamAV |
| 6 | 파일 상태 | quarantine → 검사 → approved |
| 7 | 이메일 | Idempotency + 재시도 + 중복 방지 |

---

## 🌐 API 엔드포인트 (13개)

### 고객 API (인증 불필요)
- `POST /api/estimates` - 견적 제출
- `GET /api/estimates/:receipt_id?token=xxx` - 접수 조회 (토큰 필수)
- `GET /api/estimate-availability` - AI 지원 여부만 조회

### 관리자 API (JWT 필수)
- `POST /admin/login` - 로그인
- `POST /admin/logout` - 로그아웃
- `POST /admin/token/refresh` - 토큰 갱신
- `POST /admin/sessions/revoke-all` - 모든 세션 취소
- `GET /admin/estimates` - 요청 목록
- `GET /admin/estimates/:id` - 요청 상세
- `PATCH /admin/estimates/:id` - 상태 변경
- `POST /admin/estimates/:id/memo` - 메모 추가
- `GET/POST /admin/estimates/:id/files` - 파일 관리
- `POST /admin/estimates/:id/quotation` - 정식 견적 생성 (PDF)
- `POST /admin/estimates/:id/quotation/send` - 발송
- `GET /admin/base-prices` - 기준가 조회 (admin 권한)
- `POST/PATCH /admin/base-prices` - 기준가 관리 (admin 권한)

---

## 📊 주요 워크플로우

### 1. 고객 견적 요청
```
고객 폼 입력
  ↓
POST /api/estimates (multipart/form-data)
  ├─ MIME + 매직바이트 + ClamAV 검증
  ├─ S3 업로드
  ├─ 파일 상태: quarantine
  ├─ 접수번호 생성 (BP20260929001)
  ├─ email_events 생성
  └─ 201 응답
  ↓
비동기 이메일 발송 (Bull 큐)
  ├─ 고객: 접수 알림
  └─ 관리자: 신규 요청 알림
```

### 2. 파일 검사 (비동기 워커)
```
파일 upload (quarantine)
  ↓
비동기 큐 작업
  ├─ file_status = pending_scan
  ├─ ClamAV 검사
  └─ 결과:
     ├─ 통과 → approved (접근 가능)
     └─ 실패 → rejected (접근 불가)
```

### 3. 정식 견적서 발송
```
담당자가 견적 생성
  ↓
POST /admin/estimates/:id/quotation
  ├─ PDF 파일 생성
  ├─ S3 업로드
  └─ quotations 테이블 INSERT
  ↓
담당자가 발송
  ↓
POST /admin/estimates/:id/quotation/send
  ├─ email_events 생성 (Idempotency)
  ├─ 상태: pending
  └─ Bull 큐 추가
  ↓
비동기 발송 (Sendgrid)
  ├─ 성공 → sent
  ├─ 실패 → 재시도 (1, 2, 4분)
  └─ 최종 실패 → failed (관리자 수동 처리)
```

---

## 🎯 4개 사용자 결정 (확정)

| 항목 | 결정 | 근거 |
|------|------|------|
| U1 | 상담형 견적 우선 출시 | 기준가 준비 전 고객 수집 |
| U1-1 | 기준가 준비된 품목만 AI 활성화 | 정확도 + 신뢰도 |
| U2 | 4개 카테고리 모두 지원 | 형평성 |
| U2-1 | AI 단계적 지원 | 각 품목 검증 후 |
| U3 | 관리자 1명 시작 | 비용 효율 |
| U3-1 | DB는 admin/manager 유지 | 향후 확장성 |
| U4 | Heroku + PostgreSQL | 배포 간편성 |
| U4-1 | AWS S3 (파일만) | 비공개 저장소 |

---

## 🔍 기술 검토 사항 (Phase 1 시작 전)

### 1. Bull + Redis
- [x] Bull 큐를 사용한다면 Redis 필수
- [ ] Heroku Redis 애드온 사용할지 자체 Redis 구축할지 결정 필요
- **결정**: Phase 2에서 이메일 큐 구현 시 결정

### 2. 이메일 워커
- [ ] Sendgrid 발송을 동기/비동기 중 선택
- **결정**: 비동기 (Bull + Redis) 사용

### 3. 입력 검증
- [ ] Joi (API 요청) vs Ajv (specification 스키마)
- [ ] 역할 분담:
  - Joi: 요청 바디 (형태, 타입)
  - Ajv: specification_json (내용, 카테고리별 필드)

### 4. ClamAV 실행
- [ ] Heroku에서 ClamAV 실행 방법
  - **대안 1**: 로컬 설치 (Heroku Buildpack)
  - **대안 2**: VirusTotal API (외부 서비스)
  - **대안 3**: 외부 ClamAV 서버 연결
- **결정**: Phase 2에서 검토 (초기 지원 안 할 수도)

### 5. Refresh Token 전략
- [x] admin_sessions 테이블에 저장
- [x] 로그아웃 시 revoke (상태 변경)
- [ ] 토큰 회전 정책 (선택)

### 6. 공개 API 기준가 노출 확인
- [x] GET /api/base-prices 제거
- [x] GET /api/estimate-availability (지원 여부만)

### 7. 접수번호 보안 확인
- [x] receipt_id + 일회성 토큰 (토큰 만료: 7일)

---

## 📝 개발 단계별 계획

| 단계 | 기간 | 내용 | 상태 |
|------|------|------|------|
| Phase 1 | 5일 | 백엔드 기초 (인증, DB, 로깅) | 📋 계획 |
| Phase 2 | 7일 | 고객 API (견적 제출, 파일, 이메일) | 📋 대기 |
| Phase 3 | 7일 | 관리자 API (대시보드, 정식 견적) | 📋 대기 |
| Phase 4 | 7일 | 프론트엔드 (HTML 통합, 버그 수정) | 📋 대기 |
| Phase 5 | 7일 | 테스트 & Heroku 배포 | 📋 대기 |

---

## 📌 참고 링크

- **Claude Code Artifact**: Bridge Path 최종 설계 v3 + Phase 1 계획
- **Git 브랜치**: `develop/bmad-setup`
- **다음 문서**: `PHASE-1-PLAN.md`
