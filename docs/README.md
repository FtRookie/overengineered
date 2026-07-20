# docs

Reference notes and README assets. Nothing here is read by the build — `lune run assemble` only pulls from
`game/`, and Rojo only maps `out/`, so anything in this folder is documentation and nothing else.

| what | where |
| --- | --- |
| Notes on a specific system | `docs/<subject>.md` |
| Screenshots used by the root README | `docs/images/` |

Some files deliberately stay at the repo root rather than living here: `README.md`, because GitHub renders it as
the landing page, and `CLAUDE.md`, because Claude Code reads project instructions from the root. `CONTRIBUTING.md`
also stays at the root, where GitHub links it from the issue and pull request forms. So do `LICENSE`,
`LICENSE.UPSTREAM` and `NOTICE` — GitHub only detects licensing from the root, and moving them would drop the
license out of the repository sidebar.

## Images

Reference them from the root README with a repo-relative path, so they resolve in clones and forks as well as on
GitHub:

```markdown
<img src="docs/images/rojo-connect.png" alt="The Rojo plugin button in the Studio Plugins tab" width="700" />
```

Set an explicit `width` — a raw screenshot renders at full pixel size otherwise. Keep files to a few hundred KB;
every clone carries them permanently. Studio screenshots are dark by default and read fine against both GitHub
themes, so they need no light/dark variant.
