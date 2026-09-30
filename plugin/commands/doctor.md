---
description: Check that Mole is ready on this machine (browser, keys, network)
argument-hint: [app-url]
allowed-tools: mcp__plugin_mole_mole__mole_doctor
---

Run the `mole_doctor` tool. If `$ARGUMENTS` holds a URL, pass it as `url` so reachability of the app under test is checked too.

Report what is ready and what is not. For every failed or missing item give the exact fix the tool returned. Missing Jev or Claude keys are not blockers: Mole still runs rules-only scans. Never ask the user to paste a key into the chat: tell them to put it in the `.env` file.
