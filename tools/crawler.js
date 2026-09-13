'use strict';
/* ============================================================
 * 新闻抓取程序：RSS → 新闻卡片
 * ------------------------------------------------------------
 * 零第三方依赖，仅用 Node 内置模块（方便在 GitHub Actions 运行）。
 *
 * 用法：
 *   node tools/crawler.js            # 抓取真实 RSS，写入 data/news.js
 *   node tools/crawler.js --selftest # 离线，用内置样例验证解析
 *
 * 数据来源（可自行增删 FEEDS）：
 *   - Google News 中文「网球」
 *   - Google News 英文「tennis」
 *   - BBC Sport 网球频道
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'data', 'news.js');
const MAX_NEWS = 40; // 最多保留的新闻卡片数

const FEEDS = [
  { name: '谷歌新闻·网球', url: 'https://news.google.com/rss/search?q=%E7%BD%91%E7%90%83&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=tennis&hl=en-US&gl=US&ceid=US:en' },
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/tennis/rss.xml' },
];

/* ---------- 抓取（支持重定向与 gzip） ---------- */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'tennis-cards-crawler/1.0', 'Accept-Encoding': 'gzip' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve(fetchText(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      const pipe = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      pipe.on('data', (c) => chunks.push(c));
      pipe.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      pipe.on('error', reject);
    }).on('error', reject);
  });
}

/* ---------- 极简 RSS 解析 ---------- */
function popTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>'));
  return m ? m[1] : '';
}
function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function stripHtml(s) {
  return decodeEntities(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
function parseRss(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: stripHtml(popTag(block, 'title')),
      link: stripHtml(popTag(block, 'link')),
      pubDate: stripHtml(popTag(block, 'pubDate')),
      desc: stripHtml(popTag(block, 'description')),
    });
  }
  return items.filter((i) => i.title && i.link);
}

/* ---------- RSS 条目 → 卡片 ---------- */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function fmtMMDD(ts) {
  const d = new Date(ts);
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function itemToCard(item, feedName) {
  const ts = Date.parse(item.pubDate) || Date.now();
  const teaser = item.desc ? (item.desc.slice(0, 120) + (item.desc.length > 120 ? '…' : '')) : '点击查看详细报道';
  return {
    id: 'news-' + hash(item.title + item.link),
    type: 'news',
    title: item.title,
    teaser,
    detail: item.desc || '这是一条来自网络的网球新闻，点击下方按钮阅读原文。',
    date: fmtMMDD(ts),
    ts,
    source: feedName,
    url: item.link,
  };
}

/* ---------- 去重（与已有新闻 + 标题查重） ---------- */
function dedupe(existing, fresh) {
  const seen = new Set(existing.map((c) => c.id));
  const titles = new Set(existing.map((c) => (c.title || '').toLowerCase()));
  const out = [];
  for (const c of fresh) {
    if (seen.has(c.id) || titles.has((c.title || '').toLowerCase())) continue;
    seen.add(c.id); titles.add((c.title || '').toLowerCase());
    out.push(c);
  }
  return out;
}

/* ---------- 读取现有新闻 ---------- */
function loadExisting() {
  try {
    const txt = fs.readFileSync(OUT, 'utf8');
    const m = txt.match(/window\.NEWS_CARDS\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (m) return JSON.parse(m[1]);
    return [];
  } catch { return []; }
}

/* ---------- 内置样例（离线自测） ---------- */
const FIXTURE = `<?xml version="1.0"?><rss><channel><title>test</title>
<item><title>纳达尔宣布退役</title><link>http://example.com/a</link><pubDate>Mon, 12 Aug 2026 08:00:00 GMT</pubDate><description>西班牙名将纳达尔宣布在戴维斯杯后退役。</description></item>
<item><title>New champion in Shanghai</title><link>http://example.com/b</link><pubDate>Tue, 13 Aug 2026 09:00:00 GMT</pubDate><description>&lt;b&gt;A&lt;/b&gt; new Masters winner was crowned.</description></item>
</channel></rss>`;

function selftest() {
  const items = parseRss(FIXTURE);
  const cards = items.map((i) => itemToCard(i, '测试源'));
  console.log('解析条目：', items.length);
  cards.forEach((c) => console.log('  [' + c.date + '] ' + c.title + '  -> ' + c.url));
  const bad = cards.filter((c) => !c.id || !c.title || !c.url || !c.date || !c.ts);
  console.log(bad.length ? '有坏数据' : '全部有效');
  // 去重测试：全新标题/链接应被加入，重复标题应被过滤
  const newItems = [itemToCard(items[0], '测试源'), { id: 'news-new', title: '全新报道', teaser: '', detail: '', date: '08-14', ts: Date.now(), source: '测试源', url: 'http://example.com/c' }];
  const added = dedupe(cards, newItems);
  console.log('去重后新增：', added.length, '（预期 1：仅“全新报道”通过）');
  return bad.length === 0 && added.length === 1;
}

/* ---------- 主流程 ---------- */
async function main() {
  if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

  const existing = loadExisting();
  console.log('已有新闻卡片：', existing.length);

  const fresh = [];
  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRss(xml);
      const cards = items.map((i) => itemToCard(i, feed.name));
      console.log('  ' + feed.name + '：' + cards.length + ' 条');
      fresh.push(...cards);
    } catch (e) {
      console.log('  ' + feed.name + ' 抓取失败：' + e.message);
    }
  }

  const merged = existing.concat(dedupe(existing, fresh))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, MAX_NEWS);

  const js = '// 本文件由 tools/crawler.js 自动生成（RSS 新闻）。\n' +
    '// 重新生成：node tools/crawler.js\n' +
    'window.NEWS_CARDS = ' + JSON.stringify(merged) + ';\n';
  fs.writeFileSync(OUT, js, 'utf8');
  console.log('写入：', OUT, '（' + merged.length + ' 条新闻，' + js.length + ' 字节）');
}

main().catch((e) => { console.error('抓取失败：', e.message); process.exit(1); });