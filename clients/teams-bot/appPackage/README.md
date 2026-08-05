# Teams app package — T1 skeleton

Schema `manifestVersion` **1.25** (required for channel-enabled apps from July
2026 — see the epic brief). This is the manifest shape for the bot skeleton
only; assembling the installable `.zip` (icons, admin submission, install
scoped to one user) is ticket T0c's scope ("App package + admin approval"),
not this ticket's.

**Placeholders, replace before packaging:**

- `id`, `bots[0].botId` — the bot's real Azure App ID (all-zero GUID here, not a real one)
- `developer.*` — real developer name and URLs
- `color.png` (192×192) / `outline.png` (32×32, transparent) — not included; no brand asset exists yet, and generating a placeholder image isn't this ticket's job either

**Deliberately absent, not "forgotten":**

- No `copilotAgents` section — the M365 Copilot channel doesn't support
  `Action.Execute`, which the entire action surface depends on (rubric §3).
  Channel selection itself happens at Azure Bot Service registration, not in
  this file; this manifest just doesn't declare Copilot-agent behavior.
- `scopes: ["personal"]` only — matches the admin-request's ask ("Specific
  users: me"), not team/group scope. Widen only if the user's install target changes.
- `validDomains: []` — nothing to add until a tab or message-extension link exists (T5/T6, out of this round's scope).
