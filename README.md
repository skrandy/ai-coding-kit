# ai-coding-kit

一份 config + 一个 skills 仓库，通吃 Claude Code / Codex / ZCode。

## 用法

```bash
git clone https://github.com/skrandy/ai-coding-kit && cd ai-coding-kit

npm start                    # 即 node src/index.ts

# 首次运行：生成配置 → 选引擎（没装自动下载）→ 设默认 → 问一次是否加全局 alias
# 之后运行：自动查更新 + 自动 pull/链 skills + 启动默认引擎
```

首次启动会问一次是否加全局 alias（`ai` / `ai-kit`）。

```bash
npm start -- claude        # 临时启动指定引擎
npm start -- change_engine # 切换默认引擎
npm start -- apply         # 重新写入配置 + 链 skills
npm start -- status        # 查看状态
```

## .config.json

`~/.ai-kit/.config.json`（点开头，key 不会进 git）：

```json
{
  "defaultEngine": "claude",
  "skillsDir": "~/Documents/你的skills仓库",
  "apiKey": "sk-xxx",
  "anthropic": { "baseUrl": "https://..." },
  "openai": { "baseUrl": "https://..." },
  "claude": { "model": "glm-4.7", "smallModel": "glm-4.5-air" },
  "codex": { "model": "glm-4.7" },
  "zcode": { "model": "glm-4.7" }
}
```

- `apiKey` 公用；`anthropic` 地址给 claude/zcode，`openai` 地址给 codex
- 模型跟引擎走：仅 claude 有 `smallModel`（对应 `ANTHROPIC_SMALL_FAST_MODEL`）
- `skillsDir` 指向独立 skills git 仓库，启动时自动 pull + 软链到 `~/{.claude,.codex,.zcode}/skills/`

## 写入位置

| 引擎 | LLM 配置 |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Codex | `~/.codex/config.toml`（托管块）+ key 写 `~/.zshenv` |
| ZCode | `~/.zcode/settings.json` |

## 依赖

- node >= 23（原生跑 TS）
- 装引擎（claude/codex）时需要 npm
- git（skills 仓库自动 pull）

MIT
