#!/usr/bin/env bun
/**
 * ai-kit — one config, one skills folder, three AI coding engines.
 *
 * Usage:
 *   ai-kit init                      生成 config.json 模板
 *   ai-kit install [engine]          安装引擎 (claude | codex | zcode)，无参数装全部
 *   ai-kit apply                     把 config.json 写入各引擎的 LLM 配置
 *   ai-kit sync                      把 skills/* 软链进各引擎的 skills 目录
 *   ai-kit use <engine>              设置默认引擎
 *   ai-kit start [engine]            以配置好的环境变量启动引擎（默认用 defaultEngine）
 *   ai-kit status                    查看各引擎安装/配置状态
 */

import { $ } from "bun";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, unlinkSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(import.meta.path), "..");   // repo root (src/.. )
const HOME = homedir();
const CONFIG_PATH = existsSync(join(ROOT, "config.json"))
  ? join(ROOT, "config.json")
  : join(HOME, ".ai-kit", "config.json");
const SKILLS_SRC = join(ROOT, "skills");

type Engine = "claude" | "codex" | "zcode";
const ENGINES: Engine[] = ["claude", "codex", "zcode"];

interface Config {
  defaultEngine: Engine;
  provider: {
    name: string;
    baseUrl: string;
    /** 优先从该环境变量读取 key；也允许直接写 apiKey（不推荐提交到仓库） */
    apiKeyEnv?: string;
    apiKey?: string;
    model: string;
    smallModel?: string;
  };
}

// ---------- 引擎适配层 ----------

interface Adapter {
  name: string;
  cmd: string;
  /** 引擎判定已安装 */
  installed: () => boolean;
  install: () => Promise<void>;
  /** 写入 LLM 配置 */
  applyConfig: (cfg: Config, apiKey: string) => Promise<void>;
  /** skills 目标目录 */
  skillsDir: () => string;
}

const readJson = <T>(p: string): T | null => {
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return null; }
};

const writeJson = (p: string, data: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
};

const claude: Adapter = {
  name: "claude",
  cmd: "claude",
  installed: () => existsSync(join(HOME, ".claude")) || which("claude"),
  async install() {
    await $`npm install -g @anthropic-ai/claude-code`.quiet();
  },
  async applyConfig(cfg, apiKey) {
    // Claude Code: ~/.claude/settings.json 的 env 字段注入 base url / token / model
    const p = join(HOME, ".claude", "settings.json");
    const settings = readJson<Record<string, any>>(p) ?? {};
    settings.env = {
      ...(settings.env ?? {}),
      ANTHROPIC_BASE_URL: cfg.provider.baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: cfg.provider.model,
      ...(cfg.provider.smallModel ? { ANTHROPIC_SMALL_FAST_MODEL: cfg.provider.smallModel } : {}),
    };
    writeJson(p, settings);
    console.log(`  ✓ claude → ${p}`);
  },
  skillsDir: () => join(HOME, ".claude", "skills"),
};

const codex: Adapter = {
  name: "codex",
  cmd: "codex",
  installed: () => existsSync(join(HOME, ".codex")) || which("codex"),
  async install() {
    await $`npm install -g @openai/codex`.quiet();
  },
  async applyConfig(cfg, _apiKey) {
    // Codex: ~/.codex/config.toml，用托管块避免覆盖用户已有内容；key 走 env_key
    const p = join(HOME, ".codex", "config.toml");
    mkdirSync(dirname(p), { recursive: true });
    const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
    const BEGIN = "# >>> ai-kit begin >>>";
    const END = "# <<< ai-kit end <<<";
    const stripped = existing.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
    const block = [
      BEGIN,
      `model = "${cfg.provider.model}"`,
      `model_provider = "ai-kit"`,
      ``,
      `[model_providers.ai-kit]`,
      `name = "${cfg.provider.name}"`,
      `base_url = "${cfg.provider.baseUrl}"`,
      `env_key = "AI_KIT_API_KEY"`,
      END,
      "",
    ].join("\n");
    writeFileSync(p, stripped + block);
    console.log(`  ✓ codex → ${p}`);
  },
  skillsDir: () => join(HOME, ".codex", "skills"),
};

