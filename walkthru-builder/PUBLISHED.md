# Walkthru 已发布讲解一览

记录 xiaopingfeng.com/buzzwords 每期必读文章（页面上带 `MUST` 标记的条目）在
`walkthru-worker`（Cloudflare Worker + R2）上当前发布的讲解版本，一个地方看全量覆盖情况。

**维护方式：** 每次用 `/walkthru-generate` skill 生成并发布新讲解后，运行
`python3 walkthru-builder/census.py 100 101` 重新核对整表并覆盖本文件——
不要手工编辑每一行，跑一遍脚本最快也最不容易漏。新一期上线后把期号加进上面命令。

**已覆盖/总数：** 26/43 条 MUST 已有讲解


## EP.100

| Pod | 标题 | URL | 已发布版本 | Hash | 备注 |
|---|---|---|---|---|---|
| pod-01 | NVIDIA | [https://developer.nvidia.com/blog/nvidia-vera-rubin-and-blackwell-set-a-new-standard-for-agentic-ai-performance-per-watt/](https://developer.nvidia.com/blog/nvidia-vera-rubin-and-blackwell-set-a-new-standard-for-agentic-ai-performance-per-watt/) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-19 | WSJ | [https://www.wsj.com/tech/ai/nvidia-poolside-open-source-ai-model-china-8f4a2b1c](https://www.wsj.com/tech/ai/nvidia-poolside-open-source-ai-model-china-8f4a2b1c) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-07 | Anthropic's best AI model struggles to attract users as cheaper tools thrive | [https://simonwillison.net/2026/Aug/23/anthropics-best-ai-model-struggles-to-attract-users-as-cheaper-t/](https://simonwillison.net/2026/Aug/23/anthropics-best-ai-model-struggles-to-attract-users-as-cheaper-t/) | 标准版（4步） | `99acd73254864f628ab7771a9df317e5ad7ee5d219426cf639c9e1df0fc19b14` |  |
| pod-02 | NVIDIA AVO 在 ARC-AGI-3 拿到 100% | [https://developer.nvidia.com/blog/nvidia-avo-reaches-100-on-arc-agi-3-demonstrating-a-frontier-level-general-purpose-architecture-for-long-horizon-autonomous-agents/](https://developer.nvidia.com/blog/nvidia-avo-reaches-100-on-arc-agi-3-demonstrating-a-frontier-level-general-purpose-architecture-for-long-horizon-autonomous-agents/) | 标准版（9步） | `488000f70daa15cfa4e7368d7c14d30763ad549a906a5a9dfc865743ee056414` |  |
| pod-12 | 转述如何抹掉厂商自己写的限定 | [https://thenewstack.io/nvidia-avo-arcagi3-benchmark/](https://thenewstack.io/nvidia-avo-arcagi3-benchmark/) | 标准版（6步） | `4072e47f8f400be6060d5bdeac97ad7a699438b1a6cf1b5b3ae683e739a09b42` |  |
| pod-06 | Agent Harness 的进化：从 Bolt-On 到注意力接口 | [https://www.latent.space/p/attention-interface](https://www.latent.space/p/attention-interface) | 标准版（8步） | `df63102a57f71f085d8b9dbe7056b2d1b805bd6c719be0b04c95c0aae862e661` |  |
| pod-04 | 27B 干翻 Opus 4.8：Inherent 的 Faraday | [https://techcrunch.com/2026/08/22/inherent-founded-by-deepmind-alumni-says-its-ai-teammate-just-outperformed-anthropic-and-openai-at-replicating-research/](https://techcrunch.com/2026/08/22/inherent-founded-by-deepmind-alumni-says-its-ai-teammate-just-outperformed-anthropic-and-openai-at-replicating-research/) | 标准版（6步） | `92ba46e363661525cff26d05b7ce00a68aebf131fbcef57b2c6e22e68be378db` |  |
| pod-23 | Simon Willison | [https://simonwillison.net/2026/Aug/22/more-than-just-code-review](https://simonwillison.net/2026/Aug/22/more-than-just-code-review) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-03 | OpenAI Is Building an AI Agent for Everything. Will Everyone Use Them? | [https://techcrunch.com/2026/08/24/openai-is-building-an-ai-agent-for-everything-will-everyone-use-them/](https://techcrunch.com/2026/08/24/openai-is-building-an-ai-agent-for-everything-will-everyone-use-them/) | 标准版（9步） | `a8a77e4504265570cf0252424c093c271d099ca8fb71fad3559c8ed847c22a72` |  |
| pod-09 | CUDA 护城河与 AgentX 基准 | [https://newsletter.semianalysis.com/p/agentx-inferencexv3-does-cuda-moat](https://newsletter.semianalysis.com/p/agentx-inferencexv3-does-cuda-moat) | 完整版（127步）; 标准版（14步） | `ef7c166428412a49e88b5394a9dde2db8a734e55b3e7f3b437aad6bc01718609` |  |
| pod-15 | 拆解 Claude 水印 | [https://magazine.sebastianraschka.com/p/claude-watermarking](https://magazine.sebastianraschka.com/p/claude-watermarking) | 标准版（5步） | `ec1dae1d3407b62bf780e54bb648e5672afb2b5d0cad6ca830c7d3de1da2319c` |  |
| pod-17 | Opus 4.6 越狱 | [https://techcrunch.com/2026/08/21/anthropics-opus-4-6-is-a-smut-machine/](https://techcrunch.com/2026/08/21/anthropics-opus-4-6-is-a-smut-machine/) | 标准版（5步） | `393f1149ee173f71ccd40ebdb3f9e810b39324ff191210a95fc1768f2baf6bb0` |  |
| pod-22 | Wired | [https://www.wired.com/story/teachers-deepfake-ai-students-content](https://www.wired.com/story/teachers-deepfake-ai-students-content) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-13 | Nicola Greco / Scaling Trust | [https://scalingtrust.org.uk/blog/physical-evals/](https://scalingtrust.org.uk/blog/physical-evals/) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-10 | Apple Mac Studio M5 Ultra | [https://www.apple.com/newsroom/2026/08/apple-introduces-new-mac-studio-with-m5-max-and-m5-ultra/](https://www.apple.com/newsroom/2026/08/apple-introduces-new-mac-studio-with-m5-max-and-m5-ultra/) | 标准版（12步） | `540b53bf706d4d7a42e3b9d9e37d377c79dd04281605981daf88ead177b619fe` |  |
| pod-11 | Science/AAAS | [https://www.science.org/content/article/trump-adviser-s-golden-age-report-u-s-science-missed-opportunity-critics-say](https://www.science.org/content/article/trump-adviser-s-golden-age-report-u-s-science-missed-opportunity-critics-say) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-16 | Learning more about Claude's mathematical capabilities | [https://www.anthropic.com/research/riemann-zeta](https://www.anthropic.com/research/riemann-zeta) | 标准版（6步） | `ad55208f067fb11b6a5111108985a5320d57cdf7f058b9cba3d038f59d765fab` |  |
| pod-14 | Oracle 问题：一个看不见的瓶颈 | [https://www.a16z.news/p/the-oracle-problem-an-invisible-bottleneck](https://www.a16z.news/p/the-oracle-problem-an-invisible-bottleneck) | 标准版（6步） | `97d54be3e81b24f14eada3949b5ceb825a0ec9cec89ac86085d5d6947377a1e2` |  |
| pod-18 | 追踪报道 | [https://simonwillison.net/2026/Aug/17/we-tracked-a-shipment-of-rare-books-it-ended-at-an-amazon-ai-tra](https://simonwillison.net/2026/Aug/17/we-tracked-a-shipment-of-rare-books-it-ended-at-an-amazon-ai-tra) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |

## EP.101

| Pod | 标题 | URL | 已发布版本 | Hash | 备注 |
|---|---|---|---|---|---|
| pod-01 | Our decision on Cursor following its acquisition by SpaceX | [https://openai.com/index/our-decision-on-cursor-following-its-acquisition-by-spacex/](https://openai.com/index/our-decision-on-cursor-following-its-acquisition-by-spacex/) | 标准版（4步） | `dacd64b8ccca0019547eca52c2edc95f6ffa63032b3f55d947138914baab70c0` |  |
| pod-02 | N.D. Cal. 3:26-cv-01996判决书 | [https://storage.courtlistener.com/recap/gov.uscourts.cand.465515/gov.uscourts.cand.465515.250.0_1.pdf](https://storage.courtlistener.com/recap/gov.uscourts.cand.465515/gov.uscourts.cand.465515.250.0_1.pdf) | — | `` | 原始 PDF/法律文书，非文章型信源 |
| pod-03 | 国防部官方·Grok for Government | [https://www.war.gov/News/Releases/Release/Article/4586482/department-of-war-launches-starshield-ais-grok-for-government-on-genaimil/](https://www.war.gov/News/Releases/Release/Article/4586482/department-of-war-launches-starshield-ais-grok-for-government-on-genaimil/) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-21 | NVIDIA to Acquire Hugging Face | [https://blogs.nvidia.com/blog/nvidia-to-acquire-hugging-face/](https://blogs.nvidia.com/blog/nvidia-to-acquire-hugging-face/) | 标准版（8步） | `ea981681c9e20cb5e31f71261f5de99273404e017bf4d043f6cc7f9fa1a5d533` |  |
| pod-04 | Nvidia官方 | [https://nvidianews.nvidia.com/news/nvidia-and-mediatek-deepen-long-standing-partnership-to-build-ai-edge-to-cloud-computing-platforms](https://nvidianews.nvidia.com/news/nvidia-and-mediatek-deepen-long-standing-partnership-to-build-ai-edge-to-cloud-computing-platforms) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-05 | Cloudflare推出BotBase | [https://blog.cloudflare.com/botbase-for-operators/](https://blog.cloudflare.com/botbase-for-operators/) | 标准版（4步） | `aceed5f29630c723f7abb15c8cccc6bfe3c3e07e294c30f52a0960b1315ed03d` |  |
| pod-06 | 起诉书原文（N.D. Cal. 5:26-cv-09217） | [https://www.musicbusinessworldwide.com/files/2026/08/COMPLAINT-in-Sony_Music_Publishing_US_LLC_e.pdf](https://www.musicbusinessworldwide.com/files/2026/08/COMPLAINT-in-Sony_Music_Publishing_US_LLC_e.pdf) | — | `` | 原始 PDF/法律文书，非文章型信源 |
| pod-07 | Anthropic员工聊天记录曝光 | [https://arstechnica.com/tech-policy/2026/08/zlibrary-my-beloved-anthropic-staff-chats-extolling-piracy-cited-in-sony-suit/](https://arstechnica.com/tech-policy/2026/08/zlibrary-my-beloved-anthropic-staff-chats-extolling-piracy-cited-in-sony-suit/) | 标准版（3步） | `4c2a16cfb43fc0066859c719f0fc54b2b45219dbe6989649f6c982fbce10db82` |  |
| pod-22 | 美国政府意见陈述原文（S.D.N.Y. 1:25-cv-03483） | [https://storage.courtlistener.com/recap/gov.uscourts.nysd.640396/gov.uscourts.nysd.640396.1682.0.pdf](https://storage.courtlistener.com/recap/gov.uscourts.nysd.640396/gov.uscourts.nysd.640396.1682.0.pdf) | — | `` | 原始 PDF/法律文书，非文章型信源 |
| pod-08 | 众议院情报委员会报告原文 | [https://intelligence.house.gov/wp-content/uploads/2026/09/HPSCI-Final-9.11-Report.pdf](https://intelligence.house.gov/wp-content/uploads/2026/09/HPSCI-Final-9.11-Report.pdf) | — | `` | 原始 PDF/法律文书，非文章型信源 |
| pod-09 | FSB主席致G20信函原文 | [https://www.fsb.org/uploads/P310826.pdf](https://www.fsb.org/uploads/P310826.pdf) | — | `` | 原始 PDF/法律文书，非文章型信源 |
| pod-10 | Reuters via Mississippi Today | [https://www.reuters.com/legal/government/mississippi-asks-appeals-court-reassign-judge-over-error-plagued-ai-assisted-2026-08-31/](https://www.reuters.com/legal/government/mississippi-asks-appeals-court-reassign-judge-over-error-plagued-ai-assisted-2026-08-31/) | — | `` | 未生成，可直接跑 `/walkthru-generate <url>` 补上 |
| pod-11 | Automated researchers can reliably mitigate alignment failures | [https://www.anthropic.com/research/automated-researchers-mitigate-alignment-failures](https://www.anthropic.com/research/automated-researchers-mitigate-alignment-failures) | 标准版（6步） | `a9acbff7bd542e61d9b002a8a6953c6aff454e0828d8b4046987b9ef5f24292c` |  |
| pod-13 | SKILL.state让Agent单项基准token消耗降约16倍 | [https://arxiv.org/abs/2608.26263](https://arxiv.org/abs/2608.26263) | 标准版（5步） | `ce10c44d91892bc28211185996ce6e9250d2723c2de603ebcc069ee686df7112` |  |
| pod-14 | Mixture-of-Recursions：循环Transformer的地基论文 | [https://arxiv.org/abs/2507.10524](https://arxiv.org/abs/2507.10524) | 标准版（6步） | `9e09ba6ac93ca82e169a1cd3c4a4b2b34cb6b631250a74458d5c9c4f64b8bf1a` |  |
| pod-15 | @bshlgrs | [https://x.com/bshlgrs/status/2094990313513439464](https://x.com/bshlgrs/status/2094990313513439464) | — | `` | 社交媒体帖，非文章型信源 |
| pod-25 | GPT-6 Astra: A new generation of intelligence | [https://openai.com/index/gpt-6-astra/](https://openai.com/index/gpt-6-astra/) | 标准版（9步） | `ea74e2fffbc502106773e8514634f3129a7fc89f2078d668db2a5ce486ea4510` |  |
| pod-18 | OpenClaw 2.0发布 | [https://openclaw.ai/blog/openclaw-2-accidentally](https://openclaw.ai/blog/openclaw-2-accidentally) | 标准版（7步） | `2d1b66aa667332ad5f546f30011dd6d30eb65a371791bb2b2261735871a394fc` |  |
| pod-19 | OpenClaw漏洞链 | [https://www.oasis.security/blog/openclaw-vulnerability](https://www.oasis.security/blog/openclaw-vulnerability) | 标准版（5步） | `20fe6bc31450b5b8f194df43fce6e1f46d25969e1f9b7e8b15fe2a5a356ed7b0` |  |
| pod-16 | 三星存算一体架构技术拆解 | [https://chipsandcheese.com/p/hot-chips-2026-samsungs-processing](https://chipsandcheese.com/p/hot-chips-2026-samsungs-processing) | 标准版（8步） | `6c66c63ff1adf27b93d45699f134cb7d8bd8412e9ed3fab93b2d869b5b8ba26b` |  |
| pod-17 | SLB收购Kelvion | [https://www.slb.com/newsroom/press-release/2026/pr-2026-0831](https://www.slb.com/newsroom/press-release/2026/pr-2026-0831) | 标准版（8步） | `d74f73ea51f2b0e16384b1ba51fc19374fd21e799a4d8203d874b372e760f6f4` |  |
| pod-23 | Google发布Gemini 3.8 Flash/Cyber | [https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/](https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/) | 标准版（7步） | `1e5b8618d900b42a6d0b1d1d120a68d5a6363388e52c74af5ad67348ab1581c0` |  |
| pod-24 | World Labs发布Atlas：能生成像素级相机控制视频、并重建3D场景的世界模型 | [https://x.com/theworldlabs/status/2094839756329041984](https://x.com/theworldlabs/status/2094839756329041984) | — | `` | 社交媒体帖，非文章型信源 |
| pod-20 | AI agent群自主攻破Hugging Face生产集群 | [https://newsletter.semianalysis.com/p/most-neoclouds-suck-at-security#the-openai-vs-huggingface-security-incident](https://newsletter.semianalysis.com/p/most-neoclouds-suck-at-security#the-openai-vs-huggingface-security-incident) | 标准版（6步） | `bf4039a0342d37545e9459a2e621526b64daa6a0f8f97af6c11e9e26ecd47d1a` |  |
