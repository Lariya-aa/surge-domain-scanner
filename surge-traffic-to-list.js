#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { hostToSuffixRule, isAdOrTracker } = require('./surge-domain-scan.js');

const DEFAULTS = {
  source: 'recent',
  mode: 'exact',
  filterAds: true,
  includeIps: false,
  surgeCliPath: '',
  processMatch: '',
  output: '',
  name: ''
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const cli = resolveSurgeCli(args.surgeCliPath);
  const payload = runSurgeCli(cli, args.source);
  const records = extractHosts(payload, args);
  const hosts = filterAndSortHosts(records, args);
  const output = formatResult(hosts, args, records);

  if (args.output) {
    fs.writeFileSync(args.output, output, 'utf8');
  } else {
    process.stdout.write(output);
  }
}

function parseArgs(argv) {
  const result = {
    ...DEFAULTS,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '--source') {
      result.source = normalizeChoice(argv[++i], ['recent', 'traffic-stat-host']);
    } else if (arg === '--mode') {
      result.mode = normalizeChoice(argv[++i], ['exact', 'suffix']);
    } else if (arg === '--no-filter-ads') {
      result.filterAds = false;
    } else if (arg === '--filter-ads') {
      result.filterAds = true;
    } else if (arg === '--include-ips') {
      result.includeIps = true;
    } else if (arg === '--process') {
      result.processMatch = argv[++i] || '';
    } else if (arg === '--surge-cli') {
      result.surgeCliPath = argv[++i] || '';
    } else if (arg === '--output') {
      result.output = argv[++i] || '';
    } else if (arg === '--name') {
      result.name = argv[++i] || '';
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return result;
}

function printUsage() {
  const text = `
Usage:
  node surge-traffic-to-list.js [options]

Pulls live request data from surge-cli and renders a Surge list file.

Options:
  --source recent|traffic-stat-host
                              Source of host data. Default: recent
                              recent: last ~200 requests (per-process info available)
                              traffic-stat-host: monthly aggregate (no process info)
  --mode exact|suffix         Rule mode. Default: exact
  --filter-ads                Drop ad/analytics/tracker domains. Default: on
  --no-filter-ads             Keep ad/analytics/tracker domains
  --include-ips               Keep raw IP literals (default: hostnames only)
  --process <substr-or-regex> Filter requests by process path. Recent source only.
  --surge-cli <path>          Override surge-cli executable path
  --output <file>             Write output to file instead of stdout
  --name <name>               NAME header value. Default: derived from source/process
  -h, --help                  Show this help

Examples:
  node surge-traffic-to-list.js
  node surge-traffic-to-list.js --process 'Codex' --mode suffix --output Codex.list
  node surge-traffic-to-list.js --source traffic-stat-host --no-filter-ads
`.trim();
  console.log(text);
}

function resolveSurgeCli(override) {
  if (override) {
    return override;
  }
  const fallback = '/Applications/Surge.app/Contents/Applications/surge-cli';
  const lookup = spawnSync('which', ['surge-cli'], { encoding: 'utf8' });
  if (lookup.status === 0) {
    const found = (lookup.stdout || '').trim();
    if (found) {
      return found;
    }
  }
  if (fs.existsSync(fallback)) {
    return fallback;
  }
  throw new Error('surge-cli not found. Pass --surge-cli <path> or add it to PATH.');
}

function runSurgeCli(cliPath, source) {
  const args = ['--raw', 'dump', source];
  const result = spawnSync(cliPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`Failed to spawn surge-cli: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`surge-cli exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`surge-cli did not return JSON: ${error.message}`);
  }
}

function extractHosts(payload, args) {
  if (args.source === 'recent') {
    const requests = Array.isArray(payload.requests) ? payload.requests : [];
    const filtered = args.processMatch
      ? requests.filter((r) => matchesProcess(r, args.processMatch))
      : requests;
    return filtered.map((r) => ({
      host: parseRemoteHost(r.remoteHost || r.URL || ''),
      processPath: r.processPath || r.pathForStatistics || '',
      bytes: (r.inBytes || 0) + (r.outBytes || 0),
      method: r.method || ''
    })).filter((r) => r.host);
  }
  if (args.source === 'traffic-stat-host') {
    const stats = payload.result && typeof payload.result === 'object' ? payload.result : {};
    return Object.entries(stats).map(([host, info]) => {
      const thisMonth = (info && info.thisMonth) || [0, 0];
      const lastMonth = (info && info.lastMonth) || [0, 0];
      const bytes = (thisMonth[0] || 0) + (thisMonth[1] || 0) + (lastMonth[0] || 0) + (lastMonth[1] || 0);
      return { host, bytes, processPath: '', method: '' };
    });
  }
  return [];
}

function matchesProcess(request, needle) {
  const candidates = [request.processPath, request.pathForStatistics].filter(Boolean);
  if (candidates.length === 0) {
    return false;
  }
  let pattern;
  try {
    pattern = new RegExp(needle, 'i');
  } catch (error) {
    const lower = needle.toLowerCase();
    return candidates.some((c) => c.toLowerCase().includes(lower));
  }
  return candidates.some((c) => pattern.test(c));
}

function parseRemoteHost(raw) {
  if (!raw) {
    return '';
  }
  let host = String(raw).trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end > 0) {
      return host.slice(1, end).toLowerCase();
    }
  }
  const colonIdx = host.lastIndexOf(':');
  if (colonIdx > -1 && /^\d+$/.test(host.slice(colonIdx + 1))) {
    host = host.slice(0, colonIdx);
  }
  return host.toLowerCase();
}

function isIpLiteral(host) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return true;
  }
  return host.includes(':');
}

function filterAndSortHosts(records, args) {
  const seen = new Map();
  for (const r of records) {
    const host = r.host;
    if (!host) continue;
    if (!args.includeIps && isIpLiteral(host)) continue;
    if (args.filterAds && isAdOrTracker(host)) continue;
    const prev = seen.get(host) || { host, bytes: 0, count: 0 };
    prev.bytes += r.bytes || 0;
    prev.count += 1;
    seen.set(host, prev);
  }
  return Array.from(seen.values()).sort((a, b) => {
    const byBytes = b.bytes - a.bytes;
    if (byBytes !== 0) return byBytes;
    return a.host.localeCompare(b.host);
  });
}

function buildRules(hosts, mode) {
  if (mode === 'suffix') {
    const rules = new Set();
    for (const h of hosts) {
      rules.add(hostToSuffixRule(h.host));
    }
    return dedupSuffixCoveredExact(Array.from(rules)).sort();
  }
  return hosts.map((h) => `DOMAIN,${h.host}`);
}

function dedupSuffixCoveredExact(rules) {
  const suffixHosts = new Set();
  for (const rule of rules) {
    if (rule.startsWith('DOMAIN-SUFFIX,')) {
      suffixHosts.add(rule.slice('DOMAIN-SUFFIX,'.length));
    }
  }
  return rules.filter((rule) => {
    if (!rule.startsWith('DOMAIN,')) return true;
    const host = rule.slice('DOMAIN,'.length);
    if (suffixHosts.has(host)) return false;
    for (const suffix of suffixHosts) {
      if (host.endsWith(`.${suffix}`)) return false;
    }
    return true;
  });
}

function formatResult(hosts, args, allRecords) {
  const rules = buildRules(hosts, args.mode);
  const name = args.name || inferName(args, hosts);
  const filteredAds = args.filterAds ? countFilteredAds(allRecords, args) : 0;
  const ipsDropped = args.includeIps ? 0 : countIpsDropped(allRecords);
  const header = [
    `# NAME: ${name}`,
    `# SOURCE: surge-cli dump ${args.source}${args.processMatch ? ' (process~/' + args.processMatch + '/)' : ''}`,
    `# UPDATED: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `# MODE: ${args.mode}`,
    `# HOSTS: ${hosts.length}`,
    `# RULES: ${rules.length}`,
    `# FILTERED_ADS: ${filteredAds}`,
    `# DROPPED_IPS: ${ipsDropped}`
  ];
  return `${header.join('\n')}\n${rules.join('\n')}\n`;
}

function countFilteredAds(records, args) {
  let n = 0;
  const seen = new Set();
  for (const r of records) {
    if (!r.host) continue;
    if (!args.includeIps && isIpLiteral(r.host)) continue;
    if (isAdOrTracker(r.host) && !seen.has(r.host)) {
      seen.add(r.host);
      n += 1;
    }
  }
  return n;
}

function countIpsDropped(records) {
  const seen = new Set();
  for (const r of records) {
    if (r.host && isIpLiteral(r.host)) seen.add(r.host);
  }
  return seen.size;
}

function inferName(args, hosts) {
  if (args.processMatch) {
    return args.processMatch.replace(/[^A-Za-z0-9._-]/g, '_');
  }
  if (hosts.length > 0) {
    return hosts[0].host;
  }
  return 'SurgeTraffic';
}

function normalizeChoice(value, allowed) {
  const normalized = String(value || '').toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid value: ${value}. Expected one of: ${allowed.join(', ')}`);
  }
  return normalized;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  parseRemoteHost,
  isIpLiteral,
  extractHosts,
  filterAndSortHosts,
  buildRules
};
