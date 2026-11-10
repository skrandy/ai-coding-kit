#!/usr/bin/env node
/** ai-kit — 一份 config + 一个 skills 仓库，通吃 claude-code/codex/zcode。用法: ai-kit | change_engine | install [e] | status */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();
const CONFIG_PATH = join(ROOT, ".config.json");
const ZSHRC = join(HOME, ".zshrc");
const BEGIN = "# >>> ai-kit begin >>>";
const END = "# <<< ai-kit end <<<";
const SELF = "ai-kit";

const ENGINES = ["claude-code", "codex", "zcode"];

const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
};

const writeJson = (p, data) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
};

const claude = {
  name: "claude-code",
  cmd: "claude",
  bypassArgs: ["--dangerously-skip-permissions"],
  pkg: "@anthropic-ai/claude-code",
  installed: () => existsSync(join(HOME, ".claude")) || which("claude"),
  async install() {
    await run("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
  },
  async applyConfig(_engine, ep, apiKey) {
    const p = join(HOME, ".claude", "settings.json");
    const settings = readJson(p) ?? {};
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

const codex = {
  name: "codex",
  cmd: "codex",
  bypassArgs: ["--dangerously-bypass-approvals-and-sandbox"],
  pkg: "@openai/codex",
  installed: () => existsSync(join(HOME, ".codex")) || which("codex"),
  async install() {
    await run("npm", ["install", "-g", "@openai/codex"]);
  },
  async applyConfig(_engine, ep, apiKey) {
    const p = join(HOME, ".codex", "config.toml");
    mkdirSync(dirname(p), { recursive: true });
    const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
    // codex(toml_edit) 追加自己的表（[tui]/[projects]/[windows]…）时会挤进托管块尾部，
    // 整块剥离会连带删掉项目信任记录等状态；把非 ai-kit 的表摘出来放到托管块之后。
    // 布局固定为：块前的顶层键 + 托管块 + 块前的表 + 挤进块的表 + 块后内容，
    // 保证重复运行结果稳定（块内的顶层键必须落在任何 [table] 之前，否则会被解析进那张表）
    const bi = existing.indexOf(BEGIN);
    const ei = bi >= 0 ? existing.indexOf(END, bi) : -1;
    const before = bi >= 0 ? existing.slice(0, bi) : existing;
    const inner = bi >= 0 ? existing.slice(bi + BEGIN.length, ei) : "";
    const after = bi >= 0 ? existing.slice(ei + END.length) : "";
    const foreign = inner
      .split(/(?=\n?\[)/)
      .filter(s => /^\s*\[(?!model_providers\.ai-kit\])/.test(s))
      .join("")
      .trim();
    // Windows 下 codex 0.16x+ 的 managed sandbox（自写的 [windows] 段）会压掉
    // --dangerously-bypass-approvals-and-sandbox 旗标，须显式落配置才真正 bypass；
    // 块前（首个表头之前）已有同名键则跳过，避免 TOML 重复键
    const ft = before.search(/^\[/m);
    const head = ft >= 0 ? before.slice(0, ft) : before;
    const bypassKeys = WIN
      ? [`approval_policy = "never"`, `sandbox_mode = "danger-full-access"`]
        .filter(k => !new RegExp(`^${k.split(" ")[0]}\\s*=`, "m").test(head))
      : [];
    const block = [
      BEGIN,
      `model = "${ep.model}"`,
      `model_provider = "ai-kit"`,
      ...bypassKeys,
      ``,
      `[model_providers.ai-kit]`,
      `name = "ai-kit"`,
      `base_url = "${ep.baseUrl}"`,
      `env_key = "AI_KIT_API_KEY"`,
      END,
      "",
    ].join("\n");
    const afterBody = after.replace(/^\n+/, "");
    const beforeTables = ft >= 0 ? before.slice(ft).trim() : "";
    writeFileSync(p,
      (head && !head.endsWith("\n") ? head + "\n" : head)
      + block
      + (beforeTables ? `\n${beforeTables}\n` : "")
      + (foreign ? `\n${foreign}\n` : "")
      + (afterBody ? `\n${afterBody}` : ""));

    const zshenv = join(HOME, ".zshenv");
    const cur = existsSync(zshenv) ? readFileSync(zshenv, "utf8") : "";
    const strippedEnv = cur.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
    writeFileSync(zshenv, strippedEnv + [BEGIN, `export AI_KIT_API_KEY="${apiKey}"`, END, ""].join("\n"));
    console.log(`  ✓ codex → ${p} + key 写入 ~/.zshenv  (${ep.model} @ ${ep.baseUrl})`);
  },
  skillsDir: () => join(HOME, ".codex", "skills"),
};

const zcode = {
  name: "zcode",
  cmd: "zcode",
  installed: () => existsSync(join(HOME, ".zcode")) || which("zcode"),
  async install() {
    console.log("  ⚠ zcode 请从 ZCode 官网/客户端安装；本命令只负责配置与 skills。");
  },
  async applyConfig(_engine, ep, apiKey) {
    const p = join(HOME, ".zcode", "settings.json");
    const settings = readJson(p) ?? {};
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

const ADAPTERS = { "claude-code": claude, codex, zcode };

const WIN = process.platform === "win32";

const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

// WIN 下 npm/claude 多为 .cmd shim 须经 shell；args 数组走 shell 会被裸拼接（DEP0190），改为整条引号串
function sh(cmd, args, opts = {}) {
  return WIN
    ? spawnSync([cmd, ...args].map(q).join(" "), { ...opts, shell: true })
    : spawnSync(cmd, args, opts);
}

function run(cmd, args) {
  return new Promise((ok, err) => {
    const c = sh(cmd, args, { stdio: "inherit" });
    c.status === 0 ? ok() : err(new Error(`${cmd} 退出码 ${c.status}`));
  });
}

function which(cmd) {
  if (!WIN) return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
  // 裸 "where" 依赖 PATH 里有 System32，绝对路径更稳
  const w = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe");
  return spawnSync(w, [cmd], { encoding: "utf8" }).status === 0;
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`未找到配置文件 ${CONFIG_PATH}，先运行 ai-kit（首次引导会自动生成）`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

function resolveEndpoint(cfg, engine) {
  const em = cfg.engines?.[engine];
  if (!em?.model) throw new Error(`.config.json 里没有配置 ${engine} 的 model，请编辑 ${CONFIG_PATH}`);
  const baseUrl = cfg.llm?.[em.protocol]?.baseUrl;
  if (!baseUrl) throw new Error(`.config.json 里没有配置 llm.${em.protocol}.baseUrl（引擎 ${engine} 走 ${em.protocol} 协议），请编辑 ${CONFIG_PATH}`);
  if (!cfg.apiKey) throw new Error(`.config.json 里没有 apiKey，请运行 ai-kit 按提示填写（或编辑 ${CONFIG_PATH}）`);
  return { ep: { baseUrl, model: em.model, smallModel: em.smallModel }, apiKey: cfg.apiKey };
}

function skillsSrc(cfg) {
  const d = cfg?.skillsDir?.trim();
  if (!d) return join(ROOT, "skills");
  return d.startsWith("~") ? join(HOME, d.slice(1)) : resolve(d);
}

async function autoSync(cfg) {
  const src = skillsSrc(cfg);
  if (!src || !existsSync(src)) return;
  if (existsSync(join(src, ".git"))) {
    try {
      const r = sh("git", ["-C", src, "pull", "--ff-only"], { encoding: "utf8", timeout: 30000 });
      if (r.status === 0 && r.stdout?.trim().match(/files? changed|Fast-forward/)) {
        console.log(`  ✓ skills 仓库已更新: ${r.stdout.trim().split("\n")[0]}`);
      }
    } catch { }
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

async function askLine(prompt) {
  // 逐行读取：Response(stdin).text() 要等流关闭(EOF)，交互终端下永不返回（卡死）
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function pickEngine(cfg, title) {
  console.log(title);
  ENGINES.forEach((e, i) =>
    console.log(`  ${i + 1}. ${e}${e === cfg.defaultEngine ? "  ← 默认" : ""}${ADAPTERS[e].installed() ? "" : "  (未安装，选中后自动下载)"}`)
  );
  const answer = await askLine(`输入序号或名称 [回车=${cfg.defaultEngine}]: `);
  let engine;
  if (/^\d$/.test(answer)) engine = ENGINES[Number(answer) - 1];
  else if (ENGINES.includes(answer)) engine = answer;
  return engine ?? cfg.defaultEngine;
}

async function setDefault(cfg, engine) {
  if (engine !== cfg.defaultEngine) {
    cfg.defaultEngine = engine;
    saveConfig(cfg);
    console.log(`默认引擎已切换为 ${engine}`);
  }
  return cfg;
}

async function promptMissing(cfg, engine) {
  if (!process.stdin.isTTY) return cfg;
  console.log(`首次启动 ${engine} / 配置不完整，补全一下（回车跳过表示稍后自己改配置文件）：\n`);
  if (!cfg.apiKey) {
    const v = await askLine("API Key: ");
    if (v) cfg.apiKey = v;
  }
  const em = cfg.engines[engine];
  const proto = em?.protocol ?? "anthropic";
  if (!cfg.llm[proto]?.baseUrl) {
    const v = await askLine(`${proto} 协议地址 (baseUrl): `);
    if (v) cfg.llm[proto] = { baseUrl: v };
  }
  if (em && !em.model) {
    const v = await askLine(`${engine} 的模型名: `);
    if (v) em.model = v;
    if (engine === "claude-code" && !em.smallModel) {
      const sv = await askLine("claude-code 的小模型 (smallModel，可回车跳过): ");
      if (sv) em.smallModel = sv;
    }
  }
  saveConfig(cfg);
  console.log("");
  return cfg;
}

async function onboard() {
  console.log("=== ai-kit 首次设置 ===\n");
  const tpl = readFileSync(join(ROOT, "config.example.json"), "utf8");
  saveConfig(JSON.parse(tpl));
  console.log(`已生成配置 ${CONFIG_PATH}\n`);

  const cfg = loadConfig();
  const engine = await pickEngine(cfg, "选择你的 AI coding 引擎：");
  const a = ADAPTERS[engine];
  if (!a.installed()) {
    console.log(`下载安装 ${engine} ...`);
    await a.install();
  }
  console.log(`\n引擎相关配置（API Key / baseUrl / 模型名）在首次启动对应引擎时引导补全。`);
  return setDefault(cfg, engine);
}

function installedGlobal() {
  return which(SELF);
}

async function maybeAlias(cfg) {
  if (cfg.aliasInstalled !== undefined || WIN || installedGlobal()) return cfg;
  if (!process.stdin.isTTY) return cfg;
  const yes = (await askLine("是否把 ai-kit 加入全局命令（写进 ~/.zshrc 托管块）？[Y/n]: ")).toLowerCase();
  if (yes === "" || yes === "y" || yes === "yes") {
    const cur = existsSync(ZSHRC) ? readFileSync(ZSHRC, "utf8") : "";
    const stripped = cur.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
    writeFileSync(ZSHRC, stripped + [BEGIN, `alias ai-kit='node ${join(ROOT, "src", "index.js")}'`, END, ""].join("\n"));
    console.log("已添加。新终端生效。");
  }
  cfg.aliasInstalled = true;
  saveConfig(cfg);
  return cfg;
}

async function autoUpdate(engine) {
  const a = ADAPTERS[engine];
  if (!a.pkg || !which("npm")) return;
  try {
    const latest = (sh("npm", ["view", a.pkg, "version"], { encoding: "utf8" }).stdout ?? "").trim();
    const cur = ((sh(a.cmd, ["--version"], { encoding: "utf8" }).stdout ?? "").match(/\d+\.\d+\.\d+/) ?? [""])[0];
    if (latest && cur && latest !== cur) {
      console.log(`⬆ ${engine} 有新版本 ${cur} → ${latest}，更新中...`);
      await a.install();
    }
  } catch { }
}

async function install(engineArg) {
  const targets = engineArg ? [engineArg] : ENGINES;
  for (const e of targets) {
    const a = ADAPTERS[e];
    if (!a) { console.error(`未知引擎: ${e}`); continue; }
    console.log(`安装 ${e} ...`);
    if (a.installed()) console.log(`  ✓ ${e} 已安装，跳过`);
    else await a.install();
  }
}

async function start(engineArg) {
  let cfg = existsSync(CONFIG_PATH) ? loadConfig() : await onboard();
  cfg = await maybeAlias(cfg);
  const engine = engineArg ?? cfg.defaultEngine;
  const a = ADAPTERS[engine];
  if (!a) { console.error(`未知引擎: ${engine}`); process.exit(1); }
  if (!which(a.cmd)) {
    console.log(`${a.cmd} 未安装，自动下载...`);
    await a.install();
  }
  await autoUpdate(engine);
  const em0 = cfg.engines?.[engine];
  if (!cfg.apiKey || !em0?.model || !cfg.llm?.[em0?.protocol ?? "anthropic"]?.baseUrl) {
    cfg = await promptMissing(cfg, engine);
  }
  let apiKey;
  try { ({ apiKey } = resolveEndpoint(cfg, engine)); }
  catch (e) { console.error(e.message); process.exit(1); }
  for (const e of ENGINES) {
    const ae = ADAPTERS[e];
    if (!ae.installed()) continue;
    try {
      const r = resolveEndpoint(cfg, e);
      await ae.applyConfig(e, r.ep, r.apiKey);
    } catch { }
  }
  await autoSync(cfg);
  const argv = process.argv.slice(2);
  const passthrough = argv.slice(1).filter(x => !ENGINES.includes(x));
  let mode = "bypass";
  if (process.stdin.isTTY) {
    const answer = (await askLine(`权限模式 [回车=bypass 全自动 / 输入 n=默认审批]: `)).toLowerCase();
    if (answer === "n" || answer === "normal") mode = "normal";
  }
  const extra = mode === "bypass" ? (a.bypassArgs ?? []) : [];
  const child = sh(a.cmd, [...extra, ...passthrough], { stdio: "inherit", env: { ...process.env, AI_KIT_API_KEY: apiKey } });
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
      try { const r = resolveEndpoint(cfg, e); extra = `  ${r.ep.model} (${cfg.engines[e].protocol})`; } catch { extra = "  ⚠ 配置不全"; }
    }
    console.log(`${ok ? "●" : "○"} ${e.padEnd(12)} ${ok ? "已安装" : "未安装"}${extra}${cfg?.defaultEngine === e ? "  ← 默认" : ""}`);
  }
  console.log(`\nconfig: ${CONFIG_PATH}`);
  const src = skillsSrc(cfg ?? {});
  console.log(`skills: ${src}${existsSync(src) ? ` (${readdirSync(src).filter(n => existsSync(join(src, n, "SKILL.md"))).length} 个)` : " (不存在)"}`);
}

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
  case "install":
    await install(rest[0]);
    break;
  case "status":
    await status();
    break;
  default:
    if (ENGINES.includes(cmd)) await start(cmd);
    else console.log(`用法: ai-kit [start|claude-code|codex|zcode|change_engine|install|status]`);
}
