# Development and release checks

Dependency-free, no build step — pi loads the TypeScript extensions directly.

```bash
npm test             # node --test --experimental-strip-types
npm run pack-check   # npm pack --dry-run
```

Before publishing, run `npm test` and `npm run pack-check` from the package
root (`packages/zero-pi` in the zero monorepo). `prepublishOnly` also runs the
test suite, but `pack-check` confirms the npm tarball still contains the
prompts, skills, themes, assets, docs, and extension support modules pi needs.

The `.sdd/<slug>/` contract shared with the Claude Code forge mod is in
[forge-contract.md](./forge-contract.md): if you change it, change it in both
repos in the same batch of work.
