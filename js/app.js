'use strict';

/* ============================================================
 * 网球一刻 · 交互逻辑
 *  - 竖向滑屏切换卡片（TikTok 式）
 *  - 卡内横滑四屏：📚 百科 ← 原卡 → 📊 战报 → 🔗 联想（左右滑逐级移动）
 *  - 竞猜点选作答、喜欢 / 收藏 / 分享（localStorage 持久化）
 *  - 桌面键盘 ↑↓ 切换、→ 下一屏、← 上一屏
 * ============================================================ */

// 注意：不能用 const { CARDS } = window.CONTENT 解构——
// content.js 已在全局作用域声明过同名 const，重复声明会导致整个脚本解析失败。
const ALL_CARDS = window.CONTENT.CARDS;
const CARD_TYPES = window.CONTENT.TYPES;

/* ---------------- 状态与存储 ---------------- */
const store = {
  get(key, dft) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? dft : v; }
    catch { return dft; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};
const likes = new Set(store.get('tk_likes', []));
const favs = new Set(store.get('tk_favs', []));
const answers = store.get('tk_answers', {}); // { cardId: chosenIndex }

const state = { filter: 'all', order: [], idx: 0 };

/* ---------------- 工具 ---------------- */
function $(s) { return document.querySelector(s); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayMD() {
  const d = new Date();
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function mdLabel(md) { return Number(md.slice(0, 2)) + '月' + Number(md.slice(3)) + '日'; }

/* 日期种子洗牌：同一台设备同一天内卡片顺序稳定，跨天换新 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const a = arr.slice();
  const rand = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function daySeed() {
  return Math.floor(Math.random() * 2147483647);
}

function buildOrder(filter) {
  let list = ALL_CARDS;
  if (filter === 'fav') list = ALL_CARDS.filter((c) => favs.has(c.id));
  else if (filter !== 'all') list = ALL_CARDS.filter((c) => c.type === filter);

  const today = todayMD();

  // “历史上的今天”筛选：只看当天发生的事件
  if (filter === 'history') return list.filter((c) => c.date === today);

  // “全部”视图：全部卡片混在一起随机洗牌（含当天历史与新闻）
  if (filter === 'all') {
    return seededShuffle(list, daySeed());
  }

  const pinned = list.filter((c) => c.type === 'history' && c.date === today);
  const rest = list.filter((c) => !pinned.includes(c));
  return [...pinned, ...seededShuffle(rest, daySeed())];
}

/* ---------------- 渲染 ---------------- */
/* 战报区块：交手 / 排名与身份 / 赛季与状态 / 头衔背景（新字段缺省时自动跳过） */
function reportHtml(card) {
  const rp = card.report;
  const a = (card.players && card.players[0]) || '胜者';
  const b = (card.players && card.players[1]) || '对手';
  const secs = [];
  const g = (title, lines) => { if (lines.length) secs.push({ title, lines }); };

  /* ① 交手记录 */
  const h2h = [];
  if (rp.prev[0] + rp.prev[1] === 0) {
    h2h.push('⚔️ 巡回赛首遇，两人此前从无交手');
  } else {
    h2h.push('⚔️ 赛前交手：' + a + ' ' + rp.prev[0] + ' – ' + rp.prev[1] + ' ' + b +
      '（本场后 ' + (rp.prev[0] + 1) + ' – ' + rp.prev[1] + '）');
  }
  for (const e of rp.recent) {
    h2h.push('· ' + e.y + ' ' + e.ev + ' ' + e.r + '：' + e.win + (e.s ? ' ' + e.s : '') + ' 胜');
  }
  g('🤝 交手脉络', h2h);

  /* ② 对阵背景：场地/排名/种子/年龄 */
  const bg = [];
  const tag = [];
  if (rp.rnd) tag.push(rp.rnd);
  if (rp.surf) tag.push(rp.surf);
  if (tag.length) bg.push('🏟 本场：' + tag.join(' · '));
  if (rp.wr && rp.lr) {
    let s = '🏅 赛前排名：' + a + ' 第 ' + rp.wr + ' ｜ ' + b + ' 第 ' + rp.lr;
    if (rp.wr >= rp.lr + 5) s += '（💥 下克上：排名相差 ' + (rp.wr - rp.lr) + ' 位）';
    bg.push(s);
  }
  const who = (seed, entry) =>
    entry === 'Q' ? '资格赛' : entry === 'WC' ? '外卡' : entry === 'LL' ? '幸运落败者'
      : entry === 'PR' ? '保护排名' : seed ? (seed === 1 ? '头号种子' : seed + ' 号种子') : '非种子';
  if (rp.ws || rp.ls || rp.we || rp.le) {
    bg.push('🎟 身份：' + a + ' ' + who(rp.ws, rp.we) + ' ｜ ' + b + ' ' + who(rp.ls, rp.le));
  }
  if (rp.wa && rp.la) bg.push('🎂 年龄：' + a + ' ' + rp.wa + ' 岁 ｜ ' + b + ' ' + rp.la + ' 岁');
  g('⚖️ 对阵背景', bg);

  /* ③ 赛季与状态 */
  const season = [];
  const sea = (p, o) => (o.w + o.l === 0) ? (p + ' 赛季首站') :
    (p + ' ' + o.w + '胜' + o.l + '负' + (o.t ? '·' + o.t + '冠' : ''));
  season.push('📆 本届开赛前：' + sea(a, rp.sW) + ' ｜ ' + sea(b, rp.sL));
  if (rp.form && ((rp.form[0] || '').length >= 3 || (rp.form[1] || '').length >= 3)) {
    season.push('📈 近五场：' + a + ' ' + (rp.form[0] || '—') + ' ｜ ' + b + ' ' + (rp.form[1] || '—') +
      '（W 胜 / L 负）');
  }
  if (rp.career && (rp.career[0] || rp.career[1])) {
    season.push('🎾 生涯巡回赛战绩（赛前）：' + a + ' ' + rp.career[0].w + '胜' + rp.career[0].l + '负 ｜ ' +
      b + ' ' + rp.career[1].w + '胜' + rp.career[1].l + '负');
  }
  g('📊 状态盘点', season);

  /* ④ 头衔背景 */
  const bg2 = [];
  if (rp.tt && (rp.tt[0] || rp.tt[1])) {
    const t = (p, n) => p + ' 此前 ' + n + ' 次在这项赛事登顶';
    bg2.push('👑 本赛事：' + [t(a, rp.tt[0]), t(b, rp.tt[1])].filter((x, i) => (rp.tt[i] > 0)).join(' ｜ '));
  }
  if (rp.maj && (rp.maj[0] || rp.maj[1] || rp.major)) {
    const x = rp.major ? (rp.maj[0] + 1) : rp.maj[0];
    let s = '🏆 生涯大满贯：' + a + ' ' + x + ' 座 ｜ ' + b + ' ' + rp.maj[1] + ' 座';
    if (rp.major && x >= 3) s += '（' + a + ' 正在书写传奇）';
    bg2.push(s);
  }
  g('👑 头衔坐标', bg2);

  return '<div class="card-report"><div class="rp-title">📊 战报 · 情报全览</div>' +
    secs.map((sec) =>
      '<div class="rp-group"><div class="rp-gtitle">' + esc(sec.title) + '</div>' +
      sec.lines.map((l) => '<div class="rp-line">' + esc(l) + '</div>').join('') + '</div>'
    ).join('') + '</div>';
}

/* ---------------- 联想引擎（前端运行时在已加载卡片间现算，无需新数据） ---------------- */
let REL = null;
function relIndex() {
  if (REL) return REL;
  const byPlayer = new Map(), byRival = new Map(), byDate = new Map(), byYear = new Map();
  const add = (m, k, c) => { let a = m.get(k); if (!a) m.set(k, a = []); a.push(c); };
  const noPlayers = [];
  for (const c of ALL_CARDS) {
    if (c.players && c.players.length === 2) {
      add(byPlayer, c.players[0], c); add(byPlayer, c.players[1], c);
      add(byRival, [c.players[0], c.players[1]].sort().join('||'), c);
    } else noPlayers.push(c);
    if (c.date && c.year) add(byDate, c.date, c);
    if (c.year) add(byYear, c.year, c);
  }
  return (REL = { byPlayer, byRival, byDate, byYear, noPlayers });
}
/* 取与 self 年份最接近的 k 张（谓词过滤），O(n) 免全量排序 */
function topNearest(list, self, k, pass, dist) {
  const out = [];
  for (const c of list) {
    if (c === self || !pass(c)) continue;
    const v = dist(c);
    if (out.length < k) { out.push(c); if (out.length === k) out.sort((a, b) => dist(a) - dist(b)); }
    else if (v < dist(out[out.length - 1])) { out.pop(); out.push(c); out.sort((a, b) => dist(a) - dist(b)); }
  }
  return out;
}
function assocGroups(card) {
  const R = relIndex();
  const out = [];
  const used = new Set([card.id]);
  const take = (items, k) => {
    const res = [];
    for (const c of items) {
      if (used.has(c.id)) continue;
      used.add(c.id); res.push(c);
      if (res.length >= k) break;
    }
    return res;
  };
  const yd = (c) => Math.abs((c.year || 0) - (card.year || 0));
  if (card.players && card.players.length === 2) {
    const [p1, p2] = card.players;
    let more = take(topNearest(R.byPlayer.get(p1) || [], card, 6, () => true, yd), 4);
    if (more.length < 2) { // 手工卡无 players 字段：标题/正文含该球员也算
      for (const c of R.noPlayers) {
        if (more.length >= 4) break;
        if (!used.has(c.id) && (c.title.indexOf(p1) >= 0 || (c.detail || '').indexOf(p1) >= 0)) { used.add(c.id); more.push(c); }
      }
    }
    if (more.length) out.push({ g: '👤 ' + p1 + ' 的其他时刻', items: more });
    const rivals = take(topNearest(R.byRival.get([p1, p2].sort().join('||')) || [], card, 5,
      (c) => c.year !== card.year || c.date !== card.date, yd), 3);
    if (rivals.length) out.push({ g: '⚔️ 与 ' + p2 + ' 的其他交锋', items: rivals });
  }
  if (card.date && card.year) {
    const sameDay = take(topNearest(R.byDate.get(card.date) || [], card, 4, (c) => c.year !== card.year, yd), 3);
    if (sameDay.length) out.push({ g: '📅 历年 ' + mdLabel(card.date) + ' 还发生', items: sameDay });
  }
  if (card.year) {
    const names = card.players || [];
    const sameYear = take(topNearest(R.byYear.get(card.year) || [], card, 4,
      (c) => !(names.length && c.players && (c.players.some((n) => names.includes(n)))), yd), 3);
    if (sameYear.length) out.push({ g: '🗓️ ' + card.year + ' 年·库里同年', items: sameYear });
  }
  return out;
}
function hasAssoc(card) { // 渲染前的 O(1) 探测：决定要不要挂联想面板
  const R = relIndex();
  if (card.players && ((R.byPlayer.get(card.players[0]) || []).length > 1 ||
      (R.byRival.get([card.players[0], card.players[1]].sort().join('||')) || []).length > 1)) return true;
  if (card.date && (R.byDate.get(card.date) || []).length > 1) return true;
  if (card.year && (R.byYear.get(card.year) || []).length > 1) return true;
  return false;
}
function assocHtml(card, groups) {
  let inner = '<div class="ac-title">🔗 联想 · 跨越时空</div>';
  if (!groups.length) inner += '<p class="ac-empty">这张卡暂时没有库内强关联</p>';
  for (const gr of groups) {
    inner += '<div class="ac-group"><div class="ac-gname">' + esc(gr.g) + '</div>' +
      gr.items.map((c) =>
        '<button class="ac-item" data-act="jump" data-id="' + esc(c.id) + '">' +
        '<span class="ac-year">' + (c.year || '—') + '</span>' +
        '<span class="ac-txt">' + esc(c.title) + '</span>' +
        '<span class="ac-go">⟶</span></button>'
      ).join('') + '</div>';
  }
  inner += '<button class="back-btn" data-act="back2">← 左滑或点此返回战报</button>';
  return '<div class="card-assoc">' + inner + '</div>';
}

/* ---------------- 网球百科（原卡左滑，数据在 js/knowledge.js） ---------------- */
const IOC2ISO = { SUI:'CH',GBR:'GB',USA:'US',FRA:'FR',CRO:'HR',ITA:'IT',GER:'DE',ARG:'AR',JPN:'JP',CHN:'CN',AUS:'AU',CZE:'CZ',SVK:'SK',UKR:'UA',NED:'NL',BEL:'BE',SWE:'SE',POL:'PL',KAZ:'KZ',CAN:'CA',BRA:'BR',CHI:'CL',GRE:'GR',BUL:'BG',ROU:'RO',DEN:'DK',TPE:'TW',IND:'IN',KOR:'KR',RSA:'ZA',NZL:'NZ',EGY:'EG',TUN:'TN',MAR:'MA',RUS:'RU',BLR:'BY',HUN:'HU',AUT:'AT',MEX:'MX',COL:'CO',PER:'PE',UZB:'UZ',GEO:'GE',FIN:'FI',NOR:'NO',ESP:'ES',SRB:'RS',TCH:'CZ',YUG:'RS',URS:'RU',EUN:'RU',FRG:'DE',GDR:'DE' };
function flagOf(ioc) {
  const cc = IOC2ISO[ioc] || (ioc && ioc.length === 2 ? ioc : null);
  return cc ? String.fromCodePoint(127397 + cc.charCodeAt(0), 127397 + cc.charCodeAt(1)) : '🎾';
}
/* 赛内冠军索引：赛事关键词 → 冠军国籍 IOC → {球员名集合, 年份列表}（懒建一次） */
let CHAMPS = null;
function champIndex() {
  if (CHAMPS) return CHAMPS;
  const idx = new Map();
  const KB = window.TENNIS_KB;
  if (!KB) return (CHAMPS = idx);
  for (const c of ALL_CARDS) {
    if (!c.report || !c.report.ioc || !c.report.ioc[0] || String(c.title).indexOf('冠军') < 0) continue;
    let key = null, len = 0;
    for (const k in KB.tourneys) { const i = c.title.indexOf(k); if (i >= 0 && k.length > len) { key = k; len = k.length; } }
    if (!key) continue;
    let byC = idx.get(key); if (!byC) idx.set(key, byC = new Map());
    let e = byC.get(c.report.ioc[0]); if (!e) byC.set(c.report.ioc[0], e = { names: new Set(), years: [] });
    if (c.players && c.players[0]) e.names.add(c.players[0]);
    if (c.year) e.years.push(c.year);
  }
  return (CHAMPS = idx);
}
function knowFor(card) {
  const KB = window.TENNIS_KB;
  if (!KB) return [];
  const secs = [];
  const hay = (card.title || '') + '\n' + (card.detail || '');
  let key = null, t = null, len = 0;
  for (const k in KB.tourneys) { if (hay.indexOf(k) >= 0 && k.length > len) { key = k; t = KB.tourneys[k]; len = k.length; } }
  if (t) {
    secs.push({ head: t.icon + ' 赛事百科 · ' + t.name, lines: t.lines });
    const city = KB.cities[key];
    if (city) secs.push({ head: '🏙️ 当地志 · ' + city.name, lines: city.lines });
  }
  const rp = card.report;
  const surf = rp && rp.surf;
  if (surf && KB.surfaces[surf]) secs.push({ head: '⛹️ 场地秘密 · ' + surf, lines: KB.surfaces[surf] });
  if (rp && Array.isArray(rp.ioc) && card.players) {
    const lines = [];
    for (let i = 0; i < 2; i++) {
      const cc = String(rp.ioc[i] || '').toUpperCase();
      const cty = cc && KB.countries[cc];
      if (!cty) continue;
      lines.push(flagOf(cc) + ' ' + (card.players[i] || '?') + ' · ' + cty.n + '：' + cty.t);
      if (key) {
        const e = (champIndex().get(key) || new Map()).get(cc);
        if (e && e.years.length) {
          const yrs = [...new Set(e.years)].sort();
          const nm = [...e.names];
          const whoStr = nm.length === 1 ? nm[0] : nm.slice(0, 3).join('、') + (nm.length > 3 ? ' 等' : '');
          lines.push('🏟 同国籍在此夺冠 ' + e.years.length + ' 次（' + whoStr + '）：' +
            yrs.slice(-6).join('、') + (yrs.length > 6 ? '…' : ''));
        }
      }
    }
    if (lines.length) secs.push({ head: '🌍 国家网球 · 双方球员母国', lines });
  }
  return secs;
}
function knowHtml(card, secs) {
  let inner = '<div class="kn-title">📚 网球百科</div>' +
    '<div class="kn-from">' + CARD_TYPES[card.type].icon + ' 由这张卡延伸 · ' + esc(card.title) + '</div>';
  for (const s of secs) {
    inner += '<div class="kn-group"><div class="kn-gname">' + esc(s.head) + '</div>' +
      s.lines.map((l) => '<div class="kn-line">' + esc(l) + '</div>').join('') + '</div>';
  }
  inner += '<button class="back-btn" data-act="main">右滑或点此返回原卡 <span>⟶</span></button>';
  return '<div class="panel know-panel"><div class="panel-inner">' + inner + '</div></div>';
}

function cardHtml(card, i, total) {
  const t = CARD_TYPES[card.type];
  const isQuiz = card.type === 'quiz';
  const know = knowFor(card);
  const isToday = card.type === 'history' && card.date === todayMD();
  const hintText = isQuiz ? '右滑看答案与解析' : '右滑看完整故事 · 战报';

  let badges = '<div class="badges">' +
    '<span class="type-badge ' + t.badge + '">' + t.icon + ' ' + t.label + '</span>';
  if (card.date) badges += '<span class="date-badge">' + mdLabel(card.date) + '</span>';
  if (isToday) badges += '<span class="today-badge">🎂 就在今天！</span>';
  badges += '</div>';

  let mainBody = '';
  if (card.year) mainBody += '<div class="card-year">' + card.year + ' 年</div>';
  mainBody += '<h2 class="card-title">' + esc(card.title) + '</h2>' +
    '<p class="card-teaser">' + esc(card.teaser) + '</p>';

  if (isQuiz) {
    const chosen = answers[card.id];
    const keys = ['A', 'B', 'C', 'D'];
    mainBody += '<div class="options">' +
      card.options.map((opt, oi) => {
        let cls = '';
        if (chosen != null) {
          if (oi === card.answer) cls = ' correct';
          else if (oi === chosen) cls = ' wrong';
        }
        return '<button class="opt-btn' + cls + '" data-act="answer" data-card="' + card.id +
          '" data-opt="' + oi + '"' + (chosen != null ? ' disabled' : '') + '>' +
          '<span class="opt-key">' + keys[oi] + '</span>' + esc(opt) + '</button>';
      }).join('') + '</div>';
    if (chosen != null) {
      mainBody += '<p class="card-teaser">' +
        (chosen === card.answer ? '✅ 答对了！' : '❌ 答错了，正确答案是「' + esc(card.options[card.answer]) + '」') +
        '</p>';
    }
  }

  let detailBody = '<div class="detail-divider"></div>';
  if (isQuiz) {
    detailBody += '<div class="answer-reveal">正确答案：' + esc(card.options[card.answer]) + '</div>';
  }
  detailBody += '<p class="detail-text">' + esc(card.detail) + '</p>';
  // 精彩看点（生成器 / 手工卡片均可提供）
  if (card.highlights) {
    const hls = card.highlights;
    detailBody += '<div class="card-highlights">' +
      hls.split('\n').map(l => '<div class="hl-line">' + esc(l) + '</div>').join('') +
    '</div>';
  }
  // 战报：头对头交手记录 + 当年战绩（生成器赛果卡自动附带）
  if (card.report) {
    detailBody += reportHtml(card);
  }
  if (card.type === 'news') {
    if (card.source) detailBody += '<p class="detail-meta">📰 来源：' + esc(card.source) + '</p>';
    if (card.url) detailBody += '<a class="read-link" href="' + esc(card.url) +
      '" target="_blank" rel="noopener">🔗 阅读原文 ↗</a>';
  } else if (card.date) {
    detailBody += '<p class="detail-meta">📅 发生于 ' + (card.year ? card.year + ' 年 ' : '') + mdLabel(card.date) + '</p>';
  }
  // 联想入口（有库内关联才挂第三面板；右滑两级：原卡 → 战报 → 联想）
  const groups = hasAssoc(card) ? assocGroups(card) : [];
  if (groups.length) {
    detailBody += '<button class="swipe-hint assoc-hint" data-act="assoc">🔗 ' + esc(groups[0].g) +
      ' 等联想 · 再右滑查看 <span>⟶</span></button>';
  }
  detailBody += '<button class="back-btn" data-act="back">← 左滑或点此返回原卡</button>';

  return '' +
    '<section class="card" data-type="' + card.type + '" data-id="' + card.id + '" data-idx="' + i + '">' +
      '<div class="hwrap">' +
      (know.length ? knowHtml(card, know) : '') +
        '<div class="panel main-panel"><div class="panel-inner">' +
          badges + mainBody +
          '<div class="hints-row">' +
            (know.length ? '<button class="swipe-hint hint-left" data-act="know">⟵ 左滑看网球百科</button>' : '<span></span>') +
            '<button class="swipe-hint" data-act="detail">' + hintText + ' <span>⟶</span></button>' +
          '</div>' +
        '</div><div class="watermark">' + t.icon + '</div></div>' +
        '<div class="panel detail-panel"><div class="panel-inner">' +
          badges +
          '<h2 class="card-title">' + esc(card.title) + '</h2>' +
          detailBody +
        '</div></div>' +
        (groups.length ?
          '<div class="panel assoc-panel"><div class="panel-inner">' +
            badges +
            '<h2 class="card-title">' + esc(card.title) + '</h2>' +
            assocHtml(card, groups) +
          '</div></div>' : '') +
      '</div>' +
      '<div class="counter">' + (i + 1) + ' / ' + total + '</div>' +
    '</section>';
}

function renderFeed() {
  const feed = $('#feed');
  state.order = buildOrder(state.filter);
  state.idx = 0;

  if (!state.order.length) {
    const emptyMsg = state.filter === 'history' ? '📅 今天没有网球史上的重大事件' :
      state.filter === 'fav' ? '⭐ 还没有收藏的卡片<br>看到喜欢的点右侧 ⭐ 吧' :
      '🎾 暂无内容';
    feed.innerHTML = '<div class="empty"><div class="big">' + emptyMsg.split('<')[0] + '</div><div>' + emptyMsg + '</div></div>';
    updateProgress();
    return;
  }
  feed.innerHTML = state.order.map((c, i) => cardHtml(c, i, state.order.length)).join('');
  feed.scrollTop = 0;
  resetHwraps();
  observeCards();
  updateRail();
  updateProgress();
}
/* 横向视口初始定位到主卡（百科面板在其左侧）；窗口尺寸变化时重新对齐 */
function resetHwraps() {
  document.querySelectorAll('.hwrap').forEach((h) => {
    const kids = Array.prototype.slice.call(h.children);
    const mi = kids.findIndex((p) => p.classList && p.classList.contains('main-panel'));
    if (mi > 0) h.scrollLeft = mi * h.clientWidth;
  });
}
window.addEventListener('resize', resetHwraps);

/* ---------------- 观察当前卡片 ---------------- */
let observer = null;
function observeCards() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting && en.intersectionRatio >= 0.55) {
        state.idx = Number(en.target.dataset.idx);
        updateProgress();
        updateRail();
      }
    }
  }, { root: $('#feed'), threshold: [0.55] });
  document.querySelectorAll('.card').forEach((el) => observer.observe(el));
}

