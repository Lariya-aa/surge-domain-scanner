---
name: surge-traffic-to-list
description: Convert live Surge traffic into a Surge .list rule file. Pulls hosts from `surge-cli dump recent` (per-process) or `dump traffic-stat-host` (monthly aggregate), filters ads/trackers, collapses to DOMAIN-SUFFIX rules, and emits a publish-ready .list with header metadata. Use when the user wants to generate a Surge rule set for an app/site they just used, capture which hosts a specific process is calling, or turn observed traffic into a sharable rule list.
---

# Surge Traffic → Surge List

Render a Surge `.list` from real network requests observed by a running Surge instance.

## When to use

- "Make a Surge list for the App I just opened"
- "What hosts did `<process>` reach? Give me rules."
- "Generate a .list from current traffic" / "from this month's hosts"
- After the user has run an app and wants to capture its hosts into a publishable rule set.

If the user wants to scan a URL **without** Surge running (static analysis of a page's referenced hosts), use the sibling skill `surge-domain-scan` instead — that path does HTML scraping, not live capture.

## Prerequisites

- Node ≥ 18
- Surge is running on the local machine. Verify with:
  `/Applications/Surge.app/Contents/Applications/surge-cli --raw environment`
- This skill is project-local. The runnable script:
  - From project root: `node surge-traffic-to-list.js …`
  - From anywhere: `node <project>/.claude/skills/surge-traffic-to-list/scripts/surge-traffic-to-list.js …`
    (the `scripts/` entry is a relative symlink)
- The script `require()`s the project's `surge-domain-scan.js` for `hostToSuffixRule` and `isAdOrTracker`. Node resolves the symlink to the real path before module resolution, so the require lands back in the project root automatically.
- **Independent of the `surge` official skill.** Only `surge-cli` (the binary) is required at runtime; the official `surge` skill is not.

## How to invoke

```bash
# Preferred: cd to project root, then:
node surge-traffic-to-list.js [options]
```

### Common recipes

| Goal | Command |
|---|---|
| All recent traffic, suffix mode, ad-filtered (defaults) | `node surge-traffic-to-list.js --mode suffix` |
| Just the hosts a specific app called | `node surge-traffic-to-list.js --process 'Chrome' --mode suffix` |
| Monthly aggregate across all apps | `node surge-traffic-to-list.js --source traffic-stat-host --mode suffix` |
| Keep raw IP literals (debug) | `node surge-traffic-to-list.js --include-ips` |
| Write to file | `node surge-traffic-to-list.js --process 'Codex' --mode suffix --output Codex.list` |
| Disable ad filter | `node surge-traffic-to-list.js --no-filter-ads` |

`--process` accepts a regex or substring. Matches `processPath` (full executable path) case-insensitively.

## Workflow Claude should follow

1. Confirm the user's intent: which process / time window / mode.
2. Optional sanity check: `surge-cli --raw environment` → confirm Surge is responsive.
3. Run the script with the appropriate flags.
4. Inspect the header (`# HOSTS:`, `# RULES:`, `# FILTERED_ADS:`, `# DROPPED_IPS:`) to sanity-check the result.
5. If `# HOSTS: 0`, the process filter likely missed — show the user a sample of `processPath` values from `dump recent` and ask which to match.

## Output anatomy

```
# NAME: <derived from --name / --process / first host>
# SOURCE: surge-cli dump recent (process~/Codex/)
# UPDATED: <UTC timestamp>
# MODE: exact|suffix
# HOSTS: N           ← unique hostnames kept
# RULES: M           ← deduped rule count (suffix mode dedups exact-covered-by-suffix)
# FILTERED_ADS: K    ← how many distinct ad/tracker hosts were removed
# DROPPED_IPS: P     ← raw IP literals dropped (unless --include-ips)
DOMAIN-SUFFIX,example.com
...
```

## Limitations

- `dump recent` is capped at the most recent ~200 requests. For long-running app captures, advise the user to:
  - Quit other heavy network apps, then start the target app fresh, then run the script immediately, OR
  - Use `--source traffic-stat-host` to pull monthly aggregate (no per-process breakdown).
- Many requests have no resolvable hostname (raw IP); these are dropped by default. If the user needs them, pass `--include-ips`.
- The script does not modify Surge or write rules to the running profile. To apply a rule live, run `surge-cli add-temp-rule "<rule>"` directly (no extra skill required).
