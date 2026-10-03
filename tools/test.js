'use strict';
/* 离线回归测试：
 *   1. 校验所有卡片数据完整性（ID 唯一、类型合法、竞猜答案合法、日期格式）
 *   2. 用最小 DOM 桩在全局作用域执行 content-extra + content + app，捕获脚本错误
 * 运行：node tools/test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(tag) {
  return {
    tagName: tag || 'div', _html: '', style: {}, dataset: {},
    clientHeight: 800, clientWidth: 400, scrollTop: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    closest() { return null; }, replaceWith() {}, observe() {}, disconnect() {}, scrollTo() {},
    get firstElementChild() { return makeEl(); },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
  };
}
const feedEl = makeEl('main');
global.window = { addEventListener() {} };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// 注：Node 18+ 已有只读全局 navigator，无需覆盖
global.IntersectionObserver = class { observe() {} disconnect() {} };
global.document = {
  querySelector(s) { return s === '#feed' ? feedEl : makeEl(); },
  querySelectorAll() { return []; }, addEventListener() {}, createElement(t) { return makeEl(t); },
};

function evalGlobal(file, tail) { (0, eval)(fs.readFileSync(file, 'utf8') + (tail || '')); }

/* ---------- 执行 ---------- */
let failed = 0;
function check(cond, msg) { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failed++; }

try {
  evalGlobal(path.join(ROOT, 'js', 'content-extra.js'));
  // 本地数据文件存在则一并加载校验（生成器 / 爬虫产物）
  for (const f of ['data/generated.js', 'data/news.js']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) evalGlobal(p);
  }
  evalGlobal(path.join(ROOT, 'js', 'content.js'));
  evalGlobal(path.join(ROOT, 'js', 'knowledge.js'));
  // 严格模式 eval 作用域不外泄函数，测试专用注入一个渲染出口（不影响浏览器）
  evalGlobal(path.join(ROOT, 'js', 'app.js'), '\n;globalThis.__tkCardHtml = cardHtml;');
  console.log('脚本执行：OK');
} catch (e) {
  console.log('脚本执行：FAIL → ' + e.message);
  process.exit(1);
}

const { CARDS, TYPES } = global.window.CONTENT;
console.log('卡片总数：', CARDS.length);

const byType = {};
const ids = new Set();
let dup = 0, quizBad = 0, fieldBad = 0, dateBad = 0, newsBad = 0, reportBad = 0;
for (const c of CARDS) {
  byType[c.type] = (byType[c.type] || 0) + 1;
  if (ids.has(c.id)) dup++; ids.add(c.id);
  if (!TYPES[c.type]) fieldBad++;
  if (!c.title || !c.detail || !c.teaser) fieldBad++;
  if (c.type === 'quiz' && (!Array.isArray(c.options) || c.options.length !== 4 || typeof c.answer !== 'number' || c.answer < 0 || c.answer > 3)) quizBad++;
  if (c.type === 'history' && (!/^\d{2}-\d{2}$/.test(c.date || '') || !c.year)) dateBad++;
  if (c.type === 'news' && (!c.url || !c.source)) newsBad++;
  if (c.report) {
    const r = c.report;
    if (!Array.isArray(r.prev) || r.prev.length !== 2 || typeof r.prev[0] !== 'number' ||
        !Array.isArray(r.recent) || r.recent.length > 3 || !r.sW || !r.sL || !Array.isArray(c.players)) reportBad++;
  }
}
console.log('类型分布：', JSON.stringify(byType));
check(ids.size === CARDS.length, 'ID 无重复（' + ids.size + '/' + CARDS.length + '）');
check(fieldBad === 0, '字段完整（title/teaser/detail）');
check(quizBad === 0, '竞猜选项与答案合法');
check(dateBad === 0, '历史卡片日期/年份格式正确');
check(newsBad === 0, '新闻卡片含 url 与 source');
check(reportBad === 0, '战报字段合法（' + CARDS.filter((c) => c.report).length + ' 张带战报）');

