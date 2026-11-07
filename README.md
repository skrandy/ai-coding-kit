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

```json
{
  "defaultEngine": "claude",
  "provider": {
    "name": "my-provider",
    "baseUrl": "https://api.example.com/anthropic",
    "apiKeyEnv": "AI_KIT_API_KEY",
    "model": "claude-sonnet-4-5",
    "smallModel": "claude-haiku-4-5"
  }
}
```

- `baseUrl`：任何兼容 Anthropic 协议的中转/聚合 API 地址
- `apiKeyEnv`：从哪个环境变量读 key（推荐，仓库里不放真 key）
- `defaultEngine`：`ai-kit start` 不带参数时启动谁

## 各引擎写入位置

| 引擎 | LLM 配置写入 | skills 软链到 |
|---|---|---|
| Claude Code | `~/.claude/settings.json`（env 注入 base_url/token/model） | `~/.claude/skills/` |
| Codex | `~/.codex/config.toml` 托管块（`ai-kit begin/end` 之间，不碰你的手写配置） | `~/.codex/skills/` |
| ZCode | `~/.zcode/settings.json` 的 `ai-kit` 字段（客户端内可再调整） | `~/.zcode/skills/` |

## 注意

- `apply` 幂等，可反复执行；换 provider 后重新 apply + 重启引擎即可。
- Codex 的 key 通过 `AI_KIT_API_KEY` 环境变量传递（`start` 命令会自动注入；手动跑 codex 时请自行 export）。
- ⚠️ Codex/ZCode 的 skills 目录以各工具当前版本实际支持的路径为准，如版本变动请提 issue。
