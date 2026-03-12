import Link from "next/link";
import { api } from "@/lib/api";
import TerminalBox from "@/components/TerminalBox";
import ConvictionBar from "@/components/ConvictionBar";

function fmt(v?: number, digits = 1) {
  if (v == null) return "–";
  return v.toFixed(digits);
}

function fmtPct(v?: number) {
  if (v == null) return "–";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v?: number) {
  if (!v) return "–";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtPrice(v?: number) {
  if (v == null) return "–";
  return `¢${(v * 100).toFixed(1)}`;
}

function biasTag(bias?: string) {
  if (!bias) return <span className="text-[var(--fg-dim)]">NEUTRAL</span>;
  const b = bias.toUpperCase();
  if (b.includes("YES") || b.includes("BULL"))
    return <span className="text-[var(--fg)] font-bold glow">▲ YES</span>;
  if (b.includes("NO") || b.includes("BEAR"))
    return <span className="text-[var(--red)] font-bold glow-red">▼ NO</span>;
  return <span className="text-[var(--amber)]">◆ {b}</span>;
}

function convictionBandColor(band?: string) {
  if (!band) return "text-[var(--fg-dim)]";
  if (band === "HIGH") return "text-[var(--fg)] glow";
  if (band === "MEDIUM") return "text-[var(--amber)] glow-amber";
  return "text-[var(--red)]";
}

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function MarketPage({ params }: PageProps) {
  const { ticker } = await params;
  const marketTicker = decodeURIComponent(ticker);

  let intel = null;
  let error = null;

  try {
    intel = await api.getMarketIntelligence(marketTicker, 24);
  } catch (e) {
    error = String(e);
  }

  return (
    <div className="py-4 space-y-4 fade-in">
      {/* Breadcrumb */}
      <div className="text-xs text-[var(--fg-dim)]">
        <Link href="/" className="hover:text-[var(--fg)]">
          [HOME]
        </Link>{" "}
        &gt;{" "}
        <span className="text-[var(--cyan)]">{marketTicker}</span>
      </div>

      {error ? (
        <TerminalBox title="ERROR" color="red">
          <div className="text-[var(--red)] text-xs space-y-1">
            <div>FAILED TO FETCH INTELLIGENCE FOR: {marketTicker}</div>
            <div className="text-[var(--fg-dim)]">{error}</div>
            <div className="pt-2">
              <Link href="/" className="text-[var(--fg)] hover:underline">
                &lt; BACK TO MARKETS
              </Link>
            </div>
          </div>
        </TerminalBox>
      ) : !intel ? (
        <div className="text-[var(--fg)] text-center py-12 loading">
          LOADING INTELLIGENCE REPORT
        </div>
      ) : (
        <>
          {/* Market header */}
          <TerminalBox
            title="MARKET INTELLIGENCE REPORT"
            titleRight={`${intel.windowHours}H WINDOW`}
            color="green"
          >
            <div className="space-y-3">
              <div>
                <div className="text-[var(--fg)] font-bold text-sm glow">
                  {intel.market.title}
                </div>
                {intel.market.subtitle && (
                  <div className="text-[var(--fg-dim)] text-xs mt-1">
                    {intel.market.subtitle}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="space-y-1">
                  <div className="text-[var(--fg-dim)]">MARKET ID</div>
                  <div className="text-[var(--cyan)] break-all">{marketTicker}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[var(--fg-dim)]">EVENT</div>
                  <div className="text-[var(--fg)]">{intel.market.eventTicker || "–"}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[var(--fg-dim)]">STATUS</div>
                  <div
                    className={
                      intel.market.status === "active"
                        ? "text-[var(--fg)] font-bold"
                        : "text-[var(--fg-dim)]"
                    }
                  >
                    {intel.market.status?.toUpperCase()}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[var(--fg-dim)]">CLOSES</div>
                  <div className="text-[var(--fg)]">
                    {intel.market.closeTime
                      ? new Date(intel.market.closeTime).toUTCString().slice(0, 22)
                      : "–"}
                  </div>
                </div>
              </div>
            </div>
          </TerminalBox>

          {/* 2 col: Pricing + Conviction */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Pricing */}
            <TerminalBox title="ORDERBOOK / PRICING" color="cyan">
              <div className="text-xs space-y-2">
                <div className="grid grid-cols-3 gap-2 text-[var(--fg-dim)] border-b border-[var(--fg-dim)] pb-1">
                  <span>SIDE</span>
                  <span className="text-right">BID</span>
                  <span className="text-right">ASK</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-[var(--fg)] font-bold">YES</span>
                  <span className="text-right text-[var(--fg)]">
                    {fmtPrice(intel.market.yesBid)}
                  </span>
                  <span className="text-right text-[var(--fg)]">
                    {fmtPrice(intel.market.yesAsk)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-[var(--red)] font-bold">NO</span>
                  <span className="text-right text-[var(--fg-dim)]">
                    {fmtPrice(intel.market.noBid)}
                  </span>
                  <span className="text-right text-[var(--fg-dim)]">
                    {fmtPrice(intel.market.noAsk)}
                  </span>
                </div>
                <div className="border-t border-[var(--fg-dim)] pt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[var(--fg-dim)]">IMPLIED PROB</div>
                    <div className="text-[var(--amber)] font-bold text-base">
                      {fmtPct(intel.market.impliedProbability)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--fg-dim)]">PRICE BIAS</div>
                    <div className="font-bold">{biasTag(intel.market.priceBias)}</div>
                  </div>
                  <div>
                    <div className="text-[var(--fg-dim)]">VOLUME</div>
                    <div className="text-[var(--fg)]">{fmtUsd(intel.market.volume)}</div>
                  </div>
                  <div>
                    <div className="text-[var(--fg-dim)]">OPEN INT.</div>
                    <div className="text-[var(--fg)]">{fmtUsd(intel.market.openInterest)}</div>
                  </div>
                </div>
              </div>
            </TerminalBox>

            {/* Conviction */}
            <TerminalBox title="CONVICTION SIGNAL" color="amber">
              <div className="text-xs space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--fg-dim)]">CONVICTION BAND</span>
                  <span
                    className={`font-bold text-lg ${convictionBandColor(intel.conviction.band)}`}
                  >
                    {intel.conviction.band}
                  </span>
                </div>
                <ConvictionBar score={intel.conviction.score} label="SCORE" />
                <div className="border-t border-[var(--amber)] pt-2 space-y-1">
                  <div className="text-[var(--fg-dim)]">SIGNAL NOTES:</div>
                  {intel.conviction.notes.length === 0 ? (
                    <div className="text-[var(--fg-dim)]">NO NOTES GENERATED</div>
                  ) : (
                    intel.conviction.notes.map((note, i) => (
                      <div key={i} className="text-[var(--fg)]">
                        &gt; {note}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </TerminalBox>
          </div>

          {/* Trade Flow */}
          <TerminalBox title="TRADE FLOW ANALYSIS" color="green">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-[var(--fg-dim)]">TRADE COUNT</div>
                <div className="text-[var(--fg)] font-bold text-lg">
                  {intel.tradeFlow.tradeCount.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[var(--fg-dim)]">NOTIONAL VOL</div>
                <div className="text-[var(--amber)] font-bold text-lg">
                  {fmtUsd(intel.tradeFlow.notionalUsd)}
                </div>
              </div>
              <div>
                <div className="text-[var(--fg-dim)]">LARGE ORDERS</div>
                <div className="text-[var(--cyan)] font-bold text-lg">
                  {intel.tradeFlow.largeOrderCount}
                </div>
              </div>
              <div>
                <div className="text-[var(--fg-dim)]">FLOW BIAS</div>
                <div className="font-bold text-lg">{biasTag(intel.tradeFlow.sentimentBias)}</div>
              </div>
            </div>
          </TerminalBox>

          {/* Wallet Intelligence */}
          <TerminalBox
            title="WALLET INTELLIGENCE"
            titleRight={`${intel.walletIntelligence.distinctWallets} WALLETS`}
            color="cyan"
          >
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-[var(--fg-dim)]">WALLET BIAS</div>
                  <div className="font-bold">
                    {biasTag(intel.walletIntelligence.walletBias)}
                  </div>
                </div>
                {intel.walletIntelligence.dislocation && (
                  <div>
                    <div className="text-[var(--fg-dim)]">DISLOCATION</div>
                    <div className="text-[var(--amber)] font-bold glow-amber">
                      ⚡ {intel.walletIntelligence.dislocationType?.toUpperCase()}
                    </div>
                  </div>
                )}
              </div>

              {/* Top wallets */}
              {intel.walletIntelligence.topWallets.length > 0 && (
                <div>
                  <div className="text-[var(--fg-dim)] mb-1">TOP SMART MONEY WALLETS:</div>
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 text-[var(--fg-dim)] border-b border-[var(--fg-dim)] pb-1 min-w-[420px]">
                    <span>WALLET</span>
                    <span className="text-right">SIDE</span>
                    <span className="text-right">SIZE</span>
                    <span className="text-right">SCORE</span>
                  </div>
                  <div className="overflow-x-auto">
                    {intel.walletIntelligence.topWallets.slice(0, 8).map((w, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 py-1 border-b border-[rgba(0,255,65,0.08)] min-w-[420px]"
                      >
                        <span className="text-[var(--cyan)] truncate font-mono text-[10px]">
                          {w.walletAddress.slice(0, 8)}…{w.walletAddress.slice(-6)}
                          {w.tag && (
                            <span className="ml-1 text-[var(--amber)]">[{w.tag}]</span>
                          )}
                        </span>
                        <span
                          className={`text-right font-bold ${
                            w.side === "YES"
                              ? "text-[var(--fg)]"
                              : "text-[var(--red)]"
                          }`}
                        >
                          {w.side}
                        </span>
                        <span className="text-right text-[var(--fg)]">
                          {fmtUsd(w.sizeUsd)}
                        </span>
                        <span className="text-right text-[var(--amber)]">
                          {w.qualityScore != null ? `${w.qualityScore.toFixed(0)}` : "–"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TerminalBox>

          {/* Generated at */}
          <div className="text-[var(--fg-dim)] text-xs text-right">
            REPORT GENERATED: {new Date(intel.generatedAt).toUTCString()}
          </div>
        </>
      )}
    </div>
  );
}
