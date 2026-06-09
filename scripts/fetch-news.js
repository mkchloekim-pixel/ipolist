#!/usr/bin/env node
/**
 * 네이버 뉴스 검색 API로 기업별 최신 뉴스를 수집해 news.json을 갱신한다.
 * GitHub Actions에서 매일 1회 실행되며, 결과가 바뀐 경우에만 커밋된다.
 *
 * 필요한 환경변수 (GitHub Secrets):
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
 *
 * 로컬 테스트:
 *   NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy node scripts/fetch-news.js
 */
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OUT_PATH = path.join(__dirname, '..', 'news.json');

const PER_COMPANY = 4;     // 회사당 화면에 표시할 뉴스 개수
const SEARCH_DISPLAY = 20; // 네이버에서 가져올 후보 개수 (정리 후 상위 PER_COMPANY개 사용)

// 회사 key → 네이버 뉴스 검색 쿼리.
// 회사명이 일반 단어와 겹쳐 노이즈가 많으면(예: 그레이스) 브랜드/업종 키워드를 함께 넣어 정확도를 높인다.
// 결과가 엉뚱하게 나오는 회사가 있으면 이 쿼리만 손보면 된다.
const QUERIES = {
  musinsoa:  '무신사',
  kurly:     '컬리',
  ohouse:    '오늘의집',
  oasis:     '오아시스마켓',
  goodai:    '구다이글로벌',
  vinow:     '비나우 넘버즈인',
  grace:     '그레이스 뷰티 유통',
  bnb:       '비앤비코리아',
  '2020':    '이공이공',
  lafati:    '레페리',
  liman:     '리만코리아',
  olive:     '올리브인터내셔널',
  founders:  '더파운더즈 아누아',
  highlight: '하이라이트브랜즈',
  peacenow:  '마르디메크르디',
  hagohouse: '하고하우스',
};

// 제목/본문 키워드 → 태그 (UI의 ntag 클래스와 동일: ipo / invest / global / risk / biz)
const TAG_RULES = [
  ['ipo',    ['상장', 'IPO', '아이피오', '공모', '청약', '예심', '코스닥', '코스피', '주관사', '기업공개', '증시 입성']],
  ['invest', ['투자', '유치', '펀딩', '인수', 'M&A', '엠앤에이', '지분', '프리아이피오', 'pre-ipo', '시리즈']],
  ['global', ['수출', '해외', '글로벌', '미국', '일본', '유럽', '아마존', '세포라', '진출', '북미', '동남아']],
  ['risk',   ['적자', '손실', '논란', '리스크', '부진', '하락', '철회', '연기', '소송', '우려', '감소']],
];

function pickTags(text) {
  const tags = [];
  for (const [tag, kws] of TAG_RULES) {
    if (kws.some(k => text.toLowerCase().includes(k.toLowerCase()))) tags.push(tag);
  }
  if (tags.length === 0) tags.push('biz'); // 기본값: 사업
  return tags.slice(0, 2);                 // 과밀 방지: 최대 2개
}

function clean(s) {
  return String(s || '')
    .replace(/<\/?b>/g, '')      // 검색어 강조 태그 제거
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function toYearMonth(pubDate) {
  // 네이버 pubDate 예: "Mon, 09 Jun 2026 13:00:00 +0900"
  const d = new Date(pubDate);
  if (isNaN(d)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}.${m}`;
}

async function fetchCompany(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${SEARCH_DISPLAY}&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': CLIENT_ID,
      'X-Naver-Client-Secret': CLIENT_SECRET,
    },
  });
  if (!res.ok) {
    throw new Error(`Naver API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return (json.items || [])
    .map(it => {
      const hl = clean(it.title);
      const sum = clean(it.description);
      return {
        date: toYearMonth(it.pubDate),
        hl,
        sum,
        tags: pickTags(`${hl} ${sum}`),
        link: it.originallink || it.link || '',
      };
    })
    .filter(n => n.hl && n.date)
    .slice(0, PER_COMPANY);
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('환경변수 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 가 필요합니다.');
    process.exit(1);
  }

  // 기존 news.json을 읽어, 수집 실패/결과없음 회사는 이전 데이터를 유지한다(데이터 유실 방지).
  let prev = { news: {} };
  try { prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); } catch (_) { /* 첫 실행 */ }
  const out = { news: { ...(prev.news || {}) } };

  for (const [key, query] of Object.entries(QUERIES)) {
    try {
      const news = await fetchCompany(query);
      if (news.length) {
        out.news[key] = news;
        console.log(`✓ ${key} (${query}) — ${news.length}건`);
      } else {
        console.warn(`· ${key} (${query}) — 결과 없음, 이전 데이터 유지`);
      }
    } catch (e) {
      console.warn(`✗ ${key} (${query}) — 실패: ${e.message} / 이전 데이터 유지`);
    }
    await new Promise(r => setTimeout(r, 150)); // 호출 간격 (레이트리밋 여유)
  }

  out.generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`\nnews.json 저장 완료 (${Object.keys(out.news).length}개사)`);
}

main();
