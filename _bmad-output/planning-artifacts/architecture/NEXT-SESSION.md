# NEXT SESSION: Phase 1 Day 1 시작

**대상**: Claude Code (Phase 1 Day 1)  
**날짜**: 내일 (2026-09-30)  
**범위**: 백엔드 프로젝트 초기화 + PostgreSQL 연결 설정

---

## 🚀 시작 체크리스트

### 1. 문서 읽기 (5분)
다음 순서로 읽어라. 아직 코드는 작성하지 마:

1. `_bmad-output/planning-artifacts/architecture/ARCHITECTURE-MVP-FINAL.md`
   - 최종 결정사항, DB 스키마, API 엔드포인트, 보안
   
2. `_bmad-output/planning-artifacts/architecture/PHASE-1-PLAN.md`
   - 폴더 구조, 패키지, 5일 상세 계획
   
3. 현재 파일 (NEXT-SESSION.md)
   - 오늘의 지시사항

### 2. Git 상태 확인 (5분)
```bash
cd /f/start/bridgepath-renewal

# 현재 브랜치 확인 (develop/bmad-setup)
git status

# 최근 커밋 확인
git log --oneline -5

# 현재 코드 상태 확인 (HTML/CSS/JS 파일들 보존되어 있는지)
ls -la
ls -la src/  # 아직 없어야 함
```

### 3. 기존 코드 보존 확인
- [ ] index.html 파일 존재
- [ ] style.css, estimate.css 존재
- [ ] script.js, estimate-common.js 존재
- [ ] 다른 폴더/파일 그대로 유지

---

## 📋 오늘 작업: Day 1

**목표**: Express + TypeScript 기초 + PostgreSQL 연결  
**산출물**: src/ 폴더 구조 + 로거 설정 + .env.example  
**범위**: 코드 작성만 (패키지 설치 X, npm start 테스트도 X)

### 작업 순서

#### 1️⃣ 프로젝트 계획 검토 (작성하지 말 것)
- [ ] PHASE-1-PLAN.md Day 1 섹션 읽기
- [ ] 폴더 구조 이해
- [ ] 오늘 산출물 확인

#### 2️⃣ 작성할 파일 목록 검토
다음 파일들을 **프로젝트 루트**에서 생성할 것:

**설정 파일:**
- `tsconfig.json`
- `.env.example`
- `.gitignore` (기존 파일이 있으면 확인만 하고 추가)

**소스 코드:**
- `src/index.ts` (Express 서버 진입점)
- `src/config/env.ts` (환경 변수 로드)
- `src/config/database.ts` (PostgreSQL 연결 풀)
- `src/utils/logger.ts` (Winston 로거)
- `src/types/models.ts` (TypeScript 모델 - 기본 인터페이스)

**문서:**
- `README.md` (프로젝트 개요)

### 주의사항

#### ⚠️ 하지 말 것
```
✗ npm install (패키지 설치)
✗ npm start (서버 구동 테스트)
✗ 기존 HTML/CSS/JS 파일 수정
✗ DB 마이그레이션 파일 작성 (Day 2에서)
✗ routes/, services/ 폴더 (Day 3+에서)
✗ Heroku, AWS, SendGrid 설정
```

#### ✅ 해야 할 것
```
✓ 폴더 구조 생성 (src/, config/, utils/, types/)
✓ TypeScript 설정 파일 작성
✓ 환경 변수 템플릿 작성 (.env.example)
✓ 진입점 코드 작성 (Express 서버 뼈대)
✓ 로거 설정 (구조는 구성하지만 실제 로깅은 테스트하지 말 것)
✓ git 커밋 (docs + 코드 두 개 커밋 분리 가능)
```

---

## 📝 각 파일별 작성 지침

### 1. tsconfig.json
- target: ES2020
- module: commonjs
- outDir: dist/
- strict: true
- resolveJsonModule: true
- esModuleInterop: true
- skipLibCheck: true

### 2. .env.example
필요한 환경 변수 (실제 값은 없고 템플릿만):
```
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/bridgepath_dev
JWT_SECRET=
JWT_EXPIRATION=8h
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=
SENDGRID_API_KEY=
SUPPORT_EMAIL=contact@bridgepath.co.kr
SUPPORT_PHONE=02-0000-0000
LOG_LEVEL=info
SENTRY_DSN=
```

