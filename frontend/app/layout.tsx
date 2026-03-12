import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "ALPHA//TERMINAL — x314 DLOW",
  description: "Smart money intelligence. Follow the flow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flicker">
        <Header />
        <main className="min-h-screen px-4 py-4 max-w-7xl mx-auto">
          {children}
        </main>
        <footer className="border-t border-[var(--fg-dim)] mt-8 py-3 text-center text-[var(--fg-dim)] text-xs px-4">
          <span>ALPHA//TERMINAL v0.1 </span>
          <span className="mx-2">|</span>
          <span>DATA: KALSHI DEGEN MARKETS</span>
          <span className="mx-2">|</span>
          <span>BET AT YOUR OWN RISK. NOT FINANCIAL ADVICE.</span>
        </footer>
      </body>
    </html>
  );
}
