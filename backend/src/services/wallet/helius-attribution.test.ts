import { describe, expect, test } from "bun:test";
import { extractHeliusAttributions } from "./helius-attribution";

describe("helius attribution parser", () => {
  test("parses direct normalized payload", () => {
    const parsed = extractHeliusAttributions({
      marketTicker: "SPX-TEST",
      walletAddress: "wallet_1",
      side: "YES",
      sizeUsdEst: 1200,
      timestamp: 1763040000
    });

    expect(parsed.length).toBe(1);
    expect(parsed[0]?.marketTicker).toBe("SPX-TEST");
    expect(parsed[0]?.side).toBe("YES");
  });

  test("parses accountData style payload", () => {
    const parsed = extractHeliusAttributions({
      market_ticker: "BTC-TEST",
      accountData: [
        {
          account: "wallet_abc",
          nativeBalanceChange: -200,
          tokenBalanceChanges: [
            {
              mint: "mint_1",
              userAccount: "wallet_abc",
              rawTokenAmount: {
                tokenAmount: "30"
              }
            }
          ]
        }
      ]
    });

    expect(parsed.length).toBe(1);
    expect(parsed[0]?.marketTicker).toBe("BTC-TEST");
    expect(parsed[0]?.side).toBe("NO");
    expect(parsed[0]?.sizeUsdEst).toBe(230);
  });
});