const zcode: Adapter = {
  name: "zcode",
  cmd: "zcode",
  installed: () => existsSync(join(HOME, ".zcode")) || which("zcode"),
  async install() {
    console.log("  ⚠ zcode 请从 ZCode 官网/客户端安装；本命令只负责配置与 skills 同步。");
  },
  async applyConfig(cfg, apiKey) {
    // ZCode: 引擎/供应商可在客户端内管理；这里做 best-effort 合并到 ~/.zcode/settings.json
    const p = join(HOME, ".zcode", "settings.json");
    const settings = readJson<Record<string, any>>(p) ?? {};
    settings["ai-kit"] = {
      provider: cfg.provider.name,
      baseUrl: cfg.provider.baseUrl,
      model: cfg.provider.model,
      ...(cfg.provider.smallModel ? { smallModel: cfg.provider.smallModel } : {}),
      apiKeyEnv: cfg.provider.apiKeyEnv ?? "AI_KIT_API_KEY",
    };
    writeJson(p, settings);
    console.log(`  ✓ zcode → ${p}（客户端内如需切 provider 请在应用设置里选择）`);
  },
  skillsDir: () => join(HOME, ".zcode", "skills"),
};

const ADAPTERS: Record<Engine, Adapter> = { claude, codex, zcode };

// ---------- 工具函数 ----------

function which(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`未找到配置文件 ${CONFIG_PATH}`);
    console.error(`先运行: ai-kit init`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
}

function resolveApiKey(cfg: Config): string {
  const envName = cfg.provider.apiKeyEnv ?? "AI_KIT_API_KEY";
  const key = cfg.provider.apiKey ?? process.env[envName];
  if (!key) {
    console.error(`缺少 API key：请 export ${envName}=... 或在 config.json 里填 provider.apiKey（不建议提交）`);
    process.exit(1);
  }
  return key;
}

// ---------- 命令 ----------

async function init() {
  if (existsSync(CONFIG_PATH)) {
    console.log(`已存在 ${CONFIG_PATH}，不覆盖。`);
    return;
  }
  const tpl = readFileSync(join(ROOT, "config.example.json"), "utf8");
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, tpl);
  console.log(`已生成 ${CONFIG_PATH}，编辑后运行 ai-kit apply`);
}

async function install(engineArg?: string) {
  const targets = engineArg ? [engineArg as Engine] : ENGINES;
  for (const e of targets) {
    const a = ADAPTERS[e];
    if (!a) { console.error(`未知引擎: ${e}（可选 claude | codex | zcode）`); continue; }
    console.log(`安装 ${e} ...`);
    if (a.installed()) console.log(`  ✓ ${e} 已安装，跳过`);
    else await a.install();
  }
}

async function apply() {
  const cfg = loadConfig();
  const apiKey = resolveApiKey(cfg);
  for (const e of ENGINES) {
    if (!ADAPTERS[e].installed()) { console.log(`- ${e} 未安装，跳过配置`); continue; }
    await ADAPTERS[e].applyConfig(cfg, apiKey);
  }
}

async function sync() {
  const cfg = loadConfig();
  if (!existsSync(SKILLS_SRC)) { console.log(`没有 ${SKILLS_SRC}，先创建 skills/<name>/SKILL.md`); return; }
  for (const name of readdirSync(SKILLS_SRC)) {
    const src = join(SKILLS_SRC, name);
    if (statSync(src).isFile()) continue; // 跳过 README 等散文件
    for (const e of ENGINES) {
      const a = ADAPTERS[e];
      if (!a.installed()) continue;
      const dir = a.skillsDir();
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, name);
      if (existsSync(dest)) { console.log(`  = ${e}:${name} 已存在，跳过`); continue; }
      symlinkSync(src, dest);
      console.log(`  ✓ ${e}:${name} → ${dest}`);
    }
  }
}

