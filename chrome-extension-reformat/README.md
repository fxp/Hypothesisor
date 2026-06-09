# Hypothesisor Chrome 扩展

把 `hypothesis-annotator` skill 做成 Chrome 扩展：读当前标签页正文 → GLM 生成标注 → 一键发布到 Hypothesis。

## 安装（load unpacked）

1. `chrome://extensions` → 打开右上角「开发者模式」
2. 点「加载已解压的扩展程序」→ 选择这个 `chrome-extension/` 目录
3. 首次使用前点扩展图标 → ⚙ → 填入两个必填 key：
   - **Hypothesis Token**：到 [hypothes.is/account/developer](https://hypothes.is/account/developer) 生成
   - **BigModel API Key**：到 [open.bigmodel.cn/usercenter/apikeys](https://open.bigmodel.cn/usercenter/apikeys) 申请（用 glm-4-plus 模型）

## 使用

1. 在任意网页上点工具栏的 Hypothesisor 图标
2. 选 mode（通用/学术/新闻/技术）+ style（预置 6 种或自定义描述）
3. 点「生成标注」→ 等 GLM 返回（自动按正文长度调节深度：3~40 条）
4. 勾选想发布的条目 → 点「发布选中」

灰色条目 = 引用未在当前页面正文中找到（模型改写过原文，已跳过）。

## 架构

```
manifest.json    # MV3 声明
popup.html/js/css  # 主界面
options.html/js    # Token 设置
lib/agent.js       # 核心逻辑：抽文本 / 调 GLM / 验引用 / POST Hypothesis
```

- 正文抽取：`chrome.scripting.executeScript` + `article/main/[role=main]` → `innerText`
- API：BigModel GLM + Hypothesis，均直连，无后端
- 存储：`chrome.storage.local`（Token 只在本机）
- 深度自适应：与 Python 版一致（短文 3-5 / 长文 12-18 / 超长 25-40）

## 已知限制

- 动态渲染页面需等正文加载完再点扩展（脚本抓的是 DOM 当前态）
- 登录墙/付费墙内容，扩展能看到什么就发什么
