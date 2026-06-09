# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code를 위한 안내 문서입니다.

## 프로젝트 개요

**IPO 상장예정사 대시보드** — 국내 주요 상장예정 기업(버티컬 커머스 / 뷰티 / 패션)의 현황을
한눈에 보여주는 정적 웹 대시보드입니다.

- 단일 HTML 파일: `index.html`
- 빌드 도구·프레임워크·외부 JS 라이브러리 없음 (HTML + 인라인 CSS + 바닐라 JS)
- 브라우저로 파일을 직접 열기만 하면 동작

## 배포 & 버전 관리

- **배포**: [Netlify](https://www.netlify.com/) 에서 호스팅. `main` 브랜치에 push하면
  Netlify가 자동으로 빌드/배포(빌드 단계 없이 정적 파일 그대로 서빙)합니다.
- **소스 코드**: GitHub 저장소 [`mkchloekim-pixel/ipolist`](https://github.com/mkchloekim-pixel/ipolist) 에 저장.
  - 기본 브랜치: `main`
  - Claude Code는 이 GitHub 저장소에 연결되어 있음.

> 변경 사항을 `main`에 push하면 곧바로 운영 사이트에 반영되므로, push 전 변경 내용을
> 다시 확인하세요.

## 코드 구조 (`index.html`)

| 영역 | 대략 위치 | 내용 |
|------|-----------|------|
| CSS | `<style>` 블록 | CSS 변수 기반 디자인 토큰, 테이블·슬라이드 패널·배지 스타일 |
| 헤더/필터 | 상단 | 통계 pill, 업태(버티컬/뷰티/패션) + IPO 추진강도 필터 버튼 |
| 데이터 테이블 | 본문 | 3개 섹션(버티컬·뷰티·패션)에 기업 행을 **하드코딩** |
| 데이터 객체 | `<script>` 내 | `DOMAINS`, `CUSTOM_LOGOS`, `SITE_URLS`, `PROFILES`(기업별 상세) |
| 로직 | `<script>` 하단 | `openProfile()`(상세 패널 렌더), `filterSector()`, `filterMom()` |

### 동작 방식
- 기업 행 클릭 → `openProfile(key)`가 `PROFILES[key]`를 읽어 KPI·IPO 단계바·브랜드·투자·
  뉴스·리스크 HTML을 템플릿 리터럴로 생성하고 우측 슬라이드 패널에 주입.
- 로고는 `CUSTOM_LOGOS`(base64) 우선, 없으면 Google favicon API로 폴백.
- 필터는 DOM의 `data-sector` / `data-mom` 속성으로 행 표시/숨김을 토글.

## 뉴스 자동 업데이트 (네이버 뉴스 API + GitHub Actions)

상세 패널의 "최신 뉴스 타임라인"은 **매일 자동 갱신**된다. 별도 서버 없이 GitHub Actions만으로 동작.

```
GitHub Actions (매일 07:00 KST) → scripts/fetch-news.js → 네이버 뉴스 검색 API
   → news.json 갱신 → 변경 시에만 자동 commit → Netlify 자동 재배포
브라우저: 페이지 로드 시 news.json을 fetch → PROFILES[key].news 로 병합
```

- `scripts/fetch-news.js` — 회사별 검색 쿼리(`QUERIES`)로 네이버 뉴스를 가져와 정리(태그 자동 부여, HTML 태그/엔티티 제거, 날짜 `YYYY.MM` 변환) 후 `news.json` 작성. 수집 실패/결과 없는 회사는 이전 데이터 유지.
- `.github/workflows/update-news.yml` — 매일 cron + 수동 실행(`workflow_dispatch`). `news.json`이 실제로 바뀐 날만 커밋.
- `news.json` — 자동 생성 데이터(기업 key별 `[{date, hl, sum, tags, link}]`). **수동 편집 금지**(다음 실행 때 덮어쓰임).
- 페이지의 `loadLatestNews()` IIFE가 `news.json`을 fetch. **파일이 없거나 실패하면 HTML에 하드코딩된 뉴스로 폴백**하므로, 자동화가 죽어도 화면은 깨지지 않는다.
- 필요한 GitHub Secrets: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (네이버 개발자센터 검색 API 키).
- **검색 결과가 엉뚱한 회사**(예: 회사명이 일반 단어와 겹침)는 `fetch-news.js`의 `QUERIES`에서 해당 쿼리만 손보면 된다.

## 작업 시 주의사항

- **데이터 이중 관리**: 같은 기업 정보가 **테이블 행(HTML)** 과 **`PROFILES` 객체** 양쪽에
  존재합니다. 기업을 추가/수정/삭제할 때는 **반드시 양쪽을 함께 갱신**하고, 헤더의 통계
  pill(총 N개사, 섹션별 개수)과 각 섹션의 `section-count`도 실제 행 수와 맞춰야 합니다.
- 새 기업 추가 시 키 정합성 유지: 테이블 행의 `onclick="openProfile('key')"`,
  `DOMAINS`, `SITE_URLS`(공식 홈페이지 버튼용), `PROFILES`에 동일한 key를 등록.
- `innerHTML`로 데이터를 주입하므로, 외부/사용자 입력을 다루게 되면 XSS에 주의.
