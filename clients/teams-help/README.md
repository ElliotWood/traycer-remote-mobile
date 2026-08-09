# Teams Help tab

A static explainer for the Traycer Teams app, served at `/help/` and declared
as a second static tab in the app manifest.

```
site/index.html   the page
site/theme.css    tokens for Teams' four themes
site/styles.css   layout, components, motion
site/help.js      progressive enhancement only
tools/            screenshot + assertion harness
deploy/           the VM install script
```

## Why it is hand-written, with no build step

Four files, no `package.json`, no bundler, no dependencies. The deleted
`clients/teams-tab` was Vite + React + Fluent + teams-js, and two of this
repo's recorded deployment failures came from that shape:

- a Git-Bash `--base=/tab/` mangled by MSYS path conversion into
  `/Program Files/Git/tab/`, which deployed cleanly and 404'd every asset
- a router with no basepath support, which rendered "Not Found" at a subpath
  and then pegged the CPU when given one

Both exist because a bundler rewrites asset URLs at build time. Relative
references in a hand-written document have nothing to rewrite. The dist-branch
deploy mechanism does not care where the files came from, so nothing is lost.

## The theme arrives in the URL, not from teams-js

The manifest's `contentUrl` is `…/help/?theme={theme}`. Teams substitutes that
before the document is requested, and a ten-line inline script in `<head>`
copies it onto `<html data-theme>`. The first paint is already correct.

This is deliberate, and it is why teams-js is not a dependency:

- teams-js is **no longer in this repo at all** — it left with `teams-tab`
- `app.initialize()` is unreliable in exactly this position. It rejects at
  ~60s outside Teams, and this repo measured it **hanging forever** under a
  non-Teams parent, painting an empty document. That bug was in code whose
  own docblock claimed to prevent it
- a help page is what you open when something else is broken. It must not
  need a handshake with the thing that is broken

`{theme}` is the TeamsJS **v1** placeholder name. Mobile Teams supports only
v1 names, so `{app.theme}` would work on desktop and silently fail on phones.

Four themes, not three: `default`, `dark`, `contrast` and **`glass`** — the
translucent theme Teams uses on Apple Vision Pro, which is missing from most
"Teams has three themes" summaries.

## It documents what actually ships

The page draws the whole assessment journey and badges each step *works
today* / *built, not connected yet* / *outside Teams, on purpose*. As of
`main` @ `438454c5` the one unconnected step is the **proactive completion
reply**: `proactive/` has no production caller, so the bot never tells you an
assessment finished.

Keep it that way. A help page that quietly describes unshipped behaviour
sends its reader to try something that fails, and they conclude the bot is
broken rather than unfinished.

**And re-derive the badges whenever `clients/teams-bot/src` moves.** This
section previously claimed attachments were never read and that a confident
question fell through to the help card. Both were true when written and both
were false six hours later, when `autobuild/opportunity-intake` merged — so
the page was telling people a capability did not exist when it did, which is
the more damaging direction to be wrong in. Every error pointed that way.
Verify against the source, never against this file or the artifact:

```sh
# is the proactive reply wired yet?
grep -rn "proactive/" --include=*.ts clients/teams-bot/src \
  | grep -v __tests__ | grep -v "src/proactive/"

# are attachments staged on the live path?
grep -rn "stageAttachments" clients/teams-bot/src/index.ts
```

## The card replicas track `teams/card-design`, not `main`

The four Adaptive Card replicas in `site/index.html` — clarify, assessment
started, approval, interview — are drawn against **`teams/card-design`
(`855c8116`)**, which rebuilt all of them. Verified against that branch's
`cards.ts`, not against a summary of it.

**So `/help/` must not deploy before that branch merges**, or the replicas
will not match the live bot.

The same now applies to **`teams/ack-honesty`**, which rewrites
`buildAssessmentStartedCard` so it stops promising a reply nothing sends. The
page quotes its new subtitle (*"It's running. Open it to watch progress — I
won't ping you when it finishes."*), so that branch is a second deploy
prerequisite.

The change that is not cosmetic: the fleet row now carries **`Open` only**,
and `Reply` / `History` moved down to the chat status card. That alters *how
you reply to an agent*, which this page teaches.

Replicas are divs rather than screenshots partly for this reason — a stale
string is greppable, where a stale screenshot rots silently.

**Both prerequisites landed in `main` on 2026-08-09** (autobuild check-in), so
the deploy gate above is satisfied — and the grep that sentence promises is now
run rather than available:

```sh
# every mock-eyebrow / mock-subtitle / mock-btn on the page must appear
# verbatim under clients/teams-bot/src
cd clients/teams-bot && npx vitest run src/read-surface/__tests__/help-page-copy.test.ts
```

It is **opt-out**: a replica added to the page is checked without anyone
opting it in, and example content — placeholder epic and opportunity names —
is exempted by marking that element `data-sample` in `site/index.html`. The
page rotted three claims within hours of the intake merge; this is what makes
the next one a red build instead of a reader noticing.

## Checking it

```sh
node clients/teams-help/tools/shoot-help.mjs
```

Screenshots every theme at desktop and phone widths into `tools/shots/`, and
asserts: the theme applied, no horizontal overflow, no section left
invisible, no console errors, the reduced-motion path still shows content,
the page is readable with JavaScript disabled, and an unsubstituted
`{theme}` falls through rather than selecting nothing.

It cannot verify the Teams handshake. teams-js enforces an origin allowlist,
so only real Teams can complete one — which is the other half of why the page
does not depend on it.

## Deploying

No nginx change. `bootstrap.sh`'s vhost ends with
`location / { root /var/www/traycer; try_files $uri $uri/ =404; }`, so files
at `/var/www/traycer/help/` are already served at `/help/`. Unlike `/tab/`,
`/api/messages` and `/push/`, this adds no location block — so there is
nothing for `compare-vm-state.mjs` to report as drift, and a rebuilt VM loses
only the content, not the route.

```sh
# 1. publish the four files to the dist branch
git switch --orphan demo/help-dist
git checkout main -- clients/teams-help/site
mv clients/teams-help/site/* . && rm -rf clients
git add index.html styles.css theme.css help.js
git commit -m "help dist" && git push -f origin demo/help-dist
git switch -

# 2. install on the VM
az vm run-command invoke -g "$RG" -n "$VM" --command-id RunShellScript \
  --scripts @clients/teams-help/deploy/vm-install-help.sh \
  --query "value[0].message" -o tsv

# 3. verify off-box
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "https://$FQDN/help/"
```

`--scripts @file`, never an inlined body: that path re-parses through
`cmd.exe`, which caps at 8191 characters and silently drops non-ASCII.
