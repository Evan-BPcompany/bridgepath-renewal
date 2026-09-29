# Phase 1: 백엔드 기초 개발 계획 (5일)

**목표**: Node.js + Express + PostgreSQL 서버 기초 구축  
**기간**: 5 작업일 (월-금)  
**범위**: 인증, DB 연결, 접수번호 생성, 사양 검증

---

## 📂 폴더 구조

```
bridge-path-mvp/
├─ .env.example                     # 환경 변수 템플릿
├─ package.json
├─ tsconfig.json                    # TypeScript 설정
├─ README.md
│
├─ src/
│  ├─ index.ts                      # 서버 진입점
│  ├─ config/
│  │  ├─ env.ts                     # 환경 변수 로드
│  │  ├─ database.ts                # DB 연결 풀
│  │  └─ aws.ts                     # AWS S3 설정 (Phase 2)
│  │
│  ├─ db/
│  │  ├─ migrations/
│  │  │  ├─ 001_init_schema.sql
│  │  │  ├─ 002_admin_sessions.sql
│  │  │  ├─ 003_estimate_access_tokens.sql
│  │  │  ├─ 004_base_prices.sql
│  │  │  └─ 005_seed_admin_user.sql
│  │  └─ pool.ts                    # PostgreSQL 연결 풀
│  │
│  ├─ middleware/
│  │  ├─ auth.ts                    # JWT 검증
│  │  ├─ errorHandler.ts            # 오류 처리
│  │  └─ validation.ts              # 입력 검증
│  │
│  ├─ routes/
│  │  └─ auth.ts                    # /admin/login, logout, refresh
│  │
│  ├─ services/
│  │  ├─ auth.service.ts            # 인증 로직
│  │  └─ session.service.ts         # 세션 관리
│  │
│  ├─ utils/
│  │  ├─ logger.ts                  # Winston 로거
│  │  ├─ receipt-id.ts              # 접수번호 생성
│  │  ├─ token.ts                   # JWT 생성/검증
│  │  ├─ hash.ts                    # bcryptjs 해싱
│  │  └─ specification.ts           # 사양 검증 스키마
│  │
│  └─ types/
│     ├─ models.ts                  # TypeScript 모델
│     └─ api.ts                     # API 타입
│
├─ tests/
│  ├─ unit/
│  │  ├─ auth.test.ts
│  │  ├─ receipt-id.test.ts
│  │  └─ specification.test.ts
│  └─ integration/
│     ├─ login.test.ts
│     └─ receipt-id.test.ts
│
├─ scripts/
│  ├─ setup-db.sh                   # DB 초기화
│  └─ seed-admin.sh                 # 관리자 생성
│
└─ .gitignore
```

---

