interface TerminalBoxProps {
  title?: string;
  children: React.ReactNode;
  color?: "green" | "amber" | "red" | "cyan";
  className?: string;
  titleRight?: string;
}

const colorMap = {
  green: "terminal-box",
  amber: "terminal-box-amber",
  red: "terminal-box-red",
  cyan: "terminal-box-cyan",
};

const titleColorMap = {
  green: "text-[var(--fg)] bg-black border-b border-[var(--fg-dim)]",
  amber: "text-[var(--amber)] bg-black border-b border-[var(--amber)]",
  red: "text-[var(--red)] bg-black border-b border-[var(--red)]",
  cyan: "text-[var(--cyan)] bg-black border-b border-[var(--cyan)]",
};

export default function TerminalBox({
  title,
  children,
  color = "green",
  className = "",
  titleRight,
}: TerminalBoxProps) {
  return (
    <div className={`${colorMap[color]} ${className}`}>
      {title && (
        <div className={`px-3 py-1 text-xs font-bold tracking-wider flex justify-between ${titleColorMap[color]}`}>
          <span>[ {title} ]</span>
          {titleRight && <span className="text-[var(--fg-dim)] font-normal">{titleRight}</span>}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}
