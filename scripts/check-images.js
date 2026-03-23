const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const outputDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });

  // 콘솔 에러 수집
  const consoleErrors = [];
  // 네트워크 실패 수집
  const failedRequests = [];

  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText,
      resourceType: request.resourceType()
    });
  });

  console.log('=== 메인 페이지 접속 중... ===');
  await page.goto('https://ithotdealab.com', { waitUntil: 'networkidle', timeout: 30000 });

  // 페이지 기본 정보
  const title = await page.title();
  console.log('페이지 제목:', title);

  // 스크린샷 찍기
  await page.screenshot({ path: path.join(outputDir, 'main-page.png'), fullPage: false });
  console.log('스크린샷 저장: scripts/screenshots/main-page.png');

  // 전체 페이지 스크린샷
  await page.screenshot({ path: path.join(outputDir, 'main-page-full.png'), fullPage: true });
  console.log('전체 페이지 스크린샷 저장: scripts/screenshots/main-page-full.png');

  // 딜 카드 수 확인
  const dealCards = await page.$$('[class*="card"], article, [class*="deal"]');
  console.log('\n=== 딜 카드 수:', dealCards.length, '===');

  // 이미지 상태 확인
  console.log('\n=== 이미지 로딩 상태 확인 ===');
  const imageResults = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('img'));
    return images.map(img => {
      const rect = img.getBoundingClientRect();
      return {
        src: img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete,
        broken: img.complete && img.naturalWidth === 0,
        alt: img.alt,
        visible: rect.width > 0 && rect.height > 0,
        loading: img.loading
      };
    });
  });

  console.log('총 이미지 수:', imageResults.length);

  const brokenImages = imageResults.filter(img => img.broken);
  const loadedImages = imageResults.filter(img => img.complete && img.naturalWidth > 0);
  const pendingImages = imageResults.filter(img => !img.complete);

  console.log('로딩 완료:', loadedImages.length);
  console.log('깨진 이미지:', brokenImages.length);
  console.log('로딩 중(lazy):', pendingImages.length);

  if (brokenImages.length > 0) {
    console.log('\n--- 깨진 이미지 목록 ---');
    brokenImages.forEach((img, i) => {
      console.log(`[${i+1}] ${img.src}`);
      console.log(`     alt: ${img.alt}`);
    });
  }

  // lazy 이미지를 위해 스크롤 후 재확인
  console.log('\n=== 스크롤 후 lazy 이미지 로딩 대기 ===');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  const imageResultsAfterScroll = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('img'));
    return images.map(img => ({
      src: img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      broken: img.complete && img.naturalWidth === 0,
      alt: img.alt
    }));
  });

  const brokenAfterScroll = imageResultsAfterScroll.filter(img => img.broken);
  const loadedAfterScroll = imageResultsAfterScroll.filter(img => img.complete && img.naturalWidth > 0);

  console.log('스크롤 후 로딩 완료:', loadedAfterScroll.length);
  console.log('스크롤 후 깨진 이미지:', brokenAfterScroll.length);

  if (brokenAfterScroll.length > 0) {
    console.log('\n--- 스크롤 후 깨진 이미지 목록 ---');
    brokenAfterScroll.forEach((img, i) => {
      console.log(`[${i+1}] ${img.src}`);
    });
  }

  // 이미지 도메인 분석
  console.log('\n=== 이미지 도메인 분석 ===');
  const domainCount = {};
  imageResultsAfterScroll.forEach(img => {
    try {
      if (img.src && img.src.startsWith('http')) {
        const domain = new URL(img.src).hostname;
        domainCount[domain] = (domainCount[domain] || 0) + 1;
      }
    } catch(e) {}
  });
  Object.entries(domainCount).sort((a, b) => b[1] - a[1]).forEach(([domain, count]) => {
    console.log(`  ${domain}: ${count}개`);
  });

  // 실패한 네트워크 요청
  console.log('\n=== 실패한 네트워크 요청 ===');
  if (failedRequests.length === 0) {
    console.log('실패한 요청 없음');
  } else {
    failedRequests.forEach((req, i) => {
      console.log(`[${i+1}] [${req.resourceType}] ${req.url}`);
      console.log(`     에러: ${req.failure}`);
    });
  }

  // 콘솔 에러
  console.log('\n=== 콘솔 에러 ===');
  if (consoleErrors.length === 0) {
    console.log('콘솔 에러 없음');
  } else {
    consoleErrors.forEach((err, i) => {
      console.log(`[${i+1}] ${err}`);
    });
  }

  // 404 이미지 확인 (HTTP 응답 코드)
  console.log('\n=== 이미지 HTTP 응답 확인 (샘플) ===');
  const imagesToCheck = imageResultsAfterScroll
    .filter(img => img.src && img.src.startsWith('http'))
    .slice(0, 15);

  for (const img of imagesToCheck) {
    try {
      const response = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
          return { status: res.status, ok: res.ok };
        } catch(e) {
          return { error: e.message };
        }
      }, img.src);
      const status = response.error ? `ERROR: ${response.error}` : `${response.status}`;
      const broken = img.broken ? ' [BROKEN]' : '';
      console.log(`  ${status}${broken} | ${img.src.substring(0, 100)}`);
    } catch(e) {
      console.log(`  CHECK_ERROR | ${img.src.substring(0, 80)}`);
    }
  }

  // 최종 스크린샷 (스크롤 후)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outputDir, 'main-final.png'), fullPage: false });

  // 모든 이미지 src 목록 출력
  console.log('\n=== 전체 이미지 src 목록 ===');
  imageResultsAfterScroll.forEach((img, i) => {
    const status = img.broken ? '[BROKEN]' : img.complete ? '[OK]' : '[PENDING]';
    console.log(`${status} ${img.src ? img.src.substring(0, 120) : '(src 없음)'}`);
  });

  await browser.close();
  console.log('\n=== 완료 ===');
})();
