# SimKit MCP

Let Claude Code, Cursor, Codex and other coding agents see what your iOS app actually does: the requests it sends, the responses it gets, and how it behaves when the server returns a 500 or the network is slow. The agent can also drive the simulator: relaunch, screenshot, dark mode, location, push, deep links, app data.

This package is a small bridge. The tools themselves live in [SimKit for Mac](https://simkit.dev), which is free; the bridge connects your agent to the SimKit app running on the same Mac.

> **Beta.** This needs SimKit 1.8, which is in beta: pick Beta from the Download menu on [simkit.dev](https://simkit.dev). SimKit 1.7 has no MCP server.

## Requirements

- macOS with [SimKit](https://simkit.dev) 1.8 beta or later, running, with **Coding Agents** turned on in the Agents tab
- Node.js 18 or later

## Install

**Claude Code**

```bash
claude mcp add simkit -- npx -y simkit-mcp
```

Or as a plugin, which also adds a skill that teaches the agent when to use SimKit:

```bash
claude plugin marketplace add ealtaca/simkit-mcp
claude plugin install simkit@simkit
```

**Cursor, Kiro and other clients** — add to the client's MCP config:

```json
{
  "mcpServers": {
    "simkit": { "command": "npx", "args": ["-y", "simkit-mcp"] }
  }
}
```

**Codex** — in `~/.codex/config.toml`:

```toml
[mcp_servers.simkit]
command = "npx"
args = ["-y", "simkit-mcp"]
```

If you already pressed Install in SimKit's Agents tab, your client is connected over HTTP and you don't need this package as well.

## Try it

- "List the requests my app made in the last minute and tell me which ones failed."
- "Mock /login to return a 500, relaunch the app and take a screenshot."
- "Throttle the network to 3G and tell me which requests get slow."
- "Create a bug report for my app."

## What agents can do

| Area | Examples |
|---|---|
| Network | list and inspect requests and WebSockets, export cURL/HAR, throttle, generate models and OpenAPI |
| Mocks | add and remove mocked responses, expire a token, run a network scenario |
| Simulator | boot, open links, location, appearance, text size, permissions, clipboard, Face ID, push |
| Apps and data | relaunch, reset, UserDefaults, files, keychain, databases, cookies, whole-state snapshots |
| Capture | screenshots, video, console logs, bug report bundle |

SimKit has about 90 tools. To keep your agent's context small, the bridge lists some 20 of them and the agent looks the others up as it needs them. Tools that only read are run through `read_tool`, which is marked read-only, so a client that asks before every change doesn't ask before a lookup.

Network capture needs either the SimKit SDK in your app or the direct-download build of SimKit.

## How it works, and what it touches

SimKit serves MCP on `127.0.0.1` only, protected by a token. This bridge is one dependency-free Node script (`server/simkit-mcp.mjs`). Everything it does:

- **Reads one value from your Mac:** SimKit's agent token, from SimKit's own settings file (`~/Library/Containers/com.simkit.app/Data/Library/Preferences/com.simkit.app.plist`), using `/usr/bin/plutil`. It reads nothing else.
- **Talks to one address:** `http://127.0.0.1:47290/mcp`, the SimKit app on the same Mac. It sends the token there and nowhere else, and makes no other network request.
- **Writes nothing** to disk, and collects no analytics.

What the tools return (requests, headers, bodies, screenshots) comes from the SimKit app and goes to your agent, which sends it to its model provider like anything else it reads. SimKit's own data handling is in its [privacy policy](https://simkit.dev/privacy-policy).

| Variable | Use |
|---|---|
| `SIMKIT_MCP_TOKEN` | Use this token instead of reading SimKit's settings |
| `SIMKIT_MCP_PORT` | SimKit's MCP port, if you changed it (default 47290) |
| `SIMKIT_MCP_TOOLS` | `all` lists every SimKit tool up front. By default the bridge lists the everyday ones and the agent finds the rest with `find_tools` and runs them with `read_tool` or `call_tool` |
| `SIMKIT_BUNDLE_ID` | Read the token from another SimKit build's settings |

## Troubleshooting

- **"SimKit isn't reachable"** — open SimKit and turn on Coding Agents in the Agents tab.
- **"SimKit refused the token"** — set `SIMKIT_MCP_TOKEN` to the token shown in the Agents tab.

## License

MIT
