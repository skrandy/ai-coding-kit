#!/usr/bin/env node
/** ai-kit — 一份 config + 一个 skills 仓库，通吃 claude/codex/zcode。用法: ai-kit | change_engine | apply | install [e] | status */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname((import.meta as any).filename ?? import.meta.path), "..");
const HOME = homedir();
const CONFIG_PATH = join(HOME, ".ai-kit", ".config.json");
const ZSHRC = join(HOME, ".zshrc");
const BEGIN = "# >>> ai-kit begin >>>";
const END = "# <<< ai-kit end <<<";
const SELF = "bun " + join(ROOT, "src", "index.ts");

type Engine = "claude" | "codex" | "zcode";
type Protocol = "anthropic" | "openai";
const ENGINES: Engine[] = ["claude", "codex", "zcode"];

const ENGINE_PROTOCOL: Record<Engine, Protocol> = {
  claude: "anthropic",
  zcode: "anthropic",
  codex: "openai",
};

interface ProtocolEndpoint {
  baseUrl: string;
}

interface EngineModel {
  model: string;
  smallModel?: string;
}

interface Config {
  defaultEngine: Engine;
  apiKey: string;
  skillsDir?: string;
  anthropic: ProtocolEndpoint;
  openai: ProtocolEndpoint;
  claude: EngineModel;
  codex: EngineModel;
  zcode: EngineModel;
  aliasInstalled?: boolean;
}

// ---------- 引擎适配层 ----------

interface Adapter {
  name: string;
  cmd: string;
  pkg?: string;
  installed: () => boolean;
  install: () => Promise<void>;
  applyConfig: (engine: Engine, ep: { baseUrl: string; model: string; smallModel?: string }, apiKey: string) => Promise<void>;
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
  pkg: "@anthropic-ai/claude-code",
  installed: () => existsSync(join(HOME, ".claude")) || which("claude"),
  async install() {
    await run("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
  },
  async applyConfig(_engine, ep, apiKey) {
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
  pkg: "@openai/codex",
  installed: () => existsSync(join(HOME, ".codex")) || which("codex"),
  async install() {
    await run("npm", ["install", "-g", "@openai/codex"]);
  },
  async applyConfig(_engine, ep, apiKey) {
    const p = join(HOME, ".codex", "config.toml");
    mkdirSync(dirname(p), { recursive: true });
    const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
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

    const zshenv = join(HOME, ".zshenv");
    const cur = existsSync(zshenv) ? readFileSync(zshenv, "utf8") : "";
    const strippedEnv = cur.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
    writeFileSync(zshenv, strippedEnv + [BEGIN, `export AI_KIT_API_KEY="${apiKey}"`, END, ""].join("\n"));
    console.log(`  ✓ codex → ${p} + key 写入 ~/.zshenv  (${ep.model} @ ${ep.baseUrl})`);
  },
  skillsDir: () => join(HOME, ".codex", "skills"),
};

const zcode: Adapter = {
  name: "zcode",
  cmd: "zcode",
  installed: () => existsSync(join(HOME, ".zcode")) || which("zcode"),
  async install() {
    console.log("  ⚠ zcode 请从 ZCode 官网/客户端安装；本命令只负责配置与 skills。");
  },
  async applyConfig(_engine, ep, apiKey) {
    const p = join(HOME, ".zcode", "settings.json");
    const settings = readJson<Record<string, any>>(p) ?? {};
    settings["ai-kit"] = {
      baseUrl: ep.baseUrl,
      model: ep.model,
      ...(ep.smallModel ? { smallModel: ep.smallModel } : {}),
      apiKey,
    };
    writeJson(p, settings);
    console.log(`  ✓ zcode → ${p}  (${ep.model} @ ${ep.baseUrl})`);
  },
  skillsDir: () => join(HOME, ".zcode", "skills"),
};

const ADAPTERS: Record<Engine, Adapter> = { claude, codex, zcode };

// ---------- 工具函数 ----------

const WIN = process.platform === "win32";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, err) => {
    const c = spawnSync(cmd, args, { stdio: "inherit", shell: WIN });
    c.status === 0 ? ok() : err(new Error(`${cmd} 退出码 ${c.status}`));
  });
}

function which(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`未找到配置文件 ${CONFIG_PATH}，先运行 ai-kit（首次引导会自动生成）`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
}

function saveConfig(cfg: Config) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

function resolveEndpoint(cfg: Config, engine: Engine): { ep: { baseUrl: string; model: string; smallModel?: string }; apiKey: string } {
  const baseUrl = cfg[ENGINE_PROTOCOL[engine]]?.baseUrl;
  if (!baseUrl) {
    console.error(`config.json 里没有配置 ${ENGINE_PROTOCOL[engine]} 协议的 baseUrl（引擎 ${engine} 需要），请编辑 ${CONFIG_PATH}`);
    process.exit(1);
  }
  const em = cfg[engine];
  if (!em?.model) {
    console.error(`config.json 里没有配置 ${engine} 的 model，请编辑 ${CONFIG_PATH}`);
    process.exit(1);
  }
  if (!cfg.apiKey) {
    console.error(`config.json 里没有 apiKey，请编辑 ${CONFIG_PATH}`);
    process.exit(1);
  }
  return { ep: { baseUrl, model: em.model, smallModel: em.smallModel }, apiKey: cfg.apiKey };
}

function skillsSrc(cfg?: Config): string | null {
  const d = cfg?.skillsDir?.trim();
  if (!d) return join(ROOT, "skills"); // 默认：仓库 skills/ 文件夹
  return d.startsWith("~") ? join(HOME, d.slice(1)) : resolve(d);
}

/** 启动时自动 pull skills 仓库并软链进各引擎 */
async function autoSync(cfg: Config): Promise<void> {
  const src = skillsSrc(cfg);
  if (!src || !existsSync(src)) return;
  if (existsSync(join(src, ".git"))) {
    try {
      const r = spawnSync("git", ["-C", src, "pull", "--ff-only"], { encoding: "utf8", timeout: 30000, shell: WIN });
      if (r.status === 0 && r.stdout?.trim().match(/files? changed|Fast-forward/)) {
        console.log(`  ✓ skills 仓库已更新: ${r.stdout.trim().split("\n")[0]}`);
      }
    } catch {  }
  }
  for (const name of readdirSync(src)) {
    const skillPath = join(src, name);
    if (statSync(skillPath).isFile()) continue;
    if (!existsSync(join(skillPath, "SKILL.md"))) continue;
    for (const e of ENGINES) {
      const a = ADAPTERS[e];
      if (!a.installed()) continue;
      const dir = a.skillsDir();
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, name);
      if (existsSync(dest)) continue;
      symlinkSync(resolve(skillPath), dest, WIN ? "junction" : "dir");
      console.log(`  ✓ skills: ${name} → ${dest}`);
    }
  }
}

async function askLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return (await new Response(process.stdin).text()).trim();
}

async function pickEngine(cfg: Config, title: string): Promise<Engine> {
  console.log(title);
  ENGINES.forEach((e, i) =>
    console.log(`  ${i + 1}. ${e}${e === cfg.defaultEngine ? "  ← 默认" : ""}${ADAPTERS[e].installed() ? "" : "  (未安装，选中后自动下载)"}`)
  );
  const answer = await askLine(`输入序号或名称 [回车=${cfg.defaultEngine}]: `);
  let engine: Engine | undefined;
  if (/^\d$/.test(answer)) engine = ENGINES[Number(answer) - 1];
  else if (ENGINES.includes(answer as Engine)) engine = answer as Engine;
  return engine ?? cfg.defaultEngine;
}

async function setDefault(cfg: Config, engine: Engine): Promise<Config> {
  if (engine !== cfg.defaultEngine) {
    cfg.defaultEngine = engine;
    saveConfig(cfg);
    console.log(`默认引擎已切换为 ${engine}`);
  }
  return cfg;
}


async function onboard(): Promise<Config> {
  console.log("=== ai-kit 首次设置 ===\n");
  const tpl = readFileSync(join(ROOT, "config.example.json"), "utf8");
  saveConfig(JSON.parse(tpl) as Config);
  console.log(`已生成配置模板 ${CONFIG_PATH}`);
  console.log(`（启动前需要填 apiKey 和 baseUrl；skillsDir 可选，指向你独立的 skills 仓库）\n`);

  const cfg = loadConfig();
  const engine = await pickEngine({ ...cfg, defaultEngine: "claude" } as Config, "选择你的 AI coding 引擎：");
  const a = ADAPTERS[engine];
  if (!a.installed()) {
    console.log(`下载安装 ${engine} ...`);
    await a.install();
  }
  return setDefault(cfg, engine);
}


/** 是否已通过 npm 全局安装（bin 在 PATH 里就不需要 alias） */
function installedGlobal(): boolean {
  return which("ai-kit");
}

async function maybeAlias(cfg: Config): Promise<Config> {
  if (cfg.aliasInstalled !== undefined || WIN || installedGlobal()) return cfg;
  if (!process.stdin.isTTY) return cfg;
  const yes = (await askLine("是否把 ai / ai-kit 加入全局命令（写进 ~/.zshrc 托管块）？[Y/n]: ")).toLowerCase();
  if (yes === "" || yes === "y" || yes === "yes") {
    const cur = existsSync(ZSHRC) ? readFileSync(ZSHRC, "utf8") : "";
    const stripped = cur.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
    const block = [
      BEGIN,
      `alias ai-kit='${SELF}'`,
      `alias ai='${SELF} start'`,
      END,
      "",
    ].join("\n");
    writeFileSync(ZSHRC, stripped + block);
    console.log("已添加。新终端生效：ai（启动默认引擎）、ai-kit（完整命令）");
  }
  cfg.aliasInstalled = true;
  saveConfig(cfg);
  return cfg;
}


async function autoUpdate(engine: Engine): Promise<void> {
  const a = ADAPTERS[engine];
  if (!a.pkg || !which("npm")) return;
  try {
    const latest = (spawnSync("npm", ["view", a.pkg, "version"], { encoding: "utf8" }).stdout ?? "").trim();
    const cur = (spawnSync(a.cmd, ["--version"], { encoding: "utf8", shell: WIN }).stdout ?? "").trim();
    if (latest && cur && latest !== cur) {
      console.log(`⬆ ${engine} 有新版本 ${cur} → ${latest}，更新中...`);
      await a.install();
    }
  } catch {  }
}

// ---------- 命令 ----------

async function apply() {
  const cfg = loadConfig();
  await autoSync(cfg);
  for (const e of ENGINES) {
    if (!ADAPTERS[e].installed()) { console.log(`- ${e} 未安装，跳过配置`); continue; }
    const { ep, apiKey } = resolveEndpoint(cfg, e);
    await ADAPTERS[e].applyConfig(e, ep, apiKey);
  }
}

async function install(engineArg?: string) {
  const targets = engineArg ? [engineArg as Engine] : ENGINES;
  for (const e of targets) {
    const a = ADAPTERS[e];
    if (!a) { console.error(`未知引擎: ${e}`); continue; }
    console.log(`安装 ${e} ...`);
    if (a.installed()) console.log(`  ✓ ${e} 已安装，跳过`);
    else await a.install();
  }
}

async function start(engineArg?: string) {
  let cfg = existsSync(CONFIG_PATH) ? loadConfig() : await onboard();
  cfg = await maybeAlias(cfg);
  const engine = (engineArg ?? cfg.defaultEngine) as Engine;
  const a = ADAPTERS[engine];
  if (!a) { console.error(`未知引擎: ${engine}`); process.exit(1); }
  if (!which(a.cmd)) {
    console.log(`${a.cmd} 未安装，自动下载...`);
    await a.install();
  }
  await autoUpdate(engine);
  const { apiKey } = resolveEndpoint(cfg, engine);
  await autoSync(cfg);   const argv = process.argv.slice(2);
  const startIdx = argv.indexOf("start");
  const passthrough = startIdx >= 0 ? argv.slice(startIdx + 1).filter(x => !/^(claude|codex|zcode)$/.test(x)) : [];
  const child = spawnSync(a.cmd, passthrough, { stdio: "inherit", env: { ...process.env, AI_KIT_API_KEY: apiKey }, shell: WIN });
  process.exit(child.status ?? 0);
}

async function changeEngine() {
  const cfg = loadConfig();
  const engine = await pickEngine(cfg, "切换默认引擎：");
  await setDefault(cfg, engine);
}

async function status() {
  const cfg = existsSync(CONFIG_PATH) ? loadConfig() : null;
  for (const e of ENGINES) {
    const a = ADAPTERS[e];
    const ok = a.installed();
    let extra = "";
    if (cfg) {
      try { extra = `  ${resolveEndpoint(cfg, e).ep.model}`; } catch { extra = "  ⚠ 配置不全"; }
    }
    console.log(`${ok ? "●" : "○"} ${e.padEnd(7)} ${ok ? "已安装" : "未安装"}${extra}${cfg?.defaultEngine === e ? "  ← 默认" : ""}`);
  }
  console.log(`\nconfig: ${CONFIG_PATH}${cfg?.claude ? `  claude: ${cfg.claude.model}${cfg.claude.smallModel ? '+' + cfg.claude.smallModel : ''}` : ""}${cfg?.codex ? `  codex: ${cfg.codex.model}` : ""}${cfg?.zcode ? `  zcode: ${cfg.zcode.model}` : ""}`);
  const src = skillsSrc(cfg);
  console.log(`skills: ${src ?? "未配置 skillsDir"}${src && existsSync(src) ? ` (${readdirSync(src).filter(n => existsSync(join(src, n, "SKILL.md"))).length} 个)` : ""}`);
}

// ---------- 入口 ----------

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case undefined:
  case "start":
    await start(rest[0]);
    break;
  case "change_engine":
  case "change-engine":
  case "use":
    await changeEngine();
    break;
  case "init":
    if (!existsSync(CONFIG_PATH)) await onboard();
    else console.log(`已存在 ${CONFIG_PATH}`);
    break;
  case "install": await install(rest[0]); break;
  case "apply": await apply(); break;
  case "status": await status(); break;
  default:
    console.log(`用法: ai-kit [start|change_engine|install|apply|status]`);
}
