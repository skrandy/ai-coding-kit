#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync, lstatSync, readlinkSync, rmdirSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();
const CONFIG_PATH = join(ROOT, ".config.json");
const ZSHRC = join(HOME, ".zshrc");
const BEGIN = "# >>> ai-kit begin >>>";
const END = "# <<< ai-kit end <<<";
const SELF = "ai-kit";

const ENGINES = ["claude-code", "codex"];

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
  protocol: "anthropic",
  bypassArgs: ["--dangerously-skip-permissions"],
  launchArgs: (ep) => ["--model", ep.model],
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
  protocol: "openai",
  bypassArgs: ["--dangerously-bypass-approvals-and-sandbox"],
  launchArgs: (ep) => ["-m", ep.model, "-c", 'model_provider="ai-kit"'],
  restartDaemon() {
    const r = sh("codex", ["app-server", "daemon", "restart"], { stdio: "ignore", timeout: 20000 });
    return r.status === 0;
  },
  pkg: "@openai/codex",
  installed: () => existsSync(join(HOME, ".codex")) || which("codex"),
  nativeBin() {
    if (!WIN) return "";
    for (const root of [dirname(process.execPath), join(HOME, "AppData", "Roaming", "npm")]) {
      const vendor = join(root, "node_modules", "@openai", "codex", "node_modules");
      let level1 = [];
      try { level1 = readdirSync(vendor); } catch { continue; }
      for (const a of level1) {
        for (const dir of [join(vendor, a), join(vendor, a, "@openai")]) {
          let level2 = [];
          try { level2 = readdirSync(dir); } catch { continue; }
          for (const b of level2) {
            const vend = b === "vendor" ? join(dir, b) : join(dir, b, "vendor");
            let archs = [];
            try { archs = readdirSync(vend); } catch { continue; }
            for (const arch of archs) {
              const exe = join(vend, arch, "bin", "codex.exe");
              if (existsSync(exe)) return exe;
            }
          }
        }
      }
    }
    return "";
  },
  async install() {
    await run("npm", ["install", "-g", "@openai/codex"]);
  },
  async applyConfig(_engine, ep, apiKey) {
    const p = join(HOME, ".codex", "config.toml");
    mkdirSync(dirname(p), { recursive: true });
    const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
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

const ADAPTERS = { "claude-code": claude, codex };

const WIN = process.platform === "win32";

const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

function sh(cmd, args, opts = {}) {
  if (WIN && /\.exe$/i.test(cmd)) return spawnSync(cmd, args, opts);
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
  const w = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe");
  return spawnSync(w, [cmd], { encoding: "utf8" }).status === 0;
}

const LEGACY_NAME = { "claude-code": "claude" };

function engineSection(src, engine) {
  const raw = src.engines?.[engine] ?? src[LEGACY_NAME[engine] ?? engine] ?? {};
  const out = { model: raw.model ?? "" };
  if (engine === "claude-code") out.smallModel = raw.smallModel ?? "";
  return out;
}

function normalizeConfig(prev) {
  const rest = { ...prev };
  for (const k of ["defaultEngine", "apiKey", "llm", "engines", "applied",
    "anthropic", "openai", "claude", "codex", "zcode"]) delete rest[k];
  const llm = {};
  for (const proto of ["anthropic", "openai"]) {
    llm[proto] = { baseUrl: prev.llm?.[proto]?.baseUrl ?? prev[proto]?.baseUrl ?? "" };
  }
  const defaultEngine = prev.defaultEngine === "claude" ? "claude-code" : prev.defaultEngine;
  return {
    defaultEngine: ENGINES.includes(defaultEngine) ? defaultEngine : ENGINES[0],
    apiKey: prev.apiKey ?? "",
    llm,
    engines: Object.fromEntries(ENGINES.map(e => [e, engineSection(prev, e)])),
    ...(prev.applied
      ? { applied: Object.fromEntries(Object.entries(prev.applied).filter(([e]) => ENGINES.includes(e))) }
      : {}),
    ...rest,
  };
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`未找到配置文件 ${CONFIG_PATH}，先运行 ai-kit（首次引导会自动生成）`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const cfg = normalizeConfig(raw);
  if (JSON.stringify(raw) !== JSON.stringify(cfg)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`  · ${CONFIG_PATH} 已转成新格式`);
  }
  return cfg;
}

function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

function resolveEndpoint(cfg, engine) {
  const em = cfg.engines?.[engine];
  if (!em?.model) throw new Error(`.config.json 里没有配置 ${engine} 的 model，请编辑 ${CONFIG_PATH}`);
  const proto = ADAPTERS[engine].protocol;
  const baseUrl = cfg.llm?.[proto]?.baseUrl;
  if (!baseUrl) throw new Error(`.config.json 里没有配置 llm.${proto}.baseUrl（${engine} 只认 ${proto} 协议地址），请编辑 ${CONFIG_PATH}`);
  if (!cfg.apiKey) throw new Error(`.config.json 里没有 apiKey，请运行 ai-kit 按提示填写（或编辑 ${CONFIG_PATH}）`);
  return { ep: { baseUrl, model: em.model, smallModel: em.smallModel }, apiKey: cfg.apiKey };
}

