# Submitting to the DSH plugin list

The DSH plugin market discovers plugins through
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
A submission is **one YAML file** in that repository:

```
data/plugins/Making-acid__dsh-synthv-studio.yml
```

The content to use is prepared in [`awesome-dsh-plugin-entry.yml`](awesome-dsh-plugin-entry.yml).

## Checklist (from the list's contributing guide)

| Requirement | Status in this repo |
|---|---|
| `package.json` declares `dsh.bundle.patch` | ✅ `./cordis.patch.yml` |
| `cordis.patch.yml` present and inserts the plugin row | ✅ |
| Real working code (not a placeholder or wrapper) | ✅ `lib/` + bundled bridge |
| Repository at least 1 day old | ⏳ check before opening the PR |
| Repository is actively maintained | ✅ |
| `dsh-plugin` topic added to the repository | ✅ set with `gh repo edit --add-topic` |
| Accurate, non-marketing one-line description | ✅ five tools, verified in E2E |
| Category matches what it does | `voice` |
| Optional storefront icon (GitHub-hosted raster) | ✅ `assets/icon-180.png` |
| Optional screenshots via `screenshots.json` | ✅ `assets/screenshot-1.png` |
| Optional npm package (improves install) | ⏳ `npm publish` when ready |

## Steps

1. Wait until the repository is at least 24 hours old (CI checks creation date).
2. Fork `awesome-dsh-plugin/awesome-dsh-plugin`, add
   `data/plugins/Making-acid__dsh-synthv-studio.yml` with the prepared content,
   and open one PR (at most 3 entries per PR).
3. To also get the npm install path and download counts, publish the package
   (`npm publish --access public`) — the package `repository` field already
   points back at this repo, so the mapping is picked up automatically.
4. After the PR merges, the site and both markets pick the entry up on the next
   build (usually within a day).
