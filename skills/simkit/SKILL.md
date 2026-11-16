---
name: simkit
description: Use when working on an iOS app and you need to know what it actually did at runtime — which requests it sent, what came back, how it behaves on a 500, a slow network or an expired token — or need to drive the iOS Simulator (relaunch, screenshot, dark mode, location, push, deep links, app data). Requires the SimKit Mac app with Coding Agents turned on.
---

# SimKit

SimKit is a Mac app that watches an iOS app running in the Simulator (or on a paired device). Its tools let you check what the app really did instead of guessing from the code.

## Before anything else

1. Call `list_simulators` to find the booted simulator's `udid`, then `list_apps` for the app's bundle ID. Most tools take `simulator_udid` and `bundle_id`.
2. If every call fails with "SimKit isn't reachable", ask the user to open SimKit and turn on Coding Agents in its Agents tab. Don't retry in a loop.

## The loop that pays off

After you change networking, auth or error-handling code:

1. Build and install with your usual build tool, then `relaunch_app`.
2. `wait_for_request` for the call you care about, or `list_requests` for an overview. Rows are summaries; use `get_request` for one request's headers and body.
3. Reproduce the failure case with `set_mock` (for example a 500 or a malformed body) or `set_network_conditions`, relaunch, and look again.
4. `screenshot` to see what the user would see.
5. Remove what you set up: `remove_mock`, and reset network conditions.

## What to reach for

If a tool named here isn't in your tool list, it is one of the tools SimKit keeps out of the list to save context: look it up with `find_tools`, then run it with `read_tool` if the result says `read_only: true` and with `call_tool` otherwise.

- **What did the app send?** `list_requests`, `get_request`, `wait_for_request`, `export_curl`, `list_websocket_messages`.
- **How does it handle failure?** `set_mock`, `set_network_weather`, `set_token_expired`, `set_network_conditions`.
- **Auth bugs.** `list_auth_tokens` shows requests sent with a stale token after a refresh.
- **App state.** `get_user_defaults`, `set_user_default`, `list_app_files`, `query_database`, `list_keychain_items`, `save_app_snapshot`, `restore_app_snapshot`, `reset_app_data`.
- **Simulator.** `open_url`, `set_location`, `set_appearance`, `set_text_size`, `set_permission`, `send_push`, `simulate_biometric`.
- **Evidence.** `screenshot`, `record_video`, `get_app_logs`, `create_bug_report`.

## Things to know

- Headers and bodies come back as the app sent them, secrets included. Don't paste tokens or cookies into commits, issues or chat; pass `redact` where a tool offers it.
- Request lists can be long. Filter with `query` and `limit` before fetching bodies.
- Network capture needs either the SimKit SDK in the app or the direct-download build of SimKit. If `list_requests` stays empty while the app is clearly making calls, tell the user that rather than concluding nothing was sent.
- SimKit does not tap or type in the app. Use another tool for UI automation and SimKit to observe the result.
- `erase_simulator`, `reset_app_data`, `uninstall_app` and the delete tools destroy data. Ask before using them unless the user already asked for that.
