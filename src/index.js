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
    const env = { ...(settings.env ?? {}) };
    // 旧的 SMALL_FAST_MODEL 已废弃，统一走 DEFAULT_*_MODEL；清掉以免残值冲突
    for (const k of ["ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"]) delete env[k];
    settings.env = {
      ...env,
      ANTHROPIC_BASE_URL: ep.baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: ep.model,
      ...(ep.opusModel ? { ANTHROPIC_DEFAULT_OPUS_MODEL: ep.opusModel } : {}),
      ...(ep.sonnetModel ? { ANTHROPIC_DEFAULT_SONNET_MODEL: ep.sonnetModel } : {}),
      ...(ep.haikuModel ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: ep.haikuModel } : {}),
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
const PROTOS = ["anthropic", "openai"];

function engineSection(src, engine) {
  const raw = src?.engines?.[engine] ?? src?.[LEGACY_NAME[engine] ?? engine] ?? {};
  if (engine === "claude-code") {
    // 主模型 = opus 档，不再单独存 model；老字段 model / smallModel 各自折算
    return {
      opusModel: raw.opusModel ?? raw.model ?? "",
      sonnetModel: raw.sonnetModel ?? "",
      haikuModel: raw.haikuModel ?? raw.smallModel ?? "",
    };
  }
  return { model: raw.model ?? "" };
}

// 各引擎“本次实际请求的模型名”：claude-code 取 opus 档，codex 取 model
const mainModelOf = (p, engine) =>
  engine === "claude-code" ? (p?.engines?.["claude-code"]?.opusModel ?? "") : (p?.engines?.[engine]?.model ?? "");

function normalizeProfile(src) {
  const s = src ?? {};
  const llm = {};
  for (const proto of PROTOS) llm[proto] = { baseUrl: s.llm?.[proto]?.baseUrl ?? s[proto]?.baseUrl ?? "" };
  const out = {
    apiKey: s.apiKey ?? "",
    llm,
    engines: Object.fromEntries(ENGINES.map(e => [e, engineSection(s, e)])),
  };
  const desc = typeof s.desc === "string" ? s.desc.trim() : "";
  if (desc) out.desc = desc;
  return out;
}

const isBlankProfile = (p) => !p?.apiKey
  && !p?.llm?.anthropic?.baseUrl && !p?.llm?.openai?.baseUrl
  && ENGINES.every(e => !mainModelOf(p, e));

const NAME_SKIP = new Set(["api", "www", "openai", "anthropic", "v1", "com", "cn", "net", "org", "io", "ai", "co", "dev", "app"]);

function guessProfileName(src) {
  const urls = [src?.llm?.openai?.baseUrl, src?.llm?.anthropic?.baseUrl, src?.openai?.baseUrl, src?.anthropic?.baseUrl];
  for (const u of urls) {
    if (!u) continue;
    try {
      const parts = new URL(u).hostname.replace(/^www\./, "").split(".");
      const hit = parts.find(p => p.length > 1 && !NAME_SKIP.has(p) && !/^\d+$/.test(p));
      if (hit) return hit;
    } catch { }
  }
  return "";
}

function uniqueName(profiles, base) {
  const clean = String(base || "key").replace(/[^\w.一-龥-]+/g, "-").replace(/^-+|-+$/g, "") || "key";
  if (!profiles[clean]) return clean;
  let i = 2;
  while (profiles[`${clean}-${i}`]) i++;
  return `${clean}-${i}`;
}

