'use strict';
/* ============================================================
 * 新闻抓取程序：英文 RSS → 过滤赛况 → 机翻中文（球员姓名保留英文）
 * ------------------------------------------------------------
 * 零第三方依赖，仅用 Node 内置模块（在 GitHub Actions 运行）。
 *
 * 用法：
 *   node tools/crawler.js                 # 抓取 + 翻译，写入 data/news.js
 *   node tools/crawler.js --no-translate  # 只抓取（调试用）
 *   node tools/crawler.js --selftest      # 离线自测
 *
 * 定位：以「非比赛」网球新闻为主——人事、商业、技术、规则、伤病退役、
 * 场馆城市、反兴奋剂、青训学院、争议与花边；比分/晋级/夺冠类战报剔除。
 * 翻译：MyMemory 免费接口（en|zh-CN），单次运行有字符预算；
 * 失败或超预算自动回退英文原文（优雅降级，不阻塞产出）。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'data', 'news.js');
const MAX_NEWS = 120;          // 新闻卡总量
const MAX_PER_FEED = 25;       // 单源条目上限
const TRANSLATE_BUDGET = 9000; // 单次运行机翻字符预算

const FEEDS = [
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/tennis/rss.xml' },
  { name: '卫报网球', url: 'https://www.theguardian.com/sport/tennis/rss' },
  { name: 'ESPN 网球', url: 'https://www.espn.com/espn/rss/tennis/news' },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=tennis&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Tennis.com', url: 'https://www.tennis.com/feed' },
];

/* ---------- 赛况过滤：优先保留非比赛新闻 ---------- */
const MATCH_PATTERNS = [
  /\b\d{1,2}-\d{1,2}\b/,                     // 比分
  /\b(defeats?|beats?|beaten|routs?|stuns?|prevails?|comes from behind|edges? past|overcomes?|demolishes?|cruises? (to|into))\b/i,
  /\b(advances (to|into)|reaches the (final|semi-?final|quarter-?final|last ?16|fourth round|third round)|first[- ]round (win|upset))\b/i,
  /\b(win[s|s|ing]? (his|her|the|a|their)? ?(first |maiden |record |third |fourth |fifth )?(title|crown|trophy)|claims? (the )?(title|crown)|title defence|defends? (his|her) title)\b/i,
  /\b(champion(ship)? of|grand slam number \d+|wins the (open|masters|title))\b/i,
  /击败|战胜|逆转|晋级|夺冠|捧杯|不敌|惜败|直落两盘|直落三盘/,
];
function isMatchReport(text) {
  return MATCH_PATTERNS.some((re) => re.test(text || ''));
}

