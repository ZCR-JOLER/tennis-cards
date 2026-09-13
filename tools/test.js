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
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// 注：Node 18+ 已有只读全局 navigator，无需覆盖
global.IntersectionObserver = class { observe() {} disconnect() {} };
global.document = {
  querySelector(s) { return s === '#feed' ? feedEl : makeEl(); },
  querySelectorAll() { return []; }, addEventListener() {}, createElement(t) { return makeEl(t); },
};

function evalGlobal(file) { (0, eval)(fs.readFileSync(file, 'utf8')); }

/* ---------- 执行 ---------- */
let failed = 0;
function check(cond, msg) { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failed++; }

try {
  evalGlobal(path.join(ROOT, 'js', 'content-extra.js'));
  evalGlobal(path.join(ROOT, 'js', 'content.js'));
  evalGlobal(path.join(ROOT, 'js', 'app.js'));
  console.log('脚本执行：OK');
} catch (e) {
  console.log('脚本执行：FAIL → ' + e.message);
  process.exit(1);
}

const { CARDS, TYPES } = global.window.CONTENT;
console.log('卡片总数：', CARDS.length);

const byType = {};
const ids = new Set();
let dup = 0, quizBad = 0, fieldBad = 0, dateBad = 0, newsBad = 0;
for (const c of CARDS) {
  byType[c.type] = (byType[c.type] || 0) + 1;
  if (ids.has(c.id)) dup++; ids.add(c.id);
  if (!TYPES[c.type]) fieldBad++;
  if (!c.title || !c.detail || !c.teaser) fieldBad++;
  if (c.type === 'quiz' && (!Array.isArray(c.options) || c.options.length !== 4 || typeof c.answer !== 'number' || c.answer < 0 || c.answer > 3)) quizBad++;
  if (c.type === 'history' && (!/^\d{2}-\d{2}$/.test(c.date || '') || !c.year)) dateBad++;
  if (c.type === 'news' && (!c.url || !c.source)) newsBad++;
}
console.log('类型分布：', JSON.stringify(byType));
check(ids.size === CARDS.length, 'ID 无重复（' + ids.size + '/' + CARDS.length + '）');
check(fieldBad === 0, '字段完整（title/teaser/detail）');
check(quizBad === 0, '竞猜选项与答案合法');
check(dateBad === 0, '历史卡片日期/年份格式正确');
check(newsBad === 0, '新闻卡片含 url 与 source');

console.log(failed === 0 ? '\n✅ 全部通过' : '\n❌ ' + failed + ' 项未通过');
process.exit(failed === 0 ? 0 : 1);