#!/usr/bin/env node
'use strict'

var process    = require('process')
var fs         = require('fs')
var linewrap   = require('linewrap')
var minimist   = require('minimist')
var path       = require('path')
var tildify    = require('tildify')
var stringHash = require('string-hash')
var colorpick  = require('./colorpick')
var cssColors  = require('./csscolors')
var packageMeta = require('./package.json')
var util       = require('./util')
var _          = require('underscore')
var TOML       = require('@iarna/toml')

util.globalize(util)

var wrap = linewrap(70, { skipScheme: 'ansi-color' })
var argopt = { alias: { a: 'all',  b: 'badge', c: 'color',
                        h: 'hash', t: 'title', p: 'pick',
                        del: 'delete', V: 'verbose' },
               'boolean': ['pwd', 'verbose', 'debug']
              }
var args = minimist(process.argv.slice(2), argopt)
const ARGS_DEBUG = args.debug
dprintln.display = args.debug
const cwd = process.cwd()
var defaultColorSpec = 'peru'
var colors = cssColors()
var allcolors = _.clone(colors) // remember even if deleted
var cssColorNames = _.keys(colors).sort()
var dirConfigDir = path.join(process.env.HOME, '.iterm2-tab-set-mwagstaff')
var dirConfigPath = path.join(dirConfigDir, 'config.toml')

updateColorMap('default', defaultColorSpec)

var configpath = path.join(process.env.HOME, '.tabset')
const defaultConfig = { colors: {
                          alisongreen: 'rgb(125,199,53)'
                        },
                        defaults: {
                          all: '.',
                          title: '.',
                          badge: '.',
                          color: '.'
                        }
                      }
var config = readJSON(configpath) || defaultConfig
interpretConfig(config)
var directoryColors = readDirectoryColors(dirConfigPath)
process_args()


function process_args () {
  debugStartup()

  args.pwd ? println('dir:', cwd) : null;

  debugKV('args', args)
  // help requested
  if (args.help) {
    println()
    println('To set an iTerm2 tab\'s color, badge, or title:')
    println()
    println('tabset --all|-a <string>')
    println('       --color|-c <named-color>')
    println('                  | <rgb()>')
    println('                  | <hex-color>')
    println('                  | random')
    println('                  | RANDOM')
    println('       --pick|-p')
    println('       --hash|-h <string>')
    println('       --badge|-b <string>')
    println('       --title|-t <string>')
    println('       --pwd')
    println('       --mode  0 | 1 | 2')
    println('       --init               create a config file for setting custom tab colors')
    println('                            per directory — edit it to assign colors to your')
    println('                            project dirs (supports exact and prefix matching)')
    println('       --add <name> <colorspec>')
    println('       --add <name> --pick|-p')
    println('       --del <name>')
    println('       --list')
    println('       --colors')
    println('       --help')
    println('       --verbose|-V')
    println()
  }


  const nFreeArgs = _.size(args._)
  // no real args given, so improvise
  var noSpecificArgs = (_.size(args) === (argopt['boolean'].length + 1 + 1));
      // always expect _ and booleans (e.g. pwd and verbose)
      // they do not count at "specific" arguments
  debugKV('noSpecificArgs', noSpecificArgs)
  if (!nFreeArgs && noSpecificArgs) {
    args.all = settingString(null, 'all')
    if (!args.all) {
      args.all = cwd
    }
    debugKV('default args.all', args.all)
  }

  if (args.colors) {
    var colorNames = _.keys(colors).sort()
    println(wrap('named colors: ' + colorNames.join(', ')))
  }

  // combo set everthing
  if (nFreeArgs === 1) {
    args.all = settingString(args._[0], 'all')
  } else if (nFreeArgs > 1) {
    args.all = args._.join(' ')
  }
  debugKV('nFreeArgs', nFreeArgs)
  debugKV('resolved args.all', args.all)

  if (args.all) {
    setBadge(args.all)
    setTabTitle(args.all, definedOr(args.mode, 1))
    var colorSource = null
    var directoryMatch = (!args.color && !args.hash) ? lookupDirectoryColor(cwd) : null
    var col = directoryMatch ? directoryMatch.rgb : null
    if (directoryMatch) {
      colorSource = 'directory config (' + tildify(directoryMatch.path) + ')'
    }
    if (!col) {
      col = decodeColorSpec(args.all)
      if (col) {
        colorSource = 'explicit/all argument'
      }
    }
    if (!col) {
      var colorNames = _.keys(colors).sort()
      var index = stringHash(args.all) % colorNames.length
      var hashColor = colorNames[index]
      col = colors[hashColor]
      colorSource = 'hash fallback (' + hashColor + ')'
    }
    debugKV('selected color source', colorSource)
    debugKV('selected color rgb', rgbstr(col))
    showChoice('picked color:', hashColor)
    setTabColor(col, definedOr(args.mode, 1))
  }

  if (args.badge) {
    var badge = settingString(args.badge, 'badge')
    setBadge(badge)
  }

  if (args.title) {
    var title = settingString(args.title, 'title')
    setTabTitle(title, definedOr(args.mode, 1))
  }

  if (args.hash && !args.color) {
    args.color = true
  }

  if (args.add) {
    if (!_.isString(args.add)) {
      errorExit('must give name to add')
    }
    if (args.pick) {
      colorpick({ targetApp: 'iTerm2'},
                function (res) {
                  addColor(args.add, rgbstr(res.rgb))
                  println('added:', args.add)
                })
    } else if (_.size(args._) === 1) {
      addColor(args.add, args._[0])
      println('added:', args.add)
    } else {
      errorExit('add what color?')
    }
  } else if (args.pick) {
    colorpick({ targetApp: 'iTerm2'},
              function (res) {
                println('picked:', rgbstr(res.rgb))
                setTabColor(res.rgb)
              })
  }

  if (args.del) {
    if (!_.isString(args.del)) {
      errorExit('must give name to delete')
    }
    delColor(args.del)
    println('deleted:', args.del)
  }

  if (args.list) {
    listColors()
  }

  if (args.color) {
    setTabColor(decodeColor(args.color))
  }

  if (args.init) {
    initConfigFile()
  }
}