/* ---------- 姓名掩码：机翻时保留球员名英文 ---------- */
const SUR = new Set([
  'federer', 'nadal', 'djokovic', 'murray', 'wawrinka', 'monfils', 'gasquet', 'raonic', 'cilic',
  'del-potro', 'hewitt', 'rafter', 'sampras', 'agassi', 'courier', 'chang', 'connors', 'mcenroe',
  'lendl', 'borg', 'edberg', 'wilander', 'becker', 'korda', 'ivanisevic', 'safin', 'youzhny',
  'davydenko', 'alcaraz', 'zverev', 'medvedev', 'rublev', 'rune', 'fritz', 'shelton', 'shapovalov',
  'tiafoe', 'auger-aliassime', 'hanfmann', 'struff', 'bublik', 'mektic', 'korstanje', 'musetti',
  'draper', 'kopekin', 'jodar', 'de-minaur', 'kyrgios', 'basilashvili', 'altmaier', 'cerundolo',
  'sharapova', 'williams', 'hingis', 'graf', 'navratilova', 'evert', 'court', 'davenport', 'seles',
  'halep', 'cirstea', 'cristian', 'swiatek', 'sabalenka', 'rybakina', 'gauff', 'pegula', 'keys',
  'stephens', 'ostapenko', 'svitolina', 'tsurenko', 'kostyuk', 'krejcikova', 'vondrousova',
  'siniakova', 'paolini', 'bronzetti', 'errani', 'pennetta', 'schiavone', 'jabeur', 'bencic',
  'kvitova', 'wozniacki', 'radwanska', 'zhang', 'wang', 'zheng', 'duan', 'yuan', 'sakkari',
  'samsonova', 'potapova', 'kasatkina', 'anisimova', 'andreeva', 'navarro', 'stosur', 'osaka',
  'hibino', 'darderi', 'boisson', 'bouzkova', 'noskova', 'martinez', 'bautista', 'fucsovics',
  'dementieva', 'safina', 'zvonareva', 'kuznetsova', 'doki', 'molik', 'capriati', 'henin',
  'clijsters', 'mauresmo', 'pierce', 'sanchez', 'sabotini', 'gramatikopoulou', 'sfar', 'uzhihova',
  'sinner', 'griekspoor', 'kenin', 'carreno', 'stefanini', 'darbovan', 'davidovich', 'vliegen',
  'na', 'li',
].filter((w) => w.length > 1));
const FIRST = new Set([
  'roger', 'rafael', 'novak', 'andy', 'stan', 'david', 'fernando', 'juan', 'martin', 'thomas',
  'nicolas', 'marat', 'carlos', 'jannik', 'alexander', 'daniil', 'andrey', 'jack', 'frances',
  'taylor', 'ben', 'matteo', 'lorenzo', 'felix', 'denis', 'kei', 'yuichi', 'wu', 'ze', 'shang',
  'serena', 'venus', 'mariya', 'maria', 'kim', 'justine', 'lindsay', 'petra', 'agnieszka',
  'simona', 'ana', 'garbine', 'iga', 'aryna', 'elena', 'sofia', 'jessica', 'coco', 'emma',
  'bianca', 'ons', 'karolina', 'barbora', 'jelena', 'diana', 'mirra', 'caty', 'carol', 'na',
  'martina', 'chris', 'evonne', 'margaret', 'bill', 'ilie', 'bjorn', 'john', 'mats', 'ivan',
  'andre', 'zheng', 'qinwen', 'ying-yue', 'kaia', 'lina', 'grigor', 'victor', 'aslan',
]);
function nameHit(phrase) {
  const parts = phrase.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const joined = parts.join('-');
    if (SUR.has(parts[0]) || SUR.has(joined)) return true;
    return FIRST.has(parts[0]) && (SUR.has(parts[1]) || SUR.has(joined));
  }
  return SUR.has(parts[0]);
}
/* 球员名 → §§n§§ 哨兵（bigram 优先匹配，避免 "Jannik Sinner" 拆成单词漏掩） */
function maskNames(text) {
  const map = [];
  const masked = String(text).replace(
    /[A-Z][\p{L}'’-]+\s+[A-Z][\p{L}'’-]+|[A-Z][\p{L}'’-]*(?:\.[A-Z][\p{L}'’-]*)*|[A-Z]+\b/gu,
    (m) => {
      const trim = m.replace(/[.,;:]+$/, '');
      if (!trim || trim.length < 3 || !/[a-z]/i.test(trim)) return m;
      if (!nameHit(trim)) return m;
      map.push(trim);
      return '§§' + (map.length - 1) + '§§';
    });
  return { masked, map };
}
function unmaskNames(text, map) {
  return text.replace(/§§\s?(\d+)\s?§§/g, (whole, n) => map[Number(n)] || whole);
}

/* ---------- 抓取 ---------- */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'tennis-cards-crawler/2.0', 'Accept-Encoding': 'gzip' } }, (res) => {
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
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'tennis-cards-crawler/2.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/* ---------- RSS 解析 ---------- */
function popTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>'));
  return m ? m[1] : '';
}
function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (x, n) => String.fromCodePoint(Number(n)));
}
function stripHtml(s) {
  return decodeEntities(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
function cleanTitle(t) {
  return t.replace(/\s+-\s+(BBC|ESPN|The Guardian|New York Times|CNN|AP News|ATP Tour|WTA|Reuters|Sky Sports|NY Post|The Age|The Athletic|Tennis\.com|Forbes|BBC Sport|Guardian)\b.*$/i, '').trim();
}
function parseRss(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1] || m[2] || '';
    let link = stripHtml(popTag(block, 'link'));
    if (!link) { const l = block.match(/href="([^"]+)"/); link = l ? l[1] : ''; }
    items.push({
      title: stripHtml(popTag(block, 'title')),
      link,
      pubDate: stripHtml(popTag(block, 'pubDate') || popTag(block, 'updated') || popTag(block, 'published') || popTag(block, 'dc:date')),
      desc: stripHtml(popTag(block, 'description') || popTag(block, 'summary') || popTag(block, 'content:encoded')),
    });
  }
  return items.filter((i) => i.title && i.link).map((i) => ({ ...i, title: cleanTitle(i.title) }));
}

