"use client";

import { useEffect } from "react";

export default function ViewTracker({ id }: { id: string }) {
    useEffect(() => {
        const key = `viewed_${id}`;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");

        fetch("/api/deals/view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        }).catch(() => {});
    }, [id]);

    return null;
}
