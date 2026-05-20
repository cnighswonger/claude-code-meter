# Highcharts licensing — analysis, decision, and remediation

This file records the licensing analysis for `meter.vsits.co`'s use of
Highcharts, the operational decision that came out of it, and the
remediation taken on 2026-05-20. Every legal/factual claim is cited
against a primary source.

> **Important disclaimer (read first).** This is not legal advice. The
> author is not a lawyer. This file summarizes the operator's good-faith
> reading of the primary sources cited below, retrieved on the dates
> noted. Source documents are revised by their owners over time and may
> have changed since retrieval. Anyone relying on this analysis for a
> commercial decision should re-read the cited sources themselves and,
> for any non-trivial deployment, consult counsel.

---

## What the Highcharts terms actually say

Retrieved 2026-05-20 from <https://shop.highcharts.com/license-eula>:

- **§ 1.2 "Personal Use"** is defined as *"use of the Software by a natural
  person for purposes that are entirely non-commercial, non-professional,
  and for personal enjoyment or self-education."* The definition
  explicitly excludes business, trade, profession, government, non-profit,
  freelance work, and side-hustles.
- **§ 1.3 "Educational Use"** is limited to members of a Qualified
  Educational Institution for activities directly related to that
  institution's formal instructional programs (classroom instruction,
  student coursework).
- **§ 1.4 "Commercial Use"** is defined as *"any use of the Software for
  purposes of direct or indirect commercial advantage or financial gain."*
  Encompasses for-profit companies, non-profits, government entities,
  freelance services, and internal business contexts including R&D.

Retrieved 2026-05-20 from <https://shop.highcharts.com/license>
(Standard License Agreement):

- Public-website clause: *"any use of the Licensed Software in connection
  with a publicly accessible website or webpage made available to users
  outside of the Licensees organization (Public Websites) shall be deemed
  use in an External Application and will require a SaaS License."*

Retrieved 2026-05-20 from <https://shop.highcharts.com/> (pricing):

- **Internal License** — $185 per seat annually. The page states it
  authorizes internal applications and private websites only — not
  Public Websites.
- **SaaS License** — $366 per seat annually. The page states it grants
  rights to one External Application plus internal use.
- **OEM License** — perpetual, price by quote.

This file makes no claim about Highcharts' attribution/credits behavior:
the EULA does not address whether the `credits.enabled = false` API
setting is permitted under any license tier, and the operator did not
locate an authoritative primary source on this point during the
2026-05-20 review. The Standard License's "Public Websites" clause is
the load-bearing constraint here.

---

## What we know about `meter.vsits.co`

From the deployment memo and SESSION_STATE.md (verifiable in this repo):

- Operated by Veritas Supera IT Solutions LLC (a commercial entity).
- Publicly accessible website at `https://meter.vsits.co/`.
- Companion npm packages (`claude-code-meter`, `claude-code-cache-fix`)
  are MIT-licensed. The site exists to demonstrate the methodology those
  packages use; it is not directly revenue-generating.

Mapping these against the cited EULA:

- Operator type — Veritas Supera IT Solutions LLC is a for-profit
  company. Under § 1.4, this places the use within "Commercial Use"
  regardless of whether the specific site is revenue-generating
  (the definition includes "indirect commercial advantage" and lists
  internal R&D explicitly).
- Use type — publicly accessible website serving users outside the
  Licensee's organization. Per the Standard License, this is an
  "External Application" requiring a SaaS License.
- Personal Use does not apply: § 1.2 is limited to a natural person.
- Educational Use does not apply: § 1.3 is limited to qualified
  educational institutions.

The operator's good-faith reading is that a commercial license — the
SaaS tier at $366/seat/yr per the 2026-05-20 pricing — would be the
defensible path for continued Highcharts use on this site. Continuing
on the free tier as "community research" is not supportable under
the EULA as written.

---

## Three options that were on the table

### Option A — Buy a Highcharts SaaS License

- **Cost:** $366 per seat per year (2026-05-20 pricing). Subject to
  change by Highsoft.