/* ---------- 机翻（MyMemory；失败或超预算回退英文） ---------- */
let budgetLeft = TRANSLATE_BUDGET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function translateOne(text) {
  if (!text || budgetLeft <= 20) return null;
  const chunk = text.slice(0, 460);
  budgetLeft -= chunk.length * 2; // q 与译文双计量，保守预扣
  const url = 'https://api.mymemory.translated.net/get?langpair=en|zh-CN&q=' + encodeURIComponent(chunk);
  try {
    const j = await fetchJson(url);
    const t = j && j.responseData && j.responseData.translatedText;
    if (!t || t.length > 900 || /MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(t)) return null;
    if (/^[\x00-\x7F]+$/.test(t)) return null; // 纯 ASCII 返回 = 没译出来
    return t;
  } catch { return null; }
}
/* 标题整译；长摘要分句逐段译；哨兵回填保住球员名 */
async function zhify(text) {
  if (!text) return null;
  const { masked, map } = maskNames(text);
  let out;
  if (masked.length <= 440) {
    out = await translateOne(masked);
  } else {
    const parts = masked.split(/(?<=[.!?])\s+/);
    const done = [];
    for (const p of parts) {
      const t = await translateOne(p);
      if (!t) return null;
      done.push(t);
      if (budgetLeft <= 20) break;
      await sleep(400);
    }
    out = done.join(' ');
  }
  return out ? unmaskNames(out, map) : null;
}

