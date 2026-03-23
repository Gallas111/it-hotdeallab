import pg from 'pg';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DIRECT_URL });

try {
  const res = await pool.query(`
    SELECT id, title, "mallName", "imageUrl", "affiliateLink"
    FROM "Product"
    WHERE "isActive" = true
    ORDER BY "createdAt" DESC
  `);
  
  console.log('=== Checking image validity ===\n');
  
  // 1. Community CDN images (likely screenshots, not product images)
  const communityImgDomains = ['ppomppu.co.kr', 'clien.net', 'ruliweb.com'];
  for (const r of res.rows) {
    if (!r.imageUrl) continue;
    if (communityImgDomains.some(d => r.imageUrl.includes(d))) {
      console.log(`[COMMUNITY IMG] ${r.id}`);
      console.log(`  title: ${r.title.substring(0, 60)}`);
      console.log(`  img: ${r.imageUrl}`);
    }
  }
  
  // 2. Check for broken images (HTTP HEAD request)
  console.log('\n=== Checking for broken images (sampling 10) ===');
  const sample = res.rows.slice(0, 10);
  for (const r of sample) {
    if (!r.imageUrl) continue;
    try {
      const resp = await axios.head(r.imageUrl, {
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://ithotdealab.com/' },
        validateStatus: () => true,
      });
      if (resp.status >= 400) {
        console.log(`[BROKEN ${resp.status}] ${r.id} | ${r.title.substring(0, 40)} | ${r.imageUrl.substring(0, 80)}`);
      }
    } catch (e: any) {
      console.log(`[ERROR] ${r.id} | ${r.title.substring(0, 40)} | ${e.message}`);
    }
  }
  
  // 3. Check Naver Shopping images match: verify image catalog ID matches product
  console.log('\n=== Naver Shopping images with catalog IDs ===');
  const naverImgs = res.rows.filter((r: any) => r.imageUrl?.includes('shopping-phinf.pstatic.net'));
  console.log(`Total Naver Shopping images: ${naverImgs.length}`);
  
  // Extract catalog IDs from image URLs and affiliate links
  for (const r of naverImgs) {
    const imgCatalogMatch = r.imageUrl.match(/main_(\d+)\/(\d+)/);
    const linkCatalogMatch = r.affiliateLink.match(/catalog\/(\d+)/);
    
    if (imgCatalogMatch && linkCatalogMatch) {
      const imgCatalog = imgCatalogMatch[2];
      const linkCatalog = linkCatalogMatch[1];
      if (imgCatalog !== linkCatalog) {
        console.log(`[CATALOG MISMATCH] ${r.id}`);
        console.log(`  title: ${r.title.substring(0, 60)}`);
        console.log(`  img catalog: ${imgCatalog}`);
        console.log(`  link catalog: ${linkCatalog}`);
      }
    }
  }
  
} finally {
  await pool.end();
}
