interface ConvictionBarProps {
  score: number; // 0-100
  label?: string;
}

export default function ConvictionBar({ score, label }: ConvictionBarProps) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 80 ? "var(--fg)" : pct >= 50 ? "var(--amber)" : "var(--red)";
  const filled = Math.round(pct / 5); // out of 20 chars
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);

  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      {label && <span className="text-[var(--fg-dim)] w-20 shrink-0">{label}</span>}
      <span style={{ color }} className="tracking-tight">
        {bar}
      </span>
      <span style={{ color }} className="font-bold w-8 text-right">
        {pct}%
      </span>
    </div>
  );
}