function currentCardEl() {
  return document.querySelector('.card[data-idx="' + state.idx + '"]');
}
function currentCard() { return state.order[state.idx] || null; }

/* ---------------- 进度与操作栏 ---------------- */
function updateProgress() {
  const total = state.order.length;
  const pct = total ? ((state.idx + 1) / total) * 100 : 0;
  $('#progress-fill').style.width = pct + '%';
}
function updateRail() {
  const c = currentCard();
  if (!c) return;
  $('#btn-like').classList.toggle('on-like', likes.has(c.id));
  $('#btn-fav').classList.toggle('on-fav', favs.has(c.id));
}

function nav(delta) {
  const next = Math.max(0, Math.min(state.order.length - 1, state.idx + delta));
  const feed = $('#feed');
  feed.scrollTo({ top: next * feed.clientHeight, behavior: 'smooth' });
}
/* 卡内面板逐级导航：百科(0) → 原卡 → 战报 → 联想（按类名定位，兼容无百科的卡） */
function goPanel(cardEl, i) {
  const h = cardEl && cardEl.querySelector('.hwrap');
  if (!h) return;
  const max = h.querySelectorAll(':scope > .panel').length - 1;
  i = Math.max(0, Math.min(max, i));
  h.scrollTo({ left: i * h.clientWidth, behavior: 'smooth' });
}
function panelPos(cardEl, cls) {
  const h = cardEl && cardEl.querySelector('.hwrap');
  if (!h) return 0;
  const kids = Array.prototype.slice.call(h.children);
  const i = kids.findIndex((p) => p.classList && p.classList.contains(cls));
  return i < 0 ? 0 : i;
}
function panelIdx(cardEl) {
  const h = cardEl && cardEl.querySelector('.hwrap');
  if (!h || !h.clientWidth) return 0;
  return Math.round(h.scrollLeft / h.clientWidth);
}
function revealDetail() {
  const el = currentCardEl();
  if (el) goPanel(el, panelPos(el, 'detail-panel'));
}
function stepPanel(delta) { // 键盘/按钮：前进或后退一屏
  const el = currentCardEl();
  if (el) goPanel(el, panelIdx(el) + delta);
}
function backToMain(cardEl) {
  const el = cardEl || currentCardEl();
  goPanel(el, panelPos(el, 'main-panel'));
}
/* 联想卡跳转：在当前卡组定位并滚过去，顺带把出发的卡复位 */
function jumpToCard(fromCardEl, id) {
  let pos = state.order.findIndex((c) => c.id === id);
  if (pos < 0) {                 // 被当前筛选排除 → 切回“全部”再找
    setFilter('all');
    pos = state.order.findIndex((c) => c.id === id);
  }
  if (fromCardEl) goPanel(fromCardEl, panelPos(fromCardEl, 'main-panel'));
  if (pos < 0) { toast('关联卡片未找到'); return; }
  const feed = $('#feed');
  feed.scrollTo({ top: pos * feed.clientHeight, behavior: 'smooth' });
  const el = document.querySelector('.card[data-idx="' + pos + '"]');
  if (el) goPanel(el, panelPos(el, 'main-panel'));
  toast('🔗 已跳转到关联卡片');
}

