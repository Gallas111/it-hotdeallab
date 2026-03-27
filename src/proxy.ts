import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAdminToken, COOKIE_NAME } from "@/lib/admin-auth";

const PROTECTED_PATHS = ["/api/admin", "/api/monitor/repair"];

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // auth 라우트는 제외 (로그인용)
    if (pathname === "/api/admin/auth") return NextResponse.next();

    const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));
    if (!isProtected) return NextResponse.next();

    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token || !verifyAdminToken(token)) {
        return NextResponse.json(
            { success: false, error: "Unauthorized" },
            { status: 401 },
        );
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/api/admin/:path*", "/api/monitor/repair"],
};
