'use strict';
/* ============================================================
 * 数据生成器：用真实历史赛果生成「历史上的今天」卡片
 * ------------------------------------------------------------
 * 数据源：Jeff Sackmann 的公开数据集（MIT 友好，需署名）
 *   ATP: https://github.com/JeffSackmann/tennis_atp  (atp_matches_YYYY.csv)
 *   WTA: https://github.com/JeffSackmann/tennis_wta  (wta_matches_YYYY.csv)
 *   CSV 直接链接（CDN）：https://cdn.jsdelivr.net/gh/JeffSackmann/<repo>@master/<file>
 *
 * 用法：
 *   node tools/generate.js            # 联网，下载并生成 data/generated.js
 *   node tools/generate.js --selftest # 离线，用内置样例验证选卡逻辑
 *   node tools/generate.js --out X.js # 指定输出文件
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data', 'generated.js');
const FIRST_YEAR = 1968;
const MAX_YEAR = new Date().getFullYear();
const PER_DAY = 3; // 每天保底 3 张

/* ---------- 著名球员中文名映射 ---------- */
const CN_NAME = {
  'roger federer': '费德勒', 'rafael nadal': '纳达尔', 'novak djokovic': '德约科维奇',
  'andy murray': '穆雷', 'pete sampras': '桑普拉斯', 'andre agassi': '阿加西',
  'bjorn borg': '博格', 'john mcenroe': '麦肯罗', 'jimmy connors': '康纳斯',
  'ivan lendl': '伦德尔', 'boris becker': '贝克尔', 'stefan edberg': '埃德伯格',
  'carlos alcaraz': '阿尔卡拉斯', 'jannik sinner': '辛纳', 'daniil medvedev': '梅德韦杰夫',
  'alexander zverev': '兹维列夫', 'dominic thiem': '蒂姆', 'stan wawrinka': '瓦林卡',
  'lleyton hewitt': '休伊特', 'andy roddick': '罗迪克', 'juan martin del potro': '德尔波特罗',
  'david ferrer': '费雷尔', 'juan carlos ferrero': '费雷罗', 'carlos moya': '莫亚',
  'serena williams': '小威廉姆斯', 'venus williams': '大威廉姆斯', 'steffi graf': '格拉芙',
  'martina navratilova': '纳芙拉蒂洛娃', 'chris evert': '埃弗特', 'monica seles': '塞莱斯',
  'martina hingis': '辛吉斯', 'justine henin': '海宁', 'kim clijsters': '克里斯特尔斯',
  'maria sharapova': '莎拉波娃', 'victoria azarenka': '阿扎伦卡', 'na li': '李娜', 'li na': '李娜',
  'naomi osaka': '大坂直美', 'iga swiatek': '斯瓦泰克', 'coco gauff': '高芙',
  'ashleigh barty': '巴蒂', 'aryna sabalenka': '萨巴伦卡', 'simona halep': '哈勒普',
  'angelique kerber': '科贝尔', 'petra kvitova': '科维托娃', 'garbine muguruza': '穆古鲁扎',
  'caroline wozniacki': '沃兹尼亚奇', 'ana ivanovic': '伊万诺维奇', 'amalie mauresmo': '毛瑞斯莫',
  'lindsay davenport': '达文波特', 'jennifer capriati': '卡普里亚蒂', 'zhang shuai': '张帅',
  'zheng qinwen': '郑钦文', 'wang qiang': '王蔷', 'peng shuai': '彭帅', 'yan zi': '晏紫', 'zheng jie': '郑洁',
};
function cn(name) {
  const k = String(name || '').trim().toLowerCase();
  return CN_NAME[k] || k.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* ---------- 赛事中文名映射 ---------- */
const CN_TOUR = {
  'wimbledon': '温布尔登锦标赛',
  'roland garros': '法国网球公开赛',
  'french open': '法国网球公开赛',
  'us open': '美国网球公开赛',
  'australian open': '澳大利亚网球公开赛',
  'tour finals': '年终总决赛', 'atp finals': '年终总决赛', 'wta finals': '年终总决赛',
  'olympics': '奥运会',
};
function tourName(raw) {
  const k = String(raw || '').trim().toLowerCase();
  if (CN_TOUR[k]) return CN_TOUR[k];
  let s = String(raw).trim();
  s = s.replace(/^ATP Masters 1000\s+/i, '').replace(/\s*Masters?$/i, '');
  s = s.replace(/^WTA\s+/i, '').replace(/^ATP\s+/i, '');
  if (/masters/i.test(String(raw))) s += ' 大师赛';
  return s;
}

/* ---------- 最小 CSV 解析（支持引号字段） ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------- 比赛记分（依据轮次 / 级别 / 知名球员） ---------- */
function roundScore(round) {
  const r = String(round || '').trim().toUpperCase();
  return { F: 50, SF: 25, QF: 12, R16: 6, R32: 3, R64: 1, RR: 20 }[r] ?? 0;
}
function levelScore(level, tour) {
  const k = (String(tour) + ' ' + String(level)).toLowerCase();
  if (/wimbledon|roland garros|french open|us open|australian open/.test(k)) return 100;
  if (/masters|premier|mandatory|1000/.test(k)) return 40;
  if (/olympic/.test(k)) return 30;
  if (/finals/.test(k)) return 40;
  if (/davis|fed cup|bjk|united cup|laver/.test(k)) return 12;
  if (/500/.test(k)) return 8;
  return 5; // 250 / 国际赛 / 挑战赛
}
function notable(name) {
  const k = String(name || '').trim().toLowerCase();
  return CN_NAME[k] ? 25 : 0;
}

/* ---------- 从 CSV 行转比赛对象 ---------- */
function rowToMatch(r, tour) {
  // tourney_name(1) surface(2) tourney_level(4) tourney_date(5)
  // winner_name(10) loser_name(18) score(23) round(25)
  // minutes(26) w_ace(27) l_ace(36)
  const tname = r[1] ? String(r[1]) : ' ';
  const level = r[4] ? String(r[4]) : 'A';
  const tdate = String(r[5] || '').trim();
  if (!/^\d{8}$/.test(tdate)) return null;
  const year = Number(tdate.slice(0, 4));
  const mm = tdate.slice(4, 6), dd = tdate.slice(6, 8);
  const wname = String(r[10] || '').trim();
  const lname = String(r[18] || '').trim();
  const score = String(r[23] || '').trim();
  const round = String(r[25] || '').trim();
  if (!wname || !lname) return null;
  const minutes = Number(r[26]) || 0;
  const w_ace = Number(r[27]) || 0;
  const l_ace = Number(r[36]) || 0;
  return { tour, tname, level, year, mmdd: mm + '-' + dd, wname, lname, score, round, minutes, w_ace, l_ace };
}

/* ---------- 从比分 / 统计生成精彩看点 ---------- */
function matchHighlights(m, wing) {
  const h = [];
  const s = m.score;
  if (!s) return '';
  const sets = s.split(/\s+/).filter(Boolean);

  // 用时
  if (m.minutes > 0) {
    h.push(m.minutes >= 60
      ? '⏱ 比赛用时 ' + Math.floor(m.minutes / 60) + ' 小时 ' + (m.minutes % 60) + ' 分钟'
      : '⏱ 比赛用时 ' + m.minutes + ' 分钟');
  }
  // Ace 球
  const totalAce = m.w_ace + m.l_ace;
  if (totalAce > 0) h.push('💨 全场 ' + totalAce + ' 记 Ace 球（' + wing + ' ' + m.w_ace + ' 记）');
  // 比分分析
  if (sets.length) {
    const tbSets = sets.filter((ss) => /^7-6|^6-7/.test(ss));
    if (tbSets.length) h.push('🎯 ' + tbSets.length + ' 盘通过抢七分出胜负');
    if (sets.length >= 5) h.push('🔥 五盘鏖战，精彩绝伦');
    else if (sets.length <= 3 && /F|SF/.test(m.round)) {
      const first = sets[0].split('-');
      if (first.length >= 2 && Number(first[0]) < Number(first[1])) h.push('⚡ ' + wing + ' 先失一盘后逆转');
    }
  }
  return h.join('\n');
}

/* ---------- 将比赛转为卡片 ---------- */
function matchToCard(m) {
  const wing = cn(m.wname), ling = cn(m.lname);
  const tcn = tourName(m.tname);
  const r = String(m.round).trim().toUpperCase();
  let title, teaser, detail;
  if (r === 'F') {
    title = wing + ' 夺得 ' + tcn + ' 冠军';
    teaser = m.year + ' 年，' + wing + ' 在决赛中击败 ' + ling + ' 夺冠。';
    detail = m.year + ' 年，' + wing + ' 在 ' + tcn + ' 决赛中以 ' +
      (m.score || '？') + ' 击败 ' + ling + '，捧起冠军奖杯。';
  } else if (r === 'SF') {
    title = wing + ' 挺进 ' + tcn + ' 决赛';
    teaser = m.year + ' 年，' + wing + ' 战胜 ' + ling + ' 闯入决赛。';
    detail = m.year + ' 年，' + wing + ' 在 ' + tcn + ' 半决赛中以 ' +
      (m.score || '？') + ' 力克 ' + ling + '，晋级决赛。';
  } else {
    title = wing + ' 击败 ' + ling;
    teaser = m.year + ' 年，' + wing + ' 在 ' + tcn + ' 战胜 ' + ling + '。';
    detail = m.year + ' 年，' + wing + ' 在 ' + tcn + ' 的比赛中以 ' +
      (m.score || '？') + ' 击败 ' + ling + '。';
  }
  return {
    id: 'gen-' + m.tour + '-' + m.year + m.mmdd.replace('-', '') + '-' + m.wname.toLowerCase().replace(/[^a-z]/g, ''),
    type: 'history', date: m.mmdd, year: m.year, title, teaser, detail,
    highlights: matchHighlights(m, wing),
  };
}

/* ---------- 核心选卡逻辑（可离线单测） ---------- */
function selectCards(matches) {
  // 按 MM-DD 分组，组内按"重要性"降序：级别分 > 轮次分 > 知名球员加分 > 年份
  const groups = {};
  for (const m of matches) (groups[m.mmdd] = groups[m.mmdd] || []).push(m);
  function score(m) {
    return levelScore(m.level, m.tname) + roundScore(m.round) +
      Math.max(notable(m.wname), notable(m.lname)) + Math.min(30, Math.max(0, m.year - 2000));
  }
  const days = Object.keys(groups).sort();
  const cards = [];
  for (const d of days) {
    groups[d].sort((a, b) => score(b) - score(a) || b.year - a.year);
    for (let i = 0; i < groups[d].length && i < PER_DAY; i++) cards.push(matchToCard(groups[d][i]));
  }
  return cards;
}

/* ---------- 下载单文件（带重定向） ---------- */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'tennis-cards-generator/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve(fetchText(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 80 * 1024 * 1024) { res.destroy(); reject(new Error('too large')); } });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('请求超时 ' + url)));
    req.on('error', reject);
  });
}

