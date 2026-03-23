const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DEALS = [
  'https://ithotdealab.com/deal/cmm654j9t000104last742qby',
  'https://ithotdealab.com/deal/cmm5vu4kw000004jpslrrcdwj',
];

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  for (let i = 0; i < DEALS.length; i++) {
    const url = DEALS[i];
    const dealId = url.split('/').pop();
    console.log(`\n========== 딜 ${i + 1}: ${url} ==========`);

    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('requestfailed', request => {
      networkErrors.push(`FAILED: ${request.url()} - ${request.failure()?.errorText}`);
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // 페이지 제목
      const title = await page.title();
      console.log(`페이지 제목: ${title}`);

      // 이미지 요소 찾기
      const images = await page.$$eval('img', imgs => {
        return imgs.map(img => ({
          src: img.src,
          currentSrc: img.currentSrc,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          complete: img.complete,
          alt: img.alt,
          className: img.className,
          width: img.offsetWidth,
          height: img.offsetHeight,
          isVisible: img.offsetWidth > 0 && img.offsetHeight > 0,
        }));
      });

      console.log(`\n총 이미지 수: ${images.length}`);
      images.forEach((img, idx) => {
        const status = img.naturalWidth > 0 ? '로드 성공' : '로드 실패/미완료';
        const visible = img.isVisible ? '표시됨' : '숨김';
        console.log(`  [이미지 ${idx + 1}] ${status} | ${visible}`);
        console.log(`    src: ${img.src}`);
        console.log(`    naturalSize: ${img.naturalWidth}x${img.naturalHeight}`);
        console.log(`    offsetSize: ${img.width}x${img.height}`);
        console.log(`    alt: ${img.alt}`);
        if (img.className) console.log(`    class: ${img.className}`);
      });

      // 메인 딜 이미지 (next/image 또는 큰 이미지)
      const mainImages = images.filter(img => img.width > 100 && img.height > 100);
      console.log(`\n메인 이미지(100px 이상): ${mainImages.length}개`);
      mainImages.forEach((img, idx) => {
        const loaded = img.naturalWidth > 0 ? '✓ 로드됨' : '✗ 실패';
        console.log(`  [${idx + 1}] ${loaded} | ${img.naturalWidth}x${img.naturalHeight} | ${img.src}`);
      });

      // 스크린샷
      const screenshotPath = path.join(SCREENSHOTS_DIR, `deal-${i + 1}-${dealId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`\n스크린샷 저장: ${screenshotPath}`);

      // 콘솔 에러
      if (consoleErrors.length > 0) {
        console.log('\n콘솔 에러:');
        consoleErrors.forEach(e => console.log(`  ERROR: ${e}`));
      } else {
        console.log('\n콘솔 에러: 없음');
      }

      // 네트워크 에러
      const imgNetworkErrors = networkErrors.filter(e => e.match(/\.(jpg|jpeg|png|gif|webp|avif)/i));
      if (imgNetworkErrors.length > 0) {
        console.log('\n이미지 네트워크 에러:');
        imgNetworkErrors.forEach(e => console.log(`  ${e}`));
      } else {
        console.log('이미지 네트워크 에러: 없음');
      }

    } catch (err) {
      console.log(`오류 발생: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log('\n===== 완료 =====');
})();