## 📦 npm 패키지 (핵심)

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "typescript": "^5.0.0",
    "pg": "^8.10.0",
    "dotenv": "^16.0.3",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "joi": "^17.10.0",
    "winston": "^3.8.2",
    "@sentry/node": "^7.50.0",
    "uuid": "^9.0.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.17",
    "ts-node": "^10.9.1",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "supertest": "^6.3.3",
    "nodemon": "^2.0.22",
    "prettier": "^2.8.8",
    "eslint": "^8.40.0"
  }
}
```

---

## 🗓️ 5일 상세 작업 계획

### Day 1: 프로젝트 셋업 & DB 연결

#### 작업
1. Node.js 프로젝트 초기화
   - npm init, TypeScript, Express 설치
   - .gitignore 작성
   - tsconfig.json 설정

2. Express 기본 서버 구성
   - src/index.ts: 포트 4000 서버
   - CORS, 에러 핸들러 기본 설정
   - 구동 테스트

3. PostgreSQL 연결 풀
   - src/config/database.ts: pg 연결 풀
   - src/db/pool.ts: 풀 설정
   - .env.example 작성

4. Winston 로거 설정
   - src/utils/logger.ts: 구조화된 로깅
   - 콘솔 + 파일 출력

#### 테스트
- [ ] npm start로 서버 구동 (port 4000)
- [ ] console.log 확인
- [ ] DB 연결 시도 확인

#### 산출물
- src/index.ts, config/database.ts, utils/logger.ts
- .env.example, package.json, tsconfig.json
- README.md (개발자 가이드)

---

### Day 2: 데이터베이스 & 마이그레이션

#### 작업
1. 마이그레이션 파일 작성 (5개)
   - 001_init_schema.sql: 기본 테이블
   - 002_admin_sessions.sql: 세션 관리
   - 003_estimate_access_tokens.sql: 조회 토큰
   - 004_base_prices.sql: 기준가
   - 005_seed_admin_user.sql: 초기 관리자

2. Knex.js 마이그레이션 설정
   - knexfile.ts: 마이그레이션 경로
   - package.json scripts: db:migrate, db:rollback

3. DB 초기화 스크립트
   - scripts/setup-db.sh: 환경별 초기화

#### 테스트
- [ ] npm run db:migrate 실행
- [ ] psql로 테이블 생성 확인
- [ ] 초기 관리자 확인 (master@...)

#### 산출물
- src/db/migrations/*.sql (5개 파일)
- knexfile.ts
- scripts/setup-db.sh
- src/types/models.ts (DB 모델 타입)

---

### Day 3: 인증 시스템 (로그인 & JWT)

#### 작업
1. JWT 토큰 함수
   - src/utils/token.ts: 생성, 검증
   - 알고리즘: HS256
   - 유효기간: 8시간

2. 비밀번호 해싱
   - src/utils/hash.ts: bcryptjs (rounds=12)
   - 생성, 검증 함수

3. 인증 미들웨어
   - src/middleware/auth.ts: JWT 검증
   - 쿠키에서 토큰 추출
   - 401/403 응답

4. 로그인 엔드포인트
   - src/routes/auth.ts: POST /admin/login
   - 입력 검증 (Joi)
   - 비밀번호 검증
   - 로그인 시도 제한 (5회 → 15분 잠금)

5. 인증 서비스
   - src/services/auth.service.ts: 비즈니스 로직

#### 테스트 (unit + integration)
- [ ] JWT 토큰 생성/검증
- [ ] 비밀번호 해싱/검증
- [ ] POST /admin/login (성공)
- [ ] 유효하지 않은 username (실패)
- [ ] 유효하지 않은 password (실패)
- [ ] 5회 실패 후 15분 잠금

#### 산출물
- src/utils/token.ts, hash.ts
- src/middleware/auth.ts
- src/routes/auth.ts
- src/services/auth.service.ts
- tests/unit/auth.test.ts

---

### Day 4: 세션 관리 & 접수번호 생성

#### 작업
1. 세션 관리 서비스
   - src/services/session.service.ts
   - admin_sessions 테이블 쿼리
   - 세션 생성, 취소, 조회

2. Refresh Token 처리
   - admin_sessions에서 읽기
   - 토큰 해시 검증
   - 로그아웃 시 revoke

3. Refresh Token 엔드포인트
   - POST /admin/token/refresh
   - Refresh token → Access token 발급
   - 세션 상태 확인

4. 로그아웃 엔드포인트
   - POST /admin/logout
   - 현재 세션 취소
   - 쿠키 삭제

5. 접수번호 생성 (SERIALIZABLE)
   - src/utils/receipt-id.ts
   - BP + YYYYMMDD + SEQUENCE
   - SERIALIZABLE 트랜잭션으로 중복 방지

#### 테스트
- [ ] 로그인 → access token + refresh token
- [ ] 서로 다른 쿠키 2개 설정 확인
- [ ] 토큰 만료 시뮬레이션 (JWT exp 변경)
- [ ] POST /admin/token/refresh → 새 토큰
- [ ] POST /admin/logout → 세션 취소
- [ ] 동시 접수번호 생성 (10개 요청) → 중복 없음

#### 산출물
- src/services/session.service.ts
- src/utils/receipt-id.ts
- src/routes/auth.ts (refresh, logout 추가)
- tests/integration/login.test.ts

---

### Day 5: 사양 검증 & 테스트 마무리

#### 작업
1. 사양 검증 스키마
   - src/utils/specification.ts
   - 4개 카테고리 스키마 (Ajv)
   - schema_version 추가
   - 필드 검증 (required, enum, 범위)

2. 검증 미들웨어
   - src/middleware/validation.ts
   - Specification 검증 로직
   - 카테고리별 규칙 적용

3. 오류 처리 완성
   - src/middleware/errorHandler.ts
   - 구조화된 오류 응답
   - 로그 기록

4. 로깅 미들웨어
   - 모든 요청/응답 기록
   - Winston 통합

5. 최종 문서
   - README.md (개발자 가이드)
   - 마이그레이션 스크립트 주석

#### 테스트
- [ ] eyewear specification 검증 (유효/무효)
- [ ] shoes specification 검증
- [ ] golf_products specification 검증
- [ ] other specification 검증
- [ ] 필드 누락 시 거부
- [ ] enum 값 검증

#### 산출물
- src/utils/specification.ts
- src/middleware/validation.ts
- src/middleware/errorHandler.ts
- tests/unit/specification.test.ts
- README.md (완성)

---

## 🧪 테스트 체크리스트

### 단위 테스트
```
✓ JWT 토큰 생성 (8시간 exp)
✓ JWT 토큰 검증
✓ JWT 토큰 만료 검증
✓ 비밀번호 해싱/검증
✓ 접수번호 생성 (형식)
✓ 접수번호 중복 검사
✓ eyewear specification 검증
✓ shoes specification 검증
✓ golf_products specification 검증
✓ other specification 검증
✓ 필드 타입 검증
✓ enum 값 검증
```

### 통합 테스트
```
✓ 로그인 → access token + refresh token
✓ 로그인 실패 (5회) → 15분 잠금
✓ POST /admin/token/refresh → 새 토큰
✓ POST /admin/logout → 세션 취소
✓ 동시 접수번호 생성 (10개) → 중복 없음
```

### 수동 테스트
```
✓ curl/Postman으로 API 호출 확인
✓ 쿠키 HttpOnly/Secure 설정 확인
✓ Winston 로그 파일 생성 확인
✓ 오류 시 구조화된 응답 확인
```

---

## 📊 Phase 1 완료 기준

### 기술적 완료
- [x] Express 서버 구동
- [x] PostgreSQL 연결 + 5개 마이그레이션
- [x] JWT 인증 (로그인, 토큰 갱신, 로그아웃)
- [x] admin_sessions 세션 관리
- [x] 접수번호 생성 (SERIALIZABLE)
- [x] 4개 카테고리 사양 검증 (Ajv)
- [x] 오류 처리 + 로깅

### 테스트 완료
- [x] 모든 단위 테스트 통과 (80%+ 커버리지)
- [x] 모든 통합 테스트 통과
- [x] 수동 테스트 확인

### 문서 완료
- [x] README.md
- [x] .env.example
- [x] 마이그레이션 주석

---

## 🚀 Phase 1 후 Phase 2 준비

Phase 1 완료 후:

```
Phase 1 ✅ (5일)
  ├─ Express + JWT 인증 완성
  ├─ DB 마이그레이션 완성
  └─ 사양 검증 완성
   ↓
