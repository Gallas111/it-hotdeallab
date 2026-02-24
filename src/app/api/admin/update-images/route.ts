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

async function fetchImageFromPost(postUrl: string, referer: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(postUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 8000,
        });
        const $ = cheerio.load(html);

        const ogImage = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        if (ogImage && ogImage.startsWith("http")) return ogImage;

        const contentImg = $(".post_content img, .view-content img, .fr-view img, .cont img").first().attr("src");
        if (contentImg && contentImg.startsWith("http")) return contentImg;

        return null;
    } catch {
        return null;
    }
}

export async function POST() {
    try {
        // imageUrl이 없는 상품만 조회
        const products = await prisma.product.findMany({
            where: { imageUrl: null },
            select: { id: true, sourceUrl: true },
            take: 30, // 한 번에 최대 30개
        });

        let updated = 0;
        const errors: string[] = [];

        for (const p of products) {
            try {
                const referer = `https://${new URL(p.sourceUrl).hostname}/`;
                const imageUrl = await fetchImageFromPost(p.sourceUrl, referer);
                if (imageUrl) {
                    await prisma.product.update({
                        where: { id: p.id },
                        data: { imageUrl },
                    });
                    updated++;
                }
            } catch {
                errors.push(p.id);
            }
        }

        return NextResponse.json({
            success: true,
            total: products.length,
            updated,
            errors: errors.length,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
