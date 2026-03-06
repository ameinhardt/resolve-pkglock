import type { DependencyPath } from '@pnpm/dependency-path';
import type { PackageSnapshot, ProjectSnapshot } from '@pnpm/lockfile.fs';
import { readFileSync } from 'node:fs';
import { createRequire, findPackageJSON, isBuiltin, registerHooks } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { platform } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { depPathToFilename } from '@pnpm/dependency-path';
import { readWantedLockfile } from '@pnpm/lockfile.fs';
import { nameVerFromPkgSnapshot } from '@pnpm/lockfile.utils';

type RegistryInfo = {
  name: string
  packageLocation: string
  version: string
} & Pick<ProjectSnapshot, 'dependencies' | 'devDependencies' | 'optionalDependencies'>;

const PACKAGE_REGEX = /^([a-z\d][-.\w]*|@[a-z\d][-.\w]+\/[a-z\d][-.\w]*)(\/.*)?$/;

function addToRegistry(registry: Map<null | string, Map<null | string, RegistryInfo>>, pkg: RegistryInfo) {
  const { name, version } = pkg;
  let versions = registry.get(name);
  if (versions == null) {
    versions = new Map<null | string, RegistryInfo>();
    registry.set(name, versions);
  }
  if (!versions.has(version)) {
    versions.set(version, pkg);
  }
  return pkg;
}

async function init(workspaceRoot: string) {
  const lockfile = await readWantedLockfile(workspaceRoot, { ignoreIncompatible: false });

  if (lockfile == null) {
    throw new Error('no lockfile found');
  }

  const defaultResolve = createRequire(workspaceRoot).resolve,
    virtualStoreDir = join(workspaceRoot, './node_modules/.pnpm'),
    virtualStoreDirUrlPath = pathToFileURL(virtualStoreDir).toString(),
    virtualStoreDirMaxLength = platform === 'win32' ? 60 : 120,
    dirToPackage: Record<string, RegistryInfo> = {},
    packageRegistry = new Map<null | string, Map<null | string, RegistryInfo>>();

  for (const [relDepPath, { dependencies, devDependencies, optionalDependencies }] of Object.entries(lockfile.importers) as [string, ProjectSnapshot][]) {
    const packageLocation = join(workspaceRoot, relDepPath),
      { name, version } = JSON.parse(readFileSync(join(packageLocation, 'package.json')).toString()) as { name: string, version: string },
      pkgInfo: RegistryInfo = {
        dependencies,
        devDependencies,
        name,
        optionalDependencies,
        packageLocation,
        version
      };
    dirToPackage[packageLocation] = pkgInfo;
    addToRegistry(packageRegistry, pkgInfo);
  }
  if (lockfile.packages) {
    for (const [relDepPath, pkg] of Object.entries(lockfile.packages) as Array<[string, PackageSnapshot]>) {
      const { dependencies, optionalDependencies } = pkg,
        packageLocation = join(virtualStoreDir, depPathToFilename(relDepPath, virtualStoreDirMaxLength)),
        { name, nonSemverVersion, version } = nameVerFromPkgSnapshot(relDepPath, pkg),
        pkgInfo: RegistryInfo = {
          dependencies,
          name,
          optionalDependencies,
          packageLocation,
          version: version ?? nonSemverVersion
        };
      dirToPackage[join(packageLocation, 'node_modules', name)] = pkgInfo;
      addToRegistry(packageRegistry, pkgInfo);
    }
  }

  function getParent(parentURL?: string) {
    if (parentURL == null) {
      throw new Error('No parentURL!');
    }
    let pkg: DependencyPath;
    // bottom-up first, because there are packages that introduce multiple package.json in their hierarchy
    if (parentURL.startsWith(virtualStoreDirUrlPath)) {
      const subpath = parentURL.substring(0, parentURL.indexOf('/node_modules/', virtualStoreDirUrlPath.length + 1) + 14), // '/node_modules/'.length = 14
        match = parentURL.substring(subpath.length).match(PACKAGE_REGEX);
      if (match == null) {
        throw new Error('can\'t parse calling module\'s path');
      }
      const [, name] = match;
      pkg = dirToPackage[join(fileURLToPath(subpath), name)];
    } else {
      pkg = dirToPackage[dirname(findPackageJSON(parentURL)!)];
    }
    if (pkg == null || pkg.name == null || pkg.version == null) {
      throw new Error('unknown package');
    }
    const { name: parentName, version: parentVersion } = pkg,
      parent = packageRegistry.get(parentName ?? null)?.get(parentVersion ?? null);

    if (parent == null) {
      throw new Error('can\'t identify parent');
    }
    return parent;
  }

  registerHooks({
    resolve(specifier, context, next) {
      if (isBuiltin(specifier) || isAbsolute(specifier)) {
        return next(specifier, context);
      } else if (specifier.startsWith('.')) {
        return next(join(dirname(context.parentURL ? fileURLToPath(context.parentURL) : '.'), specifier), context);
      }

      const match = specifier.match(PACKAGE_REGEX);
      if (match == null) {
        throw new Error('can\'t read package specifier');
      }
      const [, name, appendix] = match, // strip appendix as in somepackage/appendix or @some/package/appendix
        parent = getParent(context.parentURL),
        version = parent.dependencies?.[name] || parent.devDependencies?.[name] || parent.optionalDependencies?.[name];
      if (version == null) {
        // some modules test for optional modules and require standard error code
        const err: Error & Partial<{ code: string }> = new Error(`Cannot find module '${specifier}'.`);
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      let packageLocation: string | undefined;

      if (version.startsWith('link:')) {
        packageLocation = join(parent.packageLocation, version.substring(5));
      } else if (version.startsWith(`${name}@file://`)) { // plugin-commands-deploy/src/createDeployFiles.ts:createFileUrlDepPath()
        packageLocation = join(virtualStoreDir, depPathToFilename(version, virtualStoreDirMaxLength), 'node_modules', name);
      } else {
        packageLocation = join(virtualStoreDir, depPathToFilename(`${name}@${version}`, virtualStoreDirMaxLength), 'node_modules', name);
      }
      if (packageLocation[packageLocation.length - 1] === '/') {
        packageLocation = packageLocation.substring(0, packageLocation.length - 1);
      }

      if (packageLocation.endsWith(`/node_modules/${name}`)) {
        const dedicatedRequire = createRequire(pathToFileURL(
          packageLocation.substring(0, packageLocation.length - 13 - name.length)
        ));
        return next(dedicatedRequire.resolve(specifier), context);
      }
      // fallback
      return next(defaultResolve(`${packageLocation}${appendix}`), context);
    }
  });
}

export default init;
