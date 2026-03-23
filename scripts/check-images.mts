import pg from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DIRECT_URL });
try {
  const res = await pool.query(`
    SELECT id, title, "mallName", "imageUrl", "affiliateLink", "sourceUrl"
    FROM "Product"
    WHERE "isActive" = true
    ORDER BY "createdAt" DESC
  `);
  console.log('Total active products:', res.rows.length);
  console.log('\n=== Image status ===');
  
  let noImage = 0;
  let withImage = 0;
  const domainCounts: Record<string, number> = {};
  
  for (const r of res.rows) {
    if (!r.imageUrl) {
      noImage++;
      console.log(`[NO IMG] ${r.id} | ${r.title.substring(0, 50)}`);
    } else {
      withImage++;
      try {
        const domain = new URL(r.imageUrl).hostname;
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      } catch {}
    }
  }
  
  console.log(`\nWith image: ${withImage}, No image: ${noImage}`);
  console.log('\nImage domains:');
  for (const [d, c] of Object.entries(domainCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${d}: ${c}`);
  }
  
  // Show all products with images and their titles for manual review
  console.log('\n=== All products with images ===');
  for (const r of res.rows) {
    if (r.imageUrl) {
      console.log(`${r.id} | ${r.mallName} | ${r.title.substring(0, 60)}`);
      console.log(`  img: ${r.imageUrl.substring(0, 120)}`);
      console.log(`  link: ${r.affiliateLink.substring(0, 120)}`);
    }
  }
} finally {
  await pool.end();
}
