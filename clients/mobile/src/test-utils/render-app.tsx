/**
 * Mounts `App` inside the providers it needs (a retry-free `QueryClient` for the
 * fleet query and the `HostClientProvider`) for render tests. The reusable
 * composition seam T5/T6/T7 render tests build on.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MobileAuthService } from "@/host/auth-service";
import { HostClientProvider, type MobileHostClient } from "@/host/host-client-context";
import { App } from "@/App";
import { render } from "./dom";

export function renderApp(options: {
  readonly auth: MobileAuthService;
  readonly client: MobileHostClient | null;
}): void {
  const queryClient = new QueryClient({
    // Deterministic tests: an errored query must fail immediately, not retry.
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <HostClientProvider client={options.client}>
        <App auth={options.auth} />
      </HostClientProvider>
    </QueryClientProvider>,
  );
}
