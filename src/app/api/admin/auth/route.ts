import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminToken, COOKIE_NAME } from "@/lib/admin-auth";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

export async function POST(req: Request) {
    if (!ADMIN_PASSWORD) {
        console.error("ADMIN_PASSWORD environment variable is not set");
        return NextResponse.json(
            { success: false, error: "Server configuration error" },
            { status: 500 }
        );
    }

    let body: { password?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false }, { status: 400 });
    }

    const password = body.password || "";

    // timing-safe 비밀번호 비교
    const pwMatch = (() => {
        try {
            const a = Buffer.from(password, "utf8");
            const b = Buffer.from(ADMIN_PASSWORD, "utf8");
            if (a.length !== b.length) {
                // 길이가 다르면 더미 비교 후 false
                timingSafeEqual(a, Buffer.alloc(a.length));
                return false;
            }
            return timingSafeEqual(a, b);
        } catch {
            return false;
        }
    })();

    if (!pwMatch) {
        return NextResponse.json({ success: false }, { status: 401 });
    }

    const token = createAdminToken();
    const res = NextResponse.json({ success: true });

    res.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24, // 24시간
    });

    return res;
}
