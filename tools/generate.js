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
 *   node tools/generate.js            # 生成 data/generated.js（历史年份走 .cache 本地缓存，仅当年重新下载）
 *   node tools/generate.js --refresh  # 忽略缓存，重新下载全部年份
 *   node tools/generate.js --refresh-year 2024  # 只重新下载某一年
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

/* ---------- 本地缓存：历史年份数据不变，下载一次永久复用 ---------- */
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const FLAGS = process.argv.slice(2);
function cachePath(prefix, y) {
  return path.join(CACHE_DIR, prefix, prefix + '_matches_' + y + '.csv');
}
function shouldFetch(y) {
  if (FLAGS.includes('--refresh')) return true;            // 强制全部重新下载
  if (y >= MAX_YEAR) return true;                          // 今年数据持续更新
  const i = FLAGS.indexOf('--refresh-year');              // 单独刷新某一年
  return i >= 0 && Number(FLAGS[i + 1]) === y;
}

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
  // 扩展字段：场地(2) 种子(8/16) 入场身份(9/17) 年龄(14/22) 排名(45/47)
  const pInt = (v) => { const s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null; };
  return { tour, tname, level, year, mmdd: mm + '-' + dd, wname, lname, score, round, minutes, w_ace, l_ace,
    surf: String(r[2] || '').trim(),
    wseed: pInt(r[8]), lseed: pInt(r[16]),
    went: String(r[9] || '').trim().toUpperCase(), lent: String(r[17] || '').trim().toUpperCase(),
    wage: pInt(Math.floor(Number(r[14]) || 0) || ''), lage: pInt(Math.floor(Number(r[22]) || 0) || ''),
    wr: pInt(r[45]), lr: pInt(r[47]) };
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

/* ---------- 球员名规范化 / 交手配对键 ---------- */
function normP(tour, name) {
  return tour + '|' + String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}
function pairKey(tour, a, b) {
  const x = normP(tour, a), y = normP(tour, b);
  return x <= y ? x + '||' + y : y + '||' + x;
}
const ROUND_CN = {
  F: '决赛', SF: '半决赛', DF: '季军赛', QF: '1/4 决赛', R16: '1/8 决赛', R32: '1/16 决赛',
  R64: '1/32 决赛', R128: '1/64 决赛', R256: '1/128 决赛', RR: '小组赛',
};
function roundCn(r) { const k = String(r).trim().toUpperCase(); return ROUND_CN[k] || k; }
const SURF_CN = { grass: '草地', clay: '红土', hard: '硬地', carpet: '地毯' };
function surfCn(s) { return SURF_CN[String(s || '').trim().toLowerCase()] || ''; }
function tourneyKey(name) { return String(name || '').trim().toLowerCase(); }

/* ---------- 全量比赛索引（头对头 / 赛季战绩 / 冠军数） ---------- */
function buildIndexes(matches) {
  const meetings = new Map(), log = new Map(), titles = new Map();
  const push = (map, key, val) => { let a = map.get(key); if (!a) map.set(key, a = []); a.push(val); };
  for (const m of matches) {
    m.dint = Number(String(m.year) + m.mmdd.replace('-', '')); // YYYYMMDD 整数，用于时间先后
    const wk = normP(m.tour, m.wname), lk = normP(m.tour, m.lname);
    push(meetings, pairKey(m.tour, m.wname, m.lname),
      { d: m.dint, wid: wk, year: m.year, round: m.round, score: m.score, tname: m.tname });
    push(log, wk, { d: m.dint, w: 1, year: m.year });
    push(log, lk, { d: m.dint, w: 0, year: m.year });
    if (String(m.round).trim().toUpperCase() === 'F')
      push(titles, wk, { d: m.dint, year: m.year, tk: tourneyKey(m.tname), g: String(m.level).trim().toUpperCase() === 'G' });
  }
  const byDate = (a, b) => a.d - b.d;
  for (const a of meetings.values()) a.sort(byDate);
  for (const a of log.values()) a.sort(byDate);
  for (const a of titles.values()) a.sort(byDate);
  return { meetings, log, titles };
}

