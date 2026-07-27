/**
 * Vendored verbatim from `clients/gui-app/src/lib/auth/manage-subscription-url.ts`
 * (pure logic, no desktop-specific imports) — derives the "Manage
 * subscription" platform URL from `authnBaseUrl` (mobile's own
 * `AUTHN_BASE_URL`) so it stays in lockstep with whichever deploy target
 * mobile is pointed at, instead of a parallel hardcoded guess.
 */
export function resolveManageSubscriptionUrl(authnBaseUrl: string): string {
  try {
    const url = new URL(authnBaseUrl);
    const hostname = url.hostname;
    if (hostname.startsWith("authn.")) {
      url.hostname = `platform.${hostname.slice("authn.".length)}`;
      url.pathname = "/";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Falls through to the production default.
  }
  return "https://platform.traycer.ai";
}
