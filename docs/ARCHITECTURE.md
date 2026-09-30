# Architecture

Mole is one engine that emits events, and several surfaces that only listen.

```
                        ┌────────────────────── surfaces (listen only) ───────────────────────┐
 bin/mole.mjs           │  terminal (live · plain · json)   browser overlay   dashboard   MCP  │
      │                 └───────────────▲──────────────────────────▲────────────────────▲──────┘
      ▼                                 │  pure reducer: (state, event) -> state        │
 src/cli ──▶ src/engine ──emit──▶  EventBus  ──────────────────────────────────────────┘
              dig · tunnel            │
                 │  ▲                 └──▶ runs/<id>/trace.jsonl   (replay any run later)
                 ▼  │
          src/models (Jev → Claude → human)        src/core (meter, run, events, paths, findings)
```

## Layers and the one rule

```
bin/                 entry point (3 lines)
src/
  cli/               argument parsing, one file per command, exit codes          -> may import everything below
  mcp/               MCP server (stdio JSON-RPC) + tool catalogue                -> engine, core, models
  ui/
    state.mjs        pure reducer shared by every surface
    terminal/        theme, sprite, view (pure), live / plain / json renderers
    overlay/         in-page overlay (inject.js) + the Node side that drives it
    dashboard/       local web dashboard + scorecard
  engine/            what a run DOES: dig, tunnel, browser, guard, design rules   -> core, models. Never src/ui or src/cli
  models/            Jev, Claude, the trust ladder (cascade), output validation   -> core
  eval/              measurement: metrics, labelled real set, scorecard data      -> core, models
  core/              events, run folder, meter, findings, paths, errors, env      -> nothing above
config/  bench/  eval/  test-pages/   data (tokens, prices, ground truth, labels, fixtures)
plugin/  .claude-plugin/              Claude Code plugin: commands, skill, hooks, manifests
scripts/quality|eval|dev              tools for maintainers, not part of the product
test/                                 mirrors src/ (core, engine, models, eval, ui, cli, mcp, quality)
docs/  assets/                        documentation and brand
```

**Dependencies point down only.** `engine` never imports from `ui` or `cli`: it emits events and returns a result. That is why
the same run can be shown in a terminal, in a browser overlay, in an MCP client or replayed from a file, and why the engine is
testable without any display. If you need something from a surface inside the engine, pass a hook (see `attach` in
`engine/session.mjs`), do not import it.

## The event stream

Every command creates an `EventBus` (`core/events.mjs`). The engine emits plain-JSON events (`run.start`, `page.loaded`,
`finding`, `decision`, `control.pick`, `run.end`, ...; the full vocabulary is documented at the top of `events.mjs`). The Meter
adds `stage.start` / `stage.end` with cost. The bus writes every event to `runs/<id>/trace.jsonl`.

- **Terminal**: `ui/state.mjs` reduces events to a state; `ui/terminal/view.mjs` turns a state into lines (pure, snapshot-testable);
  `live.mjs` redraws them in place, `plain.mjs` prints one line per event (CI, pipes, Claude Code's Bash tool), `--json` prints NDJSON.
- **Overlay**: `ui/overlay/index.mjs` subscribes to the same bus and drives `inject.js` inside the page (shadow DOM on `<html>`,
  `pointer-events:none`, hidden while measuring and screenshotting). A test proves it does not change what the rules measure.
- **Replay**: `mole replay <run>` feeds a recorded trace back through the same reducer. No browser, no model calls.
- **MCP**: streams `notifications/progress` from the same events and returns a compact, structured result.

Because every surface derives from events, none of them can show something that did not happen. Nothing on screen is scripted.

## Files a run leaves behind (`runs/<name>-<timestamp>/`)

| File | What it is |
| :- | :- |
| `report.json` | the result (schema shared with the scorecard and the labelling tools) |
| `trace.jsonl` | every event, in order (for replay) |
| `events.jsonl` | Meter stages with time and cost (the dashboard tails this) |
| `decisions.jsonl` | every Jev/Claude decision with confidence, gate and cost |
| `escalations.jsonl` | picker fallbacks (Jev unsure/failed) |
| `light.png` `dark.png` `step-NN.png` | screenshots, taken with the overlay hidden |
| `video/` | with `--record` |

Set `MOLE_RUNS_DIR` to put runs elsewhere (tests do).

## Invariants (each has a test)

1. **NOT RUN is a failure, never a pass.** Login walls, dead URLs, blank pages and missing login files end in exit 2 and a `not_run` report.
2. **Dismissing needs more confidence than confirming** (0.9 vs 0.8). A model outage leaves findings `unjudged` and the run failing, never silently clean.
3. **Deterministic first.** Structural exemptions are decided by rules (`engine/exemptions.mjs`), never by a model.
4. **The overlay never changes measurements.** It is outside `<body>`, closed shadow root, hidden while collecting.
5. **Each distinct defect is judged once.** The same finding in light and dark shares one verdict (half the model calls).
6. **Spend is capped** (`BUDGET_USD`) and every model call is metered, including the risk screen.
7. **Nothing prints from the engine.** Only surfaces write to stdout; in MCP mode stdout carries protocol messages only.

## How to extend

| To add | Do this |
| :- | :- |
| a CLI command | add `src/cli/commands/<name>.mjs` (`name, summary, usage, options, run`) and register it in `commands/index.mjs` |
| a design rule | add it in `engine/design-checks.mjs`, add a mutation to `bench/truth.json`; `npm run evidence` must stay at precision/recall 1 |
| an event | emit it from the engine, document it in `core/events.mjs`, handle it in `ui/state.mjs` (surfaces then pick it up) |
| a surface | subscribe to the bus; reuse `ui/state.mjs`; do not import it from `engine/` |
| an MCP tool | add it to `src/mcp/tools.mjs` |
| a slash command or skill | add a `.md` under `plugin/commands/` or `plugin/skills/` |

## Brand assets

`assets/brand/mole.png` is the source sprite. `npm run build:sprite` regenerates `src/ui/terminal/mole.sprite.json` from it
(dependency-free PNG decode). `npm run trace:png -- <run>` renders a run's terminal view to an image for docs and slides.
