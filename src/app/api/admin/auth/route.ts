import { NextResponse } from "next/server";

const ADMIN_PASSWORD = "0316";

export async function POST(req: Request) {
    const { password } = await req.json();

    if (password !== ADMIN_PASSWORD) {
        return NextResponse.json({ success: false }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set("admin-auth", "authenticated", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7일
        path: "/",
    });
    return response;
}

export async function DELETE() {
    const response = NextResponse.json({ success: true });
    response.cookies.delete("admin-auth");
    return response;
}
