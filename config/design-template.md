# <your product> design

Mole tests every page against this file. The ```mole block below holds the facts it can measure; everything else
here is for people. Keep the block small and true: a value you are not sure about is better left out (the pack's
default applies) than guessed. Check what Mole will enforce with `mole design show`.

```mole
extends: modern-web          # built-in best practice (WCAG contrast and target size, readable type); or: netos
platform: desktop            # desktop | mobile; `mole dig --platform mobile` checks the phone layout too

# Your design system's own values. Delete any line you do not have a rule for.
fonts: [Inter]
colors:                      # every colour allowed in inline styles
  primary: "#0f766e"
  ink: "#0f172a"
  surface: "#ffffff"
type:
  scale: [12, 14, 16, 20, 24, 32]
  body-min: { desktop: 14, mobile: 16 }
radius: [0, 4, 8, 12, 9999]
# buttons: { heights: [32, 36, 40], small-max-height: 36, small-max-font: 14 }
# spacing: 4                 # every padding and gap on a 4px grid
# targets: { desktop: 24, mobile: 44 }

# Out of scope: third-party widgets you do not style. "ant-*" (or ".ant-*") = every class starting with ant-;
# any CSS selector works too, e.g. "#legacy-widget".
ignore: []

# Switch a rule off or change its severity: off | low | medium | high
rules: {}
```

## Voice and feel

Describe the feel in a few sentences (for example: calm, dense data screens for analysts; generous whitespace on
marketing pages). Mole does not enforce this part; it tells people, and a reviewing model, what "good" means here.
