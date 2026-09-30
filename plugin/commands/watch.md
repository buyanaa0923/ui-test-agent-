---
description: Watch Mole work in a real browser with the live mole overlay (great for demos)
argument-hint: <url> [dig|tunnel]
allowed-tools: Bash(node:*)
---

Open the live view for `$ARGUMENTS` by running this in the terminal (the browser opens on the user's screen):

```
node "${CLAUDE_PLUGIN_ROOT}/bin/mole.mjs" <dig|tunnel> <url> --watch --plain
```

- The first word of the arguments is the URL. The second word picks the mode: `dig` (default) scans every element and shows the laser sweep; `tunnel` walks the mole to each control and shows Jev's or Claude's decision on it.
- Add `--record` to save a video of the run in its run folder.
- The command exits 0 when clean, 1 when defects were found, 2 when nothing could be tested. Tell the user the outcome and where the run folder is.
