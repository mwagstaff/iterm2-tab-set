'use strict'

const assert = require('chai').assert
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const TOML = require('@iarna/toml')

const TABSET_PATH = path.join(__dirname, '..', 'tabset.js')

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join('/tmp', prefix))
}

function mkdirp(dirpath) {
  fs.mkdirSync(dirpath, { recursive: true })
}

function runTabset(args, opts) {
  return cp.spawnSync(process.execPath,
                      [TABSET_PATH].concat(args || []),
                      opts)
}

function directoryConfigPath(home) {
  return path.join(home, '.iterm2-tab-set-mwagstaff', 'config.toml')
}

function writeDirectoryConfig(home, payload) {
  const configPath = directoryConfigPath(home)
  mkdirp(path.dirname(configPath))
  const dirs = payload.directories
  const lines = []
  const stringEntries = Object.keys(dirs).filter(k => typeof dirs[k] === 'string')
  const objectEntries = Object.keys(dirs).filter(k => typeof dirs[k] !== 'string')

  if (stringEntries.length > 0) {
    lines.push('[directories]')
    stringEntries.forEach(function(key) {
      lines.push(JSON.stringify(key) + ' = ' + JSON.stringify(dirs[key]))
    })
  }

  objectEntries.forEach(function(key) {
    lines.push('[directories.' + JSON.stringify(key) + ']')
    const obj = dirs[key]
    Object.keys(obj).forEach(function(k) {
      const v = obj[k]
      lines.push(k + ' = ' + (typeof v === 'boolean' ? v : JSON.stringify(v)))
    })
  })

  fs.writeFileSync(configPath, lines.join('\n') + '\n')
  return configPath
}

describe('tabset CLI', function () {
  it('should use configured directory colors when cwd matches', function () {
    const home = makeTempDir('tabset-home-')
    const cwd = path.join(home, 'dev', 'top-scores')
    mkdirp(cwd)
    writeDirectoryConfig(home, {
      directories: {
        '~/dev/top-scores': 'lightblue'
      }
    })

    const result = runTabset([], {
      cwd,
      env: Object.assign({}, process.env, { HOME: home }),
      encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    assert.include(result.stdout, '6;1;bg;red;brightness;173')
    assert.include(result.stdout, '6;1;bg;green;brightness;216')
    assert.include(result.stdout, '6;1;bg;blue;brightness;230')
    assert.equal(result.stderr, '')
  })

  it('should warn and continue on invalid directory config TOML', function () {
    const home = makeTempDir('tabset-home-')
    const configPath = directoryConfigPath(home)
    mkdirp(path.dirname(configPath))
    fs.writeFileSync(configPath,
                     '[directories]\n"~/dev/top-scores" = ,\n')

    const result = runTabset(['--help'], {
      cwd: home,
      env: Object.assign({}, process.env, { HOME: home }),
      encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    assert.include(result.stdout, '--help')
    assert.include(result.stderr, 'warning: ignoring ~/.iterm2-tab-set-mwagstaff/config.toml: invalid TOML at line 1 column 21')
    assert.include(result.stderr, '  [directories]')
    assert.include(result.stderr, '^')
  })

  it('should warn and ignore invalid directory color entries', function () {
    const home = makeTempDir('tabset-home-')
    writeDirectoryConfig(home, {
      directories: {
        '~/dev/top-scores': { blue: true }
      }
    })

    const result = runTabset(['--help'], {
      cwd: home,
      env: Object.assign({}, process.env, { HOME: home }),
      encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    assert.include(result.stderr, 'warning: ignoring ~/.iterm2-tab-set-mwagstaff/config.toml: invalid color for "~/dev/top-scores"')
  })

  it('should create a starter directory config with init', function () {
    const home = makeTempDir('tabset-home-')
    const configPath = directoryConfigPath(home)

    const result = runTabset(['--init'], {
      cwd: home,
      env: Object.assign({}, process.env, { HOME: home }),
      encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    assert.isTrue(fs.existsSync(configPath))
    assert.deepEqual(TOML.parse(fs.readFileSync(configPath, 'utf8')), {
      directories: {
        '~': {
          color: 'blue',
          match: 'exact'
        }
      }
    })
  })

  it('should prefer directory config over hash fallback', function () {
    const home = makeTempDir('tabset-home-')
    const cwd = path.join(home, 'dev')
    mkdirp(cwd)
    writeDirectoryConfig(home, {
      directories: {
        '~/dev': 'blue'
      }
    })

    const result = runTabset(['--title', 'dev', '--hash', 'dev'], {
      cwd,
      env: Object.assign({}, process.env, { HOME: home }),
      encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    assert.include(result.stdout, '6;1;bg;red;brightness;0')
    assert.include(result.stdout, '6;1;bg;green;brightness;0')
    assert.include(result.stdout, '6;1;bg;blue;brightness;255')
    assert.equal(result.stderr, '')
  })

  it('should allow prefix matching for parent directories', function () {
    const home = makeTempDir('tabset-home-')
    const cwd = path.join(home, 'dev', 'top-scores', 'server')
    mkdirp(cwd)
    writeDirectoryConfig(home, {
      directories: {
        '~/dev/top-scores': {
          color: '#add8e6',
          match: 'prefix'
        }
      }
    })

    const result = runTabset([], {
      cwd,
      env: Object.assign({}, process.env, { HOME: home }),
      encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    assert.include(result.stdout, '6;1;bg;red;brightness;173')
    assert.include(result.stdout, '6;1;bg;green;brightness;216')
    assert.include(result.stdout, '6;1;bg;blue;brightness;230')
  })

  it('should report debug details for version and directory color selection', function () {
    const home = makeTempDir('tabset-home-')
    const cwd = path.join(home, 'dev')
    mkdirp(cwd)
    const normalizedCwd = fs.realpathSync(path.resolve(cwd))
    writeDirectoryConfig(home, {
      directories: {
        '~/dev': 'blue'
      }
    })

    const result = runTabset(['--debug'], {
      cwd,
      env: Object.assign({}, process.env, { HOME: home }),
      encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    assert.include(result.stderr, 'debug: runtime:')
    assert.include(result.stderr, '"version":"0.7.5"')
    assert.include(result.stderr, `"realScript":"${TABSET_PATH}"`)
    assert.include(result.stderr, `"path":"${directoryConfigPath(home)}"`)
    assert.include(result.stderr, 'debug: directory color lookup:')
    assert.include(result.stderr, `"normalizedCwd":"${normalizedCwd}"`)
    assert.include(result.stderr, '"matched":true')
    assert.include(result.stderr, 'debug: selected color source: directory config')
    assert.include(result.stderr, 'debug: selected color rgb: rgb(0,0,255)')
  })
})
