# Install Mole in Claude Code

Mole runs on your own machine: a local browser checks your local app, and Claude Code talks to it. Nothing is hosted.
The GitHub repository is the whole distribution.

## You need

| | Check | If missing |
| :- | :- | :- |
| Claude Code | `claude --version` | [claude.com/claude-code](https://claude.com/claude-code) |
| Node.js 20 or newer | `node --version` | [nodejs.org](https://nodejs.org) (LTS). Claude Code's own installer does not include Node |
| Google Chrome or Microsoft Edge | (almost always present) | install one, or run `npx playwright install chromium` once |

Same steps on macOS and Windows.

## Install (once per machine)

In a Claude Code session (any project):

```text
/plugin marketplace add buyanaa0923/ui-test-agent-
/plugin install mole@mole
```

Choose **Install for you (user scope)**. Claude Code then asks for Mole's settings:

| Setting | What to choose |
| :- | :- |
| Show the Mole panel | **on**: a browser window shows every check live |
| Claude second opinion | **login**: uses your own Claude Code login, no key |
| Jev key (optional) | leave **empty** unless you were given one. Mole's checks, file:line locations and the panel are free and need no key |
| Anthropic API key (optional) | leave **empty** |

Keys you do enter go to your OS keychain (macOS Keychain, Windows Credential Manager), never into a file or the repo.
Change them later in `/plugin` > **Installed** > **mole** > **Configure options**.

Then run `/reload-plugins` (or restart Claude Code) and check the setup:

```text
/mole:doctor
```

It lists what is ready and the exact fix for anything that is not.

## Use it on a project

1. Start the app's dev server as usual (for example `npm run dev`).
2. Open Claude Code in that project folder.
3. Once per project, let Claude write the design contract, then read it; it is your rulebook:
   ```text
   /mole:design
   ```
4. Check a page, and let Claude fix what Mole finds:
   ```text
   /mole:dig http://localhost:3000/en
   /mole:dig http://localhost:3000/en fix
   /mole:dig http://localhost:3000/en mobile
   ```
5. Or just work: after Claude changes UI, the Mole skill tells it to check the page itself.

Run output (screenshots, reports, videos) goes to `.mole/runs/` in your project. That folder ignores itself in git.

## Updates

Mole is in active testing and every push is a new version:

```text
/plugin marketplace update mole
/plugin
```

In `/plugin` > **Installed** > **mole**, choose **Update now**, then `/reload-plugins`. (From a shell:
`claude plugin marketplace update mole` then `claude plugin update mole@mole`.)

## Remove

```text
/plugin uninstall mole@mole
```

## Without Claude Code (terminal / CI)

```bash
git clone https://github.com/buyanaa0923/ui-test-agent-.git mole && cd mole
npm ci
node bin/mole.mjs doctor
node bin/mole.mjs dig http://localhost:3000 --watch --src /path/to/your/project
```

Keys for terminal use go in `.env` in the Mole folder (copy `.env.example`); `.env` is git-ignored.
