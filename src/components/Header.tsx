import Link from "next/link";

export default function Header() {
    return (
        <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md dark:bg-black/80">
            <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-0.5 text-xl font-bold tracking-tight">
                    <span className="text-black dark:text-white">IT</span>
                    <span className="text-[var(--primary)]">핫딜랩</span>
                </Link>

                {/* Right Actions */}
                <div className="flex items-center gap-4">
                    <div className="relative hidden items-center sm:flex group">
                        <input
                            type="text"
                            placeholder="찾고 있는 IT 기기가 있나요?"
                            className="glass-input h-10 w-48 rounded-full px-5 text-[13px] font-bold outline-none placeholder:text-gray-400"
                        />
                        <svg className="absolute right-4 h-4 w-4 text-gray-400 group-focus-within:text-[var(--primary)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>

                    <button className="text-gray-500 hover:text-[var(--foreground)] transition-colors">
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                    </button>

                    <button className="text-gray-500 hover:text-[var(--foreground)] transition-colors">
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                </div>
            </div>
        </header>
    );
}