/* ---------- 条目 → 卡片 ---------- */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function fmtMMDD(ts) {
  const d = new Date(ts);
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function itemToCard(item, feedName, doTranslate) {
  const ts = Date.parse(item.pubDate) || Date.now();
  const enTitle = item.title;
  const enDesc = item.desc || '';
  let title = enTitle, zhSum = null;
  if (doTranslate) {
    title = (await zhify(enTitle)) || enTitle;
    if (enDesc) { zhSum = await zhify(enDesc); await sleep(450); }
  }
  const teaserSrc = zhSum || enDesc;
  const detail = [
    zhSum || enDesc || '点击查看详细报道',
    zhSum && enDesc ? '📄 英文原文：' + enDesc : '',
    '🕐 ' + new Date(ts).toUTCString().slice(5, 16) + ' · 📡 ' + feedName,
    zhSum || title !== enTitle ? '🌐 英文抓取 · 机器翻译（球员姓名保留原文）' : '',
  ].filter(Boolean).join('\n\n');
  return {
    id: 'news-' + hash(enTitle + item.link),
    type: 'news',
    title,
    title_en: enTitle,
    teaser: teaserSrc ? teaserSrc.slice(0, 110) + (teaserSrc.length > 110 ? '…' : '') : '点击查看详细报道',
    detail,
    date: fmtMMDD(ts),
    ts,
    source: feedName,
    url: item.link,
  };
}

/* ---------- 去重（id + 英文标题） ---------- */
function normTitle(c) { return String(c.title_en || c.title || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function dedupe(existing, fresh) {
  const seen = new Set(existing.map((c) => c.id));
  const titles = new Set(existing.map(normTitle));
  const out = [];
  for (const c of fresh) {
    if (seen.has(c.id) || titles.has(normTitle(c))) continue;
    seen.add(c.id); titles.add(normTitle(c));
    out.push(c);
  }
  return out;
}

function loadExisting() {
  try {
    const txt = fs.readFileSync(OUT, 'utf8');
    const m = txt.match(/window\.NEWS_CARDS\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (m) return JSON.parse(m[1]);
    return [];
  } catch { return []; }
}

/* ---------- 离线自测 ---------- */
const FIXTURE = `<?xml version="1.0"?><rss><channel><title>test</title>
<item><title>Carlos Alcaraz beats Jannik Sinner 6-4 3-6 6-4 to win Madrid final - ESPN</title><link>http://example.com/a</link><pubDate>Mon, 12 May 2025 08:00:00 GMT</pubDate><description>Alcaraz won the title.</description></item>
<item><title>Novak Djokovic opens academy in Belgrade as ATP eyes calendar shake-up</title><link>http://example.com/b</link><pubDate>Tue, 13 May 2025 09:00:00 GMT</pubDate><description>&lt;b&gt;The&lt;/b&gt; world No. 1 discussed coaching, prize money and Hawk-Eye live calls.</description></item>
<item><title>Iga Swiatek tests positive; case referred to ITIA - The Guardian</title><link>http://example.com/c</link><pubDate>Tue, 13 May 2025 12:00:00 GMT</pubDate><description>Doping news involving Iga Swiatek.</description></item>
</channel></rss>`;

function selftest() {
  let pass = true;
  const R = (cond, name) => { console.log((cond ? '  ✔ ' : '  ✘ ') + name); if (!cond) pass = false; };
  const items = parseRss(FIXTURE);
  R(items.length === 3, 'RSS 解析 3 条（实体/HTML 清洗 + " - 来源"后缀剥离）');
  R(!/- ESPN$/.test(items[0].title), 'Google/媒体后缀剥离：' + items[0].title.slice(-14));
  R(isMatchReport(items[0].title), '赛况新闻被识别（比分+夺冠）');
  R(!isMatchReport(items[1].title), '非比赛新闻保留（学院/赛历）');
  R(!isMatchReport(items[2].title), '反兴奋剂新闻不被误杀');
  const { masked, map } = maskNames('Novak Djokovic opens academy in Belgrade. Iga Swiatek and Rafael Nadal attend.');
  R(map.length === 3 && /§§0§§/.test(masked), '姓名掩码 3 处: ' + JSON.stringify(map));
  R(masked.includes('Belgrade'), '地名不掩（留给翻译）');
  R(unmaskNames('§§0§§ 与 §§1§§ 出席', map) === 'Novak Djokovic 与 Iga Swiatek 出席', '哨兵回填还原');
  const { map: m2 } = maskNames('Jannik Sinner pulls out of Indian Wells');
  R(m2.length >= 1 && m2[0] === 'Jannik Sinner', 'bigram 名优先整掩: ' + (m2[0] || '漏'));
  const kept = items.filter((i) => !isMatchReport(i.title));
  R(kept.length === 2, '过滤后剩 2 条非比赛新闻');
  return pass;
}

/* ---------- 主流程 ---------- */
async function main() {
  if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const doTranslate = !process.argv.includes('--no-translate');

  const existing = loadExisting();
  console.log('已有新闻卡片：', existing.length, '张；机翻：', doTranslate ? '开（预算 ' + TRANSLATE_BUDGET + ' 字符）' : '关');

  const fresh = [];
  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRss(xml).slice(0, MAX_PER_FEED);
      let kept = 0, dropped = 0;
      for (const it of items) {
        if (isMatchReport(it.title)) { dropped++; continue; }
        fresh.push({ ...it, _feed: feed.name });
        kept++;
      }
      console.log('  ' + feed.name + '：' + items.length + ' 条 → 过滤赛况 ' + dropped + '，保留 ' + kept);
      await sleep(600);
    } catch (e) {
      console.log('  ' + feed.name + ' 抓取失败：' + e.message);
    }
  }

  fresh.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
  const stamp = (i) => 'news-' + hash(i.title + i.link);
  const newItems = dedupe(existing, fresh.map((i) => ({ id: stamp(i), title: i.title, title_en: i.title })));
  const toBuild = fresh.filter((i) => newItems.some((n) => n.id === stamp(i)));
  console.log('去重后新条目：', toBuild.length, '条；本跑预计翻译', toBuild.length, '条（预算耗尽自动转英文直存）');

  const cards = [];
  for (const it of toBuild) {
    const canTranslate = doTranslate && budgetLeft > 300;
    cards.push(await itemToCard(it, it._feed || '网络来源', canTranslate));
  }

  const merged0 = existing.concat(dedupe(existing, cards))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // 补译：此前翻译失败（标题还是英文）的 7 天内新卡，每跑至多重试 8 条
  if (doTranslate) {
    const now = Date.now();
    const untranslated = merged0.filter((c) => c.title_en && c.title === c.title_en && now - (c.ts || 0) < 7 * 864e5).slice(0, 8);
    let fixed = 0;
    for (const c of untranslated) {
      if (budgetLeft <= 300) break;
      const t = await zhify(c.title_en);
      if (t) { c.title = t; fixed++; await sleep(300); }
    }
    if (fixed) console.log('补译历史英文标题：', fixed, '条');
  }
  const merged = merged0.slice(0, MAX_NEWS);

  const js = '// 本文件由 tools/crawler.js 自动生成（英文抓取 + 机翻中文，球员姓名保留英文）。\n' +
    '// 重新生成：node tools/crawler.js\n' +
    'window.NEWS_CARDS = ' + JSON.stringify(merged) + ';\n';
  fs.writeFileSync(OUT, js);
  console.log('写入：', OUT, '（共 ' + merged.length + ' 张；剩余翻译预算 ' + Math.max(0, budgetLeft) + '）');
}

main().catch((e) => { console.error('生成失败：', e.message); process.exit(1); });
