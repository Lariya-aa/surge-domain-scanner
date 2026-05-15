# Surge Domain Scan

Scan a URL, collect the domains that the page and its text resources reference, and export the result in Surge list format.

## What it does

- Accepts one or more URLs.
- Fetches the target page and recursively inspects HTML, CSS, JS, JSON, XML, and similar text resources.
- Extracts hostnames from requests, headers, and embedded URLs.
- Outputs Surge-compatible rules such as `DOMAIN,example.com` or `DOMAIN-SUFFIX,example.com`.

## Usage

```bash
node surge-domain-scan.js https://chatgpt.com
```

Write to a Surge list file:

```bash
node surge-domain-scan.js https://example.com --output Example.list
```

Collapse subdomains into suffix rules:

```bash
node surge-domain-scan.js https://example.com --mode suffix --output Example.list
```

Export raw domains only:

```bash
node surge-domain-scan.js https://example.com --format domains
```

Optionally drop common ad/analytics/tracker domains:

```bash
node surge-domain-scan.js https://example.com --filter-ads
```

## Ad / tracker filtering

By default the scanner keeps every discovered domain because the main use case is
building a complete proxy allowlist. Use `--filter-ads` only when you explicitly
want to remove well-known ad, analytics, and session-replay domains. The header
line `# FILTERED_ADS: <n>` reports how many were removed.

## Output format

The default output is a Surge list file with a header and rule lines:

```text
# NAME: ScannedDomains
# SOURCE: https://example.com
# UPDATED: 2026-05-15 12:00:00 UTC
# MODE: exact
# FORMAT: surge
# HOSTS: 3
# RULES: 3
# FILTERED_ADS: 0
# FETCH_ERRORS: 0
DOMAIN,example.com
DOMAIN,cdn.example.com
DOMAIN,api.example.net
```

## Caveats

- This is a static network scanner, not a full browser automation engine.
- Pages that require login, strong anti-bot checks, or browser-only JavaScript may produce incomplete results.
- `--mode suffix` uses a lightweight heuristic for common public suffixes. Use `--mode exact` if you want the safest output.
- Failed fetches are reported in `# FETCH_ERRORS` and still keep the original input hostname in the output.

## Notes for a GitHub rule set

If you want to maintain a repository similar to `blackmatrix7/ios_rule_script`, you can run the script against a target URL, commit the generated `.list` file, and publish it as a raw GitHub URL for Surge to import.

## Scan records

Apple Podcasts 扫描问题、清理策略和验证记录见 `docs/APPLE_PODCASTS_SCAN_NOTES.md`。
