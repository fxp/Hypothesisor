# Hypothesisor

让 AI 为你读懂网页。三个 Chrome 扩展，同一套抽文本/引用校验内核：

- **Hypothesisor**（`chrome-extension/`）—— 生成标注，一键发布到 [Hypothesis](https://web.hypothes.is/)
- **Reframe**（`chrome-extension-reformat/`）—— 把网页重排成聚焦的交互式 Web App
- **Walkthru**（`chrome-extension-walkthru/`）—— 按顺序划出关键片段，逐段自动滚动 + 讲解卡片，像有人带你读完这篇文章

→ **落地页：** https://fxp.github.io/Hypothesisor/

## 仓库结构

```
chrome-extension/            Hypothesisor（标注）Chrome MV3 扩展源码
chrome-extension-reformat/   Reframe（重排版）Chrome MV3 扩展源码
chrome-extension-walkthru/   Walkthru（领读）Chrome MV3 扩展源码——纯读者客户端，不生成/不导入
walkthru-worker/             Walkthru 的查询后端（Cloudflare Worker，只读，从 raw.githubusercontent.com 读 packs/）
  └ packs/                    已发布的领读包 JSON——内容本身就是 git 版本历史，改动直接走 commit/diff/revert
walkthru-builder/            Walkthru 的离线生成 CLI（插件的生成能力搬到这里了）
  ├ PUBLISHED.md              已发布讲解一览——每期必读文章 URL 对应哪些版本，跑 census.py 重新核对
  └ census.py                 重新核对 PUBLISHED.md 的脚本（不要手工改表）
walkthru-admin/              Walkthru 的本地生成/编辑后台（网页版，包了 build.mjs 和 git commit/push，仅 127.0.0.1）
docs/                        GitHub Pages 落地页
idea.md                      最初的点子
```

## 快速开始

1. 克隆仓库：`git clone https://github.com/fxp/Hypothesisor.git`
2. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `chrome-extension/`
3. 点扩展图标 → ⚙ → 填入 [Hypothesis Token](https://hypothes.is/account/developer) 和 [BigModel API Key](https://open.bigmodel.cn/usercenter/apikeys)
4. 在任意网页点图标 → 选模式/风格 → 生成 → 勾选 → 发布

详见 [chrome-extension/README.md](chrome-extension/README.md)。

## License

MIT
