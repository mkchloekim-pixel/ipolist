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
const SEARCH_DISPLAY = 30; // 네이버에서 가져올 후보 개수 (필터 후 상위 PER_COMPANY개 사용)

// 회사 key → { q: 검색 쿼리, must: 필수 키워드[] }
//  - q:    네이버 뉴스 검색어 (관련도순 sort=sim 으로 조회)
//  - must: 제목/본문에 이 중 하나라도 없으면 노이즈로 보고 버림 (회사명·대표 브랜드).
//          회사명이 일반어와 겹치는 경우(이공이공·그레이스·올리브 등) 정확도의 핵심.
//  결과가 엉뚱하면 이 표의 q/must 만 손보면 된다. 관련 뉴스가 0건이면 화면은 기존 큐레이션 뉴스로 폴백.
const COMPANIES = {
  musinsoa:  { q: '무신사',                       must: ['무신사'] },
  kurly:     { q: '컬리 마켓컬리',                 must: ['컬리'] },
  ohouse:    { q: '오늘의집',                     must: ['오늘의집'] },
  oasis:     { q: '오아시스마켓',                 must: ['오아시스'] },
  goodai:    { q: '구다이글로벌',                 must: ['구다이'] },
  vinow:     { q: '비나우 넘버즈인',              must: ['비나우', '넘버즈인'] },
  grace:     { q: '그레이스 뷰티 유통',           must: ['그레이스'] },
  bnb:       { q: '비앤비코리아',                 must: ['비앤비코리아'] },   // '에어비앤비' 제외
  '2020':    { q: '이공이공 뷰티',                must: ['이공이공'] },
  lafati:    { q: '레페리 뷰티',                  must: ['레페리'] },
  liman:     { q: '리만코리아',                   must: ['리만코리아', '리만'] },
  olive:     { q: '올리브인터내셔널',             must: ['올리브인터내셔널'] }, // 'CJ올리브영' 제외
  founders:  { q: '더파운더즈 아누아',            must: ['더파운더즈', '아누아'] },
  highlight: { q: '하이라이트브랜즈',             must: ['하이라이트브랜즈'] },
  peacenow:  { q: '피스피스스튜디오 마르디메크르디', must: ['피스피스', '마르디'] },
  hagohouse: { q: '하고하우스',                   must: ['하고하우스'] },
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

async function fetchCompany(q, must) {
  // sort=sim: 관련도순 (date순은 회사명이 일반어와 겹칠 때 엉뚱한 최신기사를 끌어옴)
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=${SEARCH_DISPLAY}&sort=sim`;
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
  const keywords = (must && must.length) ? must : [q];
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
    // 관련성 가드: 제목/본문에 필수 키워드가 하나도 없으면 노이즈로 보고 제외
    .filter(n => keywords.some(k => `${n.hl} ${n.sum}`.includes(k)))
    .sort((a, b) => b.date.localeCompare(a.date)) // 관련 기사 중 최신순
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

  for (const [key, c] of Object.entries(COMPANIES)) {
    try {
      // 성공 시: 관련 뉴스 배열로 교체(0건이면 빈 배열 → 화면은 큐레이션 뉴스로 폴백)
      const news = await fetchCompany(c.q, c.must);
      out.news[key] = news;
      console.log(`${news.length ? '✓' : '·'} ${key} (${c.q}) — ${news.length}건${news.length ? '' : ' (폴백: 기본 뉴스)'}`);
    } catch (e) {
      // API 오류 등 예외 시에만: 이전 데이터 유지 (일시적 장애로 데이터가 사라지지 않게)
      console.warn(`✗ ${key} (${c.q}) — 실패: ${e.message} / 이전 데이터 유지`);
    }
    await new Promise(r => setTimeout(r, 150)); // 호출 간격 (레이트리밋 여유)
  }

  out.generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`\nnews.json 저장 완료 (${Object.keys(out.news).length}개사)`);
}

main();
