import { readFileSync } from 'node:fs';
import { createRequire, findPackageJSON, isBuiltin, registerHooks } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lockfileToPackageRegistry } from '@pnpm/lockfile-to-pnp';
import { readWantedLockfile } from '@pnpm/lockfile.fs';

const PACKAGE_REGEX = /([a-z\d][-.\w]*|@[a-z\d][-.\w]+\/[a-z\d][-.\w]*)(.*)/;

export async function getPackageRegistry(workspaceRoot: string) {
  const lockfile = await readWantedLockfile(workspaceRoot, { ignoreIncompatible: false });

  if (lockfile == null) {
    throw new Error('no lockfile found');
  }

  const opts = {
    importerNames: Object.fromEntries(Object.keys(lockfile.importers).map((depPath) => [depPath, JSON.parse(readFileSync(join(workspaceRoot, depPath, 'package.json')).toString()).name])),
    lockfileDir: workspaceRoot,
    registries: { default: 'https://npmjs.com' },
    virtualStoreDir: join(workspaceRoot, './node_modules/.pnpm'),
    virtualStoreDirMaxLength: 120
  };
  return lockfileToPackageRegistry(lockfile, opts) as Map<null | string, Map<null | string, { packageDependencies: Map<string, string>, packageLocation: string } | undefined>>;
}

export function init(packageRegistry: Awaited<ReturnType<typeof getPackageRegistry>>, workspaceRoot: string) {
  const defaultResolve = createRequire(workspaceRoot).resolve,
    dirToPackage = Object.fromEntries([...packageRegistry].map(([name, versions]) => [...versions].map(([version, pkg]) => {
      if (pkg == null) {
        throw new Error('unknown location');
      }
      return [resolve(workspaceRoot, pkg.packageLocation), [name, version]];
    })).flat());

  registerHooks({
    resolve(specifier, context, next) {
      let parent: { packageDependencies: Map<string, string>, packageLocation: string } | undefined,
        version: string | undefined,
        packageLocation: string | undefined;
      if (isBuiltin(specifier) || isAbsolute(specifier)) {
        return next(specifier, context);
      } else if (specifier.startsWith('.')) {
        return next(join(dirname(context.parentURL ? fileURLToPath(context.parentURL) : '.'), specifier), context);
      } else {
        if (context.parentURL == null) {
          throw new Error('No parentURL!');
        }
        const pkgVersion = dirToPackage[dirname(findPackageJSON(context.parentURL)!)];
        if (pkgVersion == null) {
          throw new Error('unknown package');
        }
        const [pkg, version] = pkgVersion;
        parent = packageRegistry.get(pkg)?.get(version);
      }
      const match = specifier.match(PACKAGE_REGEX);
      if (match == null) {
        throw new Error('can\'t read specifier');
      }
      const [, name, appendix] = match;
      version = parent?.packageDependencies.get(name);
      if (version == null) {
        throw new Error('can\'t find matching version');
      }
      if (version?.startsWith('link:')) {
        version = version.substring(5);
      }
      packageLocation = packageRegistry.get(name)?.get(version)?.packageLocation;
      if (packageLocation == null) {
        throw new Error('can\'t determine package location');
      }
      packageLocation = join(workspaceRoot, packageLocation);
      if (packageLocation[packageLocation.length - 1] === '/') {
        packageLocation = packageLocation.substring(0, packageLocation.length - 1);
      }

      if (packageLocation.endsWith(`/node_modules/${name}`)) { // required, if there's appendixes
        const dedicatedRequire = createRequire(pathToFileURL(
          packageLocation.substring(0, packageLocation.length - 13 - name.length)
        ));
        return next(dedicatedRequire.resolve(specifier), context);
      }
      return next(defaultResolve(`${packageLocation}${appendix}`), context);
    }
  });
}

export default async function (workspaceRoot: string) {
  const registry = await getPackageRegistry(workspaceRoot);
  init(registry, workspaceRoot);
}