Phase 2 (7일)
  ├─ POST /api/estimates (파일 업로드)
  ├─ 파일 검증 (MIME, 매직바이트, ClamAV)
  ├─ S3 업로드
  ├─ email_events 생성
  ├─ 비동기 이메일 발송 (Bull)
  └─ 접수 이메일 + 관리자 알림
```

---

## 📝 주의사항

### ⚠️ 외부 리소스 (아직 생성하지 말 것)
- [ ] Heroku 앱 (Phase 5)
- [ ] AWS IAM 키 (Phase 5)
- [ ] Sendgrid API 키 (Phase 2)
- [ ] Redis (Phase 2)

### ✅ 현재 코드 보존
- [ ] HTML/CSS/JS 파일 그대로 유지
- [ ] 현재 폴더 구조 보존
- [ ] backend/ 또는 server/ 폴더에 새 코드 추가

### 📋 .env.example에 필요한 변수
```
NODE_ENV=development
PORT=4000

# Database (로컬 PostgreSQL 또는 Heroku 예정)
DATABASE_URL=postgresql://user:password@localhost:5432/bridgepath_dev

# JWT
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRATION=8h

# AWS S3 (Phase 2에서 필요)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=bridge-path-prod

# Sendgrid (Phase 2에서 필요)
SENDGRID_API_KEY=

# 지원 정보
SUPPORT_EMAIL=contact@bridgepath.co.kr
SUPPORT_PHONE=02-0000-0000

# 로깅
LOG_LEVEL=info
SENTRY_DSN=
```

---

## 🔄 매일 체크리스트

### 시작 전 (매일)
- [ ] 이전 날 테스트 모두 통과 확인
- [ ] 커밋 상태 확인 (main 브랜치 정리)
- [ ] Day N 작업 읽기

### 종료 후 (매일)
- [ ] 새 코드 작성 완료
- [ ] 유닛/통합 테스트 작성
- [ ] 모든 테스트 통과 확인
- [ ] 코드 리뷰/린팅 (prettier/eslint)
- [ ] 커밋 생성 (feat/fix/docs 구분)
- [ ] git push

---

**Phase 1 준비 완료** ✅  
**내일부터 Day 1 개발 시작**