- **Code change:** Configure the license key per Highsoft's
  documentation. (The exact API call is not asserted here; consult
  Highsoft's docs current at the time of purchase.)
- **Pros:** Zero re-architecture. Highcharts is mature, has every
  chart type the redesign uses (waterfall, gauge, paired column),
  and the operator has years of contribution history with the project.
- **Cons:** Real recurring cost. License is per-seat per-year, not
  perpetual.

### Option B — Argue non-commercial use, stay on the free terms

This was the operator's 2026-05-17 decision, made on a less-careful
reading of the EULA. The 2026-05-20 re-read above made clear this
option is not supportable: § 1.2 limits Personal Use to natural
persons, and § 1.4 places any commercial-entity operator under
Commercial Use, so the "non-commercial" framing does not survive
contact with the actual EULA text.

This option is documented here for transparency about the prior
decision path; it is not a path forward.

### Option C — Swap Highcharts for a permissively-licensed alternative

Replace Highcharts with a library whose published license permits use
in the deployment without further licensing decisions.

**Apache ECharts.** License verified as Apache-2.0 via the npm registry
(`https://registry.npmjs.org/echarts/latest` → `.license` field returns
`"Apache-2.0"`, retrieved 2026-05-20). Config-driven option API similar
in shape to Highcharts. Native `gauge` series with `progress: { show: true }`
covers the solid-gauge use case. Waterfall is not a native series type;
the Apache ECharts Handbook documents a stacked-bar pattern with a
transparent placeholder series at
<https://echarts.apache.org/handbook/en/how-to/chart-types/bar/waterfall/>.
Accessibility support exists via the `aria` configuration option but is
less mature than Highcharts' a11y module — soft regression vs the
redesign's original a11y goal.

**Observable Plot.** License verified as ISC via the npm registry
(`https://registry.npmjs.org/@observablehq%2Fplot/latest` → `.license`
field returns `"ISC"`, retrieved 2026-05-20). More declarative,
smaller bundle. No native waterfall or gauge — would require building
both manually. Bigger porting effort than ECharts for this dashboard's
chart mix.

**Plotly.js.** License is MIT per the npm registry. Has native
`waterfall` trace and `indicator`-based gauge. Bundle is significantly
larger than the Highcharts baseline. Different mental model from
Highcharts (traces + layout), so more re-learning per chart.

---

## Decision log

### 2026-05-17 — Option B (provisional, later corrected)

Operator initially selected Option B based on a reading of the
Highcharts EULA that emphasized non-commercial / personal-use scope.
Rationale recorded at the time: `meter.vsits.co` is open-source,
non-revenue-generating community research; operator's reading was that
this falls inside Highcharts' non-commercial / personal-use terms.

### 2026-05-17 — Hardening pass (added the same day)

Concerns about whether the non-commercial reading would survive scrutiny
led to a hardening pass: all outbound hyperlinks from the meter site
and its repo back to the `vsits.co` marketing site were removed
(`public/index.html`, `public/analysis.html`, `README.md`,
`package.json` author URL — committed as `ff6bcdd` on the PR #19
branch). The redesign's React tree already rendered "VSITS" and
"Veritas Supera IT Solutions" as plain text with no hyperlinks.
`meter.vsits.co` hostname references (DNS, Caddy, `DEFAULT_SERVER`,
OG metadata) were kept since those are the site's own identity, not
hyperlinks to the marketing site.

### 2026-05-20 — Re-read EULA, switched to Option C

A primary-source re-read of the EULA on 2026-05-20 (sections quoted
above) made clear that Option B is not supportable for a
commercial-entity-operated public website. The operator chose Option C
and the dashboard was ported from Highcharts to Apache ECharts in the
same commit cycle on branch `feat/web-vite-react-dashboard-echarts`.

**Operator: cnighswonger. Date: 2026-05-20. Rationale: the EULA as
written does not provide a non-commercial path for this deployment;
swap to a permissively-licensed alternative closes the question
without recurring license cost.**

### Out of scope

Hardware-key-issued Highcharts developer licenses from prior years
(the operator has historical contributor / customer status with
Highsoft going back ~5–8 years) were under recovery during the review
but were not part of the Option C decision. If a recovered license
turns out to cover the current Highcharts version range, it can be
weighed as a future revision; no commitment in this file.

---

## Sources cited

- Highcharts EULA — <https://shop.highcharts.com/license-eula> (retrieved 2026-05-20). § 1.2 Personal Use, § 1.3 Educational Use, § 1.4 Commercial Use.
- Highcharts Standard License — <https://shop.highcharts.com/license> (retrieved 2026-05-20). Public Websites clause.
- Highcharts pricing — <https://shop.highcharts.com/> (retrieved 2026-05-20). Internal $185/seat/yr, SaaS $366/seat/yr, OEM by quote.
- Apache ECharts npm package — <https://registry.npmjs.org/echarts/latest> (retrieved 2026-05-20). `.license` field: `Apache-2.0`.
- Apache ECharts Handbook, waterfall pattern — <https://echarts.apache.org/handbook/en/how-to/chart-types/bar/waterfall/> (retrieved 2026-05-20).
- Observable Plot npm package — <https://registry.npmjs.org/@observablehq%2Fplot/latest> (retrieved 2026-05-20). `.license` field: `ISC`.

— Proxy Builder, on behalf of operator
