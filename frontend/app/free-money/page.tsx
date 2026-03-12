import Link from "next/link";
import { api, HighConvictionMarket, OpportunityMarket } from "@/lib/api";
import TerminalBox from "@/components/TerminalBox";
import ConvictionBar from "@/components/ConvictionBar";

function fmtPct(v?: number | null) {
  if (v == null) return "??%";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v?: number | null) {
  if (!v) return "–";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function timeUntil(dateStr?: string | null) {
  if (!dateStr) return "–";
  const d = new Date(dateStr);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return "EXPIRED";
  const h = Math.floor(diff / 3_600_000);
  const days = Math.floor(h / 24);
  if (days > 0) return `${days}d ${h % 24}h`;
  return `${h}h`;
}

// convictionRatio is 0-1; convert to 0-100 for display
function convictionPct(m: HighConvictionMarket) {
  return Math.round(m.smartFlow.convictionRatio * 100);
}

function edgeLabel(m: HighConvictionMarket) {
  // Derive implied prob from bid/ask mid
  const mid = m.yesBid != null && m.yesAsk != null ? (m.yesBid + m.yesAsk) / 2 : null;
  if (mid == null) return null;
  const side = m.smartFlow.dominantSide;
  if (side === "YES" && mid < 0.92) {
    return `+${((1 - mid) * 100).toFixed(1)}% UPSIDE`;
  }
  if (side === "NO" && mid > 0.08) {
    return `+${(mid * 100).toFixed(1)}% NO EDGE`;
  }
  return null;
}

async function getData() {
  const [conviction, opps] = await Promise.allSettled([
    api.getHighConviction(48, 20, 2),
    api.getOpportunities(48, 20),
  ]);

  return {
    conviction: conviction.status === "fulfilled" ? conviction.value : null,
    opps: opps.status === "fulfilled" ? opps.value : null,
    convictionError: conviction.status === "rejected" ? String(conviction.reason) : null,
    oppsError: opps.status === "rejected" ? String(opps.reason) : null,
  };
}

export default async function FreeMoneyPage() {
  const { conviction, opps, convictionError, oppsError } = await getData();

  // Filter to markets with conviction ratio >= 0.70 (70% directional agreement)
  const hotMarkets = (conviction?.markets ?? []).filter(
    (m: HighConvictionMarket) => m.smartFlow.convictionRatio >= 0.7
  );

  const oppsList = opps?.opportunities ?? [];

  return (
    <div className="py-4 space-y-6 fade-in">
      {/* Header */}
      <div className="border border-[var(--amber)] p-4 text-center space-y-2 bg-[rgba(255,176,0,0.03)]">
        <div className="text-[var(--amber)] text-xl font-bold glow-amber tracking-[0.3em]">
          FREE MONEY TERMINAL
        </div>
        <div className="text-[var(--fg-dim)] text-xs tracking-wider">
          HIGH CONVICTION PLAYS // SMART MONEY ALIGNED // 1-10% EDGE WINDOW
        </div>
        <div className="text-xs text-[var(--red)] font-bold mt-2">
          ⚠ BET AT YOUR OWN RISK. NOT FINANCIAL ADVICE. DYOR. MARKETS CAN RESOLVE AGAINST SMART MONEY.
        </div>
      </div>

      {/* How it works */}
      <TerminalBox title="HOW THIS WORKS" color="cyan">
        <div className="text-xs space-y-1 text-[var(--fg-dim)]">
          <div>&gt; We scan ALL markets for ones where smart wallets are heavily biased one direction</div>
          <div>&gt; Conviction ratio &gt;= 70% = strong directional agreement among smart money wallets</div>
          <div>&gt; Edge = gap between market price and smart money implied direction</div>
          <div>
            &gt; <span className="text-[var(--amber)]">Safe range: 1-10% edge.</span> Larger dislocations = higher reward, higher risk
          </div>
          <div>&gt; Markets where smart money is WRONG do exist. Past accuracy ≠ future returns.</div>
        </div>
      </TerminalBox>

      {/* High Conviction Markets */}
      <TerminalBox
        title="HIGH CONVICTION PLAYS"
        titleRight={`${hotMarkets.length} MARKETS`}
        color="amber"
      >
        {convictionError ? (
          <div className="text-[var(--red)] text-xs">ERR: {convictionError}</div>
        ) : hotMarkets.length === 0 ? (
          <div className="text-[var(--fg-dim)] text-xs py-4 text-center">
            NO HIGH CONVICTION MARKETS FOUND IN 48H WINDOW
            <br />
            TRY AGAIN LATER OR CHECK TRENDING MARKETS
          </div>
        ) : (
          <div className="space-y-4">
            {hotMarkets.map((m: HighConvictionMarket) => {
              const edge = edgeLabel(m);
              const pct = convictionPct(m);
              return (
                <Link
                  key={m.marketTicker}
                  href={`/market/${encodeURIComponent(m.marketTicker)}`}
                  className="block border border-[rgba(255,176,0,0.3)] p-3 hover:border-[var(--amber)] hover:bg-[rgba(255,176,0,0.05)] transition-all"
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fg)] font-bold text-sm truncate">{m.title}</div>
                      {m.subtitle && (
                        <div className="text-[var(--fg-dim)] text-xs truncate">{m.subtitle}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {edge && (
                        <span className="text-[var(--fg)] font-bold text-xs glow bg-[rgba(0,255,65,0.1)] px-2 py-0.5">
                          {edge}
                        </span>
                      )}
                      <span className="text-[var(--fg-dim)] text-[10px]">
                        CLOSES: {timeUntil(m.closeTime)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-2">
                    <div>
                      <div className="text-[var(--fg-dim)]">SMART MONEY SIDE</div>
                      <div
                        className={`font-bold ${
                          m.smartFlow.dominantSide === "YES"
                            ? "text-[var(--fg)] glow"
                            : "text-[var(--red)] glow-red"
                        }`}
                      >
                        {m.smartFlow.dominantSide === "YES" ? "▲ YES" : "▼ NO"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--fg-dim)]">MARKET PRICE</div>
                      <div className="text-[var(--amber)] font-bold">
                        {m.yesBid != null && m.yesAsk != null
                          ? fmtPct((m.yesBid + m.yesAsk) / 2)
                          : "–"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--fg-dim)]">SMART WALLETS</div>
                      <div className="text-[var(--cyan)] font-bold">
                        {m.smartFlow.walletCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--fg-dim)]">SMART FLOW</div>
                      <div className="text-[var(--fg)]">{fmtUsd(m.smartFlow.totalUsd)}</div>
                    </div>
                  </div>

                  <ConvictionBar score={pct} label="CONVICTION" />
                </Link>
              );
            })}
          </div>
        )}
      </TerminalBox>

      {/* Dislocation opportunities */}
      <TerminalBox
        title="PRICE DISLOCATIONS // SMART MONEY VS MARKET"
        titleRight="CONTRARIAN SIGNALS"
        color="red"
      >
        {oppsError ? (
          <div className="text-[var(--red)] text-xs">ERR: {oppsError}</div>
        ) : oppsList.length === 0 ? (
          <div className="text-[var(--fg-dim)] text-xs py-4 text-center">
            NO DISLOCATIONS DETECTED IN CURRENT WINDOW
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr] gap-2 text-[var(--fg-dim)] text-xs pb-1 border-b border-[var(--red)] mb-2 min-w-[580px]">
              <span>MARKET</span>
              <span className="text-center">PROB</span>
              <span className="text-center">SM BIAS</span>
              <span className="text-right">FLOW</span>
              <span>NOTE</span>
            </div>
            {oppsList.map((m: OpportunityMarket) => (
              <Link
                key={m.marketTicker}
                href={`/market/${encodeURIComponent(m.marketTicker)}`}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr] gap-2 terminal-row text-xs py-1.5 border-b border-[rgba(255,51,51,0.1)] min-w-[580px]"
              >
                <span className="text-[var(--fg)] truncate" title={m.title}>
                  {m.title.length > 35 ? m.title.slice(0, 32) + "..." : m.title}
                </span>
                <span className="text-center text-[var(--amber)]">
                  {fmtPct(m.impliedProbabilityYes)}
                </span>
                <span
                  className={`text-center font-bold ${
                    m.walletBias.toUpperCase().includes("YES")
                      ? "text-[var(--fg)]"
                      : "text-[var(--red)]"
                  }`}
                >
                  {m.walletBias.toUpperCase()}
                </span>
                <span className="text-right text-[var(--fg-dim)]">
                  {fmtUsd(m.walletYesUsd + m.walletNoUsd)}
                </span>
                <span
                  className="text-[var(--fg-dim)] text-[10px] truncate"
                  title={m.opportunityNote}
                >
                  {m.opportunityNote}
                </span>
              </Link>
            ))}
          </div>
        )}
      </TerminalBox>

      {/* Risk disclaimer */}
      <TerminalBox title="RISK DISCLOSURE" color="red">
        <div className="text-xs space-y-1 text-[var(--fg-dim)]">
          <div className="text-[var(--red)] font-bold">!! READ BEFORE TRADING !!</div>
          <div>&gt; Prediction markets can and do resolve against smart money.</div>
          <div>&gt; This tool identifies STATISTICAL PATTERNS only — not certainties.</div>
          <div>
            &gt; Conviction ratio of 90% means 90% of DETECTED smart flow leans one way,
            NOT that outcome is 90% likely.
          </div>
          <div>&gt; Position size responsibly. Never bet more than you can lose.</div>
          <div>&gt; Past smart money accuracy does not guarantee future performance.</div>
          <div className="text-[var(--amber)] font-bold pt-1">
            &gt; THIS IS NOT FINANCIAL ADVICE. USE AT YOUR OWN RISK.
          </div>
        </div>
      </TerminalBox>
    </div>
  );
}