/* ---------------- 互动 ---------------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function answerQuiz(cardId, optIdx) {
  if (answers[cardId] != null) return;
  answers[cardId] = optIdx;
  store.set('tk_answers', answers);
  // 只重渲染这张卡，保留滚动位置
  const el = document.querySelector('.card[data-id="' + cardId + '"]');
  if (!el) return;
  const card = ALL_CARDS.find((c) => c.id === cardId);
  const i = Number(el.dataset.idx);
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(card, i, state.order.length);
  const newEl = tmp.firstElementChild;
  el.replaceWith(newEl);
  observer.observe(newEl);
  const hh = newEl.querySelector('.hwrap');
  if (hh) hh.scrollLeft = panelPos(newEl, 'main-panel') * hh.clientWidth;
  const correct = optIdx === card.answer;
  toast(correct ? '✅ 答对了！右滑看解析' : '❌ 答错了，右滑看解析');
}

function toggleLike() {
  const c = currentCard(); if (!c) return;
  likes.has(c.id) ? likes.delete(c.id) : likes.add(c.id);
  store.set('tk_likes', [...likes]);
  updateRail();
  toast(likes.has(c.id) ? '❤️ 已喜欢' : '已取消喜欢');
}
function toggleFav() {
  const c = currentCard(); if (!c) return;
  favs.has(c.id) ? favs.delete(c.id) : favs.add(c.id);
  store.set('tk_favs', [...favs]);
  updateRail();
  toast(favs.has(c.id) ? '⭐ 已收藏' : '已取消收藏');
}
async function shareCard() {
  const c = currentCard(); if (!c) return;
  const t = CARD_TYPES[c.type];
  const text = '🎾 ' + c.title + '（' + t.label + '）\n' + (c.teaser || '') + '\n—— 来自「网球一刻」';
  if (navigator.share) {
    try { await navigator.share({ title: c.title, text }); return; } catch { /* 用户取消 */ }
  }
  try { await navigator.clipboard.writeText(text); toast('📋 内容已复制，去粘贴分享吧'); }
  catch { toast('复制失败，请手动截图分享'); }
}

