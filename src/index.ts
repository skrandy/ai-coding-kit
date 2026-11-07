#!/usr/bin/env bun
/**
 * ai-kit — one config, one skills folder, three AI coding engines.
 *
 * Usage:
 *   ai-kit init                      生成 config.json 模板
 *   ai-kit install [engine]          安装引擎 (claude | codex | zcode)，无参数装全部
 *   ai-kit apply                     把 config.json 写入各引擎 + 自动链入 skills
 *   ai-kit use <engine>              设置默认引擎
 *   ai-kit start [engine]            启动引擎：带参数直接启动；不带参数交互选择并记住默认
 *   ai-kit status                    查看各引擎安装/配置状态
 */

import { $ } from "bun";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(import.meta.path), "..");   // repo root (src/.. )
const HOME = homedir();
const CONFIG_PATH = join(HOME, ".ai-kit", "config.json"); // key 就放在这个文件里，不会进 git

/** skills 来源：config.skillsDir 指向用户独立的 skills 仓库 */
const skillsSrc = (cfg?: Config): string | null => {
  const d = cfg?.skillsDir;
  if (!d) return null;
  return d.startsWith("~") ? join(HOME, d.slice(1)) : resolve(d);
};

/** 自动把 skills 软链进各引擎（apply / start 时自动执行，无需手动跑） */
async function autoSync(cfg?: Config): Promise<void> {
  cfg = cfg ?? (existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config : undefined);
  const src = skillsSrc(cfg);
  if (!src || !existsSync(src)) return;
  for (const name of readdirSync(src)) {
    const skillPath = join(src, name);
    if (statSync(skillPath).isFile()) continue; // 跳过 README 等散文件
    if (!existsSync(join(skillPath, "SKILL.md"))) continue;
    for (const e of ENGINES) {
      const a = ADAPTERS[e];
      if (!a.installed()) continue;
      const dir = a.skillsDir();
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, name);
      if (existsSync(dest)) continue;
      symlinkSync(skillPath, dest);
      console.log(`  ✓ skills: ${name} → ${dest}`);
    }
  }
}

type Engine = "claude" | "codex" | "zcode";
type Protocol = "anthropic" | "openai";
const ENGINES: Engine[] = ["claude", "codex", "zcode"];

/** 各引擎说哪种协议 */
const ENGINE_PROTOCOL: Record<Engine, Protocol> = {
  claude: "anthropic",
  zcode: "anthropic",
  codex: "openai",
};

interface Endpoint {
  baseUrl: string;
  model: string;
  smallModel?: string;
}

interface Config {
  defaultEngine: Engine;
  apiKey: string;
  /** skills 仓库路径（独立 git 仓库），不填则用本项目 skills/ 目录 */
  skillsDir?: string;
  /** anthropic 协议地址：给 claude / zcode 用 */
  anthropic: Endpoint;
  /** openai 协议地址：给 codex 用 */
  openai: Endpoint;
}

// ---------- 引擎适配层 ----------

interface Adapter {
  name: string;
  cmd: string;
  installed: () => boolean;
  install: () => Promise<void>;
  /** 写入 LLM 配置（拿到该引擎对应协议的 endpoint + key） */
  applyConfig: (engine: Engine, ep: Endpoint, apiKey: string) => Promise<void>;
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
  async applyConfig(_engine, ep, apiKey) {
    // Claude Code: ~/.claude/settings.json 的 env 字段注入 base url / token / model
    const p = join(HOME, ".claude", "settings.json");
    const settings = readJson<Record<string, any>>(p) ?? {};
    settings.env = {
      ...(settings.env ?? {}),
      ANTHROPIC_BASE_URL: ep.baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: ep.model,
      ...(ep.smallModel ? { ANTHROPIC_SMALL_FAST_MODEL: ep.smallModel } : {}),
    };
    writeJson(p, settings);
    console.log(`  ✓ claude → ${p}  (${ep.model} @ ${ep.baseUrl})`);
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
  async applyConfig(_engine, ep, apiKey) {
    // Codex: ~/.codex/config.toml 托管块；key 写进 ~/.zshenv 托管块（文件里，不依赖手动 export）
    const p = join(HOME, ".codex", "config.toml");
    mkdirSync(dirname(p), { recursive: true });
    const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
    const BEGIN = "# >>> ai-kit begin >>>";
    const END = "# <<< ai-kit end <<<";
    const stripped = existing.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
    const block = [
      BEGIN,
      `model = "${ep.model}"`,
      `model_provider = "ai-kit"`,
      ``,
      `[model_providers.ai-kit]`,
      `name = "ai-kit"`,
      `base_url = "${ep.baseUrl}"`,
      `env_key = "AI_KIT_API_KEY"`,
      END,
      "",
    ].join("\n");
    writeFileSync(p, stripped + block);

    // 把 key 写进 ~/.zshenv（dot 文件，手动跑 codex 也能直接用）
    const zshenv = join(HOME, ".zshenv");
    const cur = existsSync(zshenv) ? readFileSync(zshenv, "utf8") : "";
    const strippedEnv = cur.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
    const envBlock = [BEGIN, `export AI_KIT_API_KEY="${apiKey}"`, END, ""].join("\n");
    writeFileSync(zshenv, strippedEnv + envBlock);
    console.log(`  ✓ codex → ${p} + key 写入 ~/.zshenv  (${ep.model} @ ${ep.baseUrl})`);
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
  async applyConfig(_engine, ep, apiKey) {
    // ZCode: 引擎/供应商可在客户端内管理；这里做 best-effort 合并到 ~/.zcode/settings.json
    const p = join(HOME, ".zcode", "settings.json");
    const settings = readJson<Record<string, any>>(p) ?? {};
    settings["ai-kit"] = {
      baseUrl: ep.baseUrl,
      model: ep.model,
      ...(ep.smallModel ? { smallModel: ep.smallModel } : {}),
      apiKey,
    };
    writeJson(p, settings);
    console.log(`  ✓ zcode → ${p}  (${ep.model} @ ${ep.baseUrl}，客户端内可再调整)`);
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

/** 取某引擎要用的协议 endpoint + key（全部来自配置文件，无环境变量） */
function resolveEndpoint(cfg: Config, engine: Engine): { ep: Endpoint; apiKey: string } {
  const proto = ENGINE_PROTOCOL[engine];
  const ep = cfg[proto];
  if (!ep?.baseUrl) {
    console.error(`config.json 里没有配置 ${proto} 协议的 baseUrl（引擎 ${engine} 需要 ${proto} 协议），先编辑 ${CONFIG_PATH}`);
    process.exit(1);
  }
  if (!cfg.apiKey) {
    console.error(`config.json 里没有 apiKey，先编辑 ${CONFIG_PATH}`);
    process.exit(1);
  }
  return { ep, apiKey: cfg.apiKey };
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
  console.log(`已生成 ${CONFIG_PATH}`);
  console.log(`编辑它：填 apiKey、各协议的 baseUrl/model，然后运行 ai-kit apply`);
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
  await autoSync(cfg); // skills 自动链入，无需手动 sync
  for (const e of ENGINES) {
    if (!ADAPTERS[e].installed()) { console.log(`- ${e} 未安装，跳过配置`); continue; }
    const { ep, apiKey } = resolveEndpoint(cfg, e);
    await ADAPTERS[e].applyConfig(e, ep, apiKey);
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
    passthrough = argv.slice(startIdx + 1).filter(a => !/^(claude|codex|zcode)$/.test(a));
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
  const { apiKey } = resolveEndpoint(cfg, engine);
  await autoSync(cfg); // 启动前自动链入最新 skills
  const child = spawnSync(a.cmd, passthrough ?? process.argv.slice(process.argv.indexOf("start") + 2), {
    stdio: "inherit",
    env: { ...process.env, AI_KIT_API_KEY: apiKey },
  });
  process.exit(child.status ?? 0);
}

async function status() {
  const cfg = existsSync(CONFIG_PATH) ? loadConfig() : null;
  for (const e of ENGINES) {
    const a = ADAPTERS[e];
    const ok = a.installed();
    let extra = "";
    if (cfg) {
      try {
        const { ep } = resolveEndpoint(cfg, e);
        extra = `  ${ep.model}`;
      } catch { extra = "  ⚠ provider 未配置"; }
    }
    console.log(`${ok ? "●" : "○"} ${e.padEnd(7)} ${ok ? "已安装" : "未安装"}${extra}${cfg?.defaultEngine === e ? "  ← 默认" : ""}`);
  }
  console.log(`\nconfig: ${CONFIG_PATH}${cfg?.anthropic ? `  anthropic: ${cfg.anthropic.model}` : ""}${cfg?.openai ? `  openai: ${cfg.openai.model}` : ""}`);
  const src = skillsSrc(cfg);
  console.log(`skills: ${src ?? "未配置 skillsDir"}${src && existsSync(src) ? ` (${readdirSync(src).filter(n => existsSync(join(src, n, "SKILL.md"))).length} 个)` : ""}`);
}

// ---------- 入口 ----------

const [cmd, ...rest] = process.argv.slice(2);
const help = () => console.log(`用法: ai-kit <init|install|apply|use|start|status> [参数]`);

switch (cmd) {
  case "init": await init(); break;
  case "install": await install(rest[0]); break;
  case "apply": await apply(); break;
  case "use": await use(rest[0] ?? ""); break;
  case "start": await start(rest[0]); break;
  case "status": await status(); break;
  default: help();
}
