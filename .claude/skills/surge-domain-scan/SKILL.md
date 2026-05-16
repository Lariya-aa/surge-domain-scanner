---
name: surge-domain-scan
description: Statically scan a URL (or list of URLs) and emit a Surge .list rule file of every referenced host. Fetches the page and its text resources (HTML/CSS/JS/JSON/XML), extracts hostnames from URLs and bare-domain mentions, filters ads/trackers, and renders DOMAIN / DOMAIN-SUFFIX rules. Use when the user wants to generate a Surge rule set from a URL without needing Surge running, predict what hosts an app/site will reach before actually using it, build a sharable rule list for GitHub publication, or scan a target on a machine that has no Surge instance.
---

# Surge Domain Scan (Static URL → .list)

Render a Surge `.list` from the **text contents** of one or more URLs. No Surge instance required — the script fetches the URL directly with Node's `fetch` and parses every host it can see in the response body (and CSP/Link headers).

## When to use

- "Generate Surge rules for `https://...`"
- "Scan this site and give me a .list" / "what hosts does this page call?"
- Preparing a publish-ready rule set for a GitHub repo (e.g., a `*.list` you'd commit and share)
- Predicting rules for an app/site **before** opening it through Surge

If the user wants hosts that an app **actually called** (real traffic, including JS-driven XHR/WebSocket that this scanner won't see), use the sibling skill `surge-traffic-to-list` instead — that one reads from a running Surge instance.

## Prerequisites

- Node ≥ 18 (uses built-in `fetch` + `AbortController`)
- This skill is project-local. The runnable script lives at the project root:
  - From project root: `node surge-domain-scan.js …`
  - From anywhere: `node <project>/.claude/skills/surge-domain-scan/scripts/surge-domain-scan.js …`
    (the `scripts/` entry is a relative symlink to `../../../../surge-domain-scan.js`)
- No dependency on the `surge` skill or on `surge-cli` for static scanning.

## How to invoke

```bash
# Preferred: cd into the project root, then:
node surge-domain-scan.js <url> [more urls...] [options]
```

**Default invocation for agent-driven use** (publish-ready list, no ads/trackers):

```bash
node surge-domain-scan.js <url> --mode suffix --filter-ads
```

The CLI script defaults `filterAds: false` so human users get raw output, but
**agents invoking this skill should always pass `--filter-ads`** unless the
user explicitly asks for the raw list. Same for `--mode suffix` — it produces
a much shorter, more publishable rule set.

### Common recipes

| Goal | Command |
|---|---|
| **Default agent recipe (publish-ready)** | `node surge-domain-scan.js <url> --mode suffix --filter-ads` |
| Quick scan, exact DOMAIN rules (raw, with ads) | `node surge-domain-scan.js https://chatgpt.com` |
| Multiple seed URLs into one list | `node surge-domain-scan.js https://a.com https://b.com --mode suffix --filter-ads` |
| Write to file | `node surge-domain-scan.js <url> --mode suffix --filter-ads --output Example.list` |
| Deeper crawl (more hops of discovered text resources) | `node surge-domain-scan.js <url> --depth 2 --max-urls 200 --mode suffix --filter-ads` |
| Raw domain list (no Surge format) | `node surge-domain-scan.js <url> --format domains --filter-ads` |
| User explicitly wants ads/trackers kept | `node surge-domain-scan.js <url> --mode suffix --no-filter-ads` |

Full flag set: `node surge-domain-scan.js --help`.

## Workflow Claude should follow

1. Default to `--mode suffix --filter-ads`. Only drop `--filter-ads` if the
   user explicitly says they want the raw / unfiltered list.
2. Confirm the target URL(s) with the user if ambiguous.
3. Run the script.
4. Inspect the output header. **Show `# FILTERED_ADS: N` in your reply** so
   the user can see how many ad/tracker domains were dropped. If `FILTERED_ADS:
   0` but the target is a known ad-heavy site (news/media), warn that the
   built-in blacklist may not cover their SSP/RTB stack and offer
   `--no-filter-ads` for inspection.
5. If `FETCH_ERRORS > 0`, mention which URLs failed; the input host is still
   recorded.
6. If `HOSTS` is suspiciously low for a complex site (e.g., 0–3 for an SPA),
   warn that this is the static-scan limitation — much of the host list may
   only appear at runtime via JS. Suggest the sibling skill
   `surge-traffic-to-list` for those cases.

## Output anatomy

```
# NAME: <inferred from seed URL hostname>
# SOURCE: <seed URL(s)>
# UPDATED: <UTC>
# MODE: exact|suffix
# FORMAT: surge|domains|json
# HOSTS: N
# RULES: M
# FILTERED_ADS: K
# FETCH_ERRORS: P
DOMAIN-SUFFIX,example.com
...
```

## Limitations (be honest with the user)

- **No JS execution.** Hosts only reachable through runtime JS (XHR/fetch/WebSocket) won't appear unless their URLs literally exist in the response text.
- **Login-walled / anti-bot pages**: returns whatever the unauthenticated/non-browser fetch sees. May be a stub or block page.
- **Suffix mode heuristic**: uses a small `COMMON_SECOND_LEVEL_SUFFIXES` table for ccTLDs (co.uk, com.cn, etc.). For maximum safety, use `--mode exact`.
- **Ad filter coverage**: ~55 known ad/analytics domains. Heavily ad-supported sites will still leak some adtech SSPs/RTB domains.