/**
 * Interpret a color/title/badge setting string,
 * using a default value if need be.
 */
function settingString(s, category) {
  var finalS = s
  if ((s === true) || (!s)) {
    finalS = config.defaults[category]
  }
  debugKV('settingString ' + category, { input: s, resolved: finalS, cwd: cwd })
  if ((finalS === '~') || (finalS == process.env['HOME'])) {
    return tildify(cwd)
  } else if ((finalS === '.') || (finalS === cwd)){
    return path.basename(cwd)
  }
  return finalS
}

/**
 * Add a color to the local definitions
 */
function addColor (name, spec) {
  config.colors[name] = spec
  writeJSON(configpath, config)
}

/**
 * Remove a color from use. If it's a base color, need
 * to mark it `null` in config file. Otherwise, no reason
 * to even keep it in the config file. Delete outright.
 */
function delColor (name) {
  if (_.contains(cssColorNames, name)) {
    config.colors[name] = null
  } else if (_.has(config.colors, name)) {
    delete config.colors[name]
  } else {
    errorExit('no such color', jsonify(name))
  }
  writeJSON(configpath, config)
}

/**
 * List out the custom colors.
 */
function listColors () {
  if (_.isEmpty(config.colors)) {
    println('no custom colors to list')
  } else {
    println()
    var namel = maxLength(config.colors)
    var swatchl = 9
    var nulled = []
    println(padRight('Name', namel + 1),
            padRight('Swatch', swatchl + 1),
            'Definition')
    _.each(config.colors, function (value, key) {
      if (!value) {
        nulled.push(key)
      } else {
        var rgb = decodeColorSpec(value)
        var swatch = swatchString(rgb, swatchl)
        println(padRight(key, namel + 1), swatch + ' ', value)
      }
    })
    if (nulled.length) {
      println()
      var nullplus = nulled.map(n => {
        var rgb = decodeColorSpec(n)
        return n + (rgb ? swatchString(rgb, 2) : '')
      })
      println(wrap('Nulled: ' + nullplus.join(', ')))
    }
    println()
  }
}

/**
 * Return a swatch (ANSI-colored string).
 * @param {Array of Integer} rgb - color as rgb values
 * @param {Integer} length - how wide?
 */
function swatchString (rgb, length) {
  return ansiseq2(`48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`,
                  padRight('', length))
}

/**
 * A low-level color spec decoder that handles only
 * the simple cases: A named color, rgb() spec, or
 * hex rgb spec.
 */