// ---------- 合成卡渲染冒烟测试：详情面板必须输出战报区块 ----------
try {
  const synth = {
    id: 'synthetic-report-test', type: 'history', date: '01-01', year: 2020,
    title: '测试卡片', teaser: 't', detail: 'd',
    players: ['甲', '乙'],
    report: {
      prev: [2, 1],
      recent: [{ y: 2019, ev: '温网', r: '决赛', win: '甲', s: '6-4' }],
      sW: { w: 20, l: 3, t: 2 }, sL: { w: 0, l: 0, t: 0 },
    },
  };
  const html = globalThis.__tkCardHtml(synth, 0, 1);
  check(html.includes('card-report') && html.includes('赛前交手：甲 2 – 1 乙') && html.includes('2019 温网'),
    '战报区块渲染冒烟测试');
  check(html.includes('乙 赛季首站') && html.includes('20胜3负·2冠'), '赛季文案冒烟测试');
} catch (e) {
  check(false, '战报渲染冒烟测试（异常：' + e.message + '）');
}

// ---------- 四屏结构冒烟：百科 ← 原卡 → 战报 → 联想 ----------
try {
  const real = CARDS.find((c) => c.report && c.players && c.players.length === 2 && c.year);
  check(!!real, '存在可用于联想的真实赛果卡');
  if (real) {
    const h = globalThis.__tkCardHtml(real, 0, 1);
    const panels = (h.match(/class="panel /g) || []).length;
    check(h.includes('know-panel'), '百科左滑面板已挂载');
    check(h.includes('assoc-panel') && panels === 4, '四屏结构完整（面板数=' + panels + '）');
    check(h.includes('data-act="jump"') && h.includes('跨越时空'), '联想面板含可跳转关联卡');
  }
  // 赛事百科 + 当地志命中：温网卡两者都应出现
  const wim = CARDS.find((c) => (c.title || '').includes('温布尔登'));
  const wh = wim && globalThis.__tkCardHtml(wim, 0, 1);
  check(!!wh && wh.includes('赛事百科'), '赛事百科关键词命中');
  check(!!wh && wh.includes('当地志'), '当地志板块命中');
  // 冷知识板块已按需求移除：无赛事/场地/国籍信息的卡不挂百科面板
  const plain = { id: 'x-plain', type: 'fact', title: '随便一张没赛事的卡', teaser: 't', detail: 'd' };
  check(!globalThis.__tkCardHtml(plain, 0, 1).includes('know-panel'), '无相关知识则不挂百科面板');
  // 国家网球：合成带 ioc 的卡应渲染双方母国与国旗
  const kn = {
    id: 'synthetic-ioc', type: 'history', date: '07-06', year: 2008,
    title: '费德勒 夺得 温布尔登锦标赛 冠军', teaser: 't', detail: 'd',
    players: ['Roger Federer', 'Rafael Nadal'],
    report: { prev: [2, 1], recent: [], sW: { w: 0, l: 0, t: 0 }, sL: { w: 0, l: 0, t: 0 },
      surf: '草地', ioc: ['SUI', 'ESP'] },
  };
  const kh = globalThis.__tkCardHtml(kn, 0, 1);
  check(kh.includes('国家网球') && kh.includes('🇨🇭') && kh.includes('🇪🇸'), '国家网球板块与国旗渲染');
  const KB = globalThis.window.TENNIS_KB;
  check(!!(KB && KB.cities && KB.countries && !KB.rules), '知识库结构：有当地志/国家网球，无冷知识');
  // 整体渲染（renderFeed）产出的 feed 里也应能扫到联想面板
  check(feedEl.innerHTML.includes('assoc-panel'), '全量 feed 渲染含联想面板');
} catch (e) {
  check(false, '联想冒烟测试（异常：' + e.message + '）');
}

console.log(failed === 0 ? '\n✅ 全部通过' : '\n❌ ' + failed + ' 项未通过');
process.exit(failed === 0 ? 0 : 1);