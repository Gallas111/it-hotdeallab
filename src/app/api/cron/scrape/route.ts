import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { OpenAI } from "openai";
import { prisma } from "@/lib/prisma";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        // 1. FMKorea 핫딜 게시판 크롤링 (컴퓨터/가전 키워드 위주)
        const { data: html } = await axios.get("https://www.fmkorea.com/hotdeal", {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        });

        const $ = cheerio.load(html);
        const deals: any[] = [];

        $(".fm_best_widget ul li .body").each((i, el) => {
            if (i > 10) return; // 최신 10개만 확인

            const titleEl = $(el).find(".title a");
            const title = titleEl.text().trim().replace(/\t|\n/g, "");
            const link = "https://www.fmkorea.com" + titleEl.attr("href");

            // 카테고리 추출 (에펨코리아 특성상 [쇼핑몰] 제목 형식)
            const mallMatch = title.match(/\[(.*?)\]/);
            const mallName = mallMatch ? mallMatch[1] : "기타";

            deals.push({ title, link, mallName });
        });

        // 2. AI 판별 및 저장 로직
        const results = [];
        for (const deal of deals) {
            // 중복 체크
            const exists = await prisma.product.findFirst({
                where: { sourceUrl: deal.link },
            });
            if (exists) continue;

            // AI에게 IT 핫딜 여부 및 품질 판별 요청
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `너는 IT/가전 핫딜 전문 큐레이터야. 다음 정보를 기반으로 이 게시글이 'IT 전자제품, PC, 주변기기, 가전제품' 관련 핫딜인지 판별하고, 
            맞다면 블로그 포스팅을 위한 정보를 생성해줘. 반드시 JSON 형식으로 답변해.
            기준:
            1. 카테고리: Apple, 삼성/LG, 노트북/PC, 모니터/주변기기, 음향/스마트기기 중 하나.
            2. IT제품이 아니면 isIT: false 로 반환.
            
            JSON 형식 예시:
            {
              "isIT": true,
              "refinedTitle": "고유하고 매력적인 제목",
              "category": "노트북/PC",
              "originalPrice": 1200000,
              "salePrice": 990000,
              "aiSummary": "제품의 핵심 특징 한 줄 요약",
              "aiPros": "장점1, 장점2, 장점3",
              "aiTarget": "어떤 사람에게 좋은지",
              "seoContent": "1000자 이상의 상세한 제품 설명 및 구매 가이드"
            }`,
                    },
                    {
                        role: "user",
                        content: `제목: ${deal.title}`,
                    },
                ],
                response_format: { type: "json_object" },
            });

            const aiData = JSON.parse(completion.choices[0].message.content || "{}");

            if (aiData.isIT) {
                // DB 저장
                const slug = deal.title
                    .replace(/\[.*?\]/g, "")
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9ㄱ-ㅎㅏ-ㅣ가-힣 ]/g, "")
                    .replace(/\s+/g, "-") + "-" + Date.now();

                const newProduct = await prisma.product.create({
                    data: {
                        title: aiData.refinedTitle,
                        slug: slug,
                        originalPrice: aiData.originalPrice || 0,
                        salePrice: aiData.salePrice || 0,
                        discountPercent: Math.round(((aiData.originalPrice - aiData.salePrice) / aiData.originalPrice) * 100) || 0,
                        category: aiData.category,
                        mallName: deal.mallName,
                        sourceUrl: deal.link,
                        aiSummary: aiData.aiSummary,
                        aiPros: aiData.aiPros,
                        aiTarget: aiData.aiTarget,
                        seoContent: aiData.seoContent,
                        affiliateLink: deal.link, // 임시로 원문 링크 사용 (수익 링크 전환은 추후 단계)
                        isActive: true,
                    },
                });
                results.push(newProduct.title);
            }
        }

        return NextResponse.json({ success: true, added: results });
    } catch (error: any) {
        console.error("Scrape Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
