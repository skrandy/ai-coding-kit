# ai-coding-kit

一份 config + 一个 skills 仓库，通吃 Claude Code / Codex / ZCode。

## 用法

```bash
npm i -g github:skrandy/ai-coding-kit   # 全局安装
ai-kit                                  # 任何目录直接运行

# 首次运行：问 apiKey/协议地址 → 选引擎（没装自动下载）→ 问模型 → 设默认 → 问一次全局 alias
# 之后运行：缺哪个字段现场补问哪个，答完永久保存
# 之后运行：自动查更新 + 自动 pull/链 skills + 启动默认引擎
```

首次启动会问一次是否加全局 alias（`ai` / `ai-kit`）。

```bash
ai-kit claude          # 临时启动指定引擎
ai-kit change_engine   # 切换默认引擎
ai-kit                 # 启动时可选权限模式：回车=bypass 全自动（默认），n=默认审批
ai-kit status          # 查看状态
```

## .config.json

`.config.json（仓库根目录，点开头不会进 git）`（点开头，key 不会进 git）：

```json
{
  "defaultEngine": "claude",
  "apiKey": "填你的key",
  "anthropic": { "baseUrl": "填anthropic兼容地址" },
  "openai": { "baseUrl": "填openai兼容地址" },
  "claude": { "model": "主模型", "smallModel": "小模型" },
  "codex": { "model": "模型" },
  "zcode": { "model": "模型" }
}
```

### 怎么理解这份配置

你在 token plan（比如 GLM Coding Plan）买的服务会给你**两个协议的接入地址**：

- **anthropic 协议地址** —— 给说 Anthropic 协议的引擎用（`claude-code`，以及走 anthropic 协议配置的 `zcode`）
- **openai 协议地址** —— 给说 OpenAI/GPT 协议的引擎用（`codex`）

`engines` 里每个引擎用 `protocol` 字段声明自己说哪种协议，请求就发到 `llm` 里对应的地址。引擎换协议、换地址互不影响。

- `apiKey` 公用
- 只有 `claude-code` 有 `smallModel`（Claude Code 专属的 `ANTHROPIC_SMALL_FAST_MODEL`，跑后台小任务省钱）；其他引擎单模型
- `zcode` 的模型/协议也可以直接在客户端内管理，这里的配置作为记录与兜底
- skill 放本仓库 `skills/` 文件夹，用 [Anthropic 标准](https://code.claude.com/docs/en/skills)格式（每个 skill 一个文件夹 + `SKILL.md`）：

```
skills/hello-world/SKILL.md
```

`SKILL.md` 带 frontmatter（`name` + `description`），`description` 写清什么时候触发。往里无限加，启动时自动软链到 `~/{.claude,.codex,.zcode}/skills/`。想用外部仓库就填 `skillsDir`。

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
