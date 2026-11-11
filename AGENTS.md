# Agent instructions

## GitHub account: always use `fearthedear`

All GitHub work for this repo uses the **`fearthedear`** account: pushing branches, opening and updating PRs, commenting, and any `gh` command.

- Push to `origin` (`fearthedear/autostrike-web`). Don't push to the `linuspm` fork, and don't open PRs from a fork.
- Don't use the `linuspm` account. It is often the active `gh` account (via `GH_TOKEN`), but it only has read access here, so pushes return 403.
- Open PRs but don't merge them unless asked.

`fearthedear` is logged in to `gh` through the keyring. Use its token explicitly:

```sh
# gh commands
GH_TOKEN=$(GH_TOKEN= gh auth token -u fearthedear) gh pr create -R fearthedear/autostrike-web --base main ...

# git push
GH_TOKEN= git -c credential.helper= \
  -c credential.helper='!f(){ echo username=fearthedear; echo "password=$(GH_TOKEN= gh auth token -u fearthedear)"; }; f' \
  push -u origin HEAD
```

## Tests

Run `node --test tests/*.cjs tests/*.mjs`. There is no package.json; `main` deploys to Cloudflare Pages.
