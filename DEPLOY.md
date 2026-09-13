# 🚀 把「网球一刻」发布到互联网

这个项目是纯静态网站（一个 `index.html` + CSS/JS，无需后端），所以可以免费托管，
并且配合已写好的 GitHub Actions 定时任务，**新闻卡片会自动更新**。

---

## 方案对比

| 平台 | 价格 | 是否自动更新 | 难度 | 适合 |
|---|---|---|---|---|
| **GitHub Pages** | 免费 | ✅（每次提交自动重新部署） | 低 | 首选，与定时任务无缝衔接 |
| **Vercel** | 免费 | ✅（每次提交自动部署） | 低 | 想要自定义域名/更快体验 |
| **Netlify** | 免费 | ✅ | 低 | 同上 |
| Cloudflare Pages | 免费 | ✅ | 低 | 国内访问相对稳定 |

> 关键点：新闻抓取、历史卡片重生成都通过 GitHub Actions **提交代码回仓库**，
> 上面任一平台都会侦测到新提交并自动重新部署——**不需要你手动更新网站**。

---

## 推荐路线：GitHub Pages（全程免费）

### 第 1 步：把项目上传到 GitHub

1. 注册/登录 [github.com](https://github.com)，点右上角 **New repository**，仓库名随意（如 `tennis-cards`），选 **Public**，`Create`。
2. 上传文件（两种方式任选）：
   - **网页版（最简单）**：在仓库页面点 **Add file → Upload files**，把本目录下的
     `index.html`、`css/`、`js/`、`data/`、`tools/`、`.github/` 全部拖进去，提交。
   - **命令行**（装了 [Git](https://git-scm.com/) 的话）：
     ```bash
     cd tennis-cards
     git init
     git add .
     git commit -m "网球一刻"
     git branch -M main
     git remote add origin https://github.com/你的用户名/tennis-cards.git
     git push -u origin main
     ```

### 第 2 步：开启 Pages

1. 仓库页面 → **Settings → Pages**。
2. **Source** 选 **Deploy from a branch**，分支选 `main`，目录选 **/ (root)**，保存。
3. 等待 1~2 分钟，页面顶部会显示网址：`https://你的用户名.github.io/tennis-cards/`
   —— 这就是你的网站，全世界都能访问。

### 第 3 步：让数据自动更新

- 上传的文件里已经包含 `.github/workflows/update-news.yml` 和 `update-history.yml`。
- 第一次建议手动跑一次历史卡片生成：
  仓库 → **Actions** → 左侧 **重生成历史卡片** → **Run workflow** → Run。
  几分钟后，`data/generated.js` 会被真实赛果填满（1000+ 张"历史上的今天"卡片）。
- 之后无需任何操作：新闻每 3 小时、历史卡片每周自动更新，Pages 自动重新部署。

> 提醒：GitHub Actions 需要在仓库 **Settings → Actions → General** 中允许
> **Read and write permissions**（默认通常已开启）。

---

## 备选：Vercel / Netlify / Cloudflare Pages

1. 先把仓库推到 GitHub（同"第 1 步"）。
2. 到 vercel.com / netlify.com / pages.cloudflare.com 用 GitHub 账号登录，
   选择 **导入仓库**。
3. 构建配置：
   - **Framework Preset**：Other（无框架）
   - **Build Command**：留空（静态站点无需构建）
   - **Output Directory**：`.`（或 `/public`，指向仓库根目录）
4. Deploy，几秒钟即可上线，之后每次推送自动更新。

---

## 本地运行（可选）

```bash
cd tennis-cards
python -m http.server 8766
# 打开 http://127.0.0.1:8766
```

或直接双击 `index.html`（离线可用，但只有内置手工卡片，新闻与历史赛果需运行脚本）。

---

## 常见问题

- **看不到通用网址，只有自己能看到** → 还没开启 Pages 或用了 private 仓库（免费需 public）。
- **卡片是空的** → 手动跑一次 Actions 里的两个工作流，等它们完成后刷新。
- **想要自己的域名**（如 `www.xxx.com`）→ 各平台都支持绑定自定义域名，在 Settings 里配置，再把域名解析记录指过去即可。