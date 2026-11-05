// dsh-md-studio host half.
//
// 1. Serves an optional vendored mermaid runtime from ./runtime (offline mode).
// 2. Registers a system-prompt section teaching the model the mds-diagram
//    fence and the theme-variable text rule; the full drawing spec ships as
//    the mds-diagram-design bundled skill registered below.
// 3. Ships the drawing-spec skill inside the package and registers it on
//    ctx.root as a bundled skill provider; no copy under user skill roots.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, sep } from "node:path";

const name = "dsh-md-studio";
const inject = ["webServer", "systemPrompt"];

const RUNTIME_ROUTE = "/dsh-md-studio/runtime";
const runtimeDir = fileURLToPath(new URL("./runtime", import.meta.url));
const SKILL_NAME = "mds-diagram-design";
const SKILL_PROVIDER = name;
const SKILL_RANK = 600;
const skillDir = fileURLToPath(new URL("../assets/mds-diagram-design", import.meta.url));

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const GUIDELINE = `## 图表组件（mds-diagram）

需要画架构图/流程图/示意图时，优先用 \`\`\`mds-diagram <可选标题> 围栏输出手写 SVG（简单流程继续用 mermaid 围栏）。完整绘图规范（色板/布局/关系表达/自查清单）请用 skill 工具加载 **mds-diagram-design** skill 后遵循。

必须遵守的三条硬规则：
1. 画布级文字（图例、分组标签）用主题变量：style="fill:var(--dsw-alias-label-primary,#1F2937)"——禁止硬编码深灰，深色模式下会不可见。
2. 节点用浅色底+深色字（蓝 #B5D4F4/#0C447C，橙 #FAC775/#633806，绿 #9FE1CB/#085041，紫 #CECBF6/#3C3489），全图最多 4 种语义色，≥3 种时必须有图例。
3. 根元素 <svg viewBox="0 0 W H" width="100%" font-family="system-ui,sans-serif">，内放 <title>（作为卡片标题），箭头 marker id 加随机后缀防冲突。`;

async function readBundledSkill() {
  const skillPath = join(skillDir, "SKILL.md");
  const raw = await readFile(skillPath, "utf8");
  const end = raw.indexOf("\n---\n", 4);
  if (!raw.startsWith("---\n") || end < 0) {
    throw new Error("[dsh-md-studio] " + skillPath + " 缺少 YAML frontmatter");
  }
  const front = raw.slice(4, end).split("\n");
  const field = (key) => {
    for (let i = 0; i < front.length; i++) {
      const line = front[i];
      const colon = line.indexOf(":");
      if (colon < 0 || line.slice(0, colon).trim() !== key) continue;
      const rest = line.slice(colon + 1).trim();
      if (rest === ">" || rest === ">-" || rest === "|" || rest === "|-") {
        const parts = [];
        for (let j = i + 1; j < front.length; j++) {
          const next = front[j];
          if (next.trim() === "" || !/^\s/u.test(next)) break;
          parts.push(next.trim());
        }
        return parts.join(" ").trim() || undefined;
      }
      return rest.replace(/^["']|["']$/g, "") || undefined;
    }
    return undefined;
  };
  const skillName = field("name") ?? SKILL_NAME;
  const description = field("description");
  if (!description) throw new Error("[dsh-md-studio] " + skillPath + " 的 frontmatter 缺少 description");
  const candidate = {
    name: skillName,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: "bundled",
    provider: SKILL_PROVIDER,
    path: skillPath,
    resourceBase: { kind: "directory", path: skillDir },
  };
  return { candidate, content: raw.slice(end + 5).trim() };
}

function bundledSkillProvider() {
  return {
    name: SKILL_PROVIDER,
    list: async () => {
      const { candidate } = await readBundledSkill();
      return [{ ...candidate, rank: SKILL_RANK, locator: candidate.path }];
    },
    get: async () => {
      const { candidate, content } = await readBundledSkill();
      return { ...candidate, content };
    },
  };
}

const registeredRoots = new WeakSet();

function registerBundledSkill(ctx) {
  const rootCtx = ctx.root ?? ctx;
  if (registeredRoots.has(rootCtx)) return;
  registeredRoots.add(rootCtx);
  try {
    rootCtx.inject(["skills"], (skillCtx) => {
      skillCtx.skills.registerProvider(() => bundledSkillProvider());
    });
  } catch (error) {
    registeredRoots.delete(rootCtx);
    console.error("[dsh-md-studio] skill 注册失败,本进程不提供 mds-diagram-design skill: " + String(error));
  }
}

function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: RUNTIME_ROUTE,
        async handler(req, res) {
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405);
            res.end();
            return;
          }
          const url = new URL(req.url ?? "/", "http://dsh.invalid");
          let rel;
          try {
            rel = decodeURIComponent(url.pathname.slice(RUNTIME_ROUTE.length));
          } catch {
            res.writeHead(400);
            res.end();
            return;
          }
          rel = rel.replace(/^\/+/, "");
          if (!rel || rel.includes("..") || rel.includes("\0") || rel.includes("\\") || /[:*?"<>|]/.test(rel)) {
            res.writeHead(404);
            res.end();
            return;
          }
          const root = normalize(runtimeDir);
          const target = normalize(join(root, rel));
          if (target !== root && !target.startsWith(root + sep)) {
            res.writeHead(404);
            res.end();
            return;
          }
          try {
            const body = await readFile(target);
            const dot = target.lastIndexOf(".");
            const ext = dot === -1 ? "" : target.slice(dot).toLowerCase();
            res.writeHead(200, {
              "content-type": MIME[ext] ?? "application/octet-stream",
              "cache-control": "public, max-age=86400",
            });
            res.end(req.method === "HEAD" ? undefined : body);
          } catch {
            res.writeHead(404);
            res.end();
          }
        },
      }),
    "dsh-md-studio: vendored runtime route",
  );
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: "mds-diagram-guidelines",
      order: 5200,
      text: GUIDELINE,
    }),
    "dsh-md-studio: diagram design guidelines",
  );
  registerBundledSkill(ctx);
}

export { apply, inject, name };