function skillsSrc(cfg) {
  const d = cfg?.skillsDir?.trim();
  if (!d) return join(ROOT, "skills");
  return d.startsWith("~") ? join(HOME, d.slice(1)) : resolve(d);
}

function llmFingerprint(ep, apiKey) {
  const key = apiKey ? createHash("sha256").update(apiKey).digest("hex").slice(0, 12) : "";
  return [ep.baseUrl, ep.model, ep.smallModel ?? "", key].join("|");
}

const isRepo = (d) => existsSync(join(d, ".git"));

function gitAsync(args, { cwd, timeout = 20000 } = {}) {
  return new Promise((done) => {
    let out = "", err = "", settled = false;
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ status, stdout: out, stderr: err });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch { } finish(124); }, timeout);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code ?? 1));
  });
}

function gitError(r) {
  const e = r.stderr.trim();
  if (r.status === 124) return "超时，跳过";
  if (/would be overwritten|local changes|unstaged|uncommitted/i.test(e)) return "本地有未提交改动，跳过";
  if (/would clobber|untracked working tree/i.test(e)) return "有未跟踪文件冲突，跳过";
  if (/not possible to fast-forward|diverged|unrelated histories|refusing to merge/i.test(e)) return "与远端分叉，跳过";
  if (/authentication|could not read Username|permission denied|terminal prompts disabled|could not resolve host|unable to access/i.test(e)) return "无网络或无权限，跳过";
  return e.split("\n").filter(Boolean).pop() ?? "拉取失败";
}

async function pullRepo(dir, timeout) {
  const remote = (await gitAsync(["remote"], { cwd: dir, timeout: 5000 })).stdout.trim();
  if (!remote) return { state: "no-remote" };
  const branch = (await gitAsync(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeout: 5000 })).stdout.trim();
  if (!branch || branch === "HEAD") return { state: "detached" };
  const up = (await gitAsync(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: dir, timeout: 5000 })).stdout.trim();
  if (!up) return { state: "skip", msg: "未设置上游分支，跳过" };
  const before = (await gitAsync(["rev-parse", "HEAD"], { cwd: dir, timeout: 5000 })).stdout.trim();
  const f = await gitAsync(["fetch", "--quiet"], { cwd: dir, timeout });
  if (f.status !== 0) return { state: "skip", msg: gitError(f) };
  const m = await gitAsync(["merge", "--ff-only", "--quiet", up], { cwd: dir, timeout });
  if (m.status !== 0) return { state: "skip", msg: gitError(m) };
  const after = (await gitAsync(["rev-parse", "HEAD"], { cwd: dir, timeout: 5000 })).stdout.trim();
  if (!after || after === before) return { state: "same", branch };
  const n = Number((await gitAsync(["rev-list", "--count", `${before}..${after}`], { cwd: dir, timeout: 5000 })).stdout.trim()) || 0;
  return { state: "updated", branch, commits: n, from: before.slice(0, 7), to: after.slice(0, 7) };
}

function skillDirs(src) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(src); } catch { return out; }
  for (const name of entries) {
    const p = join(src, name);
    try { if (statSync(p).isDirectory()) out.push({ name, path: p }); } catch { }
  }
  return out;
}

async function pullSkills(cfg, src) {
  const timeout = Number(cfg.skillsPullTimeout) > 0 ? Number(cfg.skillsPullTimeout) : 20000;
  const tasks = [];
  if (isRepo(src)) tasks.push({ label: "skills", dir: src });
  for (const d of skillDirs(src)) {
    if (isRepo(d.path)) tasks.push({ label: `skills/${d.name}`, dir: d.path });
  }
  if (!tasks.length) return;
  const results = await Promise.all(tasks.map(t => pullRepo(t.dir, timeout)));
  results.forEach((r, i) => {
    const t = tasks[i];
    if (r.state === "updated") {
      console.log(`  ⬆ ${t.label}: +${r.commits} 个提交（${r.from} → ${r.to}）`);
    } else if (r.state === "skip") {
      console.log(`  · ${t.label}: ${r.msg}`);
    }
  });
}

function linkSkill(name, skillPath) {
  const target = resolve(skillPath);
  for (const e of ENGINES) {
    const a = ADAPTERS[e];
    if (!a.installed()) continue;
    const dir = a.skillsDir();
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, name);
    let stat = null;
    try { stat = lstatSync(dest); } catch { }
    let relink = false;
    if (stat) {
      let cur = "";
      try { cur = readlinkSync(dest); } catch { }
      if (cur && resolve(dir, cur.replace(/^\\\\\?\\/, "")) === target) continue;
      if (!stat.isSymbolicLink()) continue;
      try { WIN ? rmdirSync(dest) : unlinkSync(dest); } catch { continue; }
      relink = true;
    }
    try {
      symlinkSync(target, dest, WIN ? "junction" : "dir");
      console.log(`  ${relink ? "↻" : "✓"} skills: ${name} → ${dest}`);
    } catch { }
  }
}

