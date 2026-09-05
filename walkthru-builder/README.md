# walkthru-builder

离线构建 Walkthru 领读包的命令行工具。没有依赖，纯 Node，跟 `chrome-extension-walkthru/` 完全解耦——插件本身不再生成任何内容，只读取、播放已发布的领读包。

## 用法

1. 拿到正文纯文本（比如从网页里手动复制，或者用其他工具抓取），存成一个 `.txt` 文件
2. 在自己的终端里 `export` 好 API Key（不要作为命令行参数传，会留在 shell 历史里）：
   ```bash
   export BIGMODEL_API_KEY=你的key
   ```
3. 运行：
   ```bash
   node build.mjs \
     --url https://example.com/article \
     --title "文章标题" \
     --text-file ./article.txt \
     --author "你的名字"
   ```
4. 生成的文件会写到 `./out/<hash>-<variant>.json`，脚本最后会打印一行现成的 `wrangler r2 object put` 命令，复制粘贴执行即可发布

## 参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--url` | 必填 | 文章的 canonical URL（决定发布后的哈希路径） |
| `--text-file` | 必填 | 正文纯文本文件路径 |
| `--title` | 空 | 文章标题 |
| `--author` | 空 | 发布署名 |
| `--variant` | `default` | 同一篇文章可以发布多份不同风格/复杂度的领读，用这个区分 |
| `--variant-label` | 等于 variant（default 显示"标准版"） | 弹窗里展示的版本标签 |
| `--model` | `glm-4-plus` | 模型名 |
| `--base-url` | BigModel 官方地址 | OpenAI 兼容的 base URL，换成 DeepSeek/OpenRouter 等只需要改这个 |
| `--key-env` | `BIGMODEL_API_KEY` | 从哪个环境变量读 Key |
| `--lang` | `zh` | 生成语言：`zh`/`en`/`bilingual`/`auto`（跟随原文） |
| `--worker` | 已部署的 Worker 地址 | 用来查询这个 URL+variant 当前发布到第几个版本，自动 +1 |
| `--out` | `./out` | 输出目录 |

## 版本管理

每份包带 `contentVersion`（整数，从 1 开始）和 `publishedAt`（生成时间）。运行前会先问 Worker 这个 `id`（`<hash>-<variant>`）当前发布到第几版，自动 +1——不需要自己手动记版本号，重新生成同一个 URL+variant 就是下一版，`wrangler r2 object put` 会直接覆盖旧文件。

## 版本历史/prompt 逻辑

这里的 system prompt、字数预算、语言判断逻辑跟 `chrome-extension-walkthru/lib/walkthrough.js` 曾经的版本是同一套——插件那边已经把生成能力整个移除了，这里是唯一还在维护它的地方。改 prompt 只需要改这一个文件。
