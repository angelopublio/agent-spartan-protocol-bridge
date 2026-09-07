const SENSITIVE_TOKENS = new Set([
  "token",
  "secret",
  "password",
  "cookie",
  "credential",
  "auth",
  "session",
  "keychain",
  "account",
  "email",
  "env",
  "environment",
  "authorization",
]);

const SENSITIVE_JOINED = new Set(["apikey", "authfile"]);

export function isAsciiKey(key: string): boolean {
  return /^[\x00-\x7F]+$/.test(key);
}

export function tokenizeRegistryKey(key: string): { tokens: string[]; joined: string } {
  const bounded = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  const tokens = bounded
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
  return { tokens, joined: tokens.join("") };
}

export function isSensitiveRegistryKey(key: string): boolean {
  if (!isAsciiKey(key)) {
    return false;
  }
  const { tokens, joined } = tokenizeRegistryKey(key);
  return tokens.some((token) => SENSITIVE_TOKENS.has(token)) || SENSITIVE_JOINED.has(joined);
}
