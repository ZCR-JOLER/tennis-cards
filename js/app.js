'use strict';

/* ============================================================
 * 网球一刻 · 交互逻辑
 *  - 竖向滑屏切换卡片（TikTok 式）
 *  - 卡内右滑查看详情 / 竞猜答案
 *  - 竞猜点选作答、喜欢 / 收藏 / 分享（localStorage 持久化）
 *  - 桌面键盘 ↑↓ 切换、→ 看详情、← 返回
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
function cardHtml(card, i, total) {
  const t = CARD_TYPES[card.type];
  const isToday = card.type === 'history' && card.date === todayMD();
  const isQuiz = card.type === 'quiz';
  const hintText = isQuiz ? '右滑查看答案解析' : '右滑查看完整故事';

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
  if (card.type === 'news') {
    if (card.source) detailBody += '<p class="detail-meta">📰 来源：' + esc(card.source) + '</p>';
    if (card.url) detailBody += '<a class="read-link" href="' + esc(card.url) +
      '" target="_blank" rel="noopener">🔗 阅读原文 ↗</a>';
  } else if (card.date) {
    detailBody += '<p class="detail-meta">📅 发生于 ' + (card.year ? card.year + ' 年 ' : '') + mdLabel(card.date) + '</p>';
  }
  detailBody += '<button class="back-btn" data-act="back">← 左滑或点此返回</button>';

  return '' +
    '<section class="card" data-type="' + card.type + '" data-id="' + card.id + '" data-idx="' + i + '">' +
      '<div class="hwrap">' +
        '<div class="panel main-panel"><div class="panel-inner">' +
          badges + mainBody +
          '<button class="swipe-hint" data-act="detail">' + hintText + ' <span>⟶</span></button>' +
        '</div><div class="watermark">' + t.icon + '</div></div>' +
        '<div class="panel detail-panel"><div class="panel-inner">' +
          badges +
          '<h2 class="card-title">' + esc(card.title) + '</h2>' +
          detailBody +
        '</div></div>' +
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
  observeCards();
  updateRail();
  updateProgress();
}

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
function revealDetail() {
  const el = currentCardEl();
  if (!el) return;
  const h = el.querySelector('.hwrap');
  h.scrollTo({ left: h.clientWidth, behavior: 'smooth' });
}
function backToMain(cardEl) {
  const h = (cardEl || currentCardEl())?.querySelector('.hwrap');
  if (h) h.scrollTo({ left: 0, behavior: 'smooth' });
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
$('#btn-detail').addEventListener('click', revealDetail);
$('#btn-like').addEventListener('click', toggleLike);
$('#btn-fav').addEventListener('click', toggleFav);
$('#btn-share').addEventListener('click', shareCard);

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); nav(1); }
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); nav(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); revealDetail(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); backToMain(); }
  else if (e.key === 'l' || e.key === 'L') toggleLike();
});

/* ---------------- 启动 ---------------- */
renderFeed();
