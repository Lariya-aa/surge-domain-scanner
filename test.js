'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const {
  scanUrls,
  hostToSuffixRule,
  extractCandidates,
  resolveUrl,
  normalizeInputUrl,
  isProbablyTextContentType,
  isAdOrTracker
} = require('./surge-domain-scan.js');

function scanOptions(overrides = {}) {
  return {
    depth: 1,
    maxUrls: 20,
    timeoutMs: 500,
    mode: 'exact',
    format: 'json',
    filterAds: false,
    userAgent: 'test-agent',
    ...overrides
  };
}

async function withMockFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('hostToSuffixRule handles common cases', () => {
  assert.equal(hostToSuffixRule('example.com'), 'DOMAIN,example.com');
  assert.equal(hostToSuffixRule('a.b.example.com'), 'DOMAIN-SUFFIX,example.com');
  assert.equal(hostToSuffixRule('www.example.co.uk'), 'DOMAIN-SUFFIX,example.co.uk');
  assert.equal(hostToSuffixRule('example.co.uk'), 'DOMAIN-SUFFIX,example.co.uk');
  assert.equal(hostToSuffixRule('1.2.3.4'), 'DOMAIN,1.2.3.4');
  assert.equal(hostToSuffixRule('localhost'), 'DOMAIN,localhost');
});

test('normalizeInputUrl prepends https when scheme missing', () => {
  assert.equal(normalizeInputUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeInputUrl('https://example.com/'), 'https://example.com/');
  assert.equal(normalizeInputUrl('http://x.com/y'), 'http://x.com/y');
  assert.throws(() => normalizeInputUrl(''));
});

test('resolveUrl resolves and rejects non-http schemes', () => {
  assert.equal(resolveUrl('/a', 'https://x.com/'), 'https://x.com/a');
  assert.equal(resolveUrl('//cdn.com/a', 'https://x.com/'), 'https://cdn.com/a');
  assert.equal(resolveUrl('https://y.com/b#frag', 'https://x.com/'), 'https://y.com/b');
  assert.equal(resolveUrl('javascript:void(0)', 'https://x.com/'), '');
  assert.equal(resolveUrl('mailto:a@b.com', 'https://x.com/'), '');
  assert.equal(resolveUrl('data:text/plain,abc', 'https://x.com/'), '');
});

test('extractCandidates picks up common forms', () => {
  const html = '<a href="https://a.com/x"><img src="//cdn.b.com/y"/></a> url(/c/z) bare.example.org';
  const c = Array.from(extractCandidates(html, 'https://base.com/'));
  assert.ok(c.includes('https://a.com/x'), 'absolute URL');
  assert.ok(c.some((v) => v.includes('cdn.b.com')), 'protocol-relative');
  assert.ok(c.includes('bare.example.org'), 'bare domain');
});

test('isProbablyTextContentType', () => {
  assert.equal(isProbablyTextContentType('text/html; charset=utf-8'), true);
  assert.equal(isProbablyTextContentType('application/json'), true);
  assert.equal(isProbablyTextContentType('application/javascript'), true);
  assert.equal(isProbablyTextContentType('image/svg+xml'), true);
  assert.equal(isProbablyTextContentType('image/png'), false);
  assert.equal(isProbablyTextContentType(''), false);
});

test('isAdOrTracker matches suffix but not substring', () => {
  assert.equal(isAdOrTracker('doubleclick.net'), true);
  assert.equal(isAdOrTracker('ad.doubleclick.net'), true);
  assert.equal(isAdOrTracker('Stats.G.Doubleclick.NET'), true);
  assert.equal(isAdOrTracker('google-analytics.com'), true);
  assert.equal(isAdOrTracker('example.com'), false);
  assert.equal(isAdOrTracker('notdoubleclick.net'), false);
  assert.equal(isAdOrTracker(''), false);
});

test('extractCandidates does not leak CSP separators into hosts', () => {
  const csp = "default-src 'self'; img-src https://*.gstatic.com; script-src https://clients1.google.com;";
  const c = Array.from(extractCandidates(csp, 'https://example.com/'));
  for (const v of c) {
    assert.ok(!v.endsWith(';'), `candidate should not end with ';': ${v}`);
  }
});

test('scanUrls keeps tracker domains by default-compatible options', async () => {
  const result = await withMockFetch(
    async (url) => {
      if (String(url) === 'https://page.example.com/') {
        return new Response('<script src="https://www.google-analytics.com/analytics.js"></script><script>fetch("https://api.example.com/v1")</script>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        });
      }
      return new Response('', { status: 200, headers: { 'content-type': 'application/javascript' } });
    },
    () => scanUrls(['https://page.example.com/'], scanOptions())
  );

  assert.ok(result.hosts.includes('www.google-analytics.com'));
  assert.ok(result.hosts.includes('api.example.com'));
  assert.equal(result.stats.filteredAds, 0);
});

test('scanUrls can filter tracker domains when requested', async () => {
  const result = await withMockFetch(
    async (url) => {
      if (String(url) === 'https://page.example.com/') {
        return new Response('<script src="https://www.google-analytics.com/analytics.js"></script><script>fetch("https://api.example.com/v1")</script>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        });
      }
      return new Response('', { status: 200, headers: { 'content-type': 'application/javascript' } });
    },
    () => scanUrls(['https://page.example.com/'], scanOptions({ filterAds: true }))
  );

  assert.ok(!result.hosts.includes('www.google-analytics.com'));
  assert.ok(result.hosts.includes('api.example.com'));
  assert.equal(result.stats.filteredAds, 1);
});

test('scanUrls preserves input host and reports fetch failures', async () => {
  await withMockFetch(
    async () => {
      throw new Error('connection refused');
    },
    async () => {
      const result = await scanUrls(['https://api.example.com/path'], scanOptions());
      assert.deepEqual(result.hosts, ['api.example.com']);
      assert.equal(result.stats.fetchErrors, 1);
      assert.equal(result.fetchErrors[0].url, 'https://api.example.com/path');
    }
  );
});

test('scanUrls records redirect chain hosts', async () => {
  await withMockFetch(async (url) => {
    const href = String(url);
    if (href === 'https://a.example.com/') {
      return new Response('', { status: 302, headers: { location: 'https://b.example.com/mid' } });
    }
    if (href === 'https://b.example.com/mid') {
      return new Response('<script src="https://asset.example.net/app.js"></script>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    }
    return new Response('', { status: 200, headers: { 'content-type': 'application/javascript' } });
  }, async () => {
    const result = await scanUrls(['https://a.example.com/'], scanOptions());
    assert.ok(result.hosts.includes('a.example.com'));
    assert.ok(result.hosts.includes('b.example.com'));
    assert.ok(result.hosts.includes('asset.example.net'));
  });
});

test('suffix mode removes exact domain when a suffix rule covers it', async () => {
  const result = await withMockFetch(async () => new Response('<script src="https://api.example.com/app.js"></script>', {
    status: 200,
    headers: { 'content-type': 'text/html' }
  }), async () => scanUrls(['https://example.com/'], scanOptions({ mode: 'suffix', maxUrls: 5 })));

  assert.ok(result.rules.includes('DOMAIN-SUFFIX,example.com'));
  assert.ok(!result.rules.includes('DOMAIN,example.com'));
});

test('scanUrls reads small text resources without content-type', async () => {
  await withMockFetch(async () => new Response(Buffer.from('<script src="https://api.example.org/app.js"></script>'), {
    status: 200,
    headers: {}
  }), async () => {
    const result = await scanUrls(['https://page.example.com/'], scanOptions({ maxUrls: 5 }));
    assert.ok(result.hosts.includes('page.example.com'));
    assert.ok(result.hosts.includes('api.example.org'));
  });
});

test('--help exits successfully', () => {
  const result = spawnSync(process.execPath, ['surge-domain-scan.js', '--help'], {
    cwd: __dirname,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});
