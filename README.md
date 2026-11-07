# ai-coding-kit

一份 config + 一个 skills 仓库，通吃 Claude Code / Codex / ZCode。

## 用法

```bash
npm i -g github:skrandy/ai-coding-kit   # 全局安装
ai-kit                                  # 任何目录直接运行

# 首次运行：生成配置 → 选引擎（没装自动下载）→ 设默认 → 问一次是否加全局 alias
# 之后运行：自动查更新 + 自动 pull/链 skills + 启动默认引擎
```

首次启动会问一次是否加全局 alias（`ai` / `ai-kit`）。

```bash
ai-kit claude          # 临时启动指定引擎
ai-kit change_engine   # 切换默认引擎
ai-kit apply           # 重新写入配置 + 链 skills
ai-kit status          # 查看状态
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

- node >= 23 + npm
- git（skills 仓库自动 pull）
- Windows / macOS / Linux；Windows 下 skills 用 junction 链接，无需管理员权限

MIT
