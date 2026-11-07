# ai-coding-kit

一份 config、一个 skills 文件夹，通吃三个 AI coding 引擎：**Claude Code / Codex / ZCode**。

## 快速开始

```bash
bun install            # 无依赖，其实可跳过
ai-kit init            # 生成 ~/.ai-kit/config.json（或用仓库内 config.json）
# 编辑 config.json：填 baseUrl / model / apiKeyEnv
export AI_KIT_API_KEY=sk-xxx
ai-kit install         # 安装 claude / codex（zcode 走客户端）
ai-kit apply           # 把 LLM 配置写入各引擎
ai-kit sync            # skills/* 软链进各引擎
ai-kit use codex       # 直接切换默认引擎
ai-kit start           # 交互菜单选引擎：选谁谁就变成新默认；回车 = 直接跑当前默认
ai-kit start claude    # 跳过菜单直接启动指定引擎
```

## config.json

配置在 `~/.ai-kit/config.json`（点开头目录 + `.gitignore` 双保险，key 不会进 git），**key 直接写在文件里，不用环境变量**。

每个 provider 分 `anthropic` / `openai` 两组协议地址——因为像火山方舟这类平台，两种协议的 baseUrl 是不同的：

```json
{
  "defaultEngine": "claude",
  "engineProvider": { "claude": "volcano", "codex": "volcano", "zcode": "volcano" },
  "providers": {
    "volcano": {
      "apiKey": "sk-xxx",
      "anthropic": {
        "baseUrl": "https://ark.cn-beijing.volces.com/api/anthropic",
        "model": "claude-sonnet-4-5"
      },
      "openai": {
        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seed-1-6"
      }
    }
  }
}
```

- `engineProvider`：每个引擎用哪个 provider；只有一个 provider 时可省略
- 引擎按协议自动取对应组：claude/zcode → `anthropic`，codex → `openai`
- `defaultEngine`：`ai-kit start` 交互菜单的默认项

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
