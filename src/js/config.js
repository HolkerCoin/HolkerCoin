export const CHAIN = {
  name: 'Solana',
  rpc: 'https://solana-rpc.publicnode.com',
  commitment: 'confirmed',
};
export const DEX_SEARCH = 'https://api.dexscreener.com/latest/dex/search?q=holker';
export const DEX_BOOSTS = 'https://api.dexscreener.com/token-boosts/top/v1';
export const DEX_TOKENS = 'https://api.dexscreener.com/tokens/v1/solana/';
export const TRENDING_COUNT = 10;
export const POLL = {
  blockMs: 2000,
  dexMs: 30000,
  timeoutMs: 8000,
  backoffMaxMs: 60000,
};
// Used only to interpolate between polls until two real samples give a measured rate.
export const FALLBACK_BLOCKS_PER_SEC = 2.5;
