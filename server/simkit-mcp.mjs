#!/usr/bin/env node
// stdio MCP bridge to the SimKit app's loopback MCP server.
// Reads newline-delimited JSON-RPC on stdin, POSTs each message to the app, writes replies to stdout.
// No dependencies. macOS only (the token lookup shells out to plutil).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const PORT = Number(process.env.SIMKIT_MCP_PORT ?? 47290);
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`;
const BUNDLE_IDS = (process.env.SIMKIT_BUNDLE_ID ?? "com.simkit.app").split(",");
const HELP = "SimKit isn't reachable. Open SimKit, turn on Coding Agents in the Agents tab, then retry. Get SimKit: https://simkit.dev";

/** Where the token came from, for the log on stderr. */
let tokenSource = "none";

function readToken() {
  if (process.env.SIMKIT_MCP_TOKEN) {
    tokenSource = "env";
    return process.env.SIMKIT_MCP_TOKEN;
  }
  for (const id of BUNDLE_IDS) {
    const candidates = [
      join(homedir(), "Library/Containers", id, "Data/Library/Preferences", `${id}.plist`),
      join(homedir(), "Library/Preferences", `${id}.plist`),
    ];
    for (const plist of candidates) {
      if (!existsSync(plist)) continue;
      try {
        const token = execFileSync("/usr/bin/plutil", ["-extract", "agents\\.mcp\\.token", "raw", plist], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        }).trim();
        if (token) {
          tokenSource = plist.includes("/Containers/") ? "container" : "preferences";
          return token;
        }
      } catch {
        // Missing key, unreadable file or a denied privacy prompt: try the next place.
      }
    }
  }
  return "";
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function fail(id, text) {
  if (id === undefined || id === null) return; // notifications get no reply
  write({ jsonrpc: "2.0", id, error: { code: -32000, message: text } });
}

async function post(body, token) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
    body,
    signal: AbortSignal.timeout(Number(process.env.SIMKIT_MCP_TIMEOUT_MS ?? 120000)),
  });
}

let token = readToken();

/** SimKit's reply to `body` as text, or null for a notification. Throws with a message for the agent. */
async function ask(body) {
  let response;
  try {
    response = await post(body, token);
    if (response.status === 401) {
      // The user may have pressed New Token; read it again once.
      token = readToken();
      response = await post(body, token);
    }
  } catch (error) {
    throw new Error(error?.cause?.code === "ECONNREFUSED" ? HELP : `SimKit bridge: ${error?.message ?? error}`);
  }
  if (response.status === 202) return null;
  if (response.status === 401) {
    throw new Error("SimKit refused the token. In SimKit's Agents tab press Install again, or set SIMKIT_MCP_TOKEN.");
  }
  if (!response.ok) throw new Error(`SimKit answered HTTP ${response.status}.`);
  return (await response.text()).trim();
}

// MARK: - Tool list
//
// SimKit has about 90 tools and their definitions run to 100 kB, which a client puts in the
// agent's context on every session. By default the bridge lists the everyday ones and puts the
// rest behind find_tools, read_tool and call_tool. SIMKIT_MCP_TOOLS=all lists every tool as SimKit does.

const LIST_ALL = (process.env.SIMKIT_MCP_TOOLS ?? "core").toLowerCase() === "all";
const FIND_LIMIT = 6;

const CORE = new Set([
  "list_simulators", "list_apps", "relaunch_app", "terminate_app", "open_url", "screenshot", "get_app_logs",
  "list_requests", "get_request", "wait_for_request", "export_curl", "clear_requests",
  "list_mocks", "set_mock", "remove_mock", "set_mocking_enabled", "set_network_conditions",
  "get_user_defaults", "set_user_default", "set_appearance", "create_bug_report",
]);

const FIND_TOOLS = {
  name: "find_tools",
  description:
    "Finds the SimKit tools that aren't listed here, which is most of them. Search before deciding SimKit can't do something. "
    + "They cover: simulator settings (location and routes, permissions, text size, locale, status bar, clipboard, Face ID, push, "
    + "media, rotation, boot, erase); an app's data (files, keychain, databases, cookies, language, whole-state snapshots, install, "
    + "reset); more network (HAR, WebSockets, auth tokens, insights, OpenAPI and model generation, sending requests, load tests, "
    + "Network Weather, token expiry, scenarios); capture (video, performance, touches, received links and pushes, accessibility "
    + "audit, design comparison); and paired real devices. Without a query it returns every hidden tool's name and one line; with "
    + `one, the best ${FIND_LIMIT} matches with their full description and input schema. Run a found tool with read_tool when its `
    + "read_only is true, and with call_tool otherwise.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Words to look for in tool names and descriptions, e.g. \"keychain\" or \"location route\"." } },
  },
  annotations: { readOnlyHint: true },
};

// Two tools rather than one so a client that asks the user before every call that isn't read-only
// (Codex does) lets the lookups through: read_tool carries readOnlyHint and refuses anything SimKit
// doesn't mark read-only.
const RUN_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The tool's name, as find_tools returned it." },
    arguments: { type: "object", description: "The tool's arguments." },
  },
  required: ["name"],
};

const READ_TOOL = {
  name: "read_tool",
  description:
    "Runs a SimKit tool found with find_tools whose read_only is true: one that only reads and changes nothing. "
    + "Pass the tool's own arguments, as its input schema describes them, in `arguments`. Other tools are refused; run those with call_tool.",
  inputSchema: RUN_SCHEMA,
  annotations: { readOnlyHint: true },
};

const CALL_TOOL = {
  name: "call_tool",
  description:
    "Runs a SimKit tool found with find_tools that changes something (read_only false). "
    + "Pass the tool's own arguments, as its input schema describes them, in `arguments`.",
  inputSchema: RUN_SCHEMA,
};

let allTools = null;

async function loadTools() {
  if (allTools) return allTools;
  const reply = JSON.parse(await ask(JSON.stringify({ jsonrpc: "2.0", id: "bridge-tools", method: "tools/list" })));
  if (reply.error) throw new Error(reply.error.message);
  allTools = reply.result.tools;
  return allTools;
}

function isReadOnly(tool) {
  return tool.annotations?.readOnlyHint === true;
}

function firstSentence(text) {
  const end = text.search(/[.:](\s|$)/);
  const sentence = end === -1 ? text : text.slice(0, end + 1);
  return sentence.length > 140 ? sentence.slice(0, 139) + "…" : sentence;
}

function findTools(tools, query) {
  const hidden = tools.filter((tool) => !CORE.has(tool.name));
  const words = (query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) {
    return { tools: hidden.map((tool) => ({ name: tool.name, read_only: isReadOnly(tool), summary: firstSentence(tool.description ?? "") })) };
  }
  const scored = hidden
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const description = (tool.description ?? "").toLowerCase();
      const score = words.reduce((sum, word) => sum + (name.includes(word) ? 3 : 0) + (description.includes(word) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return {
    tools: scored.slice(0, FIND_LIMIT).map(({ tool }) => ({ name: tool.name, read_only: isReadOnly(tool), description: tool.description, inputSchema: tool.inputSchema })),
    more_matches: scored.slice(FIND_LIMIT).map(({ tool }) => tool.name),
  };
}

function textResult(id, value, isError = false) {
  write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }], isError } });
}

async function forward(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const { id, method, params } = message;
  try {
    if (!LIST_ALL && method === "tools/list") {
      const tools = await loadTools();
      write({ jsonrpc: "2.0", id, result: { tools: [...tools.filter((tool) => CORE.has(tool.name)), FIND_TOOLS, READ_TOOL, CALL_TOOL] } });
      return;
    }
    if (!LIST_ALL && method === "tools/call" && params?.name === "find_tools") {
      textResult(id, findTools(await loadTools(), params.arguments?.query));
      return;
    }
    let body = line;
    if (!LIST_ALL && method === "tools/call" && (params?.name === "call_tool" || params?.name === "read_tool")) {
      const name = params.arguments?.name;
      if (typeof name !== "string" || !name) {
        textResult(id, { error: `${params.name} needs the tool's name. Use find_tools to look it up.` }, true);
        return;
      }
      if (params.name === "read_tool") {
        const tool = (await loadTools()).find((candidate) => candidate.name === name);
        if (!tool) {
          textResult(id, { error: `SimKit has no tool named ${name}. Use find_tools to look it up.` }, true);
          return;
        }
        if (!isReadOnly(tool)) {
          textResult(id, { error: `${name} changes something, so read_tool won't run it. Use call_tool.` }, true);
          return;
        }
      }
      body = JSON.stringify({ ...message, params: { ...params, name, arguments: params.arguments?.arguments ?? {} } });
    }
    const reply = await ask(body);
    if (reply !== null) process.stdout.write(reply + "\n");
  } catch (error) {
    fail(id, error.message);
  }
}

process.stderr.write(`simkit-mcp bridge → ${ENDPOINT} (token: ${tokenSource})\n`);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (line.trim()) forward(line);
});
// No process.exit here: stdout is a pipe, and exiting would cut off a reply still being written.
// Node exits by itself once stdin has closed and the last reply has drained.