async function use(engine: string) {
  if (!ADAPTERS[engine as Engine]) { console.error(`未知引擎: ${engine}`); process.exit(1); }
  const cfg = loadConfig();
  cfg.defaultEngine = engine as Engine;
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`默认引擎已切换为 ${engine}`);
}

async function start(engineArg?: string) {
  const cfg = loadConfig();
  let engine = engineArg as Engine | undefined;
  let passthrough: string[];

  if (!engine) {
    const argv = process.argv.slice(2);
    const startIdx = argv.indexOf("start");
    passthrough = argv.slice(startIdx + 1).filter(a => !argv[startIdx + 1] || !/^(claude|codex|zcode)$/.test(a));
    if (process.stdin.isTTY) {
      // 交互菜单：选谁就把谁存为默认引擎（切换）；直接回车 = 用当前默认
      const defaultIdx = Math.max(0, ENGINES.indexOf(cfg.defaultEngine));
      console.log(`选择要启动的引擎（当前默认: ${cfg.defaultEngine}）：`);
      ENGINES.forEach((e, i) => console.log(`  ${i + 1}. ${e}${i === defaultIdx ? "  ← 默认" : ""}${ADAPTERS[e].installed() ? "" : "  (未安装)"}`));
      process.stdout.write(`输入序号或名称 [回车=${cfg.defaultEngine}]: `);
      const answer = (await new Response(process.stdin).text()).trim();
      if (answer && /^\d$/.test(answer)) engine = ENGINES[Number(answer) - 1];
      else if (answer && ENGINES.includes(answer as Engine)) engine = answer as Engine;
      if (engine && engine !== cfg.defaultEngine) {
        cfg.defaultEngine = engine;
        writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
        console.log(`默认引擎已切换为 ${engine}`);
      }
    }
  }
  engine = (engine ?? cfg.defaultEngine) as Engine;
  const a = ADAPTERS[engine];
  if (!a) { console.error(`未知引擎: ${engine}`); process.exit(1); }
  if (!which(a.cmd)) { console.error(`${a.cmd} 未安装，先运行 ai-kit install ${engine}`); process.exit(1); }
  const apiKey = resolveApiKey(cfg);
  const child = spawnSync(a.cmd, passthrough ?? process.argv.slice(process.argv.indexOf("start") + 2), {
    stdio: "inherit",
    env: { ...process.env, AI_KIT_API_KEY: apiKey, apiKeyEnv: undefined },
  });
  process.exit(child.status ?? 0);
}

async function status() {
  const cfg = existsSync(CONFIG_PATH) ? loadConfig() : null;
  for (const e of ENGINES) {
    const a = ADAPTERS[e];
    const ok = a.installed();
    console.log(`${ok ? "●" : "○"} ${e.padEnd(7)} ${ok ? (which(a.cmd) ? "已安装" : "有配置目录，CLI 未在 PATH") : "未安装"}${cfg?.defaultEngine === e ? "  ← 默认" : ""}`);
  }
  console.log(`\nconfig: ${CONFIG_PATH}`);
  console.log(`skills: ${SKILLS_SRC} (${existsSync(SKILLS_SRC) ? readdirSync(SKILLS_SRC).filter(n => existsSync(join(SKILLS_SRC, n, "SKILL.md"))).length : 0} 个)`);
}

// ---------- 入口 ----------

const [cmd, ...rest] = process.argv.slice(2);
const help = () => console.log(`用法: ai-kit <init|install|apply|sync|use|start|status> [参数]`);

switch (cmd) {
  case "init": await init(); break;
  case "install": await install(rest[0]); break;
  case "apply": await apply(); break;
  case "sync": await sync(); break;
  case "use": await use(rest[0] ?? ""); break;
  case "start": await start(rest[0]); break;
  case "status": await status(); break;
  default: help();
}