async function autoSync(cfg) {
  const src = skillsSrc(cfg);
  if (!src || !existsSync(src)) return;
  if (cfg.skillsPull !== false) await pullSkills(cfg, src);
  for (const { name, path } of skillDirs(src)) {
    if (!existsSync(join(path, "SKILL.md"))) continue;
    linkSkill(name, path);
  }
}

async function askLine(prompt) {
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
  const proto = ADAPTERS[engine].protocol;
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
  if (!cfg.apiKey || !em0?.model || !cfg.llm?.[a.protocol]?.baseUrl) {
    cfg = await promptMissing(cfg, engine);
  }
  let apiKey, ep;
  try { ({ apiKey, ep } = resolveEndpoint(cfg, engine)); }
  catch (e) { console.error(e.message); process.exit(1); }
  for (const e of ENGINES) {
    const ae = ADAPTERS[e];
    if (!ae.installed()) continue;
    try {
      const r = resolveEndpoint(cfg, e);
      await ae.applyConfig(e, r.ep, r.apiKey);
    } catch {
      console.log(`  · ${e} 配置不全，跳过（沿用该引擎已有配置）`);
    }
  }
  const fp = llmFingerprint(ep, apiKey);
  if ((cfg.applied?.[engine] ?? "") !== fp) {
    if (a.restartDaemon?.()) console.log(`  ✓ 已重启 ${engine} 的常驻服务，旧 key/地址已失效`);
    cfg.applied = { ...(cfg.applied ?? {}), [engine]: fp };
    saveConfig(cfg);
  }
  await autoSync(cfg);
  const argv = process.argv.slice(2);
  const passthrough = argv.slice(1).filter(x => !ENGINES.includes(x));
  let mode = cfg.permissionMode ?? "bypass";
  if (process.stdin.isTTY && (cfg.permissionMode === undefined || cfg.permissionMode === null)) {
    const answer = (await askLine(`权限模式 [回车=bypass 全自动 / 输入 n=默认审批]: `)).toLowerCase();
    if (answer === "n" || answer === "normal") mode = "normal";
    cfg.permissionMode = mode;
    saveConfig(cfg);
  }
  const extra = [
    ...(mode === "bypass" ? (a.bypassArgs ?? []) : []),
    ...(a.launchArgs?.(ep) ?? []),
  ];
  console.log(`LLM: ${ep.model} @ ${ep.baseUrl}\n`);
  const bin = a.nativeBin?.() || a.cmd;
  const child = sh(bin, [...extra, ...passthrough], { stdio: "inherit", env: { ...process.env, AI_KIT_API_KEY: apiKey } });
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
      try { const r = resolveEndpoint(cfg, e); extra = `  ${r.ep.model} (${a.protocol})`; } catch { extra = "  ⚠ 配置不全"; }
    }
    console.log(`${ok ? "●" : "○"} ${e.padEnd(12)} ${ok ? "已安装" : "未安装"}${extra}${cfg?.defaultEngine === e ? "  ← 默认" : ""}`);
  }
  console.log(`\nconfig: ${CONFIG_PATH}`);
  const src = skillsSrc(cfg ?? {});
  const dirs = existsSync(src) ? skillDirs(src) : [];
  const n = dirs.filter(d => existsSync(join(d.path, "SKILL.md"))).length;
  console.log(`skills: ${src}${existsSync(src) ? ` (${n} 个)` : " (不存在)"}`);
  const pull = (cfg ?? {}).skillsPull !== false;
  console.log(`自动拉取: ${pull ? "开" : "关"}${pull ? "" : "（skillsPull: false）"}`);
  for (const d of dirs) {
    if (!existsSync(join(d.path, "SKILL.md")) && !isRepo(d.path)) continue;
    if (!isRepo(d.path)) {
      console.log(`  ○ ${d.name}  本地目录`);
      continue;
    }
    const branch = (sh("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: d.path, encoding: "utf8", timeout: 5000 }).stdout ?? "").trim();
    const dirty = (sh("git", ["status", "--porcelain"], { cwd: d.path, encoding: "utf8", timeout: 5000 }).stdout ?? "").trim();
    const remote = (sh("git", ["remote", "get-url", "origin"], { cwd: d.path, encoding: "utf8", timeout: 5000 }).stdout ?? "").trim();
    const marks = [
      branch && branch !== "HEAD" ? branch : "detached",
      dirty ? `未提交 ${dirty.split("\n").length}` : "",
      remote ? "git" : "无 origin",
    ].filter(Boolean).join("  ");
    console.log(`  ● ${d.name}  ${marks}`);
  }
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
    else console.log(`用法: ai-kit [start|claude-code|codex|change_engine|install|status]`);
}