function decodeColorSpec (spec) {
  if (_.isArray(spec)) {
    return isRGBValue(spec) ? spec : null
  }

  spec = spec.toString();  // in case not string already

  // exact match for existing named color?
  if (colors) {
    var color = allcolors[spec]
    if (color) {
      return color
    }
  }

  // match rgb(r, g, b)
  var rgbmatch = spec.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i)
  if (rgbmatch) {
    return [ parseInt(rgbmatch[1]),
             parseInt(rgbmatch[2]),
             parseInt(rgbmatch[3]) ]
  }

  // match #fa21b4
  var hexmatch = spec.match(/^#?([0-9a-f][0-9a-f])([0-9a-f][0-9a-f])([0-9a-f][0-9a-f])$/i)
  if (hexmatch) {
    return [ parseInt(hexmatch[1], 16),
             parseInt(hexmatch[2], 16),
             parseInt(hexmatch[3], 16) ]
  }

  // failed to decode
  return null
}

/**
 * A high-level color decoder that handles the complex,
 * UI-entangled cases such as random colors, hashed colors,
 * partial string search, and defaults. By delegation to
 * decodeColorSpec(), also handles the simpler cases of
 * exactly named colors and rgb() or hex CSS color definitions.
 */
function decodeColor (name) {
  if (_.isArray(name)) {  // predecoded!
    return name
  }
  if (name === null) {    // not in use
    return name
  }

  var colorNames = _.keys(colors).sort()

  if (!_.isString(name)) {
    // --color invoked, but no color specified

    var directoryMatch = lookupDirectoryColor(cwd)
    if (directoryMatch) {
      debugKV('selected color source', 'directory config (' + tildify(directoryMatch.path) + ')')
      debugKV('selected color rgb', rgbstr(directoryMatch.rgb))
      return directoryMatch.rgb
    }

    // might be a hashed color request
    if (args.hash) {
      var index = stringHash(args.hash) % colorNames.length
      var hashColor = colorNames[index]
      debugKV('selected color source', 'hash fallback (' + hashColor + ')')
      debugKV('selected color rgb', rgbstr(colors[hashColor]))
      return colors[hashColor]
    }

    // nope, no hash; so pick something at random
    name = 'random'
  }

  // random named color
  if (name === 'random') {
    var randColor = _.sample(colorNames)
    showChoice('random color:', randColor)
    return colors[randColor]
  }

  // RANDOM color - not just a random named color
  if (name === 'RANDOM') {
    var rcolor = [_.random(255), _.random(255), _.random(255) ]
    showChoice('RANDOM color:', rgbstr(rcolor))
    return rcolor
  }

  // try a low level spec
  name = name.toLowerCase()
  var defn = decodeColorSpec(name)
  if (defn) {
    return defn
  }

  // finally, a string containment search
  if (colorNames) {
    var possibles = colorNames.filter(s => {
      return s.indexOf(name) >= 0
    })
    if (possibles.length === 1) {
      showChoice('guessing:', possibles[0])
      return colors[possibles[0]]
    }  else if (possibles.length > 1) {
      println(wrap('possibly: ' + possibles.join(', ')))
      var rcolor = _.sample(possibles)
      showChoice('randomly picked:', rcolor)
      return colors[rcolor]
    }
  }

  // nothing worked, use default color
  showChoice('using default:', defaultColorSpec)
  println('because no color', jsonify(name), 'known')
  println('use --colors option to list color names')
  return colors['default']
}

/**
 * Show a given color choice. Print the current working
 * directory if global args says so.
 */
function showChoice (label, value) {
  if (args.vervise && label && value) {
    println(label, value)
  }
}

/**
 * Format a three-element rgb araay into a CSS-style
 * rgb specification.
 */
function rgbstr (rgbarray) {
  return [ 'rgb(', rgbarray.join(','), ')'].join('')
}

/**
 * Set the tab or window color of the topmost iTerm2 tab/window.
 *
 * @param {Array of int} color RGB colors to set.
 */
function setTabColor (color) {
  var cmd = ansiseq('6;1;bg;red;brightness;',   color[0]) +
            ansiseq('6;1;bg;green;brightness;', color[1]) +
            ansiseq('6;1;bg;blue;brightness;',  color[2])
  print(cmd)
}

/**
 * Set the title of the topmost iTerm2 tab.
 *
 * @param {string} title
 * @param {int} mode 0 => tab title and window title,
 *                   1 => tab title, 2 => window title
 */
