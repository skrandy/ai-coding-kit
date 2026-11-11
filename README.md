# ai-coding-kit

一份 config + 一个 skills 仓库，通吃 Claude Code / Codex。

## 用法

```bash
npm i -g github:skrandy/ai-coding-kit --allow-git=root   # 全局安装
ai-kit                                  # 任何目录直接运行

# 首次运行：选引擎（没装自动下载）→ 设默认 → 问一次全局 alias
# 之后运行：首次启动某引擎时引导补全它的 apiKey/baseUrl/模型名，答完永久保存
# 之后运行：自动查更新 + 自动 pull/链 skills + 启动默认引擎
```

首次启动会问一次是否加全局 alias（`ai` / `ai-kit`）。

改了 `.config.json` 里的 key / 地址 / 模型后，直接重跑 `ai-kit` 即可：启动时会重推配置，并在检测到变化时重启 codex 的常驻服务、用 `-m` 显式指定模型（续接旧会话也不会沿用旧模型）。

```bash
ai-kit claude-code     # 临时启动指定引擎
ai-kit change_engine   # 切换默认引擎
ai-kit                 # 首次启动选一次权限模式并记住：回车=bypass 全自动（默认），n=默认审批
ai-kit status          # 查看状态
```

## .config.json

`.config.json` —— **每次 `ai-kit` 启动都会把这里的 LLM 配置重新推给各引擎**，改完直接重启 `ai-kit` 就生效：

```json
{
  "defaultEngine": "codex",
  "apiKey": "填你的key",
  "llm": {
    "anthropic": { "baseUrl": "填anthropic兼容地址" },
    "openai": { "baseUrl": "填openai兼容地址" }
  },
  "engines": {
    "claude-code": { "model": "主模型", "smallModel": "小模型" },
    "codex": { "model": "模型" }
  }
}
```

`applied` 是 ai-kit 自己写的，不用管它。`permissionMode` 记住首次选的权限模式（`bypass` / `normal`），删掉它或设为 `null` 会重新询问。

### 怎么理解这份配置

token plan 会给**两个协议的接入地址**：`claude-code` 只会说 anthropic 协议，就用 `llm.anthropic.baseUrl`；`codex` 只会说 openai 协议，就用 `llm.openai.baseUrl`。协议是引擎自己带的，配置里不用填。

- `apiKey` 公用
- 只有 `claude-code` 有 `smallModel`（`ANTHROPIC_SMALL_FAST_MODEL`，跑后台小任务省钱）
- skill 放本仓库 `skills/` 文件夹，用 [Anthropic 标准](https://code.claude.com/docs/en/skills)格式（每个 skill 一个文件夹 + `SKILL.md`）：

```
skills/hello-world/SKILL.md
```

`SKILL.md` 带 frontmatter（`name` + `description`），`description` 写清什么时候触发。往里无限加，启动时自动软链到 `~/.claude/skills/` 和 `~/.codex/skills/`。想用外部仓库就填 `skillsDir`。

## 写入位置

| 引擎 | LLM 配置 |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Codex | `~/.codex/config.toml`（托管块）+ key 写 `~/.zshenv` |

## 依赖

- node >= 23 + npm
- git（skills 仓库自动 pull）
- Windows / macOS / Linux；Windows 下 skills 用 junction 链接，无需管理员权限

MIT
