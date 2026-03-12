"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ASCII_LOGO = `
█████╗ ██╗     ██████╗ ██╗  ██╗ █████╗
██╔══██╗██║     ██╔══██╗██║  ██║██╔══██╗
███████║██║     ██████╔╝███████║███████║
██╔══██║██║     ██╔═══╝ ██╔══██║██╔══██║
██║  ██║███████╗██║     ██║  ██║██║  ██║
╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝`.trim();

const NAV = [
  { href: "/", label: "[HOME]" },
  { href: "/free-money", label: "[FREE $$$]" },
];

export default function Header() {
  const pathname = usePathname();
  return (
    <header className="border-b border-[var(--fg-dim)] bg-black sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        {/* ASCII logo row */}
        <div className="py-2 hidden md:block">
          <pre className="text-[var(--fg)] text-[6px] leading-[1.1] glow select-none overflow-hidden">
            {ASCII_LOGO}
          </pre>
        </div>
        {/* Top bar */}
        <div className="flex items-center justify-between py-2 border-t border-[var(--fg-dim)]">
          <div className="flex items-center gap-4">
            <span className="text-[var(--fg)] font-bold text-sm glow tracking-widest">
              ALPHA//TERMINAL
            </span>
            <span className="text-[var(--fg-dim)] text-xs hidden sm:block">
              SMART MONEY INTELLIGENCE SYSTEM
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-[var(--fg-dim)] hidden sm:block">SYS:</span>
            <span className="text-[var(--fg)]">ONLINE</span>
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--fg)] ml-1 animate-pulse" />
          </div>
        </div>
        {/* Nav */}
        <nav className="flex items-center gap-1 py-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-3 py-1 text-xs transition-all ${
                pathname === n.href
                  ? "bg-[var(--fg)] text-black font-bold"
                  : "text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[rgba(0,255,65,0.07)]"
              }`}
            >
              {n.label}
            </Link>
          ))}
          <div className="ml-auto text-[var(--fg-dim)] text-xs cursor-blink">
            <span className="hidden sm:inline">KALSHI MARKETS // </span>
            <span id="live-time" suppressHydrationWarning>
              {new Date().toUTCString().slice(0, 25)}
            </span>
            <span className="cursor" />
          </div>
        </nav>
      </div>
    </header>
  );
}
