import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const supportedVersions = ['0.2.0-rc.1', '0.2.0-rc.2']
export function installation(directory) {
  const root = realpathSync(directory)
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (pkg.name !== '@deepseek-ai/dsh' || !supportedVersions.includes(pkg.version)) {
    throw new Error(`Unvalidated DSH build: ${pkg.name}@${pkg.version}; supported: ${supportedVersions.join(', ')}`)
  }
  const require = createRequire(join(root, 'package.json'))
  const packageRoot = name => dirname(require.resolve(`${name}/package.json`))
  const component = name => {
    const path = packageRoot(`@deepseek-ai/${name}`)
    const version = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version
    if (name !== 'node-addon-system' && version !== pkg.version) throw new Error(`Mixed DSH tree: ${name}@${version} vs ${pkg.version}`)
    return path
  }
  const subprocess = component('dsh-subprocess-local')
  const scope = dirname(subprocess)
  const jobs = [
    ['patch-dsh.mjs', join(subprocess, 'lib/index.js')],
    ['patch-dsh-link.mjs', scope],
    ['patch-dsh-attachment-fsync.mjs', join(component('dsh-attachment-local'), 'lib/index.js')],
    ['patch-dsh-flock-android.mjs', join(component('node-addon-system'), 'lib/flock.js')],
    ['patch-dsh-client-modules.mjs', join(component('dsh-client-modules'), 'lib/index.js')],
    ['patch-dsh-web-auth.mjs', join(component('dsh-client-connection'), 'lib/index.js')],
  ]
  const session = component('dsh-session-persistence-jsonl')
  // The storage patch CLI operates on a scope; reject a split package layout.
  if (dirname(session) !== scope || dirname(component('dsh-attachment-local')) !== scope) throw new Error('Split storage package scope; refusing to guess paths')
  const targets = [...new Set(jobs.filter(([name]) => name !== 'patch-dsh-link.mjs').map(([, file]) => file).concat(join(session, 'lib/index.js')))]
  return { root, version: pkg.version, scope, require, component, packageRoot, jobs, targets }
}
