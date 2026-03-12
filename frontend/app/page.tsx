import Link from "next/link";
import { api, TrendingMarket } from "@/lib/api";
import TerminalBox from "@/components/TerminalBox";

function formatUsd(val?: number) {
  if (!val) return "N/A";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatProb(val?: number) {
  if (val == null) return "??%";
  return `${(val * 100).toFixed(1)}%`;
}

function biasColor(bias?: string) {
  if (!bias) return "text-[var(--fg-dim)]";
  const b = bias.toUpperCase();
  if (b.includes("YES") || b.includes("BULL")) return "text-[var(--fg)]";
  if (b.includes("NO") || b.includes("BEAR")) return "text-[var(--red)]";
  return "text-[var(--amber)]";
}

function timeUntil(dateStr?: string) {
  if (!dateStr) return "–";
  const d = new Date(dateStr);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return "CLOSED";
  const h = Math.floor(diff / 3_600_000);
  const days = Math.floor(h / 24);
  if (days > 0) return `${days}d`;
  return `${h}h`;
}

async function getTrendingData() {
  try {
    return await api.getTrending(24, 25);
  } catch {
    return null;
  }
}

export default async function Home() {
  const data = await getTrendingData();

  return (
    <div className="py-4 space-y-6 fade-in">
      {/* Banner */}
      <div className="text-center space-y-1 py-4 border border-[var(--fg-dim)] bg-[rgba(0,255,65,0.02)]">
        <div className="text-[var(--fg)] text-xl font-bold glow tracking-[0.3em]">
          ALPHA//TERMINAL
        </div>
        <div className="text-[var(--fg-dim)] text-xs tracking-widest">
          SMART MONEY INTELLIGENCE — FOLLOW THE FLOW
        </div>
        <div className="flex justify-center gap-6 pt-2 text-xs">
          <Link
            href="/free-money"
            className="px-4 py-1 border border-[var(--amber)] text-[var(--amber)] glow-amber hover:bg-[rgba(255,176,0,0.1)] transition-colors tracking-wider"
          >
            [FREE $$$] HIGH CONVICTION PLAYS
          </Link>
        </div>
      </div>

      {/* System status bar */}
      <div className="flex flex-wrap gap-4 text-xs text-[var(--fg-dim)] border border-[var(--fg-dim)] p-2">
        <span>
          &gt; SYS_STATUS: <span className="text-[var(--fg)]">ONLINE</span>
        </span>
        <span>
          &gt; DATA_SRC: <span className="text-[var(--fg)]">KALSHI</span>
        </span>
        {data && (
          <>
            <span>
              &gt; MARKETS_TRACKED:{" "}
              <span className="text-[var(--fg)]">{data.markets.length}</span>
            </span>
            <span>
              &gt; LAST_UPDATE:{" "}
              <span className="text-[var(--fg)]">
                {new Date(data.generatedAt).toUTCString().slice(17, 25)} UTC
              </span>
            </span>
          </>
        )}
        <span className="loading text-[var(--fg)]">SCANNING</span>
      </div>

      {/* Trending markets table */}
      <TerminalBox
        title="TRENDING MARKETS // SMART MONEY FLOW DETECTED"
        titleRight="24H WINDOW"
        color="green"
      >
        {!data ? (
          <div className="text-[var(--amber)] py-4 text-center">
            ERR: UNABLE TO CONNECT TO DATA FEED. CHECK API_URL CONFIG.
          </div>
        ) : data.markets.length === 0 ? (
          <div className="text-[var(--fg-dim)] py-4 text-center">
            NO MARKETS IN FEED. WAITING FOR DATA
            <span className="cursor" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr_1fr] gap-2 text-[var(--fg-dim)] text-xs pb-1 border-b border-[var(--fg-dim)] mb-1 min-w-[640px]">
              <span>TICKER</span>
              <span>MARKET</span>
              <span className="text-right">PROB</span>
              <span className="text-right">VOLUME</span>
              <span className="text-center">BIAS</span>
              <span className="text-right">CLOSES</span>
            </div>
            {data.markets.map((m: TrendingMarket) => (
              <Link
                key={m.marketTicker}
                href={`/market/${encodeURIComponent(m.marketTicker)}`}
                className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr_1fr] gap-2 terminal-row text-xs py-1 border-b border-[rgba(0,255,65,0.08)] min-w-[640px]"
              >
                <span className="text-[var(--cyan)] truncate font-bold">
                  {m.marketTicker.split("-").slice(-2).join("-")}
                </span>
                <span className="text-[var(--fg)] truncate" title={m.title}>
                  {m.title.length > 45 ? m.title.slice(0, 42) + "..." : m.title}
                </span>
                <span className="text-right text-[var(--amber)]">
                  {formatProb(m.impliedProbability)}
                </span>
                <span className="text-right text-[var(--fg)]">
                  {formatUsd(m.totalNotionalUsd)}
                </span>
                <span className={`text-center font-bold ${biasColor(m.sentimentBias)}`}>
                  {m.sentimentBias?.toUpperCase() || "–"}
                </span>
                <span className="text-right text-[var(--fg-dim)]">
                  {timeUntil(m.closeTime)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </TerminalBox>

      {/* Instructions */}
      <TerminalBox title="USAGE" color="cyan">
        <div className="text-xs space-y-1 text-[var(--fg-dim)]">
          <div>&gt; Click any market row to view full smart money analysis</div>
          <div>
            &gt;{" "}
            <Link
              href="/free-money"
              className="text-[var(--amber)] hover:text-[var(--fg)] underline"
            >
              [FREE $$$]
            </Link>{" "}
            — High conviction plays. Smart money &gt;80% aligned. 1-10% edge window.
          </div>
          <div>&gt; PROB = implied probability from market price (YES mid)</div>
          <div>&gt; BIAS = smart money directional lean (YES / NO / NEUTRAL)</div>
          <div>
            &gt;{" "}
            <span className="text-[var(--red)] font-bold">
              DISCLAIMER: NOT FINANCIAL ADVICE. YOU BET, YOU RISK. DO YOUR OWN RESEARCH.
            </span>
          </div>
        </div>
      </TerminalBox>
    </div>
  );
}