function normalizeConfig(prev) {
  const rest = { ...prev };
  for (const k of ["defaultEngine", "defaultProfile", "profiles", "apiKey", "llm", "engines",
    "applied", "anthropic", "openai", "claude", "codex", "zcode"]) delete rest[k];

  const profiles = {};
  const raw = prev.profiles;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const name = String(k).trim();
      if (name) profiles[name] = normalizeProfile(v);
    }
  }
  // 老版本扁平配置 → 自动折成一套命名配置
  if (!Object.keys(profiles).length) {
    profiles[uniqueName(profiles, guessProfileName(prev) || "default")] = normalizeProfile(prev);
  }

  const defaultEngine = prev.defaultEngine === "claude" ? "claude-code" : prev.defaultEngine;
  let defaultProfile = typeof prev.defaultProfile === "string" ? prev.defaultProfile.trim() : "";
  if (!profiles[defaultProfile]) defaultProfile = Object.keys(profiles)[0];

  return {
    defaultEngine: ENGINES.includes(defaultEngine) ? defaultEngine : ENGINES[0],
    defaultProfile,
    profiles,
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

function profileEntry(cfg, name) {
  const key = name ?? cfg.defaultProfile;
  const p = cfg.profiles?.[key];
  if (!p) {
    const avail = Object.keys(cfg.profiles ?? {});
    throw new Error(`找不到配置 "${key}"${avail.length ? `（可用：${avail.join(" / ")}）` : ""}，运行 ai-kit switch 管理`);
  }
  return { name: key, p };
}

function missingFor(p, engine) {
  const out = [];
  if (!p?.apiKey) out.push("apiKey");
  const proto = ADAPTERS[engine].protocol;
  if (!p?.llm?.[proto]?.baseUrl) out.push(`llm.${proto}.baseUrl`);
  if (!mainModelOf(p, engine)) out.push(engine === "claude-code" ? "claude-code 的 opus 档（主模型）" : `${engine} 的 model`);
  return out;
}

function resolveEndpoint(cfg, engine, name) {
  const { name: n, p } = profileEntry(cfg, name);
  const miss = missingFor(p, engine);
  if (miss.length) throw new Error(`配置 "${n}" 缺 ${miss.join(" / ")}，运行 ai-kit switch 补全（或编辑 ${CONFIG_PATH}）`);
  const em = p.engines[engine];
  const proto = ADAPTERS[engine].protocol;
  const ep = { baseUrl: p.llm[proto].baseUrl, model: mainModelOf(p, engine) };
  if (engine === "claude-code") {
    ep.opusModel = em.opusModel ?? "";
    ep.sonnetModel = em.sonnetModel ?? "";
    ep.haikuModel = em.haikuModel ?? "";
  }
  return { ep, apiKey: p.apiKey, profile: n };
}

function skillsSrc(cfg) {
  const d = cfg?.skillsDir?.trim();
  if (!d) return join(ROOT, "skills");
  return d.startsWith("~") ? join(HOME, d.slice(1)) : resolve(d);
}

function llmFingerprint(ep, apiKey) {
  const key = apiKey ? createHash("sha256").update(apiKey).digest("hex").slice(0, 12) : "";
  return [ep.baseUrl, ep.model, ep.haikuModel ?? "", ep.sonnetModel ?? "", ep.opusModel ?? "", key].join("|");
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

const maskKey = (k) => (!k ? "无 key" : k.length <= 8 ? "****" : `…${k.slice(-4)}`);
const shortUrl = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\/.*$/, "");
const wlen = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
const padW = (s, n) => s + " ".repeat(Math.max(0, n - wlen(s)));

function listProfiles(cfg, { numbers = true } = {}) {
  const names = Object.keys(cfg.profiles);
  console.log(`API Key 配置（${names.length} 套，用这套：${cfg.defaultProfile}）`);
  names.forEach((n, i) => {
    const p = cfg.profiles[n];
    const models = ENGINES.map(e => `${e === "claude-code" ? "claude" : e}:${mainModelOf(p, e) || "未配置"}`).join("  ");
    const host = shortUrl(p.llm?.openai?.baseUrl || p.llm?.anthropic?.baseUrl) || "未配置";
    const head = numbers ? `${String(i + 1).padStart(2)}. ` : "    ";
    const star = n === cfg.defaultProfile ? "●" : "○";
    console.log(`  ${head}${star} ${padW(n, 14)} ${padW(models, 42)} ${padW(host, 28)} ${maskKey(p.apiKey)}${p.desc ? `  # ${p.desc}` : ""}`);
  });
}

async function editProfile(cfg, name, { engine } = {}) {
  const p = cfg.profiles[name];
  const protoOrder = engine ? [ADAPTERS[engine].protocol, ...PROTOS.filter(x => x !== ADAPTERS[engine].protocol)] : PROTOS;
  const engineOrder = engine ? [engine, ...ENGINES.filter(e => e !== engine)] : ENGINES;
  const ask = (label, cur) => askLine(`${label}${cur ? ` [${cur}]` : ""}: `);
  console.log(`\n填写配置 "${name}" —— 回车跳过 / 保持原值\n`);
  const key = await ask("API Key", p.apiKey ? maskKey(p.apiKey) : "");
  if (key) p.apiKey = key;
  const desc = await ask("备注（套餐/账号，可空）", p.desc ?? "");
  if (desc) p.desc = desc;
  for (const proto of protoOrder) {
    const v = await ask(`${proto} baseUrl`, p.llm[proto].baseUrl);
    if (v) p.llm[proto].baseUrl = v;
  }
  for (const e of engineOrder) {
    const em = p.engines[e];
    if (e === "claude-code") {
      for (const [label, k] of [["主模型（opus 档，必填）", "opusModel"], ["sonnet 档（可空）", "sonnetModel"], ["haiku 档（后台小任务，可空）", "haikuModel"]]) {
        const v = await ask(`claude-code ${label}`, em[k]);
        if (v) em[k] = v;
      }
    } else {
      const v = await ask(`${e} 模型名`, em.model);
      if (v) em.model = v;
    }
  }
  saveConfig(cfg);
  console.log(`✓ 已保存配置 "${name}"`);
  if (engine) {
    const miss = missingFor(p, engine);
    if (miss.length) console.log(`  · 还缺 ${miss.join(" / ")}，${engine} 暂时跑不起来`);
  }
}

async function addProfile(cfg, { engine, name } = {}) {
  const names = Object.keys(cfg.profiles);
  const blank = names.find(n => isBlankProfile(cfg.profiles[n]));
  const fallback = blank ?? uniqueName(cfg.profiles, `key${names.length + 1}`);
  let n = (name ?? await askLine(`配置名称（区分套餐/账号，比如 ark-coding、ark-包月）[回车=${fallback}]: `)).trim();
  if (!n) n = fallback;

  if (cfg.profiles[n] && !isBlankProfile(cfg.profiles[n])) {
    console.log(`"${n}" 已存在，没动它。要改请用 e ${n}`);
    return null;
  }
  if (cfg.profiles[n]) {
    // 复用占位空配置
  } else if (blank) {
    // 把空占位改名成新名字
    const ordered = {};
    for (const [k, v] of Object.entries(cfg.profiles)) ordered[k === blank ? n : k] = v;
    cfg.profiles = ordered;
    if (cfg.defaultProfile === blank) cfg.defaultProfile = n;
  } else {
    cfg.profiles[n] = normalizeProfile({});
  }
  saveConfig(cfg);

  await editProfile(cfg, n, { engine });

  cfg.defaultProfile = n;
  saveConfig(cfg);
  console.log(`✓ 以后就用 "${n}" 了\n`);
  return n;
}

async function renameProfile(cfg, from, to) {
  if (!to || to === from) return false;
  if (cfg.profiles[to]) { console.log(`"${to}" 已存在，换个名字`); return false; }
  const ordered = {};
  for (const [k, v] of Object.entries(cfg.profiles)) ordered[k === from ? to : k] = v;
  cfg.profiles = ordered;
  if (cfg.defaultProfile === from) cfg.defaultProfile = to;
  saveConfig(cfg);
  console.log(`✓ "${from}" → "${to}"`);
  return true;
}

function removeProfile(cfg, name) {
  if (Object.keys(cfg.profiles).length <= 1) { console.log("至少留一套配置"); return false; }
  delete cfg.profiles[name];
  if (cfg.defaultProfile === name) cfg.defaultProfile = Object.keys(cfg.profiles)[0];
  saveConfig(cfg);
  console.log(`✓ 已删除 "${name}"`);
  return true;
}

async function pickProfile(cfg) {
  for (;;) {
    const names = Object.keys(cfg.profiles);
    console.log("");
    listProfiles(cfg);
    const ans = (await askLine(`\n回车=退出 / 序号=用这套 / a=新增 / e=改 / r=改名 / d=删: `)).trim();
    if (!ans) return null;
    const [op, given] = ans.split(/\s+/);

    // 直接输序号（或名字）＝用这套
    if (/^\d+$/.test(op) || cfg.profiles[op]) {
      const pick = /^\d+$/.test(op) ? names[Number(op) - 1] : op;
      if (!pick) { console.log("没有这个序号"); continue; }
      cfg.defaultProfile = pick;
      saveConfig(cfg);
      console.log(`✓ 以后就用 "${pick}" 了`);
      return pick;
    }
    if (op === "a") {
      const n = await addProfile(cfg);
      if (n) return n;
      continue;
    }
    if (!["e", "r", "d"].includes(op)) {
      console.log("按提示输入：序号 / a / e / r / d");
      continue;
    }
    // 两步：先问要动哪一套
    const raw = given ?? (await askLine(`${op === "e" ? "改" : op === "r" ? "改名" : "删"}哪一套（序号）: `)).trim();
    const target = /^\d+$/.test(raw) ? names[Number(raw) - 1] : raw;
    if (!target || !cfg.profiles[target]) { console.log("没有这个序号"); continue; }

    if (op === "e") { await editProfile(cfg, target); continue; }
    if (op === "r") {
      const nn = (await askLine(`新名字 [${target}]: `)).trim();
      await renameProfile(cfg, target, nn);
      continue;
    }
    const yes = (await askLine(`确认删除 "${target}"？[y/N]: `)).toLowerCase();
    if (yes === "y" || yes === "yes") removeProfile(cfg, target);
  }
}

async function switchProfile(name) {
  const cfg = loadConfig();
  const names = Object.keys(cfg.profiles);
  if (name) {
    if (!cfg.profiles[name]) {
      console.error(`没有 "${name}"，可用：${names.join(" / ")}`);
      process.exit(1);
    }
    cfg.defaultProfile = name;
    saveConfig(cfg);
    console.log(`✓ 以后就用 "${name}" 了`);
    return name;
  }
  if (!process.stdin.isTTY) { listProfiles(cfg); return null; }
  return pickProfile(cfg);
}

async function onboard() {
  console.log("=== ai-kit 首次设置 ===\n");
  const tpl = readFileSync(join(ROOT, "config.example.json"), "utf8");
  saveConfig(normalizeConfig(JSON.parse(tpl)));
  console.log(`已生成配置 ${CONFIG_PATH}\n`);

  const cfg = loadConfig();
  const engine = await pickEngine(cfg, "选择你的 AI coding 引擎：");
  const a = ADAPTERS[engine];
  if (!a.installed()) {
    console.log(`下载安装 ${engine} ...`);
    await a.install();
  }
  cfg.defaultEngine = engine;
  saveConfig(cfg);

  if (process.stdin.isTTY) {
    const yes = (await askLine(`\n现在配一套 API Key 吗？（之后随时 ai-kit switch 增删切换）[Y/n]: `)).toLowerCase();
    if (yes === "" || yes === "y" || yes === "yes") await addProfile(cfg, { engine });
  } else {
    console.log(`\nAPI Key / baseUrl / 模型名在首次启动对应引擎时引导补全。`);
  }
  return cfg;
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

function parseArgs(args) {
  let engine;
  const passthrough = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!engine && ENGINES.includes(a)) { engine = a; continue; }
    passthrough.push(a);
  }
  return { engine, passthrough };
}

async function start(cliArgs = []) {
  const { engine: engineArg, passthrough } = parseArgs(cliArgs);
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

  const pname = cfg.defaultProfile;
  const miss = missingFor(cfg.profiles[pname], engine);
  if (miss.length) {
    if (!process.stdin.isTTY) {
      console.error(`配置 "${pname}" 缺 ${miss.join(" / ")}，在终端里跑一次 ai-kit switch 补全`);
      process.exit(1);
    }
    console.log(`配置 "${pname}" 在 ${engine} 下缺 ${miss.join(" / ")}`);
    await editProfile(cfg, pname, { engine });
  }
  let apiKey, ep;
  try { ({ apiKey, ep } = resolveEndpoint(cfg, engine, pname)); }
  catch (e) { console.error(e.message); process.exit(1); }

  for (const e of ENGINES) {
    const ae = ADAPTERS[e];
    if (!ae.installed()) continue;
    let r = null;
    for (const n of [...new Set([pname, cfg.defaultProfile])]) {
      try { r = resolveEndpoint(cfg, e, n); break; } catch { }
    }
    if (!r) { console.log(`  · ${e} 在这套配置里不全，跳过（沿用该引擎已有配置）`); continue; }
    try { await ae.applyConfig(e, r.ep, r.apiKey); } catch { }
  }

  const fp = `${pname}|${llmFingerprint(ep, apiKey)}`;
  if ((cfg.applied?.[engine] ?? "") !== fp) {
    if (a.restartDaemon?.()) console.log(`  ✓ 已重启 ${engine} 的常驻服务，旧 key/地址已失效`);
    cfg.applied = { ...(cfg.applied ?? {}), [engine]: fp };
    saveConfig(cfg);
  }
  await autoSync(cfg);
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
  console.log(`LLM: [${pname}] ${ep.model} @ ${ep.baseUrl}\n`);
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
      try { const r = resolveEndpoint(cfg, e, cfg.defaultProfile); extra = `  ${r.ep.model} (${a.protocol})`; } catch { extra = "  ⚠ 默认配置不全"; }
    }
    console.log(`${ok ? "●" : "○"} ${e.padEnd(12)} ${ok ? "已安装" : "未安装"}${extra}${cfg?.defaultEngine === e ? "  ← 默认" : ""}`);
  }
  if (cfg) {
    console.log("");
    listProfiles(cfg);
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
    await start(rest);
    break;
  case "switch":
  case "use":
  case "profile":
    if (await switchProfile(rest[0])) await start(rest.slice(1));
    break;
  case "change_engine":
  case "change-engine":
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
    if (ENGINES.includes(cmd)) await start([cmd, ...rest]);
    else console.log(`用法: ai-kit [switch <名字>|claude-code|codex|change_engine|install|status]`);
}