/* ---------- 下载并解析某仓库的年度文件 ---------- */
async function loadRepo(repo) {
  const matches = [];
  const prefix = repo === 'tennis_atp' ? 'atp' : 'wta';
  for (let y = FIRST_YEAR; y <= MAX_YEAR; y++) {
    const urls = [
      // 优先：Hugging Face 国内镜像（中国大陆可直接访问）
      `https://hf-mirror.com/datasets/Aneeshers/tennis-sackmann-archive/raw/main/${prefix}/${prefix}_matches_${y}.csv`,
      // 备用：Hugging Face 官方
      `https://huggingface.co/datasets/Aneeshers/tennis-sackmann-archive/raw/main/${prefix}/${prefix}_matches_${y}.csv`,
      // 备用：GitHub 原始仓库
      `https://raw.githubusercontent.com/JeffSackmann/${repo}/master/${prefix}_matches_${y}.csv`,
    ];
    let text = null;
    const errs = [];
    for (const url of urls) {
      try { text = await fetchText(url); break; }
      catch (e) { errs.push(e.message); }
    }
    if (text == null) { process.stderr.write('  跳过 ' + y + '：' + errs.join(' | ') + '\n'); continue; }
    const rows = parseCSV(text);
    const header = rows[0];
    if (!header || header.length < 26) continue; // 列结构不符则跳过
    const tour = repo === 'tennis_atp' ? 'atp' : 'wta';
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length < 26) continue;
      const m = rowToMatch(r, tour);
      if (m) matches.push(m);
    }
    process.stderr.write('  ' + y + ' … ' + (rows.length - 1) + ' 场\n');
  }
  return matches;
}