/* ---------------- 事件 ---------------- */
function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('.f-chip').forEach((b) =>
    b.classList.toggle('active', b.dataset.filter === filter));
  document.querySelectorAll('.tennis-tear').forEach((t) =>
    t.classList.toggle('active', filter === 'history'));
  renderFeed();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) {
    const act = el.dataset.act;
    if (act === 'answer') answerQuiz(el.dataset.card, Number(el.dataset.opt));
    else if (act === 'detail') revealDetail();
    else if (act === 'back') backToMain(el.closest('.card'));
    else if (act === 'know') goPanel(el.closest('.card'), 0);
    else if (act === 'main') goPanel(el.closest('.card'), panelPos(el.closest('.card'), 'main-panel'));
    else if (act === 'assoc') goPanel(el.closest('.card'), panelPos(el.closest('.card'), 'assoc-panel'));
    else if (act === 'back2') goPanel(el.closest('.card'), panelPos(el.closest('.card'), 'detail-panel'));
    else if (act === 'jump') jumpToCard(el.closest('.card'), el.dataset.id);
    else if (act === 'filter') setFilter(el.dataset.filter);
    return;
  }
  const chip = e.target.closest('.f-chip');
  if (chip) {
    setFilter(chip.dataset.filter);
  }
});

$('#btn-up').addEventListener('click', () => nav(-1));
$('#btn-down').addEventListener('click', () => nav(1));
$('#btn-detail').addEventListener('click', () => stepPanel(1));
$('#btn-like').addEventListener('click', toggleLike);
$('#btn-fav').addEventListener('click', toggleFav);
$('#btn-share').addEventListener('click', shareCard);

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); nav(1); }
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); nav(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); stepPanel(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stepPanel(-1); }
  else if (e.key === 'l' || e.key === 'L') toggleLike();
});

/* ---------------- 启动 ---------------- */
renderFeed();
