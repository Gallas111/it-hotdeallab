const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const SITE_URL = 'https://ithotdealab.com';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// HTTP HEAD 요청으로 상태코드 확인
function checkUrl(url, timeout = 10000) {
  return new Promise(resolve => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'HEAD', timeout }, res => {
      resolve({ url, status: res.statusCode, headers: res.headers });
    });
    req.on('error', err => resolve({ url, status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 0, error: 'timeout' }); });
    req.end();
  });
}

// 결과 집계
const results = { pass: 0, warn: 0, fail: 0, items: [] };
function report(level, section, msg) {
  const icon = level === 'PASS' ? '[OK]' : level === 'WARN' ? '[!!]' : '[XX]';
  console.log(`  ${icon} ${msg}`);
  results.items.push({ level, section, msg });
  if (level === 'PASS') results.pass++;
  else if (level === 'WARN') results.warn++;
  else results.fail++;
}

(async () => {
  console.log(`\n========================================`);
  console.log(`  IT핫딜랩 사이트 전체 점검`);
  console.log(`  ${new Date().toLocaleString('ko-KR')}`);
  console.log(`========================================\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('[PAGE ERROR] ' + err.message));
  page.on('requestfailed', req => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  // ──────────────────────────────────────────
  // 1. 메인 페이지 접속
  // ──────────────────────────────────────────
  console.log('[1] 메인 페이지 접속');
  let mainResponse;
  try {
    mainResponse = await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    const status = mainResponse.status();
    if (status === 200) report('PASS', 'main', `메인 페이지 HTTP ${status}`);
    else report('FAIL', 'main', `메인 페이지 HTTP ${status}`);
  } catch (e) {
    report('FAIL', 'main', `메인 페이지 접속 실패: ${e.message}`);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_main.png'), fullPage: true });

  // ──────────────────────────────────────────
  // 2. 딜 카드 현황
  // ──────────────────────────────────────────
  console.log('\n[2] 딜 카드 현황');
  const cards = await page.$$eval('a[href*="/deal/"]', els => els.map(el => {
    const img = el.querySelector('img');
    return {
      href: el.href,
      hasImg: !!img,
      imgSrc: img ? img.src : null,
      imgNaturalWidth: img ? img.naturalWidth : 0,
      imgLoaded: img ? img.complete && img.naturalWidth > 0 : false,
      title: el.textContent.trim().slice(0, 60),
    };
  }));

  if (cards.length >= 5) report('PASS', 'cards', `딜 카드 ${cards.length}개 표시`);
  else if (cards.length > 0) report('WARN', 'cards', `딜 카드 ${cards.length}개 (5개 미만)`);
  else report('FAIL', 'cards', '딜 카드 0개 - 목록이 비어있음');

  // ──────────────────────────────────────────
  // 3. 이미지 로드 상태 (브라우저 렌더링 기준)
  // ──────────────────────────────────────────
  console.log('\n[3] 이미지 렌더링 상태');
  const imgCards = cards.filter(c => c.hasImg);
  const loadedCards = cards.filter(c => c.imgLoaded);
  const brokenCards = imgCards.filter(c => !c.imgLoaded);

  if (imgCards.length === 0) {
    report('WARN', 'img-render', '이미지가 있는 카드 없음');
  } else {
    const loadRate = Math.round((loadedCards.length / imgCards.length) * 100);
    if (loadRate >= 90) report('PASS', 'img-render', `이미지 렌더링 ${loadRate}% (${loadedCards.length}/${imgCards.length})`);
    else if (loadRate >= 50) report('WARN', 'img-render', `이미지 렌더링 ${loadRate}% (${loadedCards.length}/${imgCards.length})`);
    else report('FAIL', 'img-render', `이미지 렌더링 ${loadRate}% (${loadedCards.length}/${imgCards.length}) - 대부분 깨짐!`);

    if (brokenCards.length > 0) {
      brokenCards.slice(0, 5).forEach(c => {
        console.log(`       깨진 이미지: ${(c.imgSrc || '').slice(0, 100)}`);
      });
    }
  }

  // ──────────────────────────────────────────
  // 4. 이미지 HTTP 상태 코드 점검 (핵심!)
  // ──────────────────────────────────────────
  console.log('\n[4] 이미지 HTTP 상태 코드 점검');
  const imgUrls = [...new Set(cards.filter(c => c.imgSrc).map(c => c.imgSrc))].slice(0, 10);

  if (imgUrls.length === 0) {
    report('WARN', 'img-http', '점검할 이미지 URL 없음');
  } else {
    const imgResults = await Promise.all(imgUrls.map(u => checkUrl(u)));
    const ok = imgResults.filter(r => r.status >= 200 && r.status < 400);
    const paymentRequired = imgResults.filter(r => r.status === 402);
    const otherErrors = imgResults.filter(r => r.status === 0 || r.status >= 400);

    if (paymentRequired.length > 0) {
      report('FAIL', 'img-http', `이미지 402 Payment Required ${paymentRequired.length}개 - Vercel 이미지 최적화 한도 초과!`);
      console.log('       >> next/image 대신 <img> 태그를 사용하거나 Vercel Pro로 업그레이드 필요');
    }
    if (ok.length === imgUrls.length) {
      report('PASS', 'img-http', `이미지 HTTP 전부 정상 (${ok.length}/${imgUrls.length})`);
    } else if (ok.length > 0) {
      const failedImgs = imgResults.filter(r => r.status === 0 || r.status >= 400);
      report('WARN', 'img-http', `이미지 HTTP 일부 실패 (정상 ${ok.length}/${imgUrls.length})`);
      failedImgs.slice(0, 3).forEach(r => {
        console.log(`       HTTP ${r.status}${r.error ? ' (' + r.error + ')' : ''}: ${r.url.slice(0, 100)}`);
      });
    } else {
      report('FAIL', 'img-http', `이미지 HTTP 전부 실패 (0/${imgUrls.length})`);
      imgResults.slice(0, 3).forEach(r => {
        const vercelErr = r.headers?.['x-vercel-error'] || '';
        console.log(`       HTTP ${r.status} ${vercelErr}: ${r.url.slice(0, 100)}`);
      });
    }
  }

  // ──────────────────────────────────────────
  // 5. 헬스체크 API
  // ──────────────────────────────────────────
  console.log('\n[5] 헬스체크 API');
  try {
    const healthRes = await page.goto(`${SITE_URL}/api/monitor/health`, { waitUntil: 'networkidle', timeout: 15000 });
    const healthData = JSON.parse(await healthRes.text());
    if (healthData.status === 'healthy') {
      report('PASS', 'health', `API 정상 - 딜 ${healthData.totalDeals}개, 최신 ${healthData.hoursSinceLatest}시간 전`);
    } else {
      report('FAIL', 'health', `API 비정상 - ${JSON.stringify(healthData)}`);
    }
  } catch (e) {
    report('FAIL', 'health', `헬스체크 API 실패: ${e.message}`);
  }

  // ──────────────────────────────────────────
  // 6. 상세 페이지 점검
  // ──────────────────────────────────────────
  console.log('\n[6] 상세 페이지 점검');
  if (cards.length > 0) {
    const detailUrl = cards[0].href;
    try {
      const detailRes = await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 20000 });
      const detailStatus = detailRes.status();
      if (detailStatus === 200) report('PASS', 'detail', `상세 페이지 HTTP ${detailStatus}`);
      else report('FAIL', 'detail', `상세 페이지 HTTP ${detailStatus}`);

      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_detail.png'), fullPage: true });

      // OG 태그
      const ogTitle = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => null);
      const ogImage = await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
      if (ogTitle) report('PASS', 'detail', `OG 태그 정상 (title: ${ogTitle.slice(0, 40)})`);
      else report('WARN', 'detail', 'og:title 없음');
      if (ogImage) report('PASS', 'detail', `og:image 존재`);
      else report('WARN', 'detail', 'og:image 없음');

    } catch (e) {
      report('FAIL', 'detail', `상세 페이지 접속 실패: ${e.message}`);
    }
  }

  // ──────────────────────────────────────────
  // 7. CTA 버튼 커뮤니티 링크 탐지
  // ──────────────────────────────────────────
  console.log('\n[7] CTA 커뮤니티 링크 탐지 (최대 8개 딜)');
  const communityKeywords = ['ppomppu', 'clien', 'ruliweb', 'quasarzone', 'fm.', 'arca.live', 'mlbpark', 'dcinside'];
  const dealUrls = [...new Set(cards.map(c => c.href))].slice(0, 8);
  let communityCtaCount = 0;

  for (const url of dealUrls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(500);
      const ctaBtns = await page.$$eval('a', els =>
        els.map(el => ({ text: el.textContent.trim().slice(0, 80), href: el.href }))
           .filter(el => /구매|바로가기|보러가기|쇼핑/i.test(el.text))
      );
      const commCta = ctaBtns.filter(b => communityKeywords.some(k => b.href.includes(k)));
      if (commCta.length > 0) {
        communityCtaCount++;
        report('FAIL', 'cta', `커뮤니티 CTA 발견: ${url}`);
        commCta.forEach(b => console.log(`       "${b.text}" -> ${b.href.slice(0, 80)}`));
      }
    } catch { /* skip */ }
  }
  if (communityCtaCount === 0) report('PASS', 'cta', '커뮤니티 CTA 링크 없음');

  // ──────────────────────────────────────────
  // 8. 네트워크 에러 & 콘솔 에러
  // ──────────────────────────────────────────
  console.log('\n[8] 네트워크 & 콘솔 에러');
  const criticalFailed = failedRequests.filter(r => !r.url.includes('googletagmanager') && !r.url.includes('analytics'));
  if (criticalFailed.length === 0) report('PASS', 'network', '네트워크 에러 없음');
  else {
    report('WARN', 'network', `네트워크 실패 ${criticalFailed.length}건`);
    criticalFailed.slice(0, 5).forEach(r => console.log(`       ${r.failure}: ${r.url.slice(0, 100)}`));
  }

  const criticalConsole = consoleErrors.filter(e => !e.includes('googletagmanager') && !e.includes('favicon'));
  if (criticalConsole.length === 0) report('PASS', 'console', '콘솔 에러 없음');
  else {
    report('WARN', 'console', `콘솔 에러 ${criticalConsole.length}건`);
    criticalConsole.slice(0, 5).forEach(e => console.log(`       ${e.slice(0, 120)}`));
  }

  // ──────────────────────────────────────────
  // 9. _next/image 프록시 사용 여부 (402 예방)
  // ──────────────────────────────────────────
  console.log('\n[9] Vercel 이미지 최적화 사용 여부');
  await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  const nextImageUsed = await page.$$eval('img', imgs =>
    imgs.filter(img => img.src.includes('/_next/image')).length
  );
  if (nextImageUsed === 0) report('PASS', 'next-image', 'next/image 프록시 미사용 (402 위험 없음)');
  else report('WARN', 'next-image', `next/image 프록시 사용 ${nextImageUsed}건 - Vercel 한도 초과 시 이미지 깨짐 위험`);

  // ──────────────────────────────────────────
  // 최종 요약
  // ──────────────────────────────────────────
  await browser.close();

  console.log(`\n========================================`);
  console.log(`  점검 결과 요약`);
  console.log(`========================================`);
  console.log(`  [OK] 통과: ${results.pass}건`);
  console.log(`  [!!] 경고: ${results.warn}건`);
  console.log(`  [XX] 실패: ${results.fail}건`);
  console.log(`========================================`);

  if (results.fail > 0) {
    console.log('\n  실패 항목:');
    results.items.filter(i => i.level === 'FAIL').forEach(i => {
      console.log(`    [XX] ${i.msg}`);
    });
  }
  if (results.warn > 0) {
    console.log('\n  경고 항목:');
    results.items.filter(i => i.level === 'WARN').forEach(i => {
      console.log(`    [!!] ${i.msg}`);
    });
  }

  console.log(`\n  스크린샷: ${SCREENSHOT_DIR}`);
  console.log(`  완료: ${new Date().toLocaleString('ko-KR')}\n`);

  process.exit(results.fail > 0 ? 1 : 0);
})();
