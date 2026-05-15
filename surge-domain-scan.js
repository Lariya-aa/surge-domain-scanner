#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { URL } = require('url');

const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  'ac.cn',
  'ah.cn',
  'bj.cn',
  'com.au',
  'com.br',
  'com.cn',
  'com.hk',
  'com.mx',
  'com.tw',
  'com.tr',
  'co.id',
  'co.il',
  'co.in',
  'co.jp',
  'co.kr',
  'co.nz',
  'co.uk',
  'co.za',
  'edu.cn',
  'firm.in',
  'gov.cn',
  'gov.hk',
  'gov.in',
  'gov.uk',
  'info.cn',
  'net.cn',
  'net.hk',
  'net.in',
  'net.tw',
  'org.cn',
  'org.hk',
  'org.in',
  'org.uk',
  'or.jp',
  'or.kr',
  'sa.cn',
  'sh.cn',
  'web.cn'
]);

const AD_TRACKER_SUFFIXES = new Set([
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'googletagmanager.com',
  'googletagservices.com',
  'google-analytics.com',
  'adservice.google.com',
  'facebook.net',
  'adnxs.com',
  'criteo.com',
  'criteo.net',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'taboola.com',
  'outbrain.com',
  'mgid.com',
  'adsrvr.org',
  'adroll.com',
  'rlcdn.com',
  'bidswitch.net',
  'casalemedia.com',
  '3lift.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'hotjar.com',
  'mouseflow.com',
  'fullstory.com',
  'logrocket.com',
  'newrelic.com',
  'nr-data.net',
  'scorecardresearch.com',
  'quantserve.com',
  'quantcount.com',
  'comscore.com',
  'optimizely.com',
  'crazyegg.com',
  'kissmetrics.com',
  'matomo.cloud',
  'snowplowanalytics.com',
  'mktoresp.com',
  'marketo.net',
  'pardot.com',
  'hsforms.net',
  'hs-analytics.net',
  'hs-scripts.com',
  'clarity.ms',
  'bat.bing.com',
  'ads-twitter.com',
  'analytics.twitter.com',
  'cnzz.com',
  'umeng.com',
  'umengcloud.com',
  'mmstat.com'
]);

