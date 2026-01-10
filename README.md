# resolve-pkglock

Resolve your PNPM symlinks *without breaking builds* — use your `pnpm-lock.yaml` as the single source of truth for module resolution.

`resolve-pkglock` hooks into Node.js’ modern [module customization hooks](https://nodejs.org/api/module.html#moduleregisterhooksoptions) to resolve your workspace dependencies directly from the PNPM store instead of through symlinks. This is especially useful in environments where symlinks cause issues (e.g. Docker, certain CI/CD setups, or read-only deployments).

***

## Why

- **PNPM uses symlinks** in workspaces to deduplicate modules.
- Some deployment environments **don’t preserve them**.
- Luckily, everything needed for resolution is already in your **pnpm-lock.yaml**.

By using `resolve-pkglock`, you can resolve dependencies directly from the PNPM store based on your lockfile — no symlinks required.

***

## Requirements

- **Node.js v22.15.0** or newer (supports module hooks).
- A **correctly maintained `pnpm-lock.yaml`** in your workspace root.

***

## Usage

Load the module early in your entrypoint before other imports:

```js
import resolvePkgLock from './node_modules/.pnpm/resolve-pkglock.../node_modules/resolve-pkglock/dist/index.js';

// Initialize with the path to your workspace root (where pnpm-lock.yaml lives)
await resolvePkgLock(import.meta.dirname);

// Then import your local packages normally
import('your-local-package');
```

> ⚠️ Make sure you’re referencing the *non-symlinked folder* in the PNPM store when importing `resolve-pkglock`.

***

## Optional: Disable Symlinks Completely

With `resolve-pkglock`, you can set this safely in your `pnpm-workspace.yaml`:

```yaml
symlink: false
```

This fully avoids the creation of symlinks while preserving the benefits of PNPM’s deterministic lockfile.

***

## License

MIT © [ameinhardt](https://github.com/ameinhardt)
