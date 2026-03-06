import { env } from "../../config";
import { getSolUsdPrice } from "./price-feed";

type RpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Array<string | number | boolean | Record<string, string | number | boolean>>;
};

type RpcResponse<T> = {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type RpcTransactionMeta = {
  preBalances?: number[];
  postBalances?: number[];
};

type RpcTransactionPayload = {
  slot?: number;
  blockTime?: number;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string; signer?: boolean }>;
    };
  };
  meta?: RpcTransactionMeta;
};

export type RpcReplayTransaction = {
  signature: string;
  slot: number | null;
  blockTime: number | null;
  signer: string | null;
  nativeBalanceChange: number;
};

async function rpcCall<T>(request: RpcRequest): Promise<T | null> {
  if (!env.SOLANA_RPC_URL) {
    return null;
  }

  const response = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) {
    return null;
  }

  return payload.result ?? null;
}

function firstSigner(accountKeys: Array<string | { pubkey?: string; signer?: boolean }> | undefined): string | null {
  if (!accountKeys || accountKeys.length === 0) {
    return null;
  }

  for (const key of accountKeys) {
    if (typeof key === "string") {
      return key;
    }

    if (typeof key.pubkey === "string" && key.signer === true) {
      return key.pubkey;
    }
  }

  const first = accountKeys[0];
  if (typeof first === "string") {
    return first;
  }

  return typeof first?.pubkey === "string" ? first.pubkey : null;
}

function deriveNativeBalanceChange(meta: RpcTransactionMeta | undefined): number {
  if (!meta?.preBalances || !meta.postBalances || meta.preBalances.length === 0 || meta.postBalances.length === 0) {
    return 0;
  }

  const pre = Number(meta.preBalances[0] ?? 0);
  const post = Number(meta.postBalances[0] ?? 0);
  return (post - pre) / 1_000_000_000;
}

export async function fetchTransactionForReplay(signature: string): Promise<RpcReplayTransaction | null> {
  const payload = await rpcCall<RpcTransactionPayload>({
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
  });

  if (!payload) {
    return null;
  }

  return {
    signature,
    slot: typeof payload.slot === "number" ? payload.slot : null,
    blockTime: typeof payload.blockTime === "number" ? payload.blockTime : null,
    signer: firstSigner(payload.transaction?.message?.accountKeys),
    nativeBalanceChange: deriveNativeBalanceChange(payload.meta)
  };
}

type RpcBalancePayload = {
  value?: number;
};

export async function fetchWalletBalanceUsd(walletAddress: string): Promise<number | null> {
  const payload = await rpcCall<RpcBalancePayload>({
    jsonrpc: "2.0",
    id: 1,
    method: "getBalance",
    params: [walletAddress]
  });

  if (!payload || typeof payload.value !== "number") {
    return null;
  }

  const solBalance = payload.value / 1_000_000_000;
  const solUsdPrice = await getSolUsdPrice();
  return solBalance * solUsdPrice;
}
