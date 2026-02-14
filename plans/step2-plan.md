# Step 2 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-14
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step1-plan.md`

---

## Step 2: SQLite DB 연결 & 스키마 생성

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 2-1 | 마이그레이션 전략 | 하이브리드 (초기 자동 `CREATE IF NOT EXISTS` + `schema_versions` 버전 테이블) | MVP는 자동으로 충분, 향후 ALTER TABLE 대비 |
| 2-2 | DB 파일 위치 | 환경변수 + 기본값 폴백 (`process.env.DATABASE_PATH \|\| path.join(cwd, 'data', 'blog.db')`) | 개발은 설정 없이 동작, 프로덕션은 systemd에서 절대경로 지정 |
| 2-3 | WAL pragma | WAL + `foreign_keys` + `busy_timeout` + `synchronous=NORMAL` + `cache_size=-2000` | 1GB RAM에서 성능+안전성 최적 조합, 캐시 제한으로 메모리 과사용 방지 |
| 2-4 | 네이티브 바인딩 | GitHub Actions/배포 VM의 OS·아키텍처·libc 일치 시 prebuild 사용, 미일치 시 source build 전제 + Step 6에서 호환성 검증 | prebuild는 환경 일치 조건에서만 안정적이며, 불일치 시 빌드 도구체인 준비가 필요 |
| 2-5 | 메일링 대비 인덱스 | `posts(status, published_at DESC)` 복합 인덱스 선반영 | 일간/주간 다이제스트 후보 조회(`status='published' AND published_at BETWEEN ...`) 최적화 |

> **의존성 영향**: 마이그레이션 → Step 6 배포 시 실행 순서 / DB 위치 → Step 7 systemd 환경변수 / 바인딩 → Step 6 CI 빌드 / 복합 인덱스 → Phase 4 메일링 조회 성능

#### 선행 조건 (Preflight)

- 의존성 설치:
  - `npm install better-sqlite3`
  - `npm install -D @types/better-sqlite3 tsx`
- 스크립트 등록:
  - `package.json`에 `"db:migrate": "npx tsx scripts/migrate.ts"` 추가
  - `package.json`에 `"test:step2": "node scripts/test-step-2.mjs"` 추가
- Step 2 영향 파일:
  - `package.json`, `package-lock.json`
  - `src/lib/db.ts`
  - `scripts/migrate.ts`
  - `scripts/test-step-2.mjs`

#### 운영 확정값 (관점 5 반영)

- 마이그레이션 버전 규칙: `schema_versions.version`은 `1, 2, 3...` 단순 정수 증가만 사용한다.
- 프로덕션 DB 경로 표준: `DATABASE_PATH=/opt/blog/data/blog.db`를 기본 운영값으로 사용한다.
- 마이그레이션 실행 트리거: 배포 시 `npm run db:migrate`를 명시 실행하고, 앱 시작 시 `getDb()`의 자동 마이그레이션(idempotent)을 이중 안전장치로 유지한다.

#### 구현 착수 체크포인트

- `package.json`에 `db:migrate`, `test:step2` 스크립트가 등록되어 있어야 한다.
- `src/lib/db.ts`, `scripts/migrate.ts`, `scripts/test-step-2.mjs`에서 placeholder 문구가 제거되어 있어야 한다.
- 위 항목 충족 후 Gate 테스트(`npm run db:migrate`, `npm run test:step2`)를 실행한다.

#### 구현 내용

**2-0. Placeholder 교체 (현재 코드베이스 기준)**

- `src/lib/db.ts`의 placeholder 구현을 실제 DB 연결 싱글턴 + pragma + 마이그레이션 호출 구조로 교체
- `scripts/migrate.ts`의 placeholder 로그를 실제 스키마 생성 SQL 실행 코드로 교체
- `scripts/test-step-2.mjs`의 placeholder 로그를 실제 Step 2 Gate Criteria 검증 코드로 교체

**2-1. `src/lib/db.ts` — DB 연결 싱글턴**

```ts
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH =
  process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'blog.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');       // 읽기/쓰기 동시 가능
    db.pragma('foreign_keys = ON');        // 외래키 강제
    db.pragma('busy_timeout = 5000');      // 잠금 대기 5초
    db.pragma('synchronous = NORMAL');     // WAL 환경에서 성능/안정성 균형
    db.pragma('cache_size = -2000');       // 약 2MB 권장 페이지 캐시 상한
  }
  return db;
}
```

핵심 포인트:
- WAL 모드: SSR 읽기와 API 쓰기가 동시에 가능
- WAL 제약: 동시에 하나의 writer만 허용되며, 경합 시 `busy_timeout`으로 대기
- 싱글턴 패턴: Next.js의 hot reload에서 DB 연결 중복 방지
- `data/` 디렉토리는 gitignore, 배포 시 별도 관리

**2-2. `scripts/migrate.ts` — 스키마 마이그레이션**

```sql
-- posts 테이블
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'published')),
  source_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

