# 🎾 网球一刻 · Tennis Moments

TikTok 式的网球知识卡片流：一屏一张卡片，**上下滑切卡片，右滑看详情/答案**。
纯前端、零构建、零运行时依赖，手机竖屏与电脑横屏自适应。

> 🌐 **在线访问：<https://zcr-joler.github.io/tennis-cards/>**（手机竖屏体验更佳，无需安装任何东西）

## 内容类型

| 类型 | 说明 | 来源 |
|---|---|---|
| 📅 历史上的今天 | 按"月-日"标注的网球史事件，与当天日期吻合的卡片带「🎂 就在今天！」标记 | 手工精选 + **真实赛果生成器**（每天保底 3 张、全年 365 天覆盖） |
| 🎯 网球竞猜 | 点选作答即时判对错，右滑看解析，作答记录本地保存 | 手工精选 |
| 💡 冷知识 | 温网草莓、黄球由来、抢七起源等 | 手工精选 |
| 📰 网球新闻 | 最新报道，可"阅读原文"跳转 | **RSS 自动抓取** |

## 交互

- **上下滑动** 切换卡片，**右滑** 查看详情/答案，**左滑**返回
- 桌面键盘：`↑↓` 切卡、`→` 详情、`←` 返回、`L` 喜欢
- 右侧操作栏：上一条 / 详情 / ❤️喜欢 / ⭐收藏 / ↗分享
- 顶部筛选：全部 / 历史 / 竞猜 / 冷知识 / 新闻 / ⭐收藏
- 喜欢/收藏/作答记录存入 localStorage；卡片顺序**每次打开/刷新页面都会重新随机洗牌**

## 目录结构

```
tennis-cards/
├── index.html              # 页面骨架
├── css/style.css           # 全屏卡片、四种类型主题色、横竖屏自适应
├── js/
│   ├── content.js          # 手工卡片 + 类型定义 + 合并逻辑（入口）
│   ├── content-extra.js    # 扩充的手工卡片（竞猜/冷知识等）
│   └── app.js              # 滑动 / 竞猜 / 收藏分享逻辑
├── data/
│   ├── generated.js        # 生成的历史卡片（tools/generate.js 产出，可被覆盖）
│   └── news.js             # 新闻卡片（tools/crawler.js 产出，可被覆盖）
├── tools/
│   ├── generate.js         # 真实赛果 → “历史上的今天”生成器
│   ├── crawler.js          # RSS → 新闻卡片抓取器
│   └── test.js             # 离线回归测试（数据完整性 + 应用执行）
├── .github/workflows/      # 定时任务（自动抓新闻 + 自动重生成历史）
├── DEPLOY.md               # 上线部署指南
└── README.md
```

## 快速开始 / 生成完整数据

```bash
cd tennis-cards

# 1) 联网生成「历史上的今天」真实卡片（每天 3 张 × 365 天，约 1000+ 张）
node tools/generate.js

# 2) 抓取最新网球新闻
node tools/crawler.js

# 3) 离线回归测试
node tools/test.js

# 4) 本地预览
python -m http.server 8766   # 打开 http://127.0.0.1:8766
```

> 如果不想联网，也能直接双击 `index.html` 使用（含全部手工精选卡片，
> 只是没有真实赛果与新闻）。历史卡片数据源为 Jeff Sackmann 公开数据集（1968 年至今的 ATP/WTA 赛果）。

## 发布到互联网

✅ **已上线 GitHub Pages：<https://zcr-joler.github.io/tennis-cards/>**

部署步骤见 [DEPLOY.md](./DEPLOY.md)。配合 `.github/workflows/` 里的定时任务，
**新闻每 3 小时、历史卡片每周一自动更新**（GitHub Actions 服务器抓取，无需本机在线）。