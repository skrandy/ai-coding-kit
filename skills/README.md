# skills/

把符合 [Agent Skills 标准](https://code.claude.com/docs/en/skills) 的 skill 文件夹放进来，每个文件夹含一个 `SKILL.md`：

```
skills/
└── my-skill/
    └── SKILL.md      # frontmatter: name, description + 正文
```

运行 `ai-kit sync` 后，会软链到：

| 引擎 | 目录 |
|---|---|
| Claude Code | `~/.claude/skills/<name>` |
| Codex | `~/.codex/skills/<name>` |
| ZCode | `~/.zcode/skills/<name>` |
