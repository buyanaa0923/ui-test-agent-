---
description: Watch Mole work in a real browser with the live Mole panel (great for demos); add "record" for a video
argument-hint: "<url> [dig|tunnel] [mobile] [record]"
allowed-tools: mcp__plugin_mole_mole__mole_dig, mcp__plugin_mole_mole__mole_tunnel
---

Open the live view for `$ARGUMENTS`: a browser window opens on the user's screen and the Mole panel shows every step as
it happens (the laser sweep over each checked element, red boxes with the rule on each defect, the running feed of who
decided what).

- The first word is the URL. `dig` (default) calls `mole_dig`; `tunnel` calls `mole_tunnel` (the mole walks to each
  control and shows the safety screen's decision).
- Always pass `watch: true`. Pass `record: true` if `record` is given, and `platform: "mobile"` (dig only) if `mobile` is given.

Afterwards tell the user the verdict, the run folder, and the video path if one was recorded.