-- tags 테이블
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- post_tags (다대다)
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- sources (AI 스크래핑 추적)
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL UNIQUE,
  post_id     INTEGER REFERENCES posts(id),
  scraped_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ai_model    TEXT,
  prompt_hint TEXT
);

-- schema_versions (마이그레이션 버전 추적)
CREATE TABLE IF NOT EXISTS schema_versions (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

-- FTS5 전문 검색
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, content, content='posts', content_rowid='id'
);

-- FTS 트리거
CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO posts_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_status_published_at ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
```

마이그레이션 실행 방식:
- `scripts/migrate.ts`에서 위 SQL을 `db.exec()`로 실행
- npm script 등록: `"db:migrate": "npx tsx scripts/migrate.ts"`
- 앱 시작 시에도 `getDb()` 호출 시 마이그레이션 자동 실행 (idempotent)
- CI 검증: `npm ci` 단계에서 better-sqlite3 prebuild 실패 로그를 감지하고, 필요 시 source build를 위한 컴파일러 도구체인 준비 여부를 확인

#### 통과 기준 (Gate Criteria)

- 마이그레이션 결과로 핵심 스키마(`posts`, `tags`, `post_tags`, `sources`, `schema_versions`, `posts_fts`)가 생성되어야 한다.
- DB 연결 시 WAL/foreign key/busy timeout/동기화/캐시 pragma가 의도한 값으로 적용되어야 한다.
- FTS5 가상 테이블과 트리거가 동작해 `posts` 변경이 검색 인덱스에 반영되어야 한다.
- CHECK/FK/CASCADE 제약이 의도대로 강제되어 데이터 무결성이 유지되어야 한다.

#### 완료 정의 (Definition of Done)

- `npm run db:migrate`가 종료 코드 `0`으로 완료된다.
- `npm run test:step2`가 종료 코드 `0`으로 완료된다.
- `data/blog.db` 파일이 생성되고, `PRAGMA journal_mode`가 `wal`로 확인된다.
- 테스트 검증 항목(스키마, WAL, CRUD, FTS5, FK/CASCADE, CHECK, 멱등성)이 모두 통과한다.

#### 자동화 실행

```bash
npm run test:step2
```

> `scripts/test-step-2.mjs` — 마이그레이션, 스키마 검증, WAL 모드, CRUD, FTS5, 외래키 CASCADE, CHECK 제약, 멱등성을 한 번에 검증.
> 테스트용 임시 DB(`data/test-blog.db`)를 생성하여 실행 후 자동 삭제. 기존 DB에 영향 없음.

#### 실패/복구 절차

1. `npm run db:migrate` 실패 시 로그를 먼저 확인한다.
2. DB 파일 손상 의심 시 `sqlite3 data/blog.db "PRAGMA integrity_check;"`로 무결성을 점검한다.
3. 복구 가능한 백업이 있으면 `sqlite3 .backup`으로 생성한 최신 백업에서 DB를 복원한다.
4. 복원 후 `npm run db:migrate`와 `npm run test:step2`를 순서대로 재실행한다.

#### 테스트 목록

> 참고: 아래 코드 블록은 이해를 돕는 예시이며, 최종 합격 판정은 `scripts/test-step-2.mjs` 실행 결과를 기준으로 한다.

1. **마이그레이션 실행 & DB 파일 생성**
   ```bash
   npm run db:migrate
   test -f data/blog.db && echo "DB_EXISTS" || echo "DB_MISSING"
   ```
   - 기대 결과: `DB_EXISTS`, 종료 코드 `0`
   - 실패 시: `data/` 디렉토리 존재 여부, better-sqlite3 네이티브 바인딩 빌드 여부

2. **테이블 스키마 검증** (`scripts/test-step-2.mjs` 내부 검증)
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   const tables = db.prepare(
     "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
   ).all().map(r => r.name);
   const expected = ['post_tags', 'posts', 'posts_fts', 'schema_versions', 'sources', 'tags'];
   const missing = expected.filter(t => !tables.includes(t));
   if (missing.length > 0) {
     console.error('MISSING TABLES:', missing);
     process.exit(1);
   }
   console.log('ALL TABLES EXIST:', tables);

   const postCols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
   const requiredCols = ['id','title','slug','content','status','source_url','created_at','updated_at','published_at'];
   const missingCols = requiredCols.filter(c => !postCols.includes(c));
   if (missingCols.length > 0) {
     console.error('MISSING COLUMNS in posts:', missingCols);
     process.exit(1);
   }
   console.log('POSTS COLUMNS OK:', postCols);
   db.close();
   ```
   - 기대 결과: 모든 테이블 및 컬럼 존재 확인

