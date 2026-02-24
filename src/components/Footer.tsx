export default function Footer() {
    return (
        <footer className="mt-auto border-t border-[var(--border)] bg-white px-4 py-10 dark:bg-[#121212]">
            <div className="mx-auto max-w-2xl flex flex-col gap-6 text-center">

                {/* 쿠팡 파트너스 배너 */}
                <a
                    href={`https://www.coupang.com/np/search?q=IT+전자기기&channel=user&component=&eventCategory=SRP&trcid=&traid=&sorter=scoreDesc&minPrice=&maxPrice=&priceRange=&filterType=&listSize=36&filter=&isPriceRange=false&brand=&offerCondition=&rating=0&page=1&rocketAll=false&searchIndexingToken=&backgroundColor=&partnerCode=AF5418862`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-auto block w-full max-w-sm rounded-2xl border border-[#fee500] bg-gradient-to-r from-[#fee500] to-[#ffcc00] px-6 py-4 transition-opacity hover:opacity-90"
                >
                    <div className="flex items-center justify-center gap-3">
                        <div className="flex flex-col items-start">
                            <span className="text-[11px] font-black text-[#c00] uppercase tracking-widest">Coupang Partners</span>
                            <span className="text-[16px] font-black text-gray-900 leading-tight">쿠팡 최저가 바로가기</span>
                            <span className="text-[11px] font-bold text-gray-600 mt-0.5">로켓배송 · 오늘출발 특가 모아보기</span>
                        </div>
                        <span className="text-3xl">🛒</span>
                    </div>
                </a>

                <p className="text-[11px] text-gray-400 leading-relaxed">
                    이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.<br />
                    게시된 가격은 실시간으로 변동될 수 있으며 구매 시점의 가격과 다를 수 있습니다.
                </p>

                <p className="text-[10px] text-gray-300">
                    &copy; 2026 IT핫딜랩. All rights reserved.
                </p>
            </div>
        </footer>
    );
}
