# Style consistency

The design rules check each element against allowed values. A page can pass all of them — the right fonts, colours and
spacing — and still look like it belongs to another website: a contact page generated in a different session, with
rounded, shadowed, gradient cards and centred emoji headings, on a site that is otherwise a sharp Swiss grid.
`mole tunnel` (with design checks on, the default) catches that by comparing the pages it reaches **with each other**.

## How it decides (`src/engine/fingerprint.mjs`)

1. **Fingerprint every page** from what `collect()` already measured, in light mode: how it *composes* its tokens.

   | Family | Features | Tier |
   | :- | :- | :- |
   | corners | share of cards/panels with 8px+ corners, typical card radius, share of pill buttons, typical button/field radius | strong |
   | depth | share of cards/panels with drop shadows, share of cards and filled buttons with gradients | strong |
   | voice | emoji use: none / some / throughout (not a share of text, which depends on the content) | strong |
   | type | share of text in the site's main typeface, heading weight | strong |
   | type | heading letter-spacing | weak |
   | layout | share of centred text | weak |

   A feature is blank when the page has none of the thing (no cards: no card style), so pages with little on them are
   not judged on what they do not have.

2. **Compare each page with the others**, never with itself: the median, spread and range of the *other* pages. A
   feature counts only when the page is beyond every other page by a margin, the difference is big enough to say, and
   it is far outside how much the other pages vary.
3. **Flag a page** when one difference is obvious on its own (every card rounded where no other page rounds one), or
   when a strong difference is backed by a second family. A weak feature alone never flags a page: a landing page
   legitimately centres its hero.
4. **Report it as advisory**, with the numbers. It is not a defect: it never changes the exit code and never enters the
   labelled real-findings set. It needs at least 4 measured pages.

```
⚠ style /contact does not look like the other 5 pages (advisory)
    rounded corners (8px+) on cards and panels: 100% here, 0% on the other pages
    drop shadows on cards and panels: 100% here, 0% on the other pages
    pill-shaped buttons: 100% here, 0% on the other pages
```

## How it is measured (`npm run consistency`)

`bench/style-sites.mjs` builds seeded sites in three base styles — **swiss** (sharp, bordered), **corporate** (8px
radius, subtle shadow) and **soft** (20px radius, glow, gradients, centred emoji: the "generated" look) — all from the
same tokens, with realistic page types (landing with a centred hero, dashboard, table, form, contact, article). A clean
site must produce no flag. A drifted site has exactly one page built with a different vocabulary: the whole other
style, or one drift alone (rounded corners, shadows, pill buttons + centring, emoji, another typeface, a flat page on a
rounded site). A drift that leaves the page unchanged (shadows on a page with no cards) is reported and not scored.

Seed 1, 148 sites, 878 pages, about 7 s:

| drift | caught | false alarms |
| :- | :- | :- |
| off-style | 24/24 | 0 |
| rounded | 8/8 | 0 |
| shadow | 7/8 | 0 |
| pill + centred | 16/16 | 0 |
| emoji | 16/16 | 0 |
| font | 24/24 | 0 |
| flat | 16/16 | 0 |

Recall 0.99, precision 1, **0 of 36 clean sites flagged**. The design rules find 0 defects on the drifted pages: only the
comparison sees them. The one miss is a small site where too few other pages have cards to compare shadows with.

Gates (the script exits 1 otherwise): recall ≥ 0.95, every drift ≥ 0.85, precision ≥ 0.95, no clean site flagged.
`test/quality/consistency.test.mjs` proves the benchmark can fail: with the corner features removed rounded drifts are
missed, and with no thresholds clean sites are flagged.

## Limits (read before quoting the numbers)

- **Synthetic.** The sites are generated; real sites vary more (a marketing site and the app behind it, a page built on
  a third-party widget). Real-site precision needs human labels, like the rest of Mole's model numbers.
- **One run's pages.** The comparison is between the pages this run reached; with a shallow crawl there may be fewer
  than 4, and then it says so instead of guessing.
- **Composition, not taste.** It sees corners, depth, emoji, typefaces, heading weight and centring. Layout rhythm,
  imagery, illustration style and copy tone are not measured; a model review of the flagged pages (screenshots next to
  reference pages and the DESIGN.md prose) is the planned next step, and would judge only what this finds.
