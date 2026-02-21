export default function Footer() {
    return (
        <footer className="mt-auto border-t border-[var(--border)] bg-white px-4 py-8 dark:bg-[#121212]">
            <div className="flex flex-col gap-4 text-center">
                <p className="text-sm font-bold text-[var(--foreground)] opacity-80">
                    IT/가전 핫딜 프리미엄 큐레이션
                </p>
                <p className="text-xs text-gray-400">
                    본 사이트는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.<br />
                    게시된 정보는 실시간 가격과 다를 수 있습니다.
                </p>
                <p className="text-[10px] text-gray-400">
                    &copy; 2026 IT핫딜랩. All rights reserved.
                </p>
            </div>
        </footer>
    );
}
