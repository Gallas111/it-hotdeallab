import { NextResponse } from "next/server";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REPO = "Gallas111/it-hotdeallab";
const FILE_PATH = "src/app/api/cron/scrape/route.ts";

const SOURCE_CONFIG: Record<string, { url: string; funcName: string; referer: string }> = {
    "클리앙": {
        url: "https://www.clien.net/service/board/jirum?category=1000236",
        funcName: "scrapeClien",
        referer: "https://www.clien.net/",
    },
    "뽐뿌": {
        url: "https://www.ppomppu.co.kr/rss.php?id=ppomppu",
        funcName: "scrapePpomppu",
        referer: "https://www.ppomppu.co.kr/",
    },
    "루리웹": {
        url: "https://bbs.ruliweb.com/market/board/1020",
        funcName: "scrapeRuliweb",
        referer: "https://bbs.ruliweb.com/",
    },
};

const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
};

// 파일에서 특정 함수 코드 추출
function extractFunction(code: string, funcName: string): string {
    const startIdx = code.indexOf(`async function ${funcName}(`);
    if (startIdx === -1) return "";
    const nextFuncIdx = code.indexOf("\nasync function ", startIdx + 10);
    const exportIdx = code.indexOf("\nexport async function ", startIdx + 10);
    let endIdx = code.length;
    if (nextFuncIdx !== -1) endIdx = Math.min(endIdx, nextFuncIdx);
    if (exportIdx !== -1) endIdx = Math.min(endIdx, exportIdx);
    return code.substring(startIdx, endIdx).trim();
}

export async function POST(request: Request) {
    const githubToken = process.env.GITHUB_TOKEN;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!githubToken || !geminiKey) {
        return NextResponse.json({ error: "GITHUB_TOKEN 또는 GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const { source } = await request.json();
    const config = SOURCE_CONFIG[source];
    if (!config) {
        return NextResponse.json({ error: "알 수 없는 소스" }, { status: 400 });
    }

    try {
        // ── 1. GitHub에서 마지막 커밋 시간 확인 (30분 내 수정됐으면 스킵) ──
        const commitsRes = await fetch(
            `https://api.github.com/repos/${REPO}/commits?path=${FILE_PATH}&per_page=1`,
            { headers: { Authorization: `token ${githubToken}`, Accept: "application/vnd.github.v3+json" } }
        );
        const commits = await commitsRes.json();
        const lastCommitTime = new Date(commits[0]?.commit?.committer?.date || 0);
        const minutesSinceLast = (Date.now() - lastCommitTime.getTime()) / 60000;
        if (minutesSinceLast < 30) {
            return NextResponse.json({ skipped: true, reason: "최근 수정 진행 중 (30분 대기)" });
        }

        // ── 2. 현재 사이트 HTML 수집 ─────────────────────────────────
        const { data: html } = await axios.get(config.url, {
            headers: { ...BROWSER_HEADERS, Referer: config.referer },
            timeout: 10000,
        });
        const htmlSnippet = (html as string).substring(0, 40000);

        // ── 3. GitHub에서 현재 파일 내용 + SHA 가져오기 ───────────────
        const ghRes = await fetch(
            `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
            { headers: { Authorization: `token ${githubToken}`, Accept: "application/vnd.github.v3+json" } }
        );
        const ghData = await ghRes.json();
        const currentCode = Buffer.from(ghData.content, "base64").toString("utf-8");
        const currentFunc = extractFunction(currentCode, config.funcName);

        if (!currentFunc) {
            return NextResponse.json({ error: "파일에서 함수를 찾을 수 없음" }, { status: 500 });
        }

        // ── 4. Claude에게 수정 코드 요청 ────────────────────────────
        const genai = new GoogleGenAI({ apiKey: geminiKey });
        const response = await genai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: `웹 스크레이퍼가 고장났습니다. 아래 함수가 0개의 결과를 반환하고 있습니다. 웹사이트의 HTML 구조가 변경된 것이 원인입니다.

현재 함수 코드:
\`\`\`typescript
${currentFunc}
\`\`\`

현재 웹사이트 HTML:
\`\`\`html
${htmlSnippet}
\`\`\`

HTML을 분석하여 핫딜/세일 게시글 목록을 올바르게 추출하는 업데이트된 TypeScript 함수를 반환하세요.

규칙:
- 함수 시그니처 유지: async function ${config.funcName}(): Promise<RawDeal[]>
- RawDeal 타입: { title: string; link: string; mallName: string; source: string; imageUrl?: string }
- 최대 15개 항목 추출
- axios와 cheerio($)는 이미 import됨
- try/catch로 에러 처리, 실패 시 [] 반환
- 코드만 반환 (설명 없이, 마크다운 코드블록 없이)`,
        });

        const newFunc = (response.text ?? "").trim();

        // ── 5. 파일에서 함수 교체 ───────────────────────────────────
        const newCode = currentCode.replace(currentFunc, newFunc);
        if (newCode === currentCode) {
            return NextResponse.json({ error: "코드 교체 실패 (함수 매칭 안됨)" }, { status: 500 });
        }

        // ── 6. GitHub에 커밋 ─────────────────────────────────────────
        const commitRes = await fetch(
            `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `token ${githubToken}`,
                    Accept: "application/vnd.github.v3+json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message: `[자동수정] ${source} 스크레이퍼 Claude가 자동 복구`,
                    content: Buffer.from(newCode).toString("base64"),
                    sha: ghData.sha,
                }),
            }
        );

        if (!commitRes.ok) {
            const err = await commitRes.json();
            return NextResponse.json({ error: "GitHub 커밋 실패", detail: err }, { status: 500 });
        }

        // ── 7. 텔레그램 완료 알림 ────────────────────────────────────
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: `🔧 IT핫딜랩 자동 수정 완료!\n\n✅ ${source} 스크레이퍼가 Claude에 의해 자동 복구되었습니다.\n배포 중... (약 1분 후 적용)\n\n🔗 https://ithotdealab.com`,
                parse_mode: "HTML",
            }).catch(() => {});
        }

        return NextResponse.json({ success: true, source, message: `${source} 자동 수정 완료` });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
