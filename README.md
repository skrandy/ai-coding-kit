# ai-coding-kit

一份 config、一个 skills 仓库（独立 git），通吃三个 AI coding 引擎：**Claude Code / Codex / ZCode**。

## 快速开始

```bash
bun install            # 无依赖，其实可跳过
ai-kit init            # 生成 ~/.ai-kit/config.json（或用仓库内 config.json）
# 编辑 config.json：填 baseUrl / model / apiKeyEnv
export AI_KIT_API_KEY=sk-xxx
ai-kit install         # 安装 claude / codex（zcode 走客户端）
ai-kit apply           # 写入 LLM 配置 + 自动把 skills 链进各引擎
ai-kit use codex       # 直接切换默认引擎
ai-kit start           # 交互菜单选引擎：选谁谁就变成新默认；回车 = 直接跑当前默认
ai-kit start claude    # 跳过菜单直接启动指定引擎
```

## config.json

配置在 `~/.ai-kit/config.json`（点开头目录 + `.gitignore` 双保险，key 不会进 git），**key 直接写在文件里，不用环境变量**。

公用的抽出来，baseUrl 按协议分两份，模型跟着引擎走（只有 Claude Code 有主+小双模型）：

```json
{
  "defaultEngine": "claude",
  "skillsDir": "~/Documents/你的skills仓库",
  "apiKey": "sk-xxx",
  "anthropic": { "baseUrl": "https://你的anthropic兼容地址" },
  "openai": { "baseUrl": "https://你的openai兼容地址" },
  "claude": { "model": "claude-sonnet-4-5", "smallModel": "claude-haiku-4-5" },
  "codex": { "model": "gpt-5-codex" },
  "zcode": { "model": "glm-4.7" }
}
```

- `apiKey` 公用，一份 key 三引擎共用
- `anthropic.baseUrl` 给 claude/zcode，`openai.baseUrl` 给 codex
- 模型在各自引擎小节里配：`claude.smallModel` 对应 Claude Code 的 `ANTHROPIC_SMALL_FAST_MODEL`（haiku 跑杂活），codex/zcode 只有单模型
- `skillsDir` 指向你独立的 skills git 仓库，apply/start 自动链入
- `defaultEngine`：`ai-kit start` 交互菜单的默认项
- 引擎按协议自动取对应地址：claude/zcode → `anthropic`，codex → `openai`

## 各引擎写入位置

| 引擎 | LLM 配置写入 | skills 软链到 |
|---|---|---|
| Claude Code | `~/.claude/settings.json`（env 注入 base_url/token/model） | `~/.claude/skills/` |
| Codex | `~/.codex/config.toml` 托管块（`ai-kit begin/end` 之间，不碰你的手写配置） | `~/.codex/skills/` |
| ZCode | `~/.zcode/settings.json` 的 `ai-kit` 字段（客户端内可再调整） | `~/.zcode/skills/` |

## 注意

- `apply` 幂等，可反复执行；换 provider 后重新 apply + 重启引擎即可。
- Codex 的 key 写入 `~/.zshenv` 托管块（`ai-kit begin/end` 之间），手动跑 codex 也能直接用；`start` 启动时也会自动注入。
- ⚠️ Codex/ZCode 的 skills 目录以各工具当前版本实际支持的路径为准，如版本变动请提 issue。