/* ---------- 内置样例（离线自测用） ---------- */
const FIXTURE = '' +
  'tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,score,best_of,round,minutes\n' +
  '1,Wimbledon,Grass,128,G,20080706,99,1,1,,Roger Federer,R,,,,2,2,,Rafael Nadal,L,,,,6-4 6-4 6-7(5) 6-7(8) 9-7,5,F,288\n' +
  '2,Wimbledon,Grass,128,G,20080706,80,2,2,,Rafael Nadal,L,,,,10,10,,N N,L,,,,7-6 6-4,3,SF,140\n' +
  '3,ATP Masters 1000 Miami,Hard,96,M,20100330,33,1,1,,Novak Djokovic,R,,,,3,3,,Stan Wawrinka,R,,,,6-2 6-3,3,F,75\n' +
  '4,US Open,Hard,128,G,19910908,50,9,9,,Jimmy Connors,L,,,,20,20,,X Y,R,,,,6-4 6-2,3,R32,90\n' +
  '5,Roland Garros,Clay,128,G,20110604,44,6,6,,Na Li,R,,,,7,7,,F Schiavone,R,,,,6-4 7-6(0),3,F,120\n';
function selftest() {
  const rows = parseCSV(FIXTURE).slice(1).map((r) => rowToMatch(r, 'atp')).filter(Boolean);
  const cards = selectCards(rows);
  console.log('生成卡片数：', cards.length);
  for (const c of cards) console.log('  [' + c.date + '] ' + c.title);
  const perDay = {};
  cards.forEach((c) => (perDay[c.date] = (perDay[c.date] || 0) + 1));
  console.log('每天卡片数：', JSON.stringify(perDay));
  const bad = cards.filter((c) => !c.date || !c.title || !c.detail);
  console.log(bad.length ? '有坏数据' : '全部有效');
  return bad.length === 0;
}

