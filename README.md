# ai-coding-kit

一份 config、一个 skills 仓库（独立 git），通吃三个 AI coding 引擎：**Claude Code / Codex / ZCode**。

## 快速开始

```bash
git clone https://github.com/skrandy/ai-coding-kit
cd ai-coding-kit
ai-kit                 # 或 bun src/index.ts
```

第一次运行 `ai-kit` 会进入引导：

1. 自动生成 `~/.ai-kit/.config.json` 模板（去填 apiKey 和两个 baseUrl）
2. 菜单选择 AI coding 引擎——没装的就自动下载
3. 选中的引擎即默认引擎

以后每次运行 `ai-kit`：

- 自动检查默认引擎有没有新版本，有就自动升级
- 自动把你 skills 仓库里的 skill 链进各引擎
- 直接启动默认引擎

首次启动还会问一次「要不要把 `ai` / `ai-kit` 加为全局命令」，回答后不再问。

## 常用命令

```bash
ai-kit                 # 启动默认引擎（带引导/自动更新/自动 skills）
ai-kit claude          # 临时启动指定引擎，不改默认
ai-kit change_engine   # 菜单切换默认引擎
ai-kit apply           # 重新写入 LLM 配置 + 自动链 skills
ai-kit install codex   # 手动安装某个引擎
ai-kit status          # 查看三引擎安装/配置状态
```

## .config.json

配置在 `~/.ai-kit/.config.json`（点开头文件，天然不会被 git 跟踪，key 放心写，**key 直接写在文件里，不用环境变量**。

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
- `defaultEngine`：`ai-kit` 直接运行时启动谁，`change_engine` 可切换

## skills

skills 放在你**独立的 skills git 仓库**里（标准 SKILL.md 格式，每个 skill 一个文件夹），不进本仓库。在 config 的 `skillsDir` 里填上它的本地路径，`apply` / 启动时会自动软链到各引擎，原生加载：

| 引擎 | skills 软链到 |
|---|---|
| Claude Code | `~/.claude/skills/<name>` |
| Codex | `~/.codex/skills/<name>` |
| ZCode | `~/.zcode/skills/<name>` |

skills 仓库 `git pull` 更新后，下次启动引擎即生效，无需任何手动操作。

## 各引擎 LLM 配置写入位置

| 引擎 | 写入 |
|---|---|
| Claude Code | `~/.claude/settings.json`（env 注入 base_url/token/主模型/小模型） |
| Codex | `~/.codex/config.toml` 托管块（`ai-kit begin/end` 之间，不碰你的手写配置） |
| ZCode | `~/.zcode/settings.json` 的 `ai-kit` 字段（客户端内可再调整） |

## 注意

- `apply` 幂等，可反复执行；换供应商后重新 apply + 重启引擎即可。
- Codex 的 key 写入 `~/.zshenv` 托管块，手动跑 codex 也能直接用；启动时也会自动注入。
- ⚠️ Codex/ZCode 的 skills 目录以各工具当前版本实际支持的路径为准，如版本变动请提 issue。

## License

MIT
