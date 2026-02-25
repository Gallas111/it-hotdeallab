import { NextResponse } from "next/server";

const ADMIN_PASSWORD = "0316";

export async function POST(req: Request) {
    const { password } = await req.json();

    if (password !== ADMIN_PASSWORD) {
        return NextResponse.json({ success: false }, { status: 401 });
    }

    return NextResponse.json({ success: true });
}