### 3. src/index.ts
- Express 앱 생성
- 포트 4000에서 리스닝
- CORS 설정 (나중에 프론트엔드 도메인)
- 기본 에러 핸들러 (아직 간단한 형태)
- 서버 구동 시 console.log (로거 테스트는 하지 말 것)
- 마지막에 export default app (테스트용)

### 4. src/config/env.ts
- dotenv 로드
- 환경 변수 타입 정의
- 필수 변수 검증 (없으면 에러)
- 객체로 export

### 5. src/config/database.ts
- PostgreSQL Pool 생성
- DATABASE_URL 파싱
- 연결 옵션 설정 (아직 실제 연결 테스트는 X)
- 타입 정의
- export pool

### 6. src/utils/logger.ts
- Winston 로거 설정
- 콘솔 + 파일 출력
- 구조화된 로그 (timestamp, level, message)
- 환경별 설정 (dev: verbose, prod: info)
- export default logger

### 7. src/types/models.ts
기본 TypeScript 인터페이스 정의:
- AdminUser
- Estimate
- File
- Session
(나중에 추가될 더 많은 타입들의 기초)

### 8. README.md
프로젝트 개요:
- 프로젝트 이름 (Bridge Path MVP)
- 기술 스택
- 폴더 구조
- 환경 설정 방법
- (실제 개발 단계는 아직 쓰지 말 것)

---

## 🎯 검증 체크리스트

### 코드 작성 후 확인할 것

#### 구조 확인
```bash
cd /f/start/bridgepath-renewal

# 폴더 생성 확인
ls -la src/
ls -la src/config/
ls -la src/utils/
ls -la src/types/

# 파일 생성 확인
test -f tsconfig.json && echo "✓ tsconfig.json"
test -f .env.example && echo "✓ .env.example"
test -f src/index.ts && echo "✓ src/index.ts"
test -f src/config/env.ts && echo "✓ src/config/env.ts"
test -f src/config/database.ts && echo "✓ src/config/database.ts"
test -f src/utils/logger.ts && echo "✓ src/utils/logger.ts"
test -f src/types/models.ts && echo "✓ src/types/models.ts"
test -f README.md && echo "✓ README.md"
```

#### TypeScript 문법 확인
```bash
# TypeScript 컴파일 체크 (설치 안 함)
# → 문법 에러 없어야 함 (주석으로 확인)
```

#### 기존 코드 보존 확인
```bash
# 기존 HTML/CSS/JS 파일 확인
ls -la *.html
ls -la *.css
ls -la *.js
# → 모두 그대로 있어야 함
```

#### Git 상태 확인
```bash
git status
# → 변경된 파일: 새로 생성한 파일들만
# → 기존 파일 변경 없음

git diff --check
# → 공백 오류 없음
```

---

## 📌 Git 커밋

작업 후 커밋할 것:

### 커밋 분리 (권장)
```
1. docs: finalize architecture v3 and phase 1 plan
   - ARCHITECTURE-MVP-FINAL.md
   - PHASE-1-PLAN.md
   - NEXT-SESSION.md

2. chore: init backend project structure (phase 1 day 1)
   - src/ 폴더 및 모든 파일들
   - tsconfig.json, .env.example, README.md
```

또는 한 번에:
```
docs: finalize architecture and init backend (phase 1 day 1)
```

---

## ⚡ 주의: 절대 하지 말 것

```
❌ npm install (아직 하지 말 것 - Day 1은 코드만)
❌ npm start (테스트하지 말 것)
❌ Heroku 앱 생성
❌ AWS 키 생성
❌ SendGrid 계정 설정
❌ 기존 HTML/CSS/JS 수정
❌ git checkout / git reset --hard 사용
❌ 이전 커밋 수정/삭제
```

---

## 🔮 내일 끝나면 (Day 2 준비)

Day 1 코드 작성이 끝나면:
- 모든 파일 생성 확인
- git add + git commit
- git push (develop/bmad-setup)
- 다음 세션에 이 파일을 보여주고 "Day 2: 마이그레이션" 진행

---

## 📞 문제 발생 시

만약 뭔가 명확하지 않으면:
- ARCHITECTURE-MVP-FINAL.md 다시 읽기
- PHASE-1-PLAN.md Day 1 섹션 다시 읽기
- 구체적인 질문 하기 (파일명, 함수명, 구조 등)

---

**준비 완료 ✅**  
**내일: Phase 1 Day 1 시작**
