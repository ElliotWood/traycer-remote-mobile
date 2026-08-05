/**
 * "Manage subscription" — derived from the authn base, never hardcoded.
 *
 * The billing surface lives on `platform.<env>` beside `authn.<env>`, so
 * deriving it from {@link AUTHN_BASE_URL} keeps it pointing at whichever
 * deployment this build was pointed at. A hardcoded production URL would send
 * a staging user to a real billing page, which is the sort of mistake that is
 * invisible until someone cancels the wrong thing.
 *
 * EXTRACT-ON-DEMAND DEBT, stated rather than left to be discovered. This is a
 * third copy: `clients/gui-app/src/lib/auth/manage-subscription-url.ts` is the
 * original, `clients/mobile/src/host/manage-subscription-url.ts` vendored it
 * verbatim, and this vendors it again. The tab plan's decision 6 says a module
 * the tab needs MOVES to `clients/shared` and the other clients import it
 * back, and that is the correct end state here — twenty lines with a URL
 * heuristic in three places will drift.
 *
 * It was not done in this change because `clients/shared` and `clients/mobile`
 * both had live owners mid-turn, and a move touches both. Doing the move is a
 * few minutes' work in a quiet tree; doing it into two hot packages is a merge
 * conflict in files nobody in this change is qualified to resolve.
 */
import { AUTHN_BASE_URL } from "@/config";

/** Where an unrecognisable authn base falls back to. */
const PRODUCTION_PLATFORM_URL = "https://platform.traycer.ai";

export function resolveManageSubscriptionUrl(authnBaseUrl: string): string {
  try {
    const url = new URL(authnBaseUrl);
    const hostname = url.hostname;
    if (hostname.startsWith("authn.")) {
      url.hostname = `platform.${hostname.slice("authn.".length)}`;
      url.pathname = "/";
      // `new URL().toString()` always emits the trailing slash for a root
      // path; stripping it keeps the rendered link identical to the other two
      // copies, which matters only because a diff between them is how the
      // drift this docblock warns about would be spotted.
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // An unset or malformed base is already reported by `configProblems()`;
    // falling through to production here keeps the row rendering rather than
    // throwing inside the header.
  }
  return PRODUCTION_PLATFORM_URL;
}

/** The link the account menu renders, for the configured deployment. */
export function manageSubscriptionUrl(): string {
  return resolveManageSubscriptionUrl(AUTHN_BASE_URL);
}
