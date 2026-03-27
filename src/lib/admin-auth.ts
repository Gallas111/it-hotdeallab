import { createHmac, timingSafeEqual } from "crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TOKEN_PREFIX = "hotdeal-admin-v1";

/** HMAC 기반 admin 토큰 생성 */
export function createAdminToken(): string {
    return createHmac("sha256", ADMIN_PASSWORD)
        .update(TOKEN_PREFIX)
        .digest("hex");
}

/** 토큰 검증 (timing-safe) */
export function verifyAdminToken(token: string): boolean {
    if (!ADMIN_PASSWORD || !token) return false;
    const expected = createAdminToken();
    try {
        return timingSafeEqual(
            Buffer.from(token, "utf8"),
            Buffer.from(expected, "utf8"),
        );
    } catch {
        return false;
    }
}

export const COOKIE_NAME = "admin-token";