/* ---------- 主流程 ---------- */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) { process.exit(selftest() ? 0 : 1); }
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : OUT;

  console.log('下载并解析真实赛果（' + FIRST_YEAR + '-' + MAX_YEAR + '）…');
  console.log('  [ATP]');
  const atp = await loadRepo('tennis_atp');
  console.log('  [WTA]');
  const wta = await loadRepo('tennis_wta');
  const all = atp.concat(wta);
  console.log('共解析比赛：', all.length);

  const cards = selectCards(all);
  // 覆盖度检查：理论上应覆盖全部 366 个日期
  const days = new Set(cards.map((c) => c.date));
  const missing = [];
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 31; d++) {
      const key = String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const date = new Date(2024, m - 1, d);
      if (date.getMonth() === m - 1 && !days.has(key)) missing.push(key);
    }
  }
  console.log('覆盖日期数：', days.size, '/ 366；卡片总数：', cards.length);
  if (missing.length) console.log('⚠️ 未覆盖日期：', missing.join(', '));

  const js = '// 本文件由 tools/generate.js 自动生成（真实历史赛果）。\n' +
    '// 重新生成：node tools/generate.js\n' +
    'window.GENERATED_CARDS = ' + JSON.stringify(cards) + ';\n';
  fs.writeFileSync(out, js, 'utf8');
  console.log('已写入：', out, '(' + js.length + ' 字节)');
}

main().catch((e) => { console.error('生成失败：', e.message); process.exit(1); });