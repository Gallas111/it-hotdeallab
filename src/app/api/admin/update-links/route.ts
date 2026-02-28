import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
};

const SHOP_DOMAINS = [
    // 국내 대형
    "coupang.com", "link.coupang.com", "11st.co.kr",
    "gmarket.co.kr", "auction.co.kr", "interpark.com",
    "ssg.com", "lotteon.com", "danawa.com",
    "tmon.co.kr", "smartstore.naver.com", "brand.naver.com",
    "shopping.naver.com", "search.shopping.naver.com",
    "shoppinglive.naver.com", "naver.me",
    // 국내 전문몰
    "cjonstyle.com", "compuzone.co.kr", "ohou.se",
    "lottehimall.com", "himart.co.kr", "earphoneshop.co.kr",
    "baemin.com", "baemin.go.link", "wemakeprice.com", "kurly.com",
    "apple.com", "samsung.com", "lg.co.kr",
    // 해외직구
    "amazon.com", "amazon.co.jp", "amazon.co.uk", "amazon.de",
    "aliexpress.com", "aliexpress.kr",
    "ebay.com", "ebay.co.kr", "newegg.com", "bhphotovideo.com",
    "iherb.com", "rakuten.co.jp",
    "woot.com", "costco.com", "asus.com",
];

const COMMUNITY_DOMAINS = ["clien.net", "ppomppu.co.kr", "ruliweb.com", "bbs.ruliweb", "quasarzone.com"];
const isShopLink = (url: string) => SHOP_DOMAINS.some(d => url.includes(d));
const isCommunityLink = (url: string) => COMMUNITY_DOMAINS.some(d => url.includes(d));

function toCoupangAffiliateLink(url: string): string {
    const COUPANG_PARTNERS_ID = process.env.COUPANG_PARTNERS_ID || "";
    if (!COUPANG_PARTNERS_ID) return url;
    if (!url.includes("coupang.com")) return url;
    if (url.includes("link.coupang.com")) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("partnerCode", COUPANG_PARTNERS_ID);
        return u.toString();
    } catch { return url; }
}

function toAliexpressAffiliateLink(url: string): string {
    const trackingId = process.env.ALIEXPRESS_TRACKING_ID || "";
    if (!trackingId) return url;
    if (!url.includes("aliexpress.com")) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("aff_platform", "portals-tool");
        u.searchParams.set("sk", trackingId);
        return u.toString();
    } catch { return url; }
}

function toAffiliateLink(url: string): string {
    return toAliexpressAffiliateLink(toCoupangAffiliateLink(url));
}

