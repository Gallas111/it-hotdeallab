"use client";

import { AnchorHTMLAttributes } from "react";

interface ClickTrackerProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
    id: string;
    href: string;
}

export default function ClickTracker({ id, href, children, ...rest }: ClickTrackerProps) {
    const handleClick = () => {
        const key = `clicked_${id}`;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");

        // sendBeacon은 페이지 이동 시에도 안정적으로 전송됨
        const data = JSON.stringify({ id });
        if (navigator.sendBeacon) {
            navigator.sendBeacon("/api/deals/click", new Blob([data], { type: "application/json" }));
        } else {
            fetch("/api/deals/click", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: data,
                keepalive: true,
            }).catch(() => {});
        }
    };

    return (
        <a href={href} onClick={handleClick} {...rest}>
            {children}
        </a>
    );
}
