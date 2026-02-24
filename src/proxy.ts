import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 로그인 페이지는 통과
    if (pathname === "/admin/login") return NextResponse.next();

    // /admin 경로는 쿠키 확인
    if (pathname.startsWith("/admin")) {
        const auth = request.cookies.get("admin-auth");
        if (!auth || auth.value !== "authenticated") {
            return NextResponse.redirect(new URL("/admin/login", request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/admin", "/admin/:path*"],
};