3. **WAL 모드 활성화 확인**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   const mode = db.pragma('journal_mode', { simple: true });
   console.log('JOURNAL_MODE:', mode);  // 'wal'
   db.close();
   ```
   - 기대 결과: journal_mode가 `wal`
   - 참고: `blog.db-wal` 파일은 연결 종료/체크포인트 시 사라질 수 있으므로 상시 존재를 합격 기준으로 사용하지 않는다.

4. **CRUD 통합 테스트** (`scripts/test-step-2.mjs` 내부 검증)
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   db.pragma('journal_mode = WAL');
   db.pragma('foreign_keys = ON');

   // CREATE
   const insert = db.prepare(
     `INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`
   );
   const result = insert.run('테스트 글', 'test-post', '# 테스트 내용', 'draft');
   console.log('INSERT id:', result.lastInsertRowid);

   // READ
   const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
   if (post.title !== '테스트 글') throw new Error('READ FAILED');
   console.log('READ OK');

   // UPDATE
   db.prepare('UPDATE posts SET status = ? WHERE id = ?').run('published', result.lastInsertRowid);
   const updated = db.prepare('SELECT status FROM posts WHERE id = ?').get(result.lastInsertRowid);
   if (updated.status !== 'published') throw new Error('UPDATE FAILED');
   console.log('UPDATE OK');

   // DELETE
   db.prepare('DELETE FROM posts WHERE id = ?').run(result.lastInsertRowid);
   const deleted = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
   if (deleted) throw new Error('DELETE FAILED');
   console.log('DELETE OK');

   console.log('ALL CRUD TESTS PASSED');
   db.close();
   ```

5. **FTS5 전문 검색 테스트**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   db.pragma('journal_mode = WAL');
   db.pragma('foreign_keys = ON');

   db.prepare(`INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`)
     .run('JavaScript 비동기 프로그래밍', 'js-async', 'Promise와 async/await 패턴 설명', 'published');
   db.prepare(`INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`)
     .run('Python 머신러닝 입문', 'python-ml', 'scikit-learn으로 시작하는 ML', 'published');

   const results = db.prepare(
     `SELECT rowid, title FROM posts_fts WHERE posts_fts MATCH ?`
   ).all('JavaScript');
   if (results.length === 0) throw new Error('FTS SEARCH RETURNED NO RESULTS');
   if (!results[0].title.includes('JavaScript')) throw new Error('FTS RESULT MISMATCH');

   db.prepare('DELETE FROM posts').run();
   console.log('FTS5 TEST PASSED');
   db.close();
   ```

6. **외래키 & CASCADE 삭제 테스트**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   db.pragma('journal_mode = WAL');
   db.pragma('foreign_keys = ON');

   const postId = db.prepare(
     `INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`
   ).run('FK 테스트', 'fk-test', '내용', 'draft').lastInsertRowid;
   const tagId = db.prepare(`INSERT INTO tags (name) VALUES (?)`).run('test-tag').lastInsertRowid;
   db.prepare(`INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)`).run(postId, tagId);

   db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
   const orphan = db.prepare('SELECT * FROM post_tags WHERE post_id = ?').get(postId);
   if (orphan) throw new Error('CASCADE DELETE FAILED');

   db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
   console.log('FOREIGN KEY CASCADE TEST PASSED');
   db.close();
   ```

7. **status CHECK 제약조건 테스트**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   try {
     db.prepare(`INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`)
       .run('잘못된 상태', 'bad-status', '내용', 'invalid_status');
     console.error('CHECK CONSTRAINT FAILED: should have thrown');
     process.exit(1);
   } catch (e) {
     console.log('CHECK CONSTRAINT OK:', e.message);
   }
   db.close();
   ```

8. **마이그레이션 멱등성(idempotent) 테스트**
   ```bash
   npm run db:migrate && npm run db:migrate
   echo $?
   ```
   - 기대 결과: 두 번 연속 실행해도 종료 코드 `0`, 에러 없음

#### 피드백 루프

- 이전 단계: better-sqlite3 네이티브 바인딩 빌드 실패 시 Step 1 의존성 설치 재점검
- 다음 단계: 스키마가 올바르지 않으면 Step 3의 모든 API가 실패. FTS5가 동작하지 않으면 Phase 3 검색 기능 불가능.
- 회귀 테스트: Step 3~5 구현 중 매 단계 종료 시 `npm run test:all`을 재실행해 Step 1~2 포함 전체를 검증하고, 실패 시 수정 후 전체를 다시 실행한다.

---
