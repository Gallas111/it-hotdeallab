import { NextResponse } from "next/server";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function POST(req: Request) {
    if (!ADMIN_PASSWORD) {
        console.error("ADMIN_PASSWORD environment variable is not set");
        return NextResponse.json(
            { success: false, error: "Server configuration error" },
            { status: 500 }
        );
    }

    const { password } = await req.json();

    if (password !== ADMIN_PASSWORD) {
        return NextResponse.json({ success: false }, { status: 401 });
    }

    return NextResponse.json({ success: true });
}