function setTabTitle (title, mode) {
  var cmd = ansiseq(mode, ';', title)
  print(cmd)
}

/**
 * Set the badge of the topmost iTerm2 tab.
 *
 * @param {string} msg
 */
function setBadge (msg) {
  msg += '\u00a0' // give some right spacing
  var msg64 = Buffer.from(msg.toString()).toString('base64')
  var cmd = ansiseq('1337;SetBadgeFormat=', msg64)
  print(cmd)
}

/**
 * Many of iTterm2's command sequences begin with an ESC ] and end with a
 * BEL (Ctrl-G). This function returns its arguments wrapped
 * in those start/stop codes.
 */
function ansiseq () {
  var parts = _.flatten(['\u001b]', _.toArray(arguments), '\u0007'])
  return parts.join('')
}

/**
 * Other iTterm2 command sequences are slightly differently structured.
 * This function returns its arguments wrapped
 * in those start/stop codes.
 */
function ansiseq2 () {
  var parts = _.flatten(['\u001b[', _.toArray(arguments), '\u001b[0m'])
  return parts.join('')
}

function interpretConfig (config) {
  _.each(config.colors, function (spec, key) {
    if (key === 'default') {
      defaultColorSpec = spec  // might be name or value
    }
    updateColorMap(key, spec)
  })
}

/**
 * Write a suitable default configuration file
 */
function initConfigFile () {
  if (fs.existsSync(dirConfigPath)) {
    errorExit('config file already exists')
  }

  if (fs.existsSync(dirConfigDir) && !fs.statSync(dirConfigDir).isDirectory()) {
    errorExit('config path exists but is not a directory')
  }

  var sample = [
    '# iterm2-tab-set directory color configuration',
    '#',
    '# Each entry maps a directory path to a tab color.',
    '#',
    '# Match modes:',
    '#   exact  - color applies only when you are in this exact directory',
    '#   prefix - color applies to this directory AND all subdirectories',
    '#            (useful for coloring an entire project tree)',
    '#',
    '# Color values can be CSS names ("blue"), hex ("#add8e6"), or rgb() strings.',
    '#',
    '# Example — color ~/dev and everything beneath it:',
    '#   [directories."/Users/you/dev"]',
    '#   color = "blue"',
    '#   match = "prefix"',
    '#',
    '',
    '[directories."~"]',
    'color = "blue"',
    'match = "exact"',
    ''
  ].join('\n')

  fs.mkdirSync(dirConfigDir, { recursive: true })
  fs.writeFileSync(dirConfigPath, sample)
  println('Created', tildify(dirConfigPath))
  println('Edit this file to set custom tab colors for your directories.')
}

/**
 * Update the existing color map, either by
 * adding decoded color specs or deleting entries.
 */
function updateColorMap (key, value) {
  if (value === null) {
    delete colors[key]
  } else {
    var rgb = decodeColorSpec(value)
    colors[key] = rgb
    allcolors[key] = rgb
  }
}

function readDirectoryColors (filepath) {
  if (!fs.existsSync(filepath)) {
    debugKV('directory config', { path: filepath, exists: false })
    return []
  }

  debugKV('directory config', { path: filepath, exists: true })
  var payload = readOptionalTOML(filepath)
  if (!payload) {
    return []
  }

  if (!_.isObject(payload) || _.isArray(payload)) {
    warnDirectoryConfig('expected a top-level TOML object')
    return []
  }

  if (!_.has(payload, 'directories')) {
    return []
  }

  if (!_.isObject(payload.directories) || _.isArray(payload.directories)) {
    warnDirectoryConfig('expected "directories" to be an object')
    return []
  }

  var normalized = []
  _.each(payload.directories, function (spec, dirpath) {
    var entry = parseDirectoryColorEntry(dirpath, spec)
    if (!entry) {
      return
    }
    debugKV('directory color entry', {
      configuredPath: dirpath,
      normalizedPath: entry.path,
      match: entry.match,
      color: entry.originalColor,
      rgb: entry.rgb
    })
    normalized.push(entry)
  })
  return normalized
}

