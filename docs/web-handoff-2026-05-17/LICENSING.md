# Highcharts licensing — decision required before deploy

The current `meter.vsits.co` site uses Highcharts. So does this redesign. This
is fine if usage stays under Highcharts' non-commercial / personal license. It
becomes a problem if the site is treated as commercial.

This file exists so the deployer is forced to make the call before the redesign
ships.

---

## The terms

Highcharts is dual-licensed:

- **Free** for non-commercial use, evaluation, personal projects, schoolwork,
  non-profits. The free terms allow you to ship the JS files, do not require
  a watermark, and do not require attribution at runtime.
- **Paid** for commercial use. Includes a per-developer / per-server license
  key. Without a commercial license, "commercial use" is not permitted under
  the terms — even if the code itself loads identically and shows no warning.

The line between non-commercial and commercial is **operator intent, not the
technical implementation**. A dashboard hosted at a company's vanity domain,
promoted in marketing material, linked from a corporate site, or sold as a
product — these are commercial uses, regardless of whether the dashboard
itself is paywalled or whether the company is currently profitable.

---

## What we know about `meter.vsits.co`

From the deployment memo:

- Operated by Veritas Supera IT Solutions LLC (a company).
- Linked from `vsits.co` (the company's marketing site).
- The companion npm packages (`claude-code-meter`, `claude-code-cache-fix`) are
  free / MIT, but they support the company's broader product offering.
- The site is currently small in audience and the maintainer notes "no
  watermark visible because we're below the dashboard threshold." This is a
  technical observation, not a legal defense — Highcharts' terms turn on
  use type, not visibility.

A conservative reading of the Highcharts terms suggests `meter.vsits.co`
should be treated as commercial. A more permissive reading — that it's
community open-data research with no paid product — is defensible but is the
operator's call to make, not the design agent's.

**This is not legal advice.** A 5-minute read of <https://shop.highcharts.com/eula>
by someone with authority to commit the company is the right path.

---

## Three options

Pick one before deploying.

### Option A — Buy a commercial Highcharts license

Highcharts commercial licenses start around USD ~535/developer/year and
scale up for SaaS / multi-server deployments. `meter.vsits.co` is a single
server with a single deploying developer, so the entry tier is the relevant
price.

- **Cost:** ~$535/yr (single OEM) up to a few thousand for SaaS terms.
- **Code change:** Add the license key. In `web/src/lib/chartBase.jsx`,
  before any `Highcharts.chart(...)` call:
  ```js
  Highcharts.setOptions({ credits: { enabled: false } });
  // License key configured via Highcharts.setLicenseKey() — see Highcharts docs.
  ```
- **Pros:** Zero code rework. Highcharts is mature, has every chart type the
  redesign uses (waterfall, solid-gauge, paired column), great accessibility
  module, well-documented API.
- **Cons:** Real recurring cost; the only reason to pay if Highcharts has
  something the free alternatives don't.

### Option B — Treat the site as non-commercial and keep Highcharts free

Maintain that `meter.vsits.co` is community research, not a product. Keep
the redesign as shipped.

- **Cost:** $0.
- **Code change:** None — already configured this way.
- **Pros:** No friction; matches the current live site's stance.
- **Cons:** Increasingly tenuous as the site grows or the company markets
  around it. If Highcharts ever audits, the operator is exposed. Be prepared
  to switch quickly if challenged.

### Option C — Swap to ECharts (Apache 2.0) or Observable Plot (ISC)

Replace Highcharts with a permissively-licensed alternative. No license,
no audit risk, free forever.

**ECharts (Apache 2.0).** Closest feature parity to Highcharts. Has
waterfall (`series.type: 'custom'` + render function — a bit fiddly),
solid-gauge equivalent (`series.type: 'gauge'` with custom styling), paired
columns, annotations. Bundle size comparable to Highcharts.

**Observable Plot (ISC).** More declarative, friendlier to React, smaller
bundle. But: no waterfall out of the box, no solid-gauge. Either build them
manually or accept different visuals.

- **Cost:** Engineering time. Estimate: half a day to swap Highcharts for
  ECharts on this dashboard. A full day for Plot if you want to redesign
  the gauge/waterfall to fit Plot's idioms.
- **Code change:** Swap `Highcharts.chart(...)` calls for `echarts.init(...)
  + .setOption(...)` (or `Plot.plot(...)` for Plot). The `Chart` wrapper in
  `web/src/lib/chartBase.jsx` is the only file with library-specific code —
  everything else passes options through it. Replacing this one file does
  90% of the swap.
- **Pros:** No license risk. Library is free forever. ECharts is well
  maintained, Chinese-led but with strong English docs.
- **Cons:** Some chart types will look slightly different. The waterfall
  specifically needs the most work — ECharts' approach is less idiomatic
  than Highcharts'. Plot doesn't have one at all.

---

## Recommendation

If `meter.vsits.co` is a community research surface and you want zero ambiguity:
**Option C with ECharts.** It's a half-day of work and removes the question
entirely.

If you're certain the site will stay personal-scale and Highcharts feels worth
the slight legal greyness: **Option B.** Document the decision internally so
future-you knows what was decided.

If money is no object and you want to keep the current build verbatim:
**Option A.** Cleanest path, just buy the license.

---

## Decision log

> Fill in below before deploying.

- [ ] Option A — Highcharts commercial license. License key: `__________`
- [x] Option B — Highcharts free / non-commercial. Risk accepted by: `cnighswonger (operator)` on `2026-05-17`.
- [ ] Option C — Swap to ECharts / Plot. Implemented in commit: `__________`

**Rationale (2026-05-17):** `meter.vsits.co` is open-source, non-revenue-generating community research. Operator's reading: this falls inside Highcharts' non-commercial / personal-use terms. Revisit if the site's posture shifts (revenue, paywall, embedded in a commercial product, etc.).

**Hardening pass (2026-05-17, post-decision):** A consult with the Highcharts GPT noted that the non-commercial allowance applies when the project is "strictly non-commercial and you are not charging for access or distribution" — and that a commercial license is required if the project is "intended for distribution or commercial gain." To weaken any "this is a corporate product surface" reading and tighten the non-commercial posture, all outbound hyperlinks from the meter site and its repo back to the `vsits.co` marketing website were removed:

- `public/analysis.html` — unlinked the "Veritas Supera IT Solutions LLC" footer reference; rewrote the "5x multiplier" footnote to point at the project README instead of the `vsits.co/three-layer-gate-quota-overage/` blog post.
- `README.md` — dropped the "Blog series" link to `vsits.co/three-layer-gate-quota-overage/` from the Related section.
- `package.json` — removed the `(https://vsits.co)` URL portion from the `author` field; kept the `<dev@vsits.co>` email since that's the npm-author convention for ownership identification.

The redesign's React tree (`web/src/components/sections.jsx`) already renders "VSITS" and "Veritas Supera IT Solutions" as plain text with no hyperlinks, so no changes were needed there. The `meter.vsits.co` hostname references throughout the codebase (DNS, Caddy config, `DEFAULT_SERVER` constant, OG metadata) are not hyperlinks to the marketing site — they're the meter site's own identity — and stay.

— Design Agent