/* ---------- 本场战报：头对头 + 当年战绩 + 背景信息 ---------- */
function cardReport(idx, m) {
  const wk = normP(m.tour, m.wname), lk = normP(m.tour, m.lname);
  const arr = idx.meetings.get(pairKey(m.tour, m.wname, m.lname)) || [];
  let pw = 0, pl = 0;
  const hist = [];
  for (const e of arr) {
    if (e.d >= m.dint) break;               // 只统计本届赛事开始之前的交手
    if (e.wid === wk) pw++; else pl++;
    hist.push(e);
  }
  const season = (pk) => {
    let w = 0, l = 0, t = 0;
    for (const e of (idx.log.get(pk) || [])) { if (e.d >= m.dint) break; if (e.year === m.year) { if (e.w) w++; else l++; } }
    for (const e of (idx.titles.get(pk) || [])) { if (e.d >= m.dint) break; if (e.year === m.year) t++; }
    return { w, l, t };
  };
  const isFinal = String(m.round).trim().toUpperCase() === 'F';
  const isMajor = isFinal && String(m.level).trim().toUpperCase() === 'G';
  const tk = tourneyKey(m.tname);
  const cntHere = (pk) => { let c = 0; for (const e of (idx.titles.get(pk) || [])) { if (e.d >= m.dint) break; if (e.tk === tk) c++; } return c; };
  const cntMajor = (pk) => { let c = 0; for (const e of (idx.titles.get(pk) || [])) { if (e.d >= m.dint) break; if (e.g) c++; } return c; };
  const form = (pk) => {
    const out = [];
    for (const e of (idx.log.get(pk) || [])) { if (e.d >= m.dint) break; out.push(e.w ? 'W' : 'L'); if (out.length > 5) out.shift(); }
    return out.join('');
  };
  const career = (pk) => {
    let w = 0, l = 0;
    for (const e of (idx.log.get(pk) || [])) { if (e.d >= m.dint) break; if (e.w) w++; else l++; }
    return { w, l };
  };
  return {
    prev: [pw, pl],  // 赛前交手 [本卡胜者赢, 对手赢]
    recent: hist.slice(-3).reverse().map((e) => ({
      y: e.year, ev: tourName(e.tname), r: roundCn(e.round),
      win: cn(e.wid.split('|')[1]), s: e.score || '',
    })),
    sW: season(wk), sL: season(lk),
    rnd: roundCn(m.round), surf: surfCn(m.surf),
    wr: m.wr, lr: m.lr,                     // 赛前世界排名
    ws: m.wseed, ls: m.lseed, we: m.went, le: m.lent,  // 种子与入场身份
    wa: m.wage, la: m.lage,                 // 年龄（岁）
    tt: [cntHere(wk), cntHere(lk)],         // 赛前在本赛事夺冠次数
    maj: [cntMajor(wk), cntMajor(lk)],      // 赛前生涯大满贯数
    form: [form(wk), form(lk)],             // 赛前近五场 W/L
    career: [career(wk), career(lk)],       // 赛前生涯总战绩
    final: isFinal, major: isMajor,
  };
}

/* ---------- 将比赛转为卡片 ---------- */
function matchToCard(m, idx) {
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
    players: [wing, ling],
    report: idx ? cardReport(idx, m) : null,
  };
}