function lookupDirectoryColor (dirpath) {
  var normalizedPath = normalizeDirectoryPath(dirpath)
  var match = null

  _.each(directoryColors, function (entry) {
    if (!directoryEntryMatches(entry, normalizedPath)) {
      return
    }
    if (!match || compareDirectoryEntries(entry, match) > 0) {
      match = entry
    }
  })

  debugKV('directory color lookup', {
    cwd: dirpath,
    normalizedCwd: normalizedPath,
    matched: !!match,
    matchedPath: match ? match.path : null,
    matchMode: match ? match.match : null,
    rgb: match ? match.rgb : null
  })
  return match
    ? { path: match.path, rgb: match.rgb, match: match.match }
    : null
}

function readOptionalTOML (filepath) {
  try {
    return TOML.parse(fs.readFileSync(filepath, 'utf8'))
  } catch (e) {
    warnDirectoryConfig(formatTOMLError(e), tomlErrorPointer(e, filepath))
    return null
  }
}

function warnDirectoryConfig (message, detail) {
  error('warning: ignoring', tildify(dirConfigPath) + ':', message)
  if (detail) {
    _.each(detail, function (line) {
      error(line)
    })
  }
}

function formatTOMLError (err) {
  if (err && err.line != null && err.col != null) {
    return 'invalid TOML at line ' + err.line + ' column ' + err.col
  }
  return err && err.message ? err.message : err.toString()
}

function tomlErrorPointer (err, filepath) {
  if (!err || err.line == null || err.col == null) {
    return null
  }

  var lines = fs.readFileSync(filepath, 'utf8').split(/\r?\n/)
  var lineIndex = err.line - 1
  var column = err.col
  var sourceLine = lines[lineIndex]
  if (sourceLine === undefined) {
    return null
  }

  return [
    '  ' + sourceLine,
    '  ' + padRight('', Math.max(column - 1, 0)) + '^'
  ]
}

function isRGBValue (value) {
  return _.isArray(value) &&
         value.length === 3 &&
         _.every(value, function (component) {
           return _.isNumber(component) &&
                  component >= 0 &&
                  component <= 255 &&
                  Math.floor(component) === component
         })
}

function normalizeDirectoryPath (dirpath) {
  var resolved = resolveSymbolic(dirpath)
  try {
    return fs.realpathSync(resolved)
  } catch (e) {
    return path.resolve(resolved)
  }
}

function parseDirectoryColorEntry (dirpath, spec) {
  var entrySpec = spec
  var match = 'exact'

  if (_.isObject(spec) && !_.isArray(spec)) {
    if (!_.has(spec, 'color')) {
      warnDirectoryConfig('invalid color for ' + jsonify(dirpath))
      return null
    }
    entrySpec = spec.color
    match = definedOr(spec.match, 'exact')
  }

  if ((match !== 'exact') && (match !== 'prefix')) {
    warnDirectoryConfig('invalid match mode for ' + jsonify(dirpath) +
                        '; expected "exact" or "prefix"')
    return null
  }

  var rgb = decodeColorSpec(entrySpec)
  if (!rgb) {
    warnDirectoryConfig('invalid color for ' + jsonify(dirpath))
    return null
  }

  return {
    path: normalizeDirectoryPath(dirpath),
    match: match,
    originalColor: entrySpec,
    rgb: rgb
  }
}

function directoryEntryMatches (entry, normalizedPath) {
  if (entry.match === 'exact') {
    return normalizedPath === entry.path
  }

  if (normalizedPath === entry.path) {
    return true
  }

  return normalizedPath.indexOf(entry.path + path.sep) === 0
}

function compareDirectoryEntries (left, right) {
  if (left.path.length !== right.path.length) {
    return left.path.length - right.path.length
  }

  if (left.match === right.match) {
    return 0
  }

  return (left.match === 'exact') ? 1 : -1
}

function debugStartup () {
  if (!ARGS_DEBUG) {
    return
  }

  debugKV('runtime', {
    package: packageMeta.name,
    version: packageMeta.version,
    node: process.version,
    argv1: process.argv[1],
    realScript: safeRealpath(process.argv[1] || __filename),
    cwd: cwd,
    home: process.env.HOME
  })
}

function debugKV (label, value) {
  if (!ARGS_DEBUG) {
    return
  }

  if (value === undefined) {
    error('debug:', label)
  } else if (_.isString(value)) {
    error('debug:', label + ':', value)
  } else {
    error('debug:', label + ':', jsonify(value))
  }
}

function safeRealpath (filepath) {
  try {
    return fs.realpathSync(filepath)
  } catch (e) {
    return filepath
  }
}
