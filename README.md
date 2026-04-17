# Hypothesisor

让 AI 为你读懂网页，一键标注到 [Hypothesis](https://web.hypothes.is/)。

→ **落地页：** https://fxp.github.io/Hypothesisor/

## 仓库结构

```
chrome-extension/   Chrome MV3 扩展源码（主要交付物）
docs/               GitHub Pages 落地页
idea.md             最初的点子
```

## 快速开始

1. 克隆仓库：`git clone https://github.com/fxp/Hypothesisor.git`
2. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `chrome-extension/`
3. 点扩展图标 → ⚙ → 填入 [Hypothesis Token](https://hypothes.is/account/developer) 和 [BigModel API Key](https://open.bigmodel.cn/usercenter/apikeys)
4. 在任意网页点图标 → 选模式/风格 → 生成 → 勾选 → 发布

详见 [chrome-extension/README.md](chrome-extension/README.md)。

## License

MIT
