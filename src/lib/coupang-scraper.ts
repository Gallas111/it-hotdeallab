import axios from "axios";

// HTML에서 쿠팡 상품 정보 추출 (JSON-LD 파싱)
export function parseCoupangHtml(html: string): {
    title: string;
    salePrice: number;
    originalPrice: number;
    image: string | null;
} | null {
    if (typeof html !== "string" || html.length < 10000) return null;

    let title = "";
    let salePrice = 0;
    let originalPrice = 0;
    let image: string | null = null;

    const ldBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) || [];
    for (const block of ldBlocks) {
        try {
            const ld = JSON.parse(block.replace(/<script[^>]*>/, "").replace(/<\/script>/, ""));
            const offers = ld?.offers;
            if (!offers) continue;

            if (ld?.name && !title) title = ld.name;

            const price = Number(offers.price || 0);
            if (price > 0) salePrice = price;

            // StrikethroughPrice = 쿠팡 취소선 가격 = 정가
            const priceSpec = offers.priceSpecification;
            if (priceSpec && (priceSpec.priceType || "").includes("StrikethroughPrice")) {
                const orig = Number(priceSpec.price || 0);
                if (orig > price) originalPrice = orig;
            }

            const imgs = ld?.image;
            if (!image) {
                if (Array.isArray(imgs) && imgs.length > 0) image = imgs[0];
                else if (typeof imgs === "string") image = imgs;
            }

            if (salePrice > 0) break;
        } catch {}
    }

    if (!title && salePrice === 0) return null;
    return { title, salePrice, originalPrice, image };
}

// Scrape.do → ScraperAPI 순으로 시도 (크레딧 절약)
export async function fetchCoupangHtml(url: string): Promise<string | null> {
    const scrapeDoKey = process.env.SCRAPEDO_KEY;
    const scraperApiKey = process.env.SCRAPERAPI_KEY;

    // 1차: Scrape.do (월 1,000 무료 크레딧 - 매월 갱신)
    if (scrapeDoKey) {
        try {
            const scrapeDoUrl = `https://api.scrape.do?token=${scrapeDoKey}&url=${encodeURIComponent(url)}&super=true`;
            const { data: html } = await axios.get(scrapeDoUrl, { timeout: 55000 });
            if (typeof html === "string" && html.length >= 10000 && html.includes("coupang")) {
                console.log(`[scrapedo] ✓ length=${html.length}`);
                return html;
            }
            console.log(`[scrapedo] 응답 불충분 length=${typeof html === "string" ? html.length : 0}`);
        } catch (e: any) {
            console.error("[scrapedo] error:", e.message);
        }
    }

    // 2차: ScraperAPI (5,000 크레딧 일회성, premium=10크레딧/요청)
    if (scraperApiKey) {
        try {
            const scraperUrl = `https://api.scraperapi.com/?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}&premium=true&country_code=kr`;
            const { data: html } = await axios.get(scraperUrl, { timeout: 55000 });
            if (typeof html === "string" && html.length >= 10000) {
                console.log(`[scraperapi] ✓ length=${html.length}`);
                return html;
            }
        } catch (e: any) {
            console.error("[scraperapi] error:", e.message);
        }
    }

    return null;
}

// 쿠팡 URL → 상품 정보 한 번에 추출
export async function getCoupangProductInfo(url: string): Promise<{
    title: string;
    salePrice: number;
    originalPrice: number;
    image: string | null;
} | null> {
    const html = await fetchCoupangHtml(url);
    if (!html) return null;
    const result = parseCoupangHtml(html);
    if (result) {
        console.log(`[coupang-scraper] title="${result.title.substring(0, 30)}" sale=${result.salePrice} orig=${result.originalPrice}`);
    }
    return result;
}
