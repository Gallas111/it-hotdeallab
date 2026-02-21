import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { OpenAI } from "openai";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    try {
        // 1. 클리앙 알뜰구매 게시판 크롤링 (상품정보 카테고리)
        const { data: html } = await axios.get(
            "https://www.clien.net/service/board/jirum?category=1000236",
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
                    Referer: "https://www.clien.net/service/",
                },
            }
        );

        const $ = cheerio.load(html);
        const deals: { title: string; link: string; mallName: string }[] = [];

        // 클리앙 게시판 아이템 파싱 (다양한 셀렉터 시도)
        const selectorTests = {
            list_item: $(".list_item").length,
            list_content: $(".list_content").length,
            board_list: $(".board-list").length,
            subject_fixed: $(".subject_fixed").length,
            list_subject: $(".list_subject").length,
            links: $("a[data-role='list-title-text']").length,
            total_links: $("a").length,
        };

        // 방법 1: .list_item 셀렉터
        $(".list_item").each((i, el) => {
            if (i > 15) return;

            const titleEl = $(el).find(".list_subject .subject_fixed");
            if (titleEl.length === 0) return;

            let title = titleEl.text().trim();
            if (!title) return;

            const href = $(el).find(".list_subject a").attr("href");
            if (!href) return;
            const link = href.startsWith("http")
                ? href
                : "https://www.clien.net" + href;

            const mallMatch = title.match(/\[(.*?)\]/);
            const mallName = mallMatch ? mallMatch[1] : "기타";

            deals.push({ title, link, mallName });
        });

        // 방법 2: list_item이 없으면 모든 링크에서 핫딜 패턴 매칭
        if (deals.length === 0) {
            $("a").each((i, el) => {
                const href = $(el).attr("href") || "";
                const text = $(el).text().trim();

                // 클리앙 게시글 링크 패턴: /service/board/jirum/숫자
                if (href.includes("/service/board/jirum/") && text.length > 5 && !text.includes("알뜰구매") && !text.includes("이용규칙")) {
                    const link = href.startsWith("http")
                        ? href
                        : "https://www.clien.net" + href;

                    const mallMatch = text.match(/\[(.*?)\]/);
                    const mallName = mallMatch ? mallMatch[1] : "기타";

                    deals.push({ title: text, link, mallName });
                }
            });
            // 중복 제거
            const uniqueLinks = new Set<string>();
            const uniqueDeals: typeof deals = [];
            for (const d of deals) {
                const cleanLink = d.link.split("?")[0];
                if (!uniqueLinks.has(cleanLink)) {
                    uniqueLinks.add(cleanLink);
                    uniqueDeals.push(d);
                }
            }
            deals.length = 0;
            deals.push(...uniqueDeals.slice(0, 15));
        }

        // 2. AI 판별 및 저장 로직
        const results: string[] = [];

        // 디버깅: 게시글이 없으면 셀렉터 정보 반환
        if (deals.length === 0) {
            return NextResponse.json({
                success: true,
                added: [],
                debug: {
                    message: "게시글을 찾지 못했습니다.",
                    selectors: selectorTests,
                    htmlSample: html.substring(0, 2000),
                },
            });
        }
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

            const aiData = JSON.parse(
                completion.choices[0].message.content || "{}"
            );

            if (aiData.isIT) {
                // DB 저장
                const slug =
                    deal.title
                        .replace(/\[.*?\]/g, "")
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9ㄱ-ㅎㅏ-ㅣ가-힣 ]/g, "")
                        .replace(/\s+/g, "-") +
                    "-" +
                    Date.now();

                const newProduct = await prisma.product.create({
                    data: {
                        title: aiData.refinedTitle,
                        slug: slug,
                        originalPrice: aiData.originalPrice || 0,
                        salePrice: aiData.salePrice || 0,
                        discountPercent:
                            Math.round(
                                ((aiData.originalPrice - aiData.salePrice) /
                                    aiData.originalPrice) *
                                100
                            ) || 0,
                        category: aiData.category,
                        mallName: deal.mallName,
                        sourceUrl: deal.link,
                        aiSummary: aiData.aiSummary,
                        aiPros: aiData.aiPros,
                        aiTarget: aiData.aiTarget,
                        seoContent: aiData.seoContent,
                        affiliateLink: deal.link,
                        isActive: true,
                    },
                });
                results.push(newProduct.title);
            }
        }

        return NextResponse.json({ success: true, added: results });
    } catch (error: any) {
        console.error("Scrape Error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
