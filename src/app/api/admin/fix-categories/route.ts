import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 브랜드→카테고리 매핑 규칙 (scrape route와 동일, \b 미사용 - 한글 비호환)
const BRAND_CATEGORY_RULES: { pattern: RegExp; category: string }[] = [
    // 삼성/LG 먼저 (갤럭시가 Apple로 오분류 방지)
    { pattern: /(삼성|samsung|갤럭시|galaxy|갤S|갤[A-Z]?\d|비스포크|bespoke|에어드레서|갤탭|갤럭시\s?탭|갤럭시\s?버즈|갤럭시\s?워치|갤럭시\s?북|갤럭시\s?링)/i, category: "삼성/LG" },
    { pattern: /(LG전자|LG\s?gram|LG그램|스탠바이미|올레드|트롬|오브제|시그니처|퓨리케어|코드제로|디오스)/i, category: "삼성/LG" },
    // Apple
    { pattern: /(apple|아이폰|iphone|맥북|macbook|아이패드|ipad|에어팟|airpods?|애플워치|apple\s?watch|imac|mac\s?mini|mac\s?studio|mac\s?pro|homepod|apple\s?tv)/i, category: "Apple" },
];

function correctCategory(title: string, currentCategory: string): string | null {
    for (const rule of BRAND_CATEGORY_RULES) {
        if (rule.pattern.test(title)) {
            if (currentCategory !== rule.category) return rule.category;
            return null; // 이미 올바른 카테고리
        }
    }
    return null;
}

export async function POST() {
    const products = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, title: true, category: true },
    });

    const fixes: { id: string; from: string; to: string; title: string }[] = [];

    for (const p of products) {
        const corrected = correctCategory(p.title, p.category);
        if (corrected) {
            fixes.push({ id: p.id, from: p.category, to: corrected, title: p.title });
        }
    }

    // 일괄 업데이트
    for (const fix of fixes) {
        await prisma.product.update({
            where: { id: fix.id },
            data: { category: fix.to },
        });
    }

    return NextResponse.json({
        total: products.length,
        fixed: fixes.length,
        details: fixes.map(f => `"${f.title}": ${f.from} → ${f.to}`),
    });
}
