# ai-coding-kit

一份 config + 一个 skills 仓库，通吃 Claude Code / Codex。

## 用法

```bash
npm i -g github:skrandy/ai-coding-kit --allow-git=root   # 全局安装
ai-kit                                  # 任何目录直接运行

# 首次运行：选引擎（没装自动下载）→ 设默认 → 问一次全局 alias
# 之后运行：首次启动某引擎时引导补全它的 apiKey/baseUrl/模型名，答完永久保存
# 之后运行：自动查更新 + 自动 pull 每个 skill 的 git 仓库 + 链 skills + 启动默认引擎
```

```bash
ai-kit claude-code     # 临时启动指定引擎
ai-kit change_engine   # 切换默认引擎
ai-kit                 # 首次启动选一次权限模式并记住：回车=bypass 全自动（默认），n=默认审批
ai-kit status          # 查看状态（含每个 skill 的 git 分支/脏文件）
ai-kit sync            # 手动拉一遍 skills 的 git 仓库并重链（不启动引擎）
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

## 依赖

- node >= 23 + npm

MIT