async function extractShopLink(postUrl: string): Promise<string | null> {
    try {
        // http→https 변환 (뽐뿌 JS 리다이렉트 방지)
        const fetchUrl = postUrl.replace(/^http:\/\/(www\.)?ppomppu\.co\.kr/, "https://www.ppomppu.co.kr");
        const referer = `https://${new URL(fetchUrl).hostname}/`;
        const { data: html } = await axios.get(fetchUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 10000,
        });
        const $ = cheerio.load(html);
        let found: string | null = null;

        // 1. 본문 내 직접 쇼핑몰 링크
        $(".post_content, .post-content, .view-content, .cont, .fr-view, article").find("a[href]").each((_, el) => {
            if (found) return;
            const href = $(el).attr("href") || "";
            if (href.startsWith("http") && isShopLink(href)) found = href;
        });

        // 2. 뽐뿌 base64 인코딩 링크 해독 (raw HTML에서 target= 파라미터 직접 추출)
        if (!found && postUrl.includes("ppomppu")) {
            const b64Matches = html.match(/[?&]target=([A-Za-z0-9+/=]{20,})/g) || [];
            for (const raw of b64Matches) {
                const m = raw.match(/target=([A-Za-z0-9+/=]+)/);
                if (m) {
                    try {
                        const decoded = Buffer.from(m[1], "base64").toString("utf-8");
                        if (decoded.startsWith("http") && isShopLink(decoded)) { found = decoded; break; }
                    } catch { /* skip */ }
                }
            }
        }

        // 3. 클리앙 /service/redirect 링크
        if (!found) {
            $("a[href*='/service/redirect'], a[href*='redirect'], a[href*='go.php']").each((_, el) => {
                if (found) return;
                const href = $(el).attr("href") || "";
                const m = href.match(/[?&]url=([^&]+)/);
                if (m) {
                    try {
                        const decoded = decodeURIComponent(m[1]);
                        if (isShopLink(decoded)) found = decoded;
                    } catch { /* skip */ }
                }
            });
        }

        // 4. 퀘이사존 data-href / 외부 링크 패턴
        if (!found && postUrl.includes("quasarzone")) {
            $("a[data-href], a[href*='link'], a.link-buy, a.btn-buy, .deal-link a, .external-link").each((_, el) => {
                if (found) return;
                const href = $(el).attr("data-href") || $(el).attr("href") || "";
                if (href.startsWith("http") && isShopLink(href)) found = href;
            });
            // quasarzone onclick URL 추출
            if (!found) {
                $("a[onclick]").each((_, el) => {
                    if (found) return;
                    const onclick = $(el).attr("onclick") || "";
                    const m = onclick.match(/https?:\/\/[^\s'"]+/);
                    if (m && isShopLink(m[0])) found = m[0];
                });
            }
        }

        // 5. 전체 페이지 href
        if (!found) {
            $("a[href]").each((_, el) => {
                if (found) return;
                const href = $(el).attr("href") || "";
                if (href.startsWith("http") && isShopLink(href)) found = href;
            });
        }

        // 6. 페이지 텍스트에서 URL 직접 추출 (뽐뿌/퀘이사존 텍스트 노출 URL)
        if (!found) {
            const bodyText = $.root().text();
            const urlMatches = bodyText.match(/https?:\/\/[^\s"'<>]+/g) || [];
            for (const url of urlMatches) {
                if (isShopLink(url)) { found = url; break; }
            }
        }

        return found;
    } catch {
        return null;
    }
}

export async function POST() {
    try {
        // 커뮤니티 URL이 affiliateLink로 남아있는 상품 (최대 10개씩 처리, 60초 타임아웃 방지)
        const products = await prisma.product.findMany({
            where: {
                OR: COMMUNITY_DOMAINS.map(d => ({ affiliateLink: { contains: d } })),
            },
            select: { id: true, title: true, affiliateLink: true, sourceUrl: true },
            orderBy: { createdAt: "desc" },
            take: 10,
        });

        let updated = 0;

        for (const product of products) {
            const shopLink = await extractShopLink(product.affiliateLink);
            if (shopLink) {
                const finalLink = toAffiliateLink(shopLink);
                await prisma.product.update({
                    where: { id: product.id },
                    data: { affiliateLink: finalLink },
                });
                updated++;
            }
            await new Promise(r => setTimeout(r, 200));
        }

        // 알리익스프레스 딜 중 제휴 파라미터 없는 것 일괄 업데이트
        const aliDeals = await prisma.product.findMany({
            where: {
                affiliateLink: { contains: "aliexpress.com" },
                NOT: { affiliateLink: { contains: "aff_platform" } },
            },
            select: { id: true, affiliateLink: true },
        });
        let aliUpdated = 0;
        for (const p of aliDeals) {
            const newLink = toAliexpressAffiliateLink(p.affiliateLink);
            if (newLink !== p.affiliateLink) {
                await prisma.product.update({ where: { id: p.id }, data: { affiliateLink: newLink } });
                aliUpdated++;
            }
        }

        return NextResponse.json({
            success: true,
            total: products.length,
            updated,
            aliUpdated,
            message: `커뮤니티 링크 ${updated}개 → 쇼핑몰 링크로 교체 / 알리 제휴 링크 ${aliUpdated}개 업데이트`,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
