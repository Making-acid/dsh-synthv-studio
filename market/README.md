# Submitting to the DSH plugin list

The DSH plugin market discovers plugins through
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
A submission is **one YAML file** in that repository:

```
data/plugins/Making-acid__dsh-synthv-studio.yml
```

The content to use is prepared in [`awesome-dsh-plugin-entry.yml`](awesome-dsh-plugin-entry.yml).

## Submission record

| When | What |
|---|---|
| 2026-10-27 | Submitted [PR #9710](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9710) — one entry file, no other entries touched. |
| 2026-10-27 | **Merged** at `2026-10-27T17:02:05Z` (merge commit `d527132`); entry is live at `data/plugins/Making-acid__dsh-synthv-studio.yml`. |
| 2026-11-09 | `v0.1.1` pushed to `main` (DSH 0.2.1/0.2.2 compatibility). No new PR needed — entries carry no version, and the market reads the repository. |

## Version updates after listing

Entries contain no version field, so a plugin update is: bump `package.json` here and push `main`;
the list and the markets pick the new version up from the repository on their next build.

A GitHub Release is **optional** for this plugin. `.github/workflows/release.yml` publishes to npm
on every `v*` tag and needs an `NPM_TOKEN` Actions secret, which this repository does not have yet
(verified 2026-11-09). Until that secret exists, do not push a `v*` tag for a release you do not
want to publish; a plain tag or a Release created from the GitHub UI without a `v*` tag is enough
to attach a tarball.

## Checklist (from the list's contributing guide)

| Requirement | Status in this repo |
|---|---|
| `package.json` declares `dsh.bundle.patch` | ✅ `./cordis.patch.yml` |
| `cordis.patch.yml` present and inserts the plugin row | ✅ |
| Real working code (not a placeholder or wrapper) | ✅ `lib/` + bundled bridge |
| Repository at least 1 day old | ✅ created 2026-10-25, PR opened 2026-10-27 |
| Repository is actively maintained | ✅ |
| `dsh-plugin` topic added to the repository | ✅ set with `gh repo edit --add-topic` |
| Accurate, non-marketing one-line description | ✅ five tools, verified in E2E |
| Category matches what it does | `voice` |
| Optional storefront icon (GitHub-hosted raster) | ✅ `assets/icon-180.png` |
| Optional screenshots via `screenshots.json` | ✅ `assets/screenshot-1.png` |
| Optional npm package (improves install) | ⏳ not published: the npm name `dsh-synthv-studio` is free, but no `NPM_TOKEN` secret exists yet; the market installs from source. |

## Steps

1. ~~Wait until the repository is at least 24 hours old~~ — done.
2. ~~Fork `awesome-dsh-plugin/awesome-dsh-plugin`, add
   `data/plugins/Making-acid__dsh-synthv-studio.yml` with the prepared content,
   and open one PR~~ — done: [PR #9710](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9710), merged 2026-10-27.
3. To also get the npm install path and download counts, add an `NPM_TOKEN` Actions secret and
   publish the package (`npm publish --access public`) — the package `repository` field already
   points back at this repo, so the mapping is picked up automatically.
4. After the PR merges, the site and both markets pick the entry up on the next
   build (usually within a day); later changes only need a push here — no new PR.
