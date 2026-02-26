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

        fetch("/api/deals/click", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        }).catch(() => {});
    };

    return (
        <a href={href} onClick={handleClick} {...rest}>
            {children}
        </a>
    );
}