const DEFAULTS = {
  depth: 1,
  maxUrls: 80,
  timeoutMs: 15000,
  mode: 'exact',
  format: 'surge',
  filterAds: false,
  userAgent: 'Mozilla/5.0 (compatible; surge-domain-scan/1.0)'
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  if (args.urls.length === 0) {
    printUsage();
    process.exit(1);
  }

  scanUrls(args.urls, args)
    .then((result) => {
      const output = formatResult(result, args);
      if (args.output) {
        fs.writeFileSync(args.output, output, 'utf8');
      } else {
        process.stdout.write(output);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

function parseArgs(argv) {
  const result = {
    urls: [],
    depth: DEFAULTS.depth,
    maxUrls: DEFAULTS.maxUrls,
    timeoutMs: DEFAULTS.timeoutMs,
    mode: DEFAULTS.mode,
    format: DEFAULTS.format,
    output: '',
    filterAds: DEFAULTS.filterAds,
    userAgent: DEFAULTS.userAgent,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      result.help = true;
      continue;
    }
    if (arg === '--depth') {
      result.depth = toPositiveInt(argv[++i], 'depth');
      continue;
    }
    if (arg === '--max-urls') {
      result.maxUrls = toPositiveInt(argv[++i], 'max-urls');
      continue;
    }
    if (arg === '--timeout') {
      result.timeoutMs = toPositiveInt(argv[++i], 'timeout');
      continue;
    }
    if (arg === '--mode') {
      result.mode = normalizeChoice(argv[++i], ['exact', 'suffix']);
      continue;
    }
    if (arg === '--format') {
      result.format = normalizeChoice(argv[++i], ['surge', 'domains', 'json']);
      continue;
    }
    if (arg === '--output') {
      result.output = argv[++i] || '';
      continue;
    }
    if (arg === '--no-filter-ads') {
      result.filterAds = false;
      continue;
    }
    if (arg === '--filter-ads') {
      result.filterAds = true;
      continue;
    }
    if (arg === '--user-agent') {
      result.userAgent = argv[++i] || result.userAgent;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    result.urls.push(arg);
  }

  return result;
}

function printUsage() {
  const text = `
Usage:
  node surge-domain-scan.js <url> [more urls...] [options]

Options:
  --depth <n>         Crawl depth for discovered text resources. Default: ${DEFAULTS.depth}
  --max-urls <n>      Maximum unique URLs to fetch. Default: ${DEFAULTS.maxUrls}
  --timeout <ms>      Per-request timeout in milliseconds. Default: ${DEFAULTS.timeoutMs}
  --mode exact|suffix Rule mode. exact keeps DOMAIN rules; suffix collapses to DOMAIN-SUFFIX. Default: ${DEFAULTS.mode}
  --format surge|domains|json
                      Surge list output, raw domain list, or JSON. Default: ${DEFAULTS.format}
  --output <file>     Write the result to a file instead of stdout
  --filter-ads        Drop common ad/analytics/tracker domains
  --no-filter-ads     Keep ad/analytics/tracker domains. Default.
  --user-agent <ua>   Custom user agent
  -h, --help          Show this help

Examples:
  node surge-domain-scan.js https://chatgpt.com
  node surge-domain-scan.js https://example.com --mode suffix --output example.list
  node surge-domain-scan.js https://a.com https://b.com --format json
  node surge-domain-scan.js https://example.com --filter-ads
`.trim();
  console.log(text);
}

async function scanUrls(inputUrls, options) {
  const state = {
    visited: new Set(),
    hosts: new Set(),
    discoveredUrls: new Set(),
    queue: [],
    fetchErrors: []
  };

  for (const input of inputUrls) {
    const normalized = normalizeInputUrl(input);
    state.queue.push({ url: normalized, depth: 0 });
  }

  while (state.queue.length > 0 && state.visited.size < options.maxUrls) {
    const current = state.queue.shift();
    if (state.visited.has(current.url)) {
      continue;
    }
    state.visited.add(current.url);
    state.discoveredUrls.add(current.url);
    recordHostFromUrl(current.url, state.hosts);

    let response;
    try {
      response = await fetchResource(current.url, options);
    } catch (error) {
      state.fetchErrors.push({
        url: current.url,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    for (const visitedUrl of response.visitedUrls || []) {
      state.discoveredUrls.add(visitedUrl);
      recordHostFromUrl(visitedUrl, state.hosts);
    }
    if (response.finalUrl) {
      recordHostFromUrl(response.finalUrl, state.hosts);
    }
    recordHeaderHosts(response.headers, current.url, state.hosts);

    if (!response.text || current.depth >= options.depth) {
      continue;
    }

    const candidates = extractCandidates(response.text, response.finalUrl || current.url);
    for (const candidate of candidates) {
      const resolved = resolveUrl(candidate, response.finalUrl || current.url);
      if (!resolved) {
        continue;
      }
      state.discoveredUrls.add(resolved);
      recordHostFromUrl(resolved, state.hosts);
      if (state.visited.size < options.maxUrls && isCrawlableTextUrl(resolved)) {
        state.queue.push({ url: resolved, depth: current.depth + 1 });
      }
    }
  }

  const hostList = Array.from(state.hosts).filter(Boolean);
  const hosts = (options.filterAds ? hostList.filter((host) => !isAdOrTracker(host)) : hostList).sort(sortHostNames);
  const rules = buildRules(hosts, options.mode);

  return {
    inputUrls: inputUrls.map(normalizeInputUrl),
    hosts,
    rules,
    stats: {
      visitedUrls: state.visited.size,
      discoveredUrls: state.discoveredUrls.size,
      filteredAds: options.filterAds ? hostList.length - hosts.length : 0,
      fetchErrors: state.fetchErrors.length
    },
    fetchErrors: state.fetchErrors
  };
}

async function fetchResource(rawUrl, options) {
  const MAX_REDIRECTS = 5;
  let currentUrl = rawUrl;
  const visitedUrls = [];
  const headers = {
    'user-agent': options.userAgent,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
  };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    visitedUrls.push(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers,
        signal: controller.signal
      });

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          return { finalUrl: currentUrl, headers: response.headers, text: '', visitedUrls };
        }
        const nextUrl = resolveUrl(location, currentUrl);
        if (!nextUrl) {
          return { finalUrl: currentUrl, headers: response.headers, text: '', visitedUrls };
        }
        if (hop === MAX_REDIRECTS) {
          return {
            finalUrl: nextUrl,
            headers: response.headers,
            text: '',
            visitedUrls: visitedUrls.concat(nextUrl)
          };
        }
        currentUrl = nextUrl;
        continue;
      }

      const text = await readBodyAsText(response, currentUrl);
      return {
        finalUrl: response.url || currentUrl,
        headers: response.headers,
        text,
        visitedUrls
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { finalUrl: currentUrl, headers: { get: () => null }, text: '', visitedUrls };
}

async function readBodyAsText(response, responseUrl = '') {
  const contentType = response.headers.get('content-type') || '';
  const contentLength = Number(response.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
    return '';
  }
  if (contentType && !isProbablyTextContentType(contentType)) {
    return '';
  }
  if (!contentType && responseUrl) {
    try {
      const url = new URL(responseUrl);
      if (pathLooksBinary(url.pathname)) {
        return '';
      }
    } catch (error) {
      // If the URL cannot be parsed, fall back to trying the body.
    }
  }
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}

function recordHeaderHosts(headers, baseUrl, hosts) {
  const keys = ['content-security-policy', 'link', 'refresh', 'location'];
  for (const key of keys) {
    const value = headers.get ? headers.get(key) : null;
    if (!value) {
      continue;
    }
    const candidates = extractCandidates(value, baseUrl);
    for (const candidate of candidates) {
      const resolved = resolveUrl(candidate, baseUrl);
      if (resolved) {
        recordHostFromUrl(resolved, hosts);
      }
    }
  }
}

function extractCandidates(text, baseUrl) {
  const candidates = new Set();
  if (!text) {
    return candidates;
  }

  const absoluteUrlPattern = /https?:\/\/[^\s"'<>`;,)]+/gi;
  const protocolRelativePattern = /(^|[^a-zA-Z0-9_:-])\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>`]*)?/g;
  const attrPattern = /(?:href|src|action|poster|data-src|data-href|content)\s*=\s*["']([^"']+)["']/gi;
  const srcsetPattern = /srcset\s*=\s*["']([^"']+)["']/gi;
  const cssUrlPattern = /url\(\s*['"]?([^'"()]+)['"]?\s*\)/gi;
  const importPattern = /@import\s+['"]([^'"]+)['"]/gi;
  const bareDomainPattern = /(^|[^A-Za-z0-9@_:/.-])((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::\d+)?)(?![A-Za-z0-9-])/gi;

  collectPatternMatches(text, absoluteUrlPattern, candidates);
  collectProtocolRelativeMatches(text, protocolRelativePattern, candidates);
  collectPatternMatches(text, attrPattern, candidates, 1);
  collectSrcsetMatches(text, srcsetPattern, candidates);
  collectPatternMatches(text, cssUrlPattern, candidates, 1);
  collectPatternMatches(text, importPattern, candidates, 1);
  collectBareDomainMatches(text, bareDomainPattern, candidates);

  return candidates;
}

function collectPatternMatches(text, pattern, candidates, groupIndex = 0) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[groupIndex] || match[0];
    if (value) {
      candidates.add(value.trim());
    }
  }
}

function collectProtocolRelativeMatches(text, pattern, candidates) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[0].replace(/^[^/]*\/\//, '//').trim();
    if (value) {
      candidates.add(value);
    }
  }
}

function collectBareDomainMatches(text, pattern, candidates) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = (match[2] || match[1] || '').trim();
    if (value) {
      candidates.add(value);
    }
  }
}

function collectSrcsetMatches(text, pattern, candidates) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1] || '';
    for (const entry of raw.split(',')) {
      const candidate = entry.trim().split(/\s+/)[0];
      if (candidate) {
        candidates.add(candidate);
      }
    }
  }
}

function resolveUrl(candidate, baseUrl) {
  if (!candidate) {
    return '';
  }
  const value = candidate.trim();
  if (!value) {
    return '';
  }
  if (/^(?:javascript|mailto|tel|data|blob):/i.test(value)) {
    return '';
  }
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.hash = '';
      return url.toString();
    }
    return '';
  } catch (error) {
    return '';
  }
}

function normalizeInputUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    throw new Error('Empty URL input');
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return new URL(trimmed).toString();
  }
  return new URL(`https://${trimmed}`).toString();
}

function recordHostFromUrl(rawUrl, hosts) {
  if (!rawUrl) {
    return '';
  }
  try {
    const url = new URL(rawUrl);
    const host = normalizeHost(url.hostname);
    if (host && hosts) {
      hosts.add(host);
    }
    return host;
  } catch (error) {
    return '';
  }
}

function normalizeHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) {
    return '';
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return '';
  }
  return host;
}

function buildRules(hosts, mode) {
  if (mode === 'suffix') {
    const suffixes = new Set();
    for (const host of hosts) {
      const rule = hostToSuffixRule(host);
      if (rule) {
        suffixes.add(rule);
      }
    }
    for (const rule of Array.from(suffixes)) {
      if (rule.startsWith('DOMAIN-SUFFIX,')) {
        suffixes.delete(`DOMAIN,${rule.slice('DOMAIN-SUFFIX,'.length)}`);
      }
    }
    return Array.from(suffixes).sort(sortRuleLines);
  }

  return hosts.map((host) => `DOMAIN,${host}`);
}

function hostToSuffixRule(host) {
  if (isIpAddress(host) || host === 'localhost') {
    return `DOMAIN,${host}`;
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return `DOMAIN,${host}`;
  }
  const twoLabelSuffix = parts.slice(-2).join('.');
  if (COMMON_SECOND_LEVEL_SUFFIXES.has(twoLabelSuffix) && parts.length >= 3) {
    return `DOMAIN-SUFFIX,${parts.slice(-3).join('.')}`;
  }
  return `DOMAIN-SUFFIX,${twoLabelSuffix}`;
}

function isAdOrTracker(host) {
  const normalized = String(host || '').toLowerCase();
  if (!normalized) {
    return false;
  }
  if (AD_TRACKER_SUFFIXES.has(normalized)) {
    return true;
  }
  for (const suffix of AD_TRACKER_SUFFIXES) {
    if (normalized.endsWith(`.${suffix}`)) {
      return true;
    }
  }
  return false;
}

function isIpAddress(host) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return true;
  }
  return /^[0-9a-f:]+$/i.test(host) && host.includes(':');
}

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

function isProbablyTextContentType(contentType) {
  const normalized = String(contentType || '').toLowerCase();
  return (
    normalized.includes('text/') ||
    normalized.includes('json') ||
    normalized.includes('javascript') ||
    normalized.includes('xml') ||
    normalized.includes('svg') ||
    normalized.includes('css') ||
    normalized.includes('html') ||
    normalized.includes('xhtml') ||
    normalized.includes('manifest')
  );
}

function isCrawlableTextUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return /\.(?:html?|xhtml?|mjs|cjs|js|json|css|xml|svg|txt|map)(?:[?#].*)?$/i.test(url.pathname) || !pathLooksBinary(url.pathname);
  } catch (error) {
    return false;
  }
}

function pathLooksBinary(pathname) {
  return /\.(?:png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|zip|gz|tgz|bz2|7z|rar)(?:$|[?#])/i.test(pathname);
}

function sortHostNames(a, b) {
  const depthDiff = labelCount(a) - labelCount(b);
  if (depthDiff !== 0) {
    return depthDiff;
  }
  return a.localeCompare(b);
}

function sortRuleLines(a, b) {
  return a.localeCompare(b);
}

function labelCount(host) {
  return String(host || '').split('.').filter(Boolean).length;
}

function formatResult(result, options) {
  if (options.format === 'json') {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (options.format === 'domains') {
    return `${result.hosts.join('\n')}\n`;
  }

  const name = inferRuleName(result.inputUrls);
  const header = [
    `# NAME: ${name}`,
    `# SOURCE: ${result.inputUrls.join(', ')}`,
    `# UPDATED: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `# MODE: ${options.mode}`,
    `# FORMAT: ${options.format}`,
    `# HOSTS: ${result.hosts.length}`,
    `# RULES: ${result.rules.length}`,
    `# FILTERED_ADS: ${result.stats ? result.stats.filteredAds || 0 : 0}`,
    `# FETCH_ERRORS: ${result.stats ? result.stats.fetchErrors || 0 : 0}`
  ];
  return `${header.join('\n')}\n${result.rules.join('\n')}\n`;
}

function inferRuleName(inputUrls) {
  const first = inputUrls && inputUrls[0] ? inputUrls[0] : '';
  try {
    const url = new URL(first);
    const host = normalizeHost(url.hostname);
    if (host) {
      return host;
    }
  } catch (error) {
    // Fall through to a generic name.
  }
  return 'ScannedDomains';
}

function normalizeChoice(value, allowed) {
  const normalized = String(value || '').toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid value: ${value}. Expected one of: ${allowed.join(', ')}`);
  }
  return normalized;
}

function toPositiveInt(value, name) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

if (require.main === module) {
  main();
}

module.exports = {
  scanUrls,
  extractCandidates,
  resolveUrl,
  normalizeInputUrl,
  hostToSuffixRule,
  isProbablyTextContentType,
  isAdOrTracker
};
