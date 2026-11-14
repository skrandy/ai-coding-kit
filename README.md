# ai-coding-kit

一份 config + 一个 skills 仓库，通吃 Claude Code / Codex。API Key 存多套，切一次就记住。

## 装

```bash
npm i -g github:skrandy/ai-coding-kit --allow-git=root
```

## 用

```bash
ai-kit          # 用当前配置启动
ai-kit switch   # 换 key / 加 key，选完就是它了
```

`ai-kit claude-code` 临时换引擎，`ai-kit change_engine` 换默认引擎，`ai-kit status` 看状态。

## 配置

`.config.json`，一套 key 一段，`defaultProfile` 指当前用的那套：

```json
{
  "defaultEngine": "codex",
  "defaultProfile": "ark-包月",
  "profiles": {
    "ark-包月": {
      "apiKey": "…",
      "llm": {
        "openai": { "baseUrl": "…" },
        "anthropic": { "baseUrl": "…" }
      },
      "engines": {
        "codex": { "model": "…" },
        "claude-code": { "opusModel": "…", "sonnetModel": "…", "haikuModel": "…" }
      }
    }
  }
}
```

claude-code 只有三档，主模型就是 `opusModel`：启动时 `--model` 和 `ANTHROPIC_MODEL` 都取它，同时它也写进 `ANTHROPIC_DEFAULT_OPUS_MODEL`，`/model` 选 opus 时用的是同一个。`sonnetModel` / `haikuModel` 对应 `ANTHROPIC_DEFAULT_SONNET/HAIKU_MODEL`，留空就跟随厂商默认；haiku 档还负责后台小任务，旧变量 `ANTHROPIC_SMALL_FAST_MODEL` 已废弃。

每次启动都会把当前这套推给各引擎。老配置首次运行自动迁移，`defaultProfile` 一般不用手改。

## 依赖

node >= 23 + npm

MIT