/* ---------- 核心选卡逻辑（可离线单测） ---------- */
function selectCards(matches) {
  const idx = buildIndexes(matches);
  // 按 MM-DD 分组，组内按"重要性"降序：级别分 > 轮次分 > 知名球员加分 > 年份
  const groups = {};
  for (const m of matches) (groups[m.mmdd] = groups[m.mmdd] || []).push(m);
  function score(m) {
    return levelScore(m.level, m.tname) + roundScore(m.round) +
      Math.max(notable(m.wname), notable(m.lname)) + Math.min(30, Math.max(0, m.year - 2000));
  }
  const days = Object.keys(groups).sort();
  const cards = [];
  const usedIds = new Map();
  for (const d of days) {
    groups[d].sort((a, b) => score(b) - score(a) || b.year - a.year);
    for (let i = 0; i < groups[d].length && i < PER_DAY; i++) {
      const card = matchToCard(groups[d][i], idx);
      // 同一球员同一赛事多场会撞 ID，追加序号去重
      const n = (usedIds.get(card.id) || 0) + 1;
      usedIds.set(card.id, n);
      if (n > 1) card.id += '-' + n;
      cards.push(card);
    }
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
    const cp = cachePath(prefix, y);
    let cached = false;
    if (!shouldFetch(y) && fs.existsSync(cp)) {
      text = fs.readFileSync(cp, 'utf8');
      cached = true;
    } else {
      const errs = [];
      for (const url of urls) {
        try { text = await fetchText(url); break; }
        catch (e) { errs.push(e.message); }
      }
      if (text == null && fs.existsSync(cp)) {          // 网络失败回退缓存
        text = fs.readFileSync(cp, 'utf8'); cached = true;
        process.stderr.write('  ' + y + ' … 下载失败，改用缓存\n');
      }
      if (text != null) {                               // 成功后写入缓存
        try {
          fs.mkdirSync(path.dirname(cp), { recursive: true });
          fs.writeFileSync(cp, text, 'utf8');
        } catch (e) { /* 只读环境下跳过缓存写入 */ }
      }
    }
    if (text == null) { process.stderr.write('  跳过 ' + y + '（无缓存且下载失败）\n'); continue; }
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
    process.stderr.write('  ' + y + ' … ' + (rows.length - 1) + ' 场' + (cached ? '（缓存）' : '') + '\n');
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
  '5,Roland Garros,Clay,128,G,20110604,44,6,6,,Na Li,R,,,,7,7,,F Schiavone,R,,,,6-4 7-6(0),3,F,120\n' +
  '6,Wimbledon,Grass,128,G,20060626,99,1,1,,Roger Federer,R,,,,2,2,,Rafael Nadal,L,,,,6-3 6-1 6-4,5,F,114\n' +
  '7,Roland Garros,Clay,128,G,20070527,99,2,2,,Rafael Nadal,L,,,,1,1,,Roger Federer,R,,,,6-3 4-6 6-3 6-4,5,F,153\n' +
  '8,Wimbledon,Grass,128,G,20070625,99,1,1,,Roger Federer,R,,,,2,2,,Rafael Nadal,L,,,,7-6(7) 4-6 7-6(3) 2-6 6-2,5,F,207\n' +
  '9,Wimbledon,Grass,128,G,20070625,60,1,1,,Roger Federer,R,,,,5,5,,David Nalbandian,L,,,,6-4 6-3,3,R16,88\n' +
  '10,ATP Masters 1000 Miami,Hard,96,M,20160502,5,7,7,,Roberto Bautista Agut,R,,,,24,24,,Novak Djokovic,R,,,,6-2 6-3,3,F,80,,,,,,,,,,,,,,,,,,,35,,2\n';
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

  // ---------- 战报断言（样例中 2006 温网 / 2007 法网 / 2007 温网 三场费纳决） ----------
  let pass = bad.length === 0;
  const R = (cond, name) => { console.log((cond ? '  ✔ ' : '  ✘ ') + name); if (!cond) pass = false; };
  const find = (y, key) => cards.find((c) => c.year === y && c.title.indexOf(key) >= 0);
  const c08 = find(2008, '夺得');
  const c07rg = find(2007, '夺得 法国网球公开赛');
  const c07w = find(2007, '夺得 温布尔登');
  R(cards.every((c) => c.report), '所有卡片都带战报');
  R(c08 && c08.report.prev[0] === 2 && c08.report.prev[1] === 1 && c08.report.recent.length === 3,
    '2008 决赛：赛前交手 2-1，含近 3 次明细');
  R(c07rg && c07rg.report.prev[0] === 0 && c07rg.report.prev[1] === 1,
    '2007 法网（纳达尔胜）：赛前交手 0-1');
  R(c07w && c07w.report.prev[0] === 1 && c07w.report.prev[1] === 1,
    '2007 温网（费德勒胜）：赛前交手 1-1');
  R(c07w && c07w.report.sW.w === 0 && c07w.report.sW.l === 1,
    '2007 温网：费德勒赛季（该赛前）0 胜 1 负——即法网决赛负');
  R(c07w && c07w.report.recent.length === 2, '2007 温网：近 2 次交手明细');
  // ID 去重：2007 温网费德勒两轮同基础 ID，应出现 -2 后缀且整体无重复
  const idset = new Set(cards.map((c) => c.id));
  R(idset.size === cards.length, 'ID 去重后全量唯一');
  R(cards.some((c) => /-2$/.test(c.id)), '同球员同赛事多场触发 -2 后缀');
  // 扩展背景字段
  R(c08 && c08.report.tt[0] === 2 && c08.report.maj[0] === 2 && c08.report.final && c08.report.major,
    '2008 温网：此前 2 次在此夺冠、2 座大满贯，识别为大满贯决赛');
  const c16 = find(2016, 'Miami');
  R(c16 && c16.report.wr === 35 && c16.report.lr === 2 && c16.report.surf === '硬地',
    '2016 Miami：赛前排名 35 vs 2 抓取正确（爆冷素材）');
  R(c07w && c07w.report.form[0] === 'WL', '2007 温网：费德勒赛前近况 WL');
  return pass;
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
  // 数据自检：ID 唯一 + 战报字段形状
  {
    const seen = new Set();
    for (const c of cards) { if (!seen.add(c.id)) throw new Error('存在重复 ID: ' + c.id); }
    const bad = cards.filter((c) => !c.report || !Array.isArray(c.report.prev) || c.report.prev.length !== 2 ||
      !Array.isArray(c.report.recent) || c.report.recent.length > 3 || !c.report.sW || !c.report.sL);
    if (bad.length) throw new Error('战报字段异常: ' + (bad[0] && bad[0].id));
    console.log('✔ ID 唯一性与战报字段自检通过（' + cards.length + ' 张）');
  }
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