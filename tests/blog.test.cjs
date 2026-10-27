const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://autostrikegolf.com';
const APP_STORE = 'https://apps.apple.com/us/app/autostrike-golf/id6762587973';

const ARTICLES = [
  '/blog/golf-app-prices-compared/',
  '/blog/best-apple-watch-golf-app-auto-shot-tracking/',
  '/blog/switch-golf-apps-keep-your-score-history/',
];
const PAGES = ['/blog/', ...ARTICLES];
const COMPETITORS = ['18Birdies', 'Golfshot', 'Hole19', 'SwingU', 'Arccos', 'Garmin'];

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const fileFor = (urlPath) => {
  const clean = urlPath.split('#')[0].split('?')[0];
  if (clean === '/' || clean === '') return 'index.html';
  const rel = clean.replace(/^\//, '');
  if (rel.endsWith('/')) return `${rel}index.html`;
  if (existsSync(path.join(ROOT, rel)) && !rel.endsWith('/')) {
    return existsSync(path.join(ROOT, rel, 'index.html')) ? `${rel}/index.html` : rel;
  }
  if (existsSync(path.join(ROOT, `${rel}.html`))) return `${rel}.html`;
  return rel;
};
const html = (urlPath) => read(fileFor(urlPath));
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
const meta = (doc, attr, name) => {
  const re = new RegExp(`<meta\\s+${attr}="${name.replace(/[:.]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i');
  return (doc.match(re) || [])[1];
};
const jsonLd = (doc) => [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((m) => {
    const data = JSON.parse(m[1]);
    return data['@graph'] || [data];
  });
const ofType = (nodes, type) => nodes.find((n) => n['@type'] === type);

test('every blog page exists and has unique, well-formed SEO metadata', () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const url of PAGES) {
    const doc = html(url);
    const title = (doc.match(/<title>([^<]+)<\/title>/) || [])[1];
    const description = meta(doc, 'name', 'description');
    assert.ok(title && title.length <= 70, `${url}: title missing or longer than 70 chars (${title && title.length})`);
    assert.ok(description && description.length >= 70 && description.length <= 165, `${url}: description length ${description && description.length}`);
    assert.ok(!titles.has(title), `${url}: duplicate title`);
    assert.ok(!descriptions.has(description), `${url}: duplicate description`);
    titles.add(title);
    descriptions.add(description);

    assert.match(doc, new RegExp(`<link rel="canonical" href="${SITE}${url}">`), `${url}: canonical`);
    assert.equal(meta(doc, 'property', 'og:url'), `${SITE}${url}`, `${url}: og:url`);
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'og:type']) {
      assert.ok(meta(doc, 'property', prop), `${url}: ${prop}`);
    }
    for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      assert.ok(meta(doc, 'name', name), `${url}: ${name}`);
    }
    assert.match(meta(doc, 'name', 'robots'), /^index, follow/, `${url}: robots meta`);
    assert.match(doc, /<html lang="en">/);
    assert.match(doc, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
  }
});

test('blog pages use one h1, ordered headings and images with alt text and dimensions', () => {
  for (const url of PAGES) {
    const doc = html(url);
    assert.equal((doc.match(/<h1[\s>]/g) || []).length, 1, `${url}: exactly one h1`);
    let level = 1;
    for (const [, n] of doc.matchAll(/<h([1-6])[\s>]/g)) {
      assert.ok(Number(n) <= level + 1, `${url}: heading jumps from h${level} to h${n}`);
      level = Number(n);
    }
    for (const [img] of doc.matchAll(/<img\b[^>]*>/g)) {
      assert.match(img, /\salt="[^"]*"/, `${url}: img without alt: ${img}`);
      assert.match(img, /\swidth="\d+"/, `${url}: img without width: ${img}`);
      assert.match(img, /\sheight="\d+"/, `${url}: img without height: ${img}`);
    }
  }
});

test('articles have Article, BreadcrumbList and FAQPage structured data matching the page', () => {
  for (const url of ARTICLES) {
    const doc = html(url);
    const nodes = jsonLd(doc);
    const article = ofType(nodes, 'Article');
    assert.ok(article, `${url}: Article JSON-LD`);
    const h1 = text((doc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
    assert.equal(article.headline, h1, `${url}: headline matches h1`);
    assert.ok(article.headline.length <= 110, `${url}: headline too long`);
    assert.equal(article.mainEntityOfPage['@id'] || article.mainEntityOfPage, `${SITE}${url}`);
    assert.match(article.datePublished, /^\d{4}-\d{2}-\d{2}/);
    assert.match(article.dateModified, /^\d{4}-\d{2}-\d{2}/);
    assert.equal(meta(doc, 'property', 'article:published_time'), article.datePublished, `${url}: og published_time`);
    assert.equal(meta(doc, 'property', 'article:modified_time'), article.dateModified, `${url}: og modified_time`);
    assert.match(doc, new RegExp(`<time datetime="${article.datePublished}"`), `${url}: visible published date`);
    assert.match(doc, new RegExp(`<time datetime="${article.dateModified}"`), `${url}: visible modified date`);
    assert.ok(article.author && article.publisher && article.publisher.logo, `${url}: author/publisher`);
    assert.ok([].concat(article.image).every((i) => i.startsWith(`${SITE}/`)), `${url}: absolute image`);

    const crumbs = ofType(nodes, 'BreadcrumbList');
    assert.ok(crumbs, `${url}: BreadcrumbList`);
    const items = crumbs.itemListElement;
    assert.deepEqual(items.map((i) => i.position), [1, 2, 3]);
    assert.equal(items[0].item, `${SITE}/`);
    assert.equal(items[1].item, `${SITE}/blog/`);
    assert.equal(items[2].item, `${SITE}${url}`);

    const faq = ofType(nodes, 'FAQPage');
    assert.ok(faq, `${url}: FAQPage`);
    const visible = [...doc.matchAll(/<summary><h3>([\s\S]*?)<\/h3><\/summary>\s*<div>([\s\S]*?)<\/div>/g)]
      .map(([, q, a]) => ({ q: text(q), a: text(a) }));
    assert.ok(visible.length >= 3, `${url}: at least 3 visible FAQ entries`);
    assert.deepEqual(faq.mainEntity.map((e) => e.name), visible.map((v) => v.q), `${url}: FAQ questions match`);
    faq.mainEntity.forEach((e, i) => {
      assert.equal(e.acceptedAnswer.text, visible[i].a, `${url}: FAQ answer ${i + 1} matches visible text`);
    });
  }
});

test('blog index lists every article with Blog and BreadcrumbList structured data', () => {
  const doc = html('/blog/');
  const nodes = jsonLd(doc);
  const blog = ofType(nodes, 'Blog');
  assert.ok(blog, 'Blog JSON-LD');
  assert.deepEqual(blog.blogPost.map((p) => p.url).sort(), ARTICLES.map((a) => `${SITE}${a}`).sort());
  assert.ok(ofType(nodes, 'BreadcrumbList'), 'BreadcrumbList JSON-LD');
  for (const url of ARTICLES) assert.ok(doc.includes(`href="${url}"`), `blog index links to ${url}`);
});

test('articles cross-link, cite sources and include App Store calls to action', () => {
  for (const url of ARTICLES) {
    const doc = html(url);
    for (const other of ARTICLES.filter((a) => a !== url)) {
      assert.ok(doc.includes(`href="${other}"`), `${url} links to ${other}`);
    }
    assert.ok(doc.includes('href="/blog/"'), `${url}: links to blog index`);
    assert.ok((doc.match(new RegExp(`href="${APP_STORE}"`, 'g')) || []).length >= 2, `${url}: App Store CTAs`);
    assert.match(doc, /<section class="sources"[\s\S]*?<ol>[\s\S]*?<a href="https:\/\//, `${url}: sources list`);
    assert.match(doc, /as of/i, `${url}: dated claims`);
  }
});

test('all internal links on blog and updated pages resolve to real files and anchors', () => {
  for (const url of [...PAGES, '/', '/support.html', '/privacy.html', '/terms/']) {
    const doc = html(url);
    for (const [, href] of doc.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|mailto:|data:|#$)/.test(href)) continue;
      if (href.startsWith('#')) {
        assert.ok(doc.includes(`id="${href.slice(1)}"`), `${url}: missing anchor ${href}`);
        continue;
      }
      const target = href.startsWith('/') ? href : path.posix.join(url.endsWith('/') ? url : path.posix.dirname(url), href);
      const file = fileFor(target);
      assert.ok(existsSync(path.join(ROOT, file)), `${url}: broken link ${href} (${file})`);
      const hash = href.split('#')[1];
      if (hash) assert.ok(read(file).includes(`id="${hash}"`), `${url}: missing anchor ${href}`);
    }
    for (const [a] of doc.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      assert.match(a, /rel="[^"]*noopener/, `${url}: target=_blank without noopener`);
    }
  }
});

test('blog pages are in the sitemap with lastmod and are not blocked from indexing', () => {
  const sitemap = read('sitemap.xml');
  for (const url of PAGES) {
    const entry = sitemap.match(new RegExp(`<url>\\s*<loc>${SITE}${url}</loc>([\\s\\S]*?)</url>`));
    assert.ok(entry, `${url} in sitemap`);
    assert.match(entry[1], /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, `${url}: lastmod`);
  }
  const robots = read('robots.txt');
  assert.doesNotMatch(robots, /Disallow:\s*\/(blog)?\s*$/m);

  const rules = read('_headers').split(/\n(?=\S)/).map((block) => {
    const [pattern, ...headers] = block.trim().split('\n');
    return { pattern: pattern.trim(), headers: headers.join('\n') };
  });
  const matches = (pattern, url) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(url);
  for (const url of PAGES) {
    for (const rule of rules.filter((r) => matches(r.pattern, url))) {
      assert.doesNotMatch(rule.headers, /noindex/i, `${url}: _headers rule ${rule.pattern} sets noindex`);
    }
  }
});

test('site navigation links to the blog and the landing page links to every article', () => {
  for (const url of ['/', '/support.html', '/privacy.html', '/terms/', ...PAGES]) {
    const doc = html(url);
    const nav = (doc.match(/<nav>[\s\S]*?<\/nav>/) || [''])[0];
    const footer = (doc.match(/<footer>[\s\S]*?<\/footer>/) || [''])[0];
    assert.ok(nav.includes('href="/blog/"'), `${url}: Blog in nav`);
    assert.ok(footer.includes('href="/blog/"'), `${url}: Blog in footer`);
  }
  const home = html('/');
  for (const url of ARTICLES) assert.ok(home.includes(`href="${url}"`), `landing page links to ${url}`);
});

test('the landing page keeps competitor names out of its copy', () => {
  const home = text(html('/').replace(/<script[\s\S]*?<\/script>/g, ''));
  for (const name of COMPETITORS) {
    assert.ok(!home.toLowerCase().includes(name.toLowerCase()), `landing page mentions ${name}`);
  }
});
