import { isAddress } from "@solana/kit";

/** Fomo's public address is kept in component state, never in a URL or storage. */
export function parseWalletAddress(value: string): string | null {
  const trimmed = value.trim();
  return isAddress(trimmed) ? trimmed : null;
}

export function enrollmentWalletIssue(owner: string, expectedOwner: string | null): string | null {
  if (expectedOwner && owner !== expectedOwner) {
    return "This is a different wallet from your Fomo address. Switch to your Fomo account in Phantom, then reconnect. Your pledge has not been submitted.";
  }
  return null;
}

/** Only forward the public page path, never query strings or fragment contents. */
export function phantomBrowseUrl(pageUrl: string): string | null {
  try {
    const page = new URL(pageUrl);
    if (page.protocol !== "https:" || page.username || page.password) return null;
    const host = page.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
    return `https://phantom.com/ul/browse/${encodeURIComponent(page.origin + page.pathname)}?ref=${encodeURIComponent(page.origin)}`;
  } catch {
    return null;
  }
}

/** Wallet errors may be wrapped by the transaction client. Never show raw RPC errors. */
export function wasWalletDeclined(error: unknown): boolean {
  const visited = new Set<object>();
  for (let current = error; current && typeof current === "object" && !visited.has(current);) {
    visited.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === 4001 || value.code === "4001") return true;
    current = value.cause;
  }
  return false;
}

/** Only the SDK's typed block-height error identifies this expiration case. */
export function wasTransactionExpired(error: unknown): boolean {
  const seen = new Set<object>();
  for (let current = error; current && typeof current === "object" && !seen.has(current);) {
    seen.add(current);
    const value = current as { context?: { __code?: unknown }; cause?: unknown };
    if (value.context?.__code === 1) return true;
    current = value.cause;
  }
  return false;
}
