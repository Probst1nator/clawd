import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  ACTS,
  BAND_ROWS,
  FLOOR_TEXT,
  MAX_DELAY_S,
  MAX_MINIS,
  MAX_STEPS,
  MINI_STALE_S,
  PICKABLE,
  PREVIEW_PER_LINE,
  PREVIEW_POSES,
  PREVIEW_PROP_POSES,
  READ_HOLD_S,
  SHEET_POSES,
  SLEEP_AFTER_S,
  TICK_MS,
  bandRows,
  bodyOf,
  callActs,
  callLabel,
  clean,
  createWorld,
  emoteFrom,
  emoteJson,
  emotePreview,
  emoteSheet,
  endMini,
  frameCells,
  isAsleep,
  linkRoutine,
  onPrompt,
  onTool,
  onTurnEnd,
  perform,
  resize,
  routineFrom,
  seeded,
  setEdge,
  spawnMini,
  step,
} from './clawd-sim'
import type { ActKind, Call, Emote, Playable, Routine, World } from './clawd-sim'
import { ALIASES, COMMANDS, EMOTE_COMMANDS, LIST_KINDS, MAX_REPEAT, isClawdDraft, marksFor, menuFor, menuLayout, namesFit, orderOf, writeOut } from './clawd-words'
import type { ListKind, Menu, Names } from './clawd-words'
import { UML_LEGEND, UML_WIDTH, clawdUml, umlKinds } from './clawd-uml'
import type { UmlKind } from './clawd-uml'

// Clawd, the logo, runs in the band above the prompt: one full-width Raster
// that a timer repaints with $.ui.blit. Session events steer it (the
// behaviours are in clawd-sim.ts). User decisions 2026-10-03: logo-style
// quadrant blocks, Clawd standing on a floor line at the band's bottom, two
// sub-pixels of headroom above him (BAND_ROWS), and a row more (TALL_ROWS)
// during big jumps; two more (ANTENNA_ROWS) while he wears the Remote Control
// antenna on a tall look. With only 3 rows to spare he bounces in place.
const CLAWD_MIN_ROWS = 3
const CLAWD_MIN_COLUMNS = 20
const CLAWD_MAX_COLUMNS = 512 // the Raster limit
// While /clawd is typed, a framed list hangs below Clawd's runway, whose floor
// is the frame's top edge (user, 2026-10-05: "the way Clawd stands on top of a
// box" with "the way the dropdown list is shown"). At most this many names show.
const MENU_ROWS = 7
// PICK_MODEL picks what Clawd plays next (user, 2026-10-03; Haiku, Sonnet
// from 2026-10-06, Haiku again from 2026-10-07): when a prompt is sent, when a turn ends, and
// otherwise after a random 10 to 60 s. It reads the messages and tool calls
// since its last pick, its rolling summary of the session, the situation
// (time, idle time, what Clawd is doing) and the newest act a model made. It
// may ask for a new act; Opus then writes the act's steps, kept in data/acts/
// for every session and host. The top right of the band shows the pick and,
// for a new act, its title.
// Each running subagent gets a mini Clawd (user, 2026-10-03), which the
// picker addresses on its own: one pick is a list of calls, like parallel tool
// calls, each naming a body (or all of them), an act and a delay of 0 to 5 s.
// The picker is off until `/clawd autopick on` (user, 2026-10-07: a public
// install makes no model calls by itself); the choice is kept in $.store.
const PICK_MODEL = 'haiku'
const MAKE_MODEL = 'opus'
const PICK_MIN_S = 10
const PICK_MAX_S = 60
const NEW_PER_DAY = 5 // new acts and emotes in any 24 hours, over all sessions and hosts
const FEED_MAX = 40 // lines kept for the next pick
const DAY_MS = 24 * 3600_000
const TRACE_MAX = 50 // picks kept per session in picks/
// Emotes (user, 2026-10-04): looks Clawd takes for a while. emotes/ holds the
// ones drawn by hand, data/emotes/ the ones a model drew. A model draws one in
// a headless `claude -p` run, because $.model.complete takes no image: the run
// may read the reference image and the preview of its draft and nothing else,
// and the mod writes the files. A new emote starts as EMOTE_DRAFTS drafts in
// one reply; the next round sees them side by side and picks one (user,
// 2026-10-05), and each later round sees the preview of its draft.
const EMOTE_ROUNDS = 3
const EMOTE_DRAFTS = 3
const EMOTE_ROUND_MS = 300_000
const IMAGE = /\.(png|jpe?g|gif|webp)$/i
// `/clawd` words no emote may be named
const EMOTE_VERBS = [...Object.keys(COMMANDS), ...Object.keys(EMOTE_COMMANDS), ...Object.keys(LIST_KINDS), ...Object.keys(ALIASES), 'pick']
// What the built-in acts look like, for /clawd list and the menu while /clawd is typed.
const ACT_WHAT: Partial<Record<ActKind, string>> = {
  ...PICKABLE,
  sleep: 'sits down and falls asleep',
  wake: 'wakes up',
  carry: 'fetches a brick for the pile',
  kick: 'kicks the brick pile over',
  read: 'holds up a scroll and looks down at it',
}

const isClawdOn = atom({ plugin: 'clawd', key: 'isClawdOn' } as const, true)
const clawdRows = atom({ plugin: 'clawd', key: 'clawdRows' } as const, BAND_ROWS)
const isTracing = atom({ plugin: 'clawd', key: 'isTracing' } as const, false)
const isDebugging = atom({ plugin: 'clawd', key: 'isDebugging' } as const, false)
const clawdMenu = atom({ plugin: 'clawd', key: 'clawdMenu' } as const, null)

// Off in headless sessions and with CLAUDE_CLAWD_OFF=1. Tests set
// CLAUDE_CLAWD_SEED so the band's random acts repeat.
// `names` is what a `/clawd` word may name, read once per `/clawd` draft.
// `dataDir` keeps what the mod makes (acts, emotes a model drew, previews,
// traces): data/ beside the plugin where a checkout has one, as tools/clawd
// does, else clawd/ in the Claude config folder, which a plugin update leaves
// alone. `emoteDir` holds the emotes that ship with the mod. `look` is the
// emote Clawd wears when no other look is on, named by the plugin's
// clawd.json (user, 2026-10-07: the MatSci octopus in clawd-matsci); `base`
// is that emote as last read.
const mod = {
  isOff: false,
  rand: Math.random,
  dataDir: '',
  emoteDir: '',
  look: '',
  base: null as Emote | null,
  project: '',
  startedAt: 0,
  names: undefined as Names | undefined,
  isRemote: false, // Remote Control is on: Clawd wears an antenna and the autopicker pauses
}

/** An act a model made, as kept in data/acts/<name>.json. */
type MadeAct = Routine & { made: string; project: string; why: string }

/** An emote from emotes/ (`made` empty) or data/emotes/. */
type MadeEmote = Emote & { made: string; project: string; why: string; image: string; file: string }

/** One call as the picker made it, for the label and `/clawd`. */
type Called = { who: string; name: string; delay: number }

type Pick = { trigger: string; calls: Called[]; why: string; at: number; made?: MadeAct }

/** One pick as it went: what the picker read, what it answered, what came of it. */
type Trace = { at: string; trigger: string; system: string; prompt: string; reply: string; outcome: string }

// The picker's working state; a hot reload starts it over.
const brain = {
  feed: [] as { n: number; text: string }[], // what happened since the last pick
  seq: 0, // lines ever fed
  seen: 0, // lines the last pick read
  summary: '',
  recent: [] as string[], // picks, newest first
  last: null as Pick | null,
  timer: null as Timer | null,
  dueAt: 0, // when the timer fires; 0 while none is set
  isPicking: false,
  again: null as string | null, // a trigger that came in during a pick
  making: '', // the emote a model is drawing now
  emoteError: '', // why the last emote a model drew failed
}

// Clawd's working state; a hot reload starts Clawd over.
const clawd = {
  world: null as World | null,
  requestId: null as string | null,
  last: '',
  rows: null as number | null, // the band's height as last written; null: not yet written this load
}

function clawdTick($: EngineInterface): void {
  const w = clawd.world
  const requestId = clawd.requestId
  if (!w || !requestId) return // paused while the band is not mounted
  step(w)
  const rows = bandRows(w)
  if (rows !== clawd.rows) {
    clawd.rows = rows
    void update($, clawdRows, () => rows) // the band redraws at its new height
  }
  const cells = frameCells(w)
  if (cells === clawd.last) return
  clawd.last = cells
  void $.ui.blit({ requestId, key: 'clawd', cells }).then(r => {
    if (r.deny === undefined || clawd.requestId !== requestId) return
    // Unmounted, or a frame of the old height that reached the band after it
    // grew or shrank (the band keeps one requestId). Nothing else redraws the
    // band until its props change, so ask for the render that mounts it again;
    // a band no longer shown draws no Raster, and the tick stays paused.
    $.ui.log(`clawd: blit refused: ${r.deny}`, { to: 'debug' })
    clawd.requestId = null
    $.ui.invalidate('ui.render')
  })
}

// While Remote Control is on, Clawd wears an antenna (user, 2026-10-08). No
// hook event says when it goes on or off, but the engine keeps
// CLAUDE_CODE_BRIDGE_SESSION_ID in its own environment while the session has a
// Remote Control link (2.1.294), so the mod reads it every REMOTE_POLL_MS.
// While it is on, the autopicker pauses and Clawd plays random acts; the stored
// setting is left as it is and applies again when Remote Control ends (user,
// 2026-10-08).
const REMOTE_POLL_MS = 1000

async function pollRemote($: EngineInterface): Promise<void> {
  const isRemote = Boolean(await $.env.get('CLAUDE_CODE_BRIDGE_SESSION_ID'))
  if (isRemote === mod.isRemote) return
  mod.isRemote = isRemote
  if (clawd.world) clawd.world.antenna = isRemote
  if (isRemote) {
    brain.timer?.cancel()
    brain.timer = null
    brain.dueAt = 0
  } else if (await isAutopicking($)) schedulePick($, await $.clock.now())
  $.ui.log(`clawd: Remote Control ${isRemote ? 'on, antenna up, autopicker paused' : 'off, antenna down'}`, { to: 'debug' })
}

// --- the picker ----------------------------------------------------------------

const PICK_SYSTEM =
  'You direct Clawd, the Claude Code logo drawn as a small creature that runs around in a band ' +
  'above the prompt of a Claude Code session, and a mini Clawd for each subagent the session runs. ' +
  'The person sees Clawd while they work and sometimes talks to it or about it. When they give it a ' +
  'name or compare it to something, they want to see it become that thing, which is what new acts and emotes are for. ' +
  'You pick what they play next so it fits what is going on, and you keep a short summary of the ' +
  'session. Reply with one JSON object and nothing else.'

const MAKE_SYSTEM =
  'You write short choreographies for Clawd, the Claude Code logo drawn as a small orange creature ' +
  "in a terminal band 4 rows high and as wide as the terminal. Reply with one JSON object and nothing else."

function oneLine(s: string, n: number, end = false): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return end ? `...${t.slice(-n)}` : `${t.slice(0, n)}...`
}

function feed(text: string): void {
  brain.seq += 1
  brain.feed.push({ n: brain.seq, text })
  if (brain.feed.length > FEED_MAX) brain.feed.shift()
}

/** A subagent's mini id, or 'subagent' when it has none. */
function miniName(agentId: string): string {
  return clawd.world?.minis.find(m => m.agentId === agentId)?.id ?? 'subagent'
}

function toolLine(e: Record<string, unknown>, isError: boolean): string {
  const keys = ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'skill', 'prompt']
  const what = keys.map(k => e[k]).find((v): v is string => typeof v === 'string' && v !== '')
  const who = typeof e.agentId === 'string' ? ` (${miniName(e.agentId)})` : ''
  return `tool ${String(e.tool)}${who} ${isError ? 'failed' : 'ok'}${what ? `: ${oneLine(what, 100)}` : ''}`
}

function callText(c: Called): string {
  return `${c.who}: ${c.name}${c.delay > 0 ? ` +${c.delay} s` : ''}`
}

function parseJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const value: unknown = JSON.parse(match[0])
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`
}

/**
 * The acts models made, newest first, from data/acts/, with their emote and
 * play steps linked to `emotes` (read here when not given) and to each other.
 */
async function loadMade($: EngineInterface, emotes?: Emote[]): Promise<MadeAct[]> {
  const dir = `${mod.dataDir}/acts`
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    return [] // no act made yet
  }
  const made: MadeAct[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const raw = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Record<string, unknown>
      const routine = routineFrom(raw)
      if (typeof routine === 'string') continue
      const text = (v: unknown) => (typeof v === 'string' ? v : '')
      made.push({ ...routine, made: text(raw.made), project: text(raw.project), why: text(raw.why) })
    } catch {
      // half-written or broken; skip it
    }
  }
  const looks = emotes ?? (await loadEmotes($))
  const find = (name: string) => made.find(r => r.name === name) ?? looks.find(x => x.name === name)
  return made.sort((a, b) => b.made.localeCompare(a.made)).map(r => linkRoutine(r, find))
}

/**
 * The emotes, read fresh on each use so a new file plays without a reload:
 * emotes/ first, then data/emotes/ newest first. A model's emote never
 * replaces a hand-drawn one of the same name.
 */
async function loadEmotes($: EngineInterface): Promise<MadeEmote[]> {
  const found: MadeEmote[] = []
  for (const dir of [mod.emoteDir, `${mod.dataDir}/emotes`]) {
    let entries: { name: string; kind: string }[] = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue // none there yet
    }
    const here: MadeEmote[] = []
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Record<string, unknown>
        const look = emoteFrom(raw)
        if (typeof look === 'string' || found.some(e => e.name === look.name)) continue
        const text = (v: unknown) => (typeof v === 'string' ? v : '')
        const file = `${dir}/${entry.name}`
        here.push({ ...look, made: text(raw.made), project: text(raw.project), why: text(raw.why), image: text(raw.image), file })
      } catch {
        // half-written or broken; skip it
      }
    }
    found.push(...here.sort((a, b) => b.made.localeCompare(a.made)))
  }
  if (mod.look) {
    mod.base = found.find(e => e.name === mod.look) ?? null
    if (clawd.world) clawd.world.base = mod.base
  }
  return found
}

/** data/ beside the plugin where a checkout has one, else clawd/ in the Claude config folder. */
async function dataDirOf($: EngineInterface, root: string): Promise<string> {
  const beside = `${root.replace(/\/[^/]*$/, '')}/data`
  try {
    if ((await $.fs.stat(beside)).kind === 'dir') return beside
  } catch {
    // no such folder
  }
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  return `${config}/clawd`
}

/** The emote the plugin's clawd.json names as Clawd's own look, or ''. */
async function lookOf($: EngineInterface, root: string): Promise<string> {
  try {
    const raw = JSON.parse(await $.fs.read(`${root}/clawd.json`)) as { look?: unknown }
    return typeof raw.look === 'string' ? raw.look : ''
  } catch {
    return '' // no clawd.json: Clawd is Clawd
  }
}

/** Whether the autopicker runs by itself (`/clawd autopick on`); off until then. */
async function isAutopicking($: EngineInterface): Promise<boolean> {
  return (await $.store.get('isAutopickOn')) === true
}

/** Whether the autopicker picks by itself now: switched on, and Remote Control off. */
async function isPickingAlone($: EngineInterface): Promise<boolean> {
  return !mod.isRemote && (await isAutopicking($))
}

/** A local image's real path for an emote's reference, or '' when it is none. */
async function imagePath($: EngineInterface, raw: string): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const path = raw.startsWith('~/') ? `${home}/${raw.slice(2)}` : raw
  if (!path.startsWith('/') || !IMAGE.test(path)) return ''
  try {
    const stat = await $.fs.stat(path, { resolve: true })
    return stat.kind === 'file' && stat.realPath && IMAGE.test(stat.realPath) ? stat.realPath : ''
  } catch {
    return ''
  }
}

/** Writes bytes to a file; $.fs.write takes text only. */
async function writeBytes($: EngineInterface, path: string, bytes: Uint8Array): Promise<void> {
  const code = 'import base64,os,sys;os.makedirs(os.path.dirname(sys.argv[1]),exist_ok=True);open(sys.argv[1],"wb").write(base64.b64decode(sys.stdin.read()))'
  const base64 = (bytes as Uint8Array & { toBase64(): string }).toBase64()
  const r = await $.process.run(['python3', '-c', code, path], { stdin: base64, timeoutMs: 20_000 })
  if (r.exitCode !== 0) throw new Error(`python3 exited ${r.exitCode}: ${oneLine(r.stderr, 200)}`)
}

/** Draws the emote's preview sheet to data/emotes/previews/<file>.png; the path. */
async function previewEmote($: EngineInterface, look: Emote, file = look.name): Promise<string> {
  const path = `${mod.dataDir}/emotes/previews/${file}.png`
  await writeBytes($, path, emotePreview(look))
  return path
}

/**
 * The prompt of one drawing round. With `change`, an existing look is changed:
 * `isBefore` marks the first round, whose draft is the look as it is now.
 */
function emotePrompt(
  name: string,
  title: string,
  why: string,
  image: string,
  draft: string,
  preview: string,
  refused: string,
  change = '',
  isBefore = false,
  drafts: string[] = [],
): string {
  const poses = PREVIEW_POSES.map((p, i) => `${i + 1}. ${p}`).join('; ')
  const propPoses = PREVIEW_PROP_POSES.map((p, i) => `${PREVIEW_POSES.length + i + 1}. ${p}`).join('; ')
  const propLine = `A look with a prop gets one more line of ${PREVIEW_PROP_POSES.length} panels: ${propPoses}.`
  // A new emote's first round draws several drafts; the next one picks from them.
  const isDrafting = !change && !draft && drafts.length === 0
  return [
    `You ${change ? 'change a' : 'draw a new'} look for Clawd, the Claude Code logo, which runs around as a small creature in a`,
    'terminal band above the prompt. For a while Clawd is drawn in this look instead of its own, and',
    'moves as always: it walks, hops, looks around, blinks, trips, waves, and sits down to sleep.',
    `The look: ${name}, "${title}".`,
    `Why it was asked for: ${why || '(no reason given)'}`,
    ...(change ? [`The change asked for now: "${change}". Make that change and keep what it does not touch.`] : []),
    image
      ? `The reference image is ${image}. Read it first and draw the look after it: its silhouette, colour and the features that make it recognisable at this tiny size.`
      : 'There is no reference image; draw it from the title.',
    '',
    'How it is drawn: on a grid of sub-pixels, 2 x 2 per terminal cell, with quadrant block characters.',
    'A terminal cell is about twice as high as wide, so a sub-pixel is too. A cell shows at most two',
    'colours, so keep to one body colour: eyes are holes that show the dark terminal background. The',
    'band is 4 rows (8 sub-pixels) high; with "tall": true it grows to 5 rows (10 sub-pixels) while Clawd',
    "wears the look. Clawd's own body is 12 x 4 sub-pixels with four legs of 1 below it.",
    '',
    ...(isDrafting
      ? [
          `Draw ${EMOTE_DRAFTS} drafts that differ in how they show it: silhouette, proportions, eyes, legs or arms. The`,
          'next round sees them side by side and keeps the best. Reply with one JSON object and nothing else,',
          `{"drafts": [${Array.from({ length: EMOTE_DRAFTS }, (_, i) => `draft ${i + 1}`).join(', ')}]}, each draft an object like this:`,
        ]
      : ['Reply with one JSON object and nothing else:']),
    `{"name": "${name}", "title": "...", "color": "#rrggbb", "shapes": {...}, "legs": [...], "legLength": 2,`,
    ' "wiggle": false, "armRow": 2, "arms": {...}, "tall": false, "dur": 8, "done": false}',
    '- color: the body colour; one that stands out on a dark background. "accent": "#rrggbb" is',
    "  optional, for '+' pixels; a '+' only shows where all 8 of its neighbours are body pixels.",
    '- shapes: rows of characters, one string per row, at most 20 wide. # body, o an eye (a hole while',
    '  open; it moves when Clawd looks around), + accent, . empty. normal: standing. squash: landing or',
    '  crouching, wider and lower. stretch: rising in a jump, narrower and higher. flat: lying flat after',
    '  a trip, 1 or 2 rows. Any shape left out is the normal one.',
    '- legs: columns of the normal shape where legs hang below its last row, up to 8. legLength 0 to 3.',
    "  wiggle true: the leg tips sway like tentacles and crawl in a ripple; false: they step like Clawd's.",
    "- armRow: the normal shape's row the arms grow from, or null for none. arms (optional): the arm",
    "  pixels as [dx, dy] from the body's edge on that row, dx outward and dy down, up to 4 per pose",
    "  and within 3. Clawd's are out [[1,0],[2,0]], up [[1,-1],[2,-2]], down [[1,1]], raised [[1,-1],[1,-2]].",
    "  Each pose is one line: the first pixel touches the body's edge, each next one the one before, no",
    "  branches; a pose that is not keeps Clawd's. Draw nothing held into the arms: at this size it reads",
    '  as horns or a tail. A held thing is the tool.',
    '- Height limit: each shape, with legLength for normal and stretch, at most 6 sub-pixels, or 8 with',
    '  "tall": true. dur: seconds Clawd keeps the look, 3 to 20.',
    '- prop (optional): an object beside Clawd that is not part of its body: something that moves on its',
    '  own, such as a rocket that lifts off, or something Clawd works on, such as a block it mines. Draw',
    '  such a thing as a prop, not into the shapes, or it walks along with Clawd.',
    '  {"rows": [...], "color": "#rrggbb", "x": -12, "path": [{"t": 0, "y": 0}, ...], "trail": false}.',
    '  rows: # the prop colour, + the accent, . empty; at most 8 wide and 6 high (8 with',
    '  "tall"); an even width keeps its pixels paired in cells. color: optional, the accent by default.',
    "  x: sub-pixels from Clawd's centre to the prop's centre as the look starts, negative behind Clawd;",
    '  from then on the prop keeps to its path wherever Clawd goes. path: up to 8 keys in time order, t',
    '  seconds since the look started (0 to dur), y the height of its bottom above the floor (0 to 24),',
    '  x an optional sideways shift; straight lines between keys, then the last key holds. Past y 10 the',
    '  prop has left the band. trail: true for sparks below it while it rises, like a flame.',
    '  The path runs on its own clock and does not follow Clawd: after a wave and two hops Clawd goes on',
    '  as always and may walk off, trip or sit down and sleep. Give a moving path only to a thing that',
    '  moves by itself, such as a rocket or a ball rolling away. A thing Clawd works on stays on the',
    '  floor: one key {"t": 0, "y": 0}. When the look ends, a prop on the floor breaks into its pixels.',
    '- tool (optional): a thing Clawd holds in its front hand, such as a pointer or a pickaxe.',
    '  {"rows": [...], "color": "#rrggbb"}. rows: # the tool colour, + the accent, . empty; at most 8 wide',
    "  and 4 high. color: optional, the accent by default. The first pixel of the bottom row sits one",
    "  pixel past the front arm's tip, and the tool moves with that tip from pose to pose without",
    '  turning, so a wave between up and raised moves it too. Give it a colour other than the body, or it',
    '  reads as part of the arm.',
    '- done: true once you have seen the preview of this exact JSON and it looks right.',
    ...(refused ? ['', `Your last draft was refused: ${refused}. Fix that.`] : []),
    ...(drafts.length > 0 && preview
      ? [
          '',
          `Your ${drafts.length} drafts:`,
          ...drafts.map((d, i) => `${i + 1}. ${d}`),
          `Their sheet is ${preview}. Read it. Line k shows draft k, its number at the left, as the terminal`,
          `shows the band, in ${SHEET_POSES.length} poses: ${SHEET_POSES.join('; ')}.`,
          'Compare them with the reference image, or with the title when there is none, and pick the one',
          'that is easiest to recognise at this size. Fix what the sheet shows is off in it; a feature of',
          'another draft may be taken over. Reply with the fixed JSON, "pick": its number, and "done": false.',
        ]
      : draft && isBefore
      ? [
          '',
          `The look as it is now: ${draft}`,
          ...(preview
            ? [
                `Its preview is ${preview}. Read it. It is a sheet of ${PREVIEW_POSES.length} panels, ${PREVIEW_PER_LINE} per line, each the`,
                `band as the terminal shows it with Clawd in this look, in these poses: ${poses}.`,
                propLine,
              ]
            : []),
          'Make the change asked for and reply with the changed JSON and "done": false.',
        ]
      : draft && preview
      ? [
          '',
          `Your last draft: ${draft}`,
          `Its preview is ${preview}. Read it. It is a sheet of ${PREVIEW_POSES.length} panels, ${PREVIEW_PER_LINE} per line, each the`,
          `band as the terminal shows it with Clawd in your look, in these poses: ${poses}.`,
          propLine,
          ...(change ? ['Check first that it carries the change asked for.'] : []),
          'Compare it with the reference image, or with the title when there is none, and work out what',
          'makes it harder to recognise at this size: silhouette, eyes, legs, arms, proportions. If any of',
          'that can be fixed within the limits, reply with the corrected JSON and "done": false. Reply with',
          'the same JSON and "done": true only when no change would make it clearly more recognisable.',
        ]
      : []),
  ].join('\n')
}

/** A look a model drew, under the name asked for, with its own title or else the one asked for. */
function lookFrom(raw: unknown, name: string, title: string): Emote | string {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return emoteFrom({ ...r, name, title: typeof r.title === 'string' && r.title.trim() ? r.title : title })
}

/** An emote to change, and the change asked for (/clawd emote change). */
type Change = { look: MadeEmote; text: string }

/**
 * A model draws a new emote: EMOTE_DRAFTS drafts, then a round in which it
 * sees them side by side, picks one and fixes it, then a round in which it
 * sees the pick's preview and corrects it. With `start`, the first draft is
 * the emote as it is now, and the model makes the change asked for. The
 * emote, or why there is none.
 */
async function makeEmote($: EngineInterface, name: string, title: string, why: string, image: string, start?: Change): Promise<MadeEmote | string> {
  let best: Emote | null = null
  let draft = start ? JSON.stringify(emoteJson(start.look)) : ''
  let preview = start ? await previewEmote($, start.look, `${name}.before`) : ''
  let drafts: string[] = [] // the drafts to pick from, as JSON
  let refused = ''
  for (let round = 1; round <= EMOTE_ROUNDS; round++) {
    // The run may read the reference image and the newest preview, nothing else.
    const reads = [image, preview].filter(Boolean).map(p => `Read(/${p})`)
    const argv = [
      'claude', '-p', '--model', MAKE_MODEL, '--effort', 'medium', '--safe-mode', '--setting-sources', '',
      '--no-session-persistence', '--tools', 'Read', '--permission-mode', 'dontAsk',
      ...(reads.length > 0 ? ['--allowedTools', ...reads] : []),
    ]
    const r = await $.process.run(argv, {
      cwd: mod.dataDir,
      stdin: emotePrompt(name, title, why, image, draft, preview, refused, start?.text, start !== undefined && round === 1, drafts),
      timeoutMs: EMOTE_ROUND_MS,
    })
    if (r.exitCode !== 0) return `claude exited ${r.exitCode} in round ${round}: ${oneLine(r.stderr || r.stdout, 200)}`
    const raw = parseJson(r.stdout)
    if (!start && !draft && drafts.length === 0) {
      // The drafts go on one sheet for the next round to pick from; a single one is a draft as usual.
      const list = raw?.drafts
      const looks = (Array.isArray(list) ? list : [raw]).slice(0, EMOTE_DRAFTS).map(d => lookFrom(d, name, title))
      const good = looks.filter((l): l is Emote => typeof l !== 'string')
      refused = good.length > 0 ? '' : looks.join('; ') || 'no drafts'
      best = good[0] ?? best
      if (good.length > 1) {
        drafts = good.map(l => JSON.stringify(emoteJson(l)))
        preview = `${mod.dataDir}/emotes/previews/${name}.drafts.png`
        await writeBytes($, preview, emoteSheet(good))
      } else if (good[0]) {
        draft = JSON.stringify(emoteJson(good[0]))
        preview = await previewEmote($, good[0], `${name}.draft${round}`)
      }
      continue
    }
    const look = lookFrom(raw, name, title)
    if (typeof look === 'string') {
      refused = look
      continue
    }
    refused = ''
    // Done counts only for a draft whose preview the model has seen; for a
    // change, not before the model has seen its own changed draft.
    const json = JSON.stringify(emoteJson(look))
    best = look
    if (raw?.done === true && json === draft && !(start && round === 1)) break
    draft = json
    drafts = []
    preview = await previewEmote($, look, `${name}.draft${round}`)
  }
  if (!best) return `no usable draft in ${EMOTE_ROUNDS} rounds: ${refused}`
  const made = new Date(await $.clock.now()).toISOString()
  // A changed emote goes back where it was; the old one is kept in data/emotes/old/.
  const file = start?.look.file ?? `${mod.dataDir}/emotes/${name}.json`
  if (start) await $.fs.write(await oldPath($, name), await $.fs.read(file))
  const changed = start ? { change: start.text } : {}
  await $.fs.write(file, `${JSON.stringify({ ...emoteJson(best), made, project: mod.project, why, image, ...changed }, null, 2)}\n`)
  await previewEmote($, best)
  return { ...best, made, project: mod.project, why, image, file }
}

/** Where an emote's old file goes when it is changed or deleted: data/emotes/old/<name>.<time>.json. */
async function oldPath($: EngineInterface, name: string): Promise<string> {
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  return `${mod.dataDir}/emotes/old/${name}.${stamp}.json`
}

/**
 * Starts drawing an emote in the background; it plays on `who` when done. It
 * runs from a timer, so it outlives the hook that asked for it.
 */
function startEmote($: EngineInterface, name: string, title: string, why: string, image: string, who: string, start?: Change): void {
  brain.making = name
  const w = clawd.world
  if (w) callLabel(w, [], start ? ` · changing ${name}: "${start.text}"` : ` · new emote coming: "${title}"`)
  $.clock.after(1, () => void drawEmote($, name, title, why, image, who, start))
}

async function drawEmote($: EngineInterface, name: string, title: string, why: string, image: string, who: string, start?: Change): Promise<void> {
  let result: MadeEmote | string
  try {
    result = await makeEmote($, name, title, why, image, start)
  } catch (err) {
    result = String(err)
  } finally {
    brain.making = ''
  }
  const w = clawd.world
  const what = start ? 'emote change' : 'new emote'
  if (typeof result === 'string') {
    if (w) callLabel(w, [], ` · ${what} failed`)
    $.ui.log(`clawd: ${what} ${name} failed: ${result}`, { to: 'debug' })
    $.ui.toast(`Clawd's ${what} ${name} failed; /clawd says why`)
    brain.emoteError = `${name}: ${result}`
    return
  }
  if (w) {
    callActs(w, [{ who, what: result, delay: 0 }])
    callLabel(w, [{ who, name: `${name} (${start ? 'changed' : 'new emote'}) "${result.title}"` }])
  }
  brain.recent = [`${who}: ${name}`, ...brain.recent].slice(0, 8)
  $.ui.toast(start ? `Clawd's emote ${name} is changed` : `Clawd has a new emote: ${name}`)
}

/** With `/clawd trace`, keeps the pick in data/picks/<session id>.jsonl, the last TRACE_MAX. */
async function tracePick($: EngineInterface, t: Trace): Promise<void> {
  if (!(await read($, isTracing))) return
  const path = `${mod.dataDir}/picks/${await $.session.id()}.jsonl`
  let lines: string[] = []
  try {
    lines = (await $.fs.read(path)).split('\n').filter(Boolean)
  } catch {
    // the first pick traced in this session
  }
  lines = [...lines, JSON.stringify(t)].slice(-TRACE_MAX)
  try {
    await $.fs.write(path, `${lines.join('\n')}\n`)
  } catch (err) {
    $.ui.log(`clawd: trace not written: ${String(err)}`, { to: 'debug' })
  }
}

/**
 * With `/clawd debug` (user, 2026-10-07), shows the pick in the transcript, in
 * three rows the model never sees: the trigger, the model and its tokens; the
 * whole reply; what came of it. A row shows no line breaks (it draws a glyph
 * for each; tested live 2026-10-07), so the reply's whitespace is collapsed.
 * `$.model.complete` returns the reply's text only, so the model's thinking
 * cannot be shown.
 */
async function debugPick($: EngineInterface, t: Trace, tokens: string): Promise<void> {
  if (!(await read($, isDebugging))) return
  $.ui.log(`Clawd debug · autopick, ${t.trigger} · ${PICK_MODEL}${tokens}`)
  $.ui.log(`reply: ${t.reply.replace(/\s+/g, ' ').trim() || '(none)'}`)
  $.ui.log(`→ ${t.outcome}`)
}

async function localTime($: EngineInterface): Promise<string> {
  try {
    const r = await $.process.run(['date', '+%a %H:%M'], { timeoutMs: 3000 })
    return r.stdout.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function pickPrompt(w: World, trigger: string, made: MadeAct[], emotes: MadeEmote[], madeToday: number, now: number, time: string): string {
  const lines = brain.feed.map(l => l.text)
  const first = brain.feed[0]
  if (first && first.n > brain.seen + 1) lines.unshift(`(${first.n - brain.seen - 1} earlier lines dropped)`)
  const newest = made[0]
  const doing = (a: World['act']) => (a ? (a.routine ?? a.kind) : 'between acts')
  const minis = w.minis.filter(m => !m.isLeaving)
  const canMake = madeToday < NEW_PER_DAY
  return [
    `<session_summary>${brain.summary || '(nothing yet)'}</session_summary>`,
    '<new_since_your_last_pick>',
    ...(lines.length > 0 ? lines : ['(nothing new)']),
    '</new_since_your_last_pick>',
    '<situation>',
    `trigger: ${trigger}`,
    `project: ${mod.project}`,
    `local time: ${time}`,
    `session running for ${ago(now - mod.startedAt)}; last session event ${ago((w.t - w.lastEventAt) * 1000)} ago`,
    `the session is ${w.mode === 'work' ? 'working' : 'idle'}; ${w.pile} bricks on the pile (one per tool call that does more than read)`,
    `your recent calls, newest first: ${brain.recent.join(', ') || 'none'}`,
    '</situation>',
    '<entities>',
    `clawd: Clawd itself, for the main session; doing ${doing(w.act)}`,
    ...minis.map(
      m =>
        `${m.id}: a mini Clawd for the subagent "${oneLine(m.title, 60)}" (${m.kind}); running ` +
        `${ago((w.t - m.since) * 1000)}, ${m.tools} tool calls; doing ${doing(m.act)}`,
    ),
    '</entities>',
    `<newest_made_act>${
      newest
        ? `${newest.name}: "${newest.title}", made ${ago(now - Date.parse(newest.made))} ago in ${newest.project || '?'} because: ${newest.why || '?'}`
        : 'none yet'
    }</newest_made_act>`,
    '<acts>',
    ...Object.entries(PICKABLE).map(([name, what]) => `${name}: ${what}`),
    ...made.map(r => `${r.name}: ${r.title}`),
    ...emotes.map(e => `${e.name}: an emote, clawd only: Clawd turns into ${e.title} for ${e.dur} s`),
    '</acts>',
    '',
    'Return {"summary": "...", "calls": [{"who": "clawd", "play": "...", "delay": 0}], "why": "...", "new": null}.',
    '- summary: at most three sentences. Update the session summary with what is new: what the',
    '  session is about, how it is going, the mood. Keep it as it is when nothing is new.',
    '- calls: what to play, like parallel tool calls: one call, or several for several entities.',
    '  who: an id from <entities>, or "all". play: a name from <acts>. delay: seconds from now,',
    `  0 to ${MAX_DELAY_S}. Calls with the same delay start together; different delays stagger them,`,
    '  e.g. a wave that runs from clawd to a1 to a2. Several calls for one entity play one after',
    '  another. A call cuts in on what the entity is doing, except a reaction to a session event,',
    '  which it waits for. Leave out entities that have no reason to react. Vary the acts: avoid',
    '  your recent calls unless one clearly fits best. Quiet moments suit calm acts.',
    '- why: a few words.',
    // Tuned with replays through Haiku (2026-10-03): the earlier "null, unless no
    // act fits" wording answered "hi snowman" with a wave, 0 of 18 nicknames.
    canMake
      ? '- new: first read what the person just wrote. When they call Clawd by a name, compare it to\n' +
        '  something or ask it for something ("hey pirate", "he looks like a teapot", "do a cartwheel"),\n' +
        '  they want to see Clawd become that thing or do that trick. If no act in <acts> shows exactly\n' +
        '  that, ask for one. Also ask when the session reaches a moment worth its own act. Asking is\n' +
        '  {"name": "snake_case_name", "title": "what it shows and when it fits, under 80 characters",\n' +
        '  "for": "<who plays it first>"}; otherwise new is null. Add "look": true when Clawd should look\n' +
        '  like that thing (a pirate, a teapot) rather than do a trick: then it is drawn as a new emote.\n' +
        '  Add "image": "<path>" when the person wrote the path of a local image of that thing. calls\n' +
        '  still name acts from <acts>: play the closest one while the new act is written.\n' +
        `  ${madeToday} of at most ${NEW_PER_DAY} new acts were made in the last 24 hours.`
      : `- new: null. The ${NEW_PER_DAY} new acts for the last 24 hours are made.`,
  ].join('\n')
}

function makePrompt(name: string, title: string, why: string, made: Routine[], emotes: Emote[]): string {
  const names = (items: { name: string; title: string }[]) => items.map(x => `${x.name} ("${oneLine(x.title, 60)}")`).join(', ') || 'none yet'
  return [
    'Write the steps for a new act.',
    `name: ${name}`,
    `title: ${title}`,
    `why it was asked for: ${why}`,
    `the session so far: ${brain.summary || '(no summary)'}`,
    '',
    'Clawd is 6 cells wide and stands on a floor line; above its head is one row of room (two when',
    'it jumps). A mini Clawd, half its size, may play the act too. Steps play one after another;',
    'the act should last 3 to 12 seconds. A step is an',
    'object with "do" and optional fields:',
    '- idle {dur}: stands and looks around. wave {dur}. look {dur}: looks left and right.',
    '  think {dur}: looks up with a question mark.',
    '- wander {to}, run {to}: walks or runs to a spot, to from 0 (left edge) to 1 (right edge).',
    '  run {wrap true, dir -1|1, to}: a lap: runs off the edge in dir and straight back in from the',
    '  other edge, on to `to` (default: where it started).',
    '- move {to, speed, ease, wrap, dir}: goes to `to` at `speed`: walk, run, or a number of walking',
    '  speeds from 0.25 to 4 (run is 3). ease true speeds up from a stand and slows to a stop, about',
    '  0.4 s each way. wrap and dir work as for run. wander and run also take speed and ease.',
    '- hop {n 1-3, height 1-6, sparks true|false}: hops in place.',
    '- jump {dir -1|1, height 1-6}: a big jump sideways.',
    '- celebrate: two hops with sparks, then a wave. trip: trips, lies flat with dizzy stars, gets',
    '  up. chase: chases a sparkle and jumps to catch it. peek: runs off one edge and comes back',
    '  from the other. alert: an exclamation mark, eyes wide.',
    '- pose {dur 0.2-4, shape, sit}: holds still. shape: normal, squash, stretch or flat. sit: true',
    '  sits.',
    '- Any step may also take arms, eyes, look and up, which hold for that whole step, so',
    '  {"do": "run", "arms": "wave"} runs and waves. arms: out, up, down, wave, flail or none. eyes:',
    '  open, closed or wide. look: -1 back, 0 ahead, 1 forward. up: true looks up.',
    '- mark {glyph}: a glyph over its head for a moment, one of ! ? * + ~ z o ^ #.',
    '- sparks {n 1-8}: gold sparks around it.',
    '- emote {name, dur 1-20}: puffs into a look by name; the steps after it play in that look for',
    `  dur seconds (default: the look's own time). A mini skips it. Looks: ${names(emotes)}.`,
    "- play {name}: plays a made act's steps here. Inside it, that act's own play steps are skipped.",
    `  Made acts: ${names(made)}.`,
    'At most 12 steps. Return {"steps": [...]}.',
  ].join('\n')
}

/** Opus writes the steps of a new act; the act, or why there is none. */
async function makeAct($: EngineInterface, name: string, title: string, why: string, made: Routine[], emotes: Emote[]): Promise<MadeAct | string> {
  const answer = await $.model.complete({
    model: MAKE_MODEL,
    system: MAKE_SYSTEM,
    prompt: makePrompt(name, title, why, made, emotes),
    maxTokens: 2000,
    effort: 'medium',
    timeoutMs: 120_000,
  })
  if (!answer.isAnswered) return answer.reason
  const routine = routineFrom({ name, title, steps: parseJson(answer.text)?.steps })
  if (typeof routine === 'string') return `${routine}; Opus wrote: ${oneLine(answer.text, 300)}`
  const act: MadeAct = { ...routine, made: new Date(await $.clock.now()).toISOString(), project: mod.project, why }
  await $.fs.write(`${mod.dataDir}/acts/${name}.json`, `${JSON.stringify(act, null, 2)}\n`)
  return act
}

const ASKED = 'asked with /clawd autopick now'

function schedulePick($: EngineInterface, now: number): void {
  brain.timer?.cancel()
  const ms = Math.round((PICK_MIN_S + Math.random() * (PICK_MAX_S - PICK_MIN_S)) * 1000)
  brain.dueAt = now + ms
  brain.timer = $.clock.after(ms, () => void pickNext($, 'timer'))
}

/** Asks PICK_MODEL what Clawd plays next, then sets the timer for the next pick. */
async function pickNext($: EngineInterface, trigger: string): Promise<void> {
  brain.timer?.cancel()
  brain.timer = null
  brain.dueAt = 0
  if (brain.isPicking) {
    brain.again = trigger
    return
  }
  const w = clawd.world
  const now = await $.clock.now()
  // Off, or paused while Remote Control is on, only /clawd autopick now picks, and no timer runs.
  if (trigger !== ASKED && !(await isPickingAlone($))) return
  if (!w || !clawd.requestId || !(await read($, isClawdOn))) return schedulePick($, now)
  // Asleep with no subagent running, Clawd waits for the next session event,
  // which wakes it and picks.
  if (trigger === 'timer' && isAsleep(w) && w.minis.length === 0) return
  brain.isPicking = true
  try {
    await pick($, w, trigger, now)
  } catch (err) {
    $.ui.log(`clawd: pick failed: ${String(err)}`, { to: 'debug' })
  } finally {
    brain.isPicking = false
    const again = brain.again
    brain.again = null
    if (again) void pickNext($, again)
    else if (await isPickingAlone($)) schedulePick($, await $.clock.now())
  }
}

async function pick($: EngineInterface, w: World, trigger: string, now: number): Promise<void> {
  const emotes = await loadEmotes($)
  const made = await loadMade($, emotes)
  const madeToday = [...made, ...emotes].filter(r => r.made && now - Date.parse(r.made) < DAY_MS).length
  const fedUpTo = brain.seq
  // What the person wrote in the lines this pick reads: an image path the picker names must be in there.
  const userWrote = brain.feed.filter(l => l.n <= fedUpTo && l.text.startsWith('user: ')).map(l => l.text).join('\n')
  const prompt = pickPrompt(w, trigger, made, emotes, madeToday, now, await localTime($))
  const answer = await $.model.complete({
    model: PICK_MODEL,
    system: PICK_SYSTEM,
    prompt,
    maxTokens: 600,
    timeoutMs: 30_000,
  })
  const at = new Date(now).toISOString()
  const tokens = ` · ${answer.usage.input_tokens} tokens in, ${answer.usage.output_tokens} out`
  const traced = async (reply: string, outcome: string) => {
    const t = { at, trigger, system: PICK_SYSTEM, prompt, reply, outcome }
    await debugPick($, t, tokens)
    await tracePick($, t)
  }
  if (!answer.isAnswered) {
    brain.last = { trigger, calls: [], why: `no answer: ${answer.reason}`, at: now }
    return traced('', `no answer: ${answer.reason}`)
  }
  brain.feed = brain.feed.filter(l => l.n > fedUpTo)
  brain.seen = fedUpTo
  const parsed = parseJson(answer.text)
  if (typeof parsed?.summary === 'string' && parsed.summary.trim()) brain.summary = parsed.summary.trim()
  const why = typeof parsed?.why === 'string' ? parsed.why : ''
  const byName = new Map<string, Routine | Emote>([...emotes.map(e => [e.name, e] as const), ...made.map(r => [r.name, r] as const)])
  const actOf = (name: unknown): Playable | undefined =>
    typeof name !== 'string' ? undefined : Object.hasOwn(PICKABLE, name) ? (name as ActKind) : byName.get(name)
  const isWho = (who: string) => who === 'all' || bodyOf(w, who) !== undefined

  // The calls; a bare {"play"} is one call for Clawd.
  const raw = Array.isArray(parsed?.calls) ? parsed.calls : parsed?.play !== undefined ? [{ who: 'clawd', play: parsed.play }] : []
  const calls: Call[] = []
  const called: Called[] = []
  for (const item of raw.slice(0, 12)) {
    const c = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const who = typeof c.who === 'string' ? c.who : 'clawd'
    const what = actOf(c.play)
    if (!isWho(who) || what === undefined) continue
    const delay = typeof c.delay === 'number' && Number.isFinite(c.delay) ? Math.min(MAX_DELAY_S, Math.max(0, c.delay)) : 0
    calls.push({ who, what, delay })
    called.push({ who, name: typeof what === 'string' ? what : what.name, delay })
  }
  // Haiku often plays the act it asks for before it exists; that call is
  // dropped above, and the ask still stands without any other call.
  const ask = parsed?.new as { name?: unknown; title?: unknown; for?: unknown; look?: unknown; image?: unknown } | null | undefined
  const isAsking = !!ask && typeof ask.name === 'string' && typeof ask.title === 'string'
  if (calls.length === 0 && !isAsking) {
    brain.last = { trigger, calls: [], why: `unusable reply: ${oneLine(answer.text, 80)}`, at: now }
    return traced(answer.text, 'unusable reply: no call names a known body and act')
  }
  if (calls.length > 0) {
    callActs(w, calls)
    callLabel(w, called)
    brain.recent = [...called.map(callText), ...brain.recent].slice(0, 8)
  }
  brain.last = { trigger, calls: called, why, at: now }
  const playing = `played ${called.map(callText).join(', ') || 'nothing'}`

  // A new act, when asked for and allowed; it plays on `for` once written.
  if (!ask || typeof ask.name !== 'string' || typeof ask.title !== 'string') return traced(answer.text, `${playing}; no new act`)
  if (madeToday >= NEW_PER_DAY) return traced(answer.text, `${playing}; new act ${ask.name} asked, but ${NEW_PER_DAY} were made today`)
  const name = ask.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  const title = oneLine(ask.title, 80)
  const target = typeof ask.for === 'string' && isWho(ask.for) ? ask.for : 'clawd'
  const existing = actOf(name)
  if (existing !== undefined) {
    // It asked for one that exists: play that.
    callActs(w, [{ who: target, what: existing, delay: 0 }])
    callLabel(w, [{ who: target, name }])
    return traced(answer.text, `${playing}; new act ${name} exists, played that`)
  }
  if (ask.look === true) {
    // A new look: drawn in the background, so the picks go on meanwhile.
    if (EMOTE_VERBS.includes(name)) return traced(answer.text, `${playing}; new emote ${name} refused: the name is a /clawd word`)
    if (brain.making) return traced(answer.text, `${playing}; new emote ${name} asked, but ${brain.making} is still being drawn`)
    const image = typeof ask.image === 'string' && userWrote.includes(ask.image) ? await imagePath($, ask.image) : ''
    startEmote($, name, title, why, image, 'clawd')
    return traced(answer.text, `${playing}; new emote ${name} being drawn${image ? ` after ${image}` : ''}`)
  }
  callLabel(w, called, ` · new act coming: "${title}"`)
  const result = await makeAct($, name, title, why, made, emotes)
  if (typeof result === 'string') {
    callLabel(w, called, ' · new act failed')
    $.ui.log(`clawd: new act ${name} failed: ${result}`, { to: 'debug' })
    return traced(answer.text, `${playing}; new act ${name} failed: ${result}`)
  }
  // The file keeps the names; the act plays with its emote and play steps linked.
  callActs(w, [{ who: target, what: linkRoutine(result, n => byName.get(n)), delay: 0 }])
  callLabel(w, [{ who: target, name: `${name} (new) "${title}"` }])
  brain.recent = [`${target}: ${name}`, ...brain.recent].slice(0, 8)
  brain.last = { trigger, calls: [{ who: target, name, delay: 0 }], why, at: now, made: result }
  return traced(answer.text, `${playing}; new act ${name} made`)
}

/** What a `/clawd` word may name now: the minis on screen, the emotes, the made acts, the built-in acts. */
async function loadNames($: EngineInterface): Promise<Names> {
  const emotes = await loadEmotes($)
  const made = await loadMade($, emotes)
  const minis = (clawd.world?.minis ?? []).filter(m => !m.isLeaving)
  return {
    minis: Object.fromEntries(minis.map(m => [m.id, `the mini for "${oneLine(m.title, 40)}"`])),
    emotes: Object.fromEntries(emotes.map(x => [x.name, x.title])),
    made: Object.fromEntries(made.map(r => [r.name, r.title])),
    acts: Object.fromEntries(ACTS.map(a => [a, ACT_WHAT[a] ?? 'an act'])),
  }
}

/** Sets the menu above the prompt (undefined closes it); a write only when it changes. */
async function setMenu($: EngineInterface, menu: Menu | undefined): Promise<void> {
  const now = await read($, clawdMenu)
  if (JSON.stringify(now) !== JSON.stringify(menu ?? null)) await update($, clawdMenu, () => menu ?? null)
}

/** The text cut to n cells, ending in `...` when cut. */
function cut(s: string, n: number): string {
  if (s.length <= n) return s
  return n <= 3 ? s.slice(0, Math.max(0, n)) : `${s.slice(0, n - 3)}...`
}

/** The menu's top edge as Text, when Clawd is hidden: the title, and ` · note`, cut to fit. */
function edgeLine(title: string, note: string, columns: number): [string, string] {
  const room = Math.max(0, columns - 6)
  const head = cut(clean(title), room)
  return [head, cut(note ? clean(` · ${note}`) : '', room - head.length)]
}

// What follows each command in /clawd help.
const ARGS: Readonly<Record<string, string>> = {
  help: ' [uml]',
  act: ` <act> [1-${MAX_REPEAT}]`,
  emote: ' <emote>',
  list: ' acts|made|emotes|minis',
  autopick: ' [now|on|off]',
  trace: ' [on|off]',
  debug: ' [on|off]',
}
// What follows each `/clawd emote` command in /clawd help.
const EMOTE_ARGS: Readonly<Record<string, string>> = {
  create: ' <name> [image] <looks>',
  change: ' <emote> [image] <change>',
  delete: ' <emote>',
  preview: ' <emote>',
}
// The first line of /clawd list <kind>.
const KIND_INTRO: Record<ListKind, string> = {
  acts: `Acts: moves Clawd or a mini plays once. /clawd act <act> [1-${MAX_REPEAT}], or /clawd <mini> <act>.`,
  made: 'Made acts: acts a model wrote when the autopicker asked for one. They play like acts.',
  emotes: 'Emotes: looks Clawd takes for a while. /clawd emote <emote> plays one; /clawd emote create, change and delete make, alter and remove them.',
  minis: 'Minis: small Clawds, one per running subagent; each leaves when its subagent ends. /clawd <mini> <act>.',
}

async function clawdHelp($: EngineInterface): Promise<string> {
  const names = await loadNames($)
  const usage: [string, string][] = [
    ['/clawd', 'what Clawd is doing, and the last autopick'],
    ...Object.entries(COMMANDS).flatMap(([name, what]): [string, string][] => {
      const row: [string, string] = [`/clawd ${name}${ARGS[name] ?? ''}`, what]
      if (name !== 'emote') return [row]
      return [
        [`/clawd emote <emote>`, "Clawd takes an emote's look for a while"],
        ...Object.entries(EMOTE_COMMANDS).map(([verb, does]): [string, string] => [`/clawd emote ${verb}${EMOTE_ARGS[verb] ?? ''}`, does]),
        [`/clawd <mini> <act> [1-${MAX_REPEAT}]`, 'a mini plays an act, e.g. /clawd a1 wave'],
      ]
    }),
  ]
  const width = Math.max(...usage.map(([cmd]) => cmd.length))
  const n = (rows: Readonly<Record<string, string>>) => Object.keys(rows).length
  return [
    'Clawd is the Claude Code logo, running in the band above the prompt. It hops when you send a prompt,',
    'holds up a scroll while tools only read, stacks a brick for each other tool call and kicks the pile',
    'over at the next prompt. Between events it plays random acts. With /clawd autopick on, a model, the',
    `autopicker, chooses instead, every ${PICK_MIN_S} to ${PICK_MAX_S} s, and that uses your Claude usage.`,
    '',
    'What can play:',
    '  act    a move Clawd or a mini plays once: jump, wave, chase, ... Made acts are acts a model',
    '         wrote when the autopicker asked for one; they play the same way.',
    '  emote  a look Clawd itself takes for a while, such as an octopus; it keeps moving in that look.',
    '         Clawd only. /clawd emote create, change and delete make, alter and remove them.',
    '  mini   a small Clawd that comes for each running subagent and leaves when it ends. You cannot',
    '         make one; while it is there, /clawd <its id> <act> tells it what to play (a1, a2, ...).',
    'While Remote Control is on, Clawd wears a gray antenna with a green tip, on any look, and the autopicker pauses.',
    `Now there are ${n(names.acts)} acts, ${n(names.made)} made acts, ${n(names.emotes)} emotes and ${n(names.minis)} minis; /clawd list <kind> names them.`,
    '',
    ...usage.map(([cmd, what]) => `${cmd.padEnd(width)}  ${what}`),
    '',
    'Short forms: /clawd jump works without act, an emote name without emote, and a name may be cut short',
    'while only one fits (/clawd cel plays celebrate). While you type, a framed list above the prompt',
    'shows the names the word fits, and a space writes out a word that fits one name.',
    '',
    '/clawd help uml draws how Clawd behaves and how a new act or emote is made and found, as UML.',
  ].join('\n')
}

/** `/clawd help uml`: the diagrams, with a warning when the terminal is narrower than they are. */
function clawdHelpUml(columns: number): string {
  const lines = clawdUml({
    sleepAfterS: SLEEP_AFTER_S,
    readHoldS: READ_HOLD_S,
    miniStaleS: MINI_STALE_S,
    maxMinis: MAX_MINIS,
    pickMinS: PICK_MIN_S,
    pickMaxS: PICK_MAX_S,
    maxDelayS: MAX_DELAY_S,
    newPerDay: NEW_PER_DAY,
    maxSteps: MAX_STEPS,
    emoteDrafts: EMOTE_DRAFTS,
    emoteRounds: EMOTE_ROUNDS,
    pickModel: PICK_MODEL,
    makeModel: MAKE_MODEL,
  })
  const narrow = columns < UML_WIDTH ? [`The diagrams are ${UML_WIDTH} columns wide and the terminal has ${columns}, so lines wrap.`, ''] : []
  return [...narrow, ...lines].join('\n')
}

// The colours of /clawd help uml, by what umlKinds says a run is.
const UML_STYLE: Record<UmlKind, { color?: string; bold?: boolean }> = {
  text: {},
  heading: { bold: true },
  state: { color: '#d77757' }, // Clawd's orange, ORANGE in clawd-sim.ts
  name: { bold: true },
  note: { color: FLOOR_TEXT },
  flow: { color: '#5fa8d3' },
  end: { color: 'success', bold: true },
  guard: { color: '#e0b84a' },
  footnote: { color: '#b48ead' },
}

async function clawdListOf($: EngineInterface, of: ListKind): Promise<string> {
  const rows = Object.entries((await loadNames($))[of])
  let intro = KIND_INTRO[of]
  if (of === 'made' || of === 'emotes') {
    const now = await $.clock.now()
    const dated = [...(await loadMade($)), ...(await loadEmotes($))]
    const madeToday = dated.filter(r => r.made && now - Date.parse(r.made) < DAY_MS).length
    intro += ` Made in the last 24 h: ${madeToday} acts and emotes; the autopicker may ask for ${NEW_PER_DAY} a day.`
  }
  const width = Math.max(0, ...rows.map(([name]) => name.length))
  return [intro, ...(rows.length > 0 ? rows.map(([name, what]) => `  ${name.padEnd(width)}  ${what}`) : ['  none now'])].join('\n')
}

async function clawdStatus($: EngineInterface): Promise<string> {
  const w = clawd.world
  const now = await $.clock.now()
  const where = w ? `${w.act?.routine ?? w.act?.kind ?? 'between acts'}, ${w.mode} mode, pile of ${w.pile}` : 'not on screen'
  const last = brain.last
  const next = brain.isPicking
    ? 'The autopicker is choosing now.'
    : !(await isAutopicking($))
      ? 'The autopicker is off, so Clawd plays random acts; /clawd autopick on lets a model choose (uses your Claude usage).'
      : mod.isRemote
        ? 'The autopicker is paused while Remote Control is on, so Clawd plays random acts; it picks again when Remote Control ends.'
        : brain.dueAt > 0
          ? `Next autopick in ${ago(brain.dueAt - now)}.`
          : 'Next autopick at the next prompt or turn end.'
  const minis = (w?.minis ?? []).map(
    m =>
      `${m.id} "${oneLine(m.title, 40)}" (${m.kind}, ${ago((w ? w.t - m.since : 0) * 1000)}, ${m.tools} tools, ` +
      `${m.isLeaving ? 'leaving' : (m.act?.routine ?? m.act?.kind ?? 'between acts')})`,
  )
  return [
    `Clawd ${(await read($, isClawdOn)) ? 'on' : 'off'}: ${where}.${mod.isRemote ? ' Remote Control is on, so it wears an antenna.' : ''}`,
    `Minis: ${minis.join('; ') || 'none (one comes per running subagent)'}; ${w?.minisMade ?? 0} this session.`,
    last
      ? `Last autopick (${last.trigger}, ${ago(now - last.at)} ago): ${last.calls.map(callText).join(', ') || '-'}` +
        `${last.why ? `; ${last.why}` : ''}.` +
        (last.made ? ` New act "${last.made.title}".` : '')
      : 'No autopick yet.',
    `${next} Session summary: ${brain.summary || '(none yet)'}`,
    ...(brain.making ? [`Drawing the emote ${brain.making} now.`] : []),
    ...(brain.emoteError ? [`The last emote drawing failed: ${brain.emoteError}`] : []),
    '/clawd help explains acts, emotes and minis and lists the commands.',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    mod.isOff = (await $.env.get('CLAUDE_CLAWD_OFF')) === '1' || !e.isInteractive
    if (mod.isOff) return started
    const seed = Number(await $.env.get('CLAUDE_CLAWD_SEED'))
    if (Number.isInteger(seed)) mod.rand = seeded(seed)
    const isOn = (await $.store.get('isClawdOn')) !== false
    if (!isOn) await update($, isClawdOn, () => false)
    $.ui.log(
      isOn
        ? `Clawd is on · /clawd help explains it · /clawd off hides it (remembered) · remove the mod: claude plugin disable ${$.plugin.name}`
        : `Clawd is off · /clawd on brings it back`,
    )
    await $.command.register({
      name: 'clawd',
      description: 'Clawd above the prompt: help, act, emote, list, on, off, autopick; short names work',
    })
    $.clock.every(TICK_MS, () => clawdTick($))
    await pollRemote($)
    $.clock.every(REMOTE_POLL_MS, () => void pollRemote($))
    const root = $.plugin.root
    mod.emoteDir = `${root}/emotes`
    mod.dataDir = await dataDirOf($, root)
    mod.look = await lookOf($, root)
    if (mod.look) await loadEmotes($) // finds the base look before Clawd is drawn
    mod.project = e.cwd.split('/').filter(Boolean).pop() ?? e.cwd
    mod.startedAt = await $.clock.now()
    if (await isPickingAlone($)) schedulePick($, mod.startedAt)
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    if (mod.names) {
      mod.names = undefined
      await setMenu($, undefined)
    }
    if (!mod.isOff && e.origin.kind !== 'plugin' && clawd.world) onPrompt(clawd.world)
    if (!mod.isOff && e.origin.kind !== 'plugin' && !e.text.trimStart().startsWith('/clawd')) {
      feed(`user: ${oneLine(e.text, 400)}`)
      // On a timer, so the prompt never waits for the picker.
      $.clock.after(1, () => void pickNext($, 'prompt sent'))
    }
    return next(e)
  })

  // Typing `/clawd ...`: the band shows a framed list of what the word at the
  // cursor fits, the words turn green (one name) or red (none), and a space
  // after a word that fits one name writes it out (Tab never reaches a hook).
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (mod.isOff || !isClawdDraft(box.text)) {
      if (mod.names) {
        mod.names = undefined
        await setMenu($, undefined)
      }
      return box
    }
    mod.names ??= await loadNames($) // fresh once per /clawd draft
    const typed = e.inputText === ' ' ? writeOut(box.text, box.cursor, mod.names) : undefined
    const text = typed?.text ?? box.text
    const cursor = typed?.cursor ?? box.cursor
    await setMenu($, menuFor(text, cursor, mod.names))
    const marks = marksFor(text, mod.names).map(m => ({ start: m.start, end: m.end, color: m.isFit ? 'success' : 'error' }))
    return { ...box, text, cursor, decorations: [...(typed ? [] : (box.decorations ?? [])), ...marks] }
  })

  // A subagent started: a mini Clawd for it, while it runs.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const w = clawd.world
    if (mod.isOff || !w || started.agentId === undefined) return started
    const mini = spawnMini(w, started.agentId, e.description, e.subagentType)
    feed(
      `subagent ${mini?.id ?? '(no mini, too many)'} started: "${oneLine(e.description, 80)}" (${e.subagentType})` +
        `${e.background ? ', in the background' : ''}`,
    )
    if (mini) $.clock.after(1, () => void pickNext($, `subagent ${mini.id} started`))
    return started
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isError = ran.deny !== undefined || ran.isError === true
    // A Read, or a Bash call the engine judged read-only (rg, ls, cat), makes it read.
    const isReading = !isError && (e.tool === 'Read' || (e.tool === 'Bash' && ran.isReadOnly === true))
    if (!mod.isOff && clawd.world) onTool(clawd.world, isError, e.agentId, isReading)
    if (!mod.isOff) feed(toolLine(e as unknown as Record<string, unknown>, isError))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (mod.isOff) return result
    if (e.agentId !== undefined) {
      // A subagent's answer: its mini says goodbye and runs off.
      const id = miniName(e.agentId)
      const mini = clawd.world ? endMini(clawd.world, e.agentId, e.reason) : undefined
      if (mini) {
        feed(`subagent ${id} finished (${e.reason}, ${Math.round(e.durationMs / 1000)} s): ${oneLine(e.answer, 200, true)}`)
        $.clock.after(1, () => void pickNext($, `subagent ${id} finished`))
      }
      return result
    }
    if (clawd.world) onTurnEnd(clawd.world, e.reason)
    feed(`assistant, turn ended (${e.reason}, ${Math.round(e.durationMs / 1000)} s): ${oneLine(e.answer, 500, true)}`)
    $.clock.after(1, () => void pickNext($, `turn ended (${e.reason})`))
    return result
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    if (mod.names) {
      mod.names = undefined
      await setMenu($, undefined)
    }
    // A word may be cut short while it fits one name (clawd-words.ts).
    const names = await loadNames($)
    const order = orderOf(words, names)
    if (order.kind === 'status') return { text: await clawdStatus($) }
    if (order.kind === 'unclear') return { text: order.text }
    if (order.kind === 'list') return { text: await clawdListOf($, order.of) }
    const w = clawd.world
    if (order.kind === 'play') {
      if (!w) return { text: 'Clawd is not on screen.' }
      const { who, fit, count: n } = order
      const what = fit.kind === 'emote' ? (await loadEmotes($)).find(x => x.name === fit.name) : fit.kind === 'made' ? (await loadMade($)).find(r => r.name === fit.name) : undefined
      if (fit.kind !== 'act' && !what) return { text: `Clawd: ${fit.name} is gone.` }
      if (who !== 'clawd' && !bodyOf(w, who)) return { text: `Clawd: ${who} has left.` }
      // All repeats are queued at once, so one does not cut the next short.
      perform(w, what ?? (fit.name as ActKind), n, who)
      const name = who === 'clawd' ? 'Clawd' : who
      return { text: n > 1 ? `${name}: ${fit.name} ×${n}.` : `${name}: ${fit.name}.` }
    }
    const verb = order.name
    const [arg] = order.rest
    if (verb === 'help') {
      if (arg === undefined) return { text: await clawdHelp($) }
      return { text: 'uml'.startsWith(arg) ? clawdHelpUml(e.presentation.columns) : 'Clawd: /clawd help takes uml or nothing.' }
    }
    if (verb === 'on' || verb === 'off') {
      await update($, isClawdOn, () => verb === 'on')
      await $.store.set('isClawdOn', verb === 'on')
      return { text: `Clawd ${verb}.` }
    }
    // Bare trace, debug and autopick switch their state (user, 2026-10-07:
    // "it should just switch the current state"); on and off still set it.
    if (verb === 'trace') {
      const turn = arg === undefined ? undefined : ['on', 'off'].find(t => t === arg || (arg.length > 1 && t.startsWith(arg)))
      if (arg !== undefined && !turn) return { text: 'Clawd: /clawd trace takes on, off or nothing.' }
      const isOn = turn ? turn === 'on' : !(await read($, isTracing))
      await update($, isTracing, () => isOn)
      return {
        text: isOn
          ? `Clawd: each autopick now goes to ${mod.dataDir}/picks/${await $.session.id()}.jsonl (the last ${TRACE_MAX}). /clawd trace stops it.`
          : 'Clawd: autopicks are no longer traced.',
      }
    }
    if (verb === 'debug') {
      const turn = arg === undefined ? undefined : ['on', 'off'].find(t => t === arg || (arg.length > 1 && t.startsWith(arg)))
      if (arg !== undefined && !turn) return { text: 'Clawd: /clawd debug takes on, off or nothing.' }
      const isOn = turn ? turn === 'on' : !(await read($, isDebugging))
      await update($, isDebugging, () => isOn)
      // User, 2026-10-07: debug looked broken while autopick was off and no pick ran.
      const offHint = !(await isAutopicking($))
        ? ' Autopick is off, so only /clawd autopick now picks; /clawd autopick lets it run by itself.'
        : mod.isRemote
          ? ' Autopick is paused while Remote Control is on, so only /clawd autopick now picks.'
          : ''
      return {
        text: isOn
          ? `Clawd: debug on. Each autopick's whole reply, its tokens and what came of it now show here, dim and not sent to the model. The model's thinking is not available to a mod.${offHint} /clawd debug turns it off.`
          : 'Clawd: debug off.',
      }
    }
    if (verb === 'autopick') {
      const turn = arg === undefined ? undefined : ['now', 'on', 'off'].find(t => t === arg || (arg.length > 1 && t.startsWith(arg)))
      if (arg !== undefined && !turn) return { text: 'Clawd: /clawd autopick takes now, on, off or nothing.' }
      if (turn === 'now') {
        $.clock.after(1, () => void pickNext($, ASKED))
        return { text: 'Clawd: the autopicker chooses now; /clawd shows its pick.' }
      }
      const isOn = turn ? turn === 'on' : !(await isAutopicking($))
      await $.store.set('isAutopickOn', isOn)
      if (isOn) {
        if (!mod.isRemote) schedulePick($, await $.clock.now())
        return {
          text:
            `Clawd: the autopicker is on (remembered). ${PICK_MODEL} picks what plays after each prompt and turn and every ` +
            `${PICK_MIN_S} to ${PICK_MAX_S} s, about 100 calls an hour in a busy session, and may have ${MAKE_MODEL} make ` +
            `up to ${NEW_PER_DAY} new acts or emotes a day. It all counts against your Claude usage. /clawd autopick turns it off.` +
            (mod.isRemote ? ' It is paused while Remote Control is on and starts when Remote Control ends.' : ''),
        }
      }
      brain.timer?.cancel()
      brain.timer = null
      brain.dueAt = 0
      return { text: 'Clawd: the autopicker is off (remembered). Clawd plays random acts and makes no model calls. /clawd autopick turns it on.' }
    }
    const emotes = await loadEmotes($)
    if (verb === 'preview') {
      const fits = arg === undefined ? [] : namesFit(arg, ['emote'], names)
      const look = fits.length === 1 ? emotes.find(x => x.name === fits[0]?.name) : undefined
      if (!look) return { text: `Clawd: no emote ${arg ?? ''}. Emotes: ${emotes.map(x => x.name).join(', ') || 'none'}.` }
      const path = await previewEmote($, look)
      const poses = look.prop ? [...PREVIEW_POSES, ...PREVIEW_PROP_POSES] : PREVIEW_POSES
      return { text: `Clawd: ${look.name} in ${poses.length} poses, ${PREVIEW_PER_LINE} per line, is in ${path}. The poses: ${poses.join(', ')}.` }
    }
    if (verb === 'create') {
      // `/clawd emote create <name> [image path] <what it looks like>`; a draw is a
      // paid model run, so it needs an image or a description.
      const [name = '', ...rest] = order.rest
      const at = rest.findIndex(word => IMAGE.test(word))
      const image = at >= 0 ? await imagePath($, rest[at] ?? '') : ''
      if (at >= 0 && !image) return { text: `Clawd: ${rest[at]} is no image file.` }
      const looks = oneLine(rest.filter((_, i) => i !== at).join(' '), 80)
      const title = looks || name.replace(/_/g, ' ')
      if (!/^[a-z][a-z0-9_]{1,30}$/.test(name) || (!looks && !image)) {
        return { text: 'Usage: /clawd emote create <snake_case_name> [image path] <what it looks like>, e.g. /clawd emote create frog a green frog with big eyes' }
      }
      const taken = [...ACTS, ...Object.keys(PICKABLE), ...EMOTE_VERBS, ...(await loadMade($)).map(r => r.name), ...emotes.map(x => x.name)]
      if (taken.includes(name)) return { text: `Clawd: ${name} is taken; pick another name.` }
      if (brain.making) return { text: `Clawd: ${brain.making} is still being drawn; one at a time.` }
      startEmote($, name, title, 'asked for with /clawd emote create', image, 'clawd')
      return {
        text: `Clawd: a model draws ${name}${image ? ` after ${image}` : ''}, in up to ${EMOTE_ROUNDS} rounds of a minute or two; it plays when done.`,
      }
    }
    // orderOf has checked that change and delete name an emote in full.
    const look = emotes.find(x => x.name === arg)
    if ((verb === 'change' || verb === 'delete') && !look) return { text: `Clawd: ${arg ?? ''} is gone.` }
    if (look && brain.making === look.name) return { text: `Clawd: ${look.name} is being drawn right now; wait until it is done.` }
    if (verb === 'delete' && look) {
      const to = await oldPath($, look.name)
      await $.process.run(['mkdir', '-p', `${mod.dataDir}/emotes/old`], { timeoutMs: 5000 })
      const r = await $.process.run(['mv', '--', look.file, to], { timeoutMs: 5000 })
      if (r.exitCode !== 0) return { text: `Clawd: ${look.name} could not be moved: ${oneLine(r.stderr, 200)}` }
      const tracked = look.file.startsWith(`${mod.emoteDir}/`) ? ' It shipped with the mod in emotes/: in a git checkout, commit the removal or git checkout it back.' : ''
      return { text: `Clawd: ${look.name} is deleted. Its file is now ${to}; move it back to undo.${tracked}` }
    }
    if (verb === 'change' && look) {
      // `/clawd emote change <emote> [image path] <what to change>`; a paid model run like create.
      const rest = order.rest.slice(1)
      const at = rest.findIndex(word => IMAGE.test(word))
      const image = at >= 0 ? await imagePath($, rest[at] ?? '') : ''
      if (at >= 0 && !image) return { text: `Clawd: ${rest[at]} is no image file.` }
      // One pair of quotes around the whole request is the user's, not part of it.
      const words = oneLine(rest.filter((_, i) => i !== at).join(' '), 120)
      const said = /^(["']).*\1$/.test(words) && words.length > 1 ? words.slice(1, -1).trim() : words
      const text = said || (image ? 'make it look like the new reference image' : '')
      if (!text) return { text: `Usage: /clawd emote change ${look.name} [image path] <what to change>, e.g. /clawd emote change ${look.name} make it blue` }
      if (brain.making) return { text: `Clawd: ${brain.making} is still being drawn; one at a time.` }
      startEmote($, look.name, look.title, look.why || 'asked for with /clawd emote change', image || look.image, 'clawd', { look, text })
      return {
        text: `Clawd: a model changes ${look.name}: "${text}", in up to ${EMOTE_ROUNDS} rounds of a minute or two; it plays when done. The old look goes to ${mod.dataDir}/emotes/old/.`,
      }
    }
    return { text: await clawdStatus($) }
  })

  // /clawd help uml in colour. The stored row keeps the plain text the model reads.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (mod.isOff || e.surface !== 'terminal' || e.props.command !== 'clawd' || !e.props.text.includes(UML_LEGEND)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {umlKinds(e.props.text.split('\n')).map((runs, i) => (
          <Box key={`uml-${i}`}>
            <Text>{runs.length ? runs.map(run => <Text {...UML_STYLE[run.kind]}>{run.text}</Text>) : ' '}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  // Above the prompt: whatever the engine draws there, then Clawd's runway,
  // then the /clawd menu while one is typed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (mod.isOff || e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const rows = Math.min(await read($, clawdRows), e.props.maxRows)
    const columns = Math.min(CLAWD_MAX_COLUMNS, e.props.bodyColumns)
    const isShown = (await read($, isClawdOn)) && rows >= CLAWD_MIN_ROWS && columns >= CLAWD_MIN_COLUMNS
    // With Clawd hidden the menu draws its own top edge.
    const room = e.props.maxRows - (isShown ? rows : 1) - 1
    const menu = columns >= CLAWD_MIN_COLUMNS && room >= 0 ? await read($, clawdMenu) : null
    if (!isShown) clawd.requestId = null
    if (!isShown && !menu) return next(e)
    const engine = await next(e)
    const { Box, Raster, Text } = $.ui.resolve(e)
    const out = [engine]
    if (isShown) {
      clawd.world ??= createWorld(columns, rows, mod.rand)
      clawd.world.base = mod.base
      clawd.world.antenna = mod.isRemote
      if (clawd.world.cols !== columns || clawd.world.rows !== rows) resize(clawd.world, columns, rows)
      setEdge(clawd.world, menu ? menu.title : null, menu?.note)
      clawd.requestId = e.requestId
      clawd.last = frameCells(clawd.world)
      out.push(<Raster key="clawd" columns={columns} rows={rows} cells={clawd.last} />)
    }
    if (menu) {
      const rule = (text: string) => <Text color={FLOOR_TEXT}>{text}</Text>
      if (!isShown) {
        const [head, tail] = edgeLine(menu.title, menu.note, columns)
        out.push(
          <Box key="menu-top" width={columns}>
            {rule('╭─ ')}
            <Text bold>{head}</Text>
            <Text dimColor>{tail}</Text>
            {rule(`${head ? ' ' : ''}${'─'.repeat(Math.max(0, columns - 5 - head.length - tail.length))}╮`)}
          </Box>,
        )
      }
      const { rows: shown, foot } = menuLayout(menu, Math.min(MENU_ROWS, room))
      const nameW = Math.min(Math.max(4, ...shown.map(r => r.name.length)), Math.floor((columns - 2) * 0.4))
      const whatW = Math.max(0, columns - 8 - nameW)
      shown.forEach((r, i) => {
        const name = cut(r.name, nameW)
        const [from, to] = [Math.min(r.from, name.length), Math.min(r.to, name.length)]
        const color = menu.isOne ? 'success' : undefined
        out.push(
          <Box key={`menu-${i}`} width={columns}>
            {rule('│')}
            <Text color="success">{menu.isOne ? ' ❯ ' : '   '}</Text>
            <Text bold color={color}>{name.slice(0, from)}</Text>
            <Text bold color="success" underline>{name.slice(from, to)}</Text>
            <Text bold color={color}>{name.slice(to).padEnd(nameW - to + 2)}</Text>
            <Text dimColor>{cut(clean(r.what), whatW).padEnd(whatW + 1)}</Text>
            {rule('│')}
          </Box>,
        )
      })
      const tail = cut(clean(foot), columns - 6)
      out.push(
        <Box key="menu-bottom" width={columns}>
          {rule(tail ? '╰─ ' : '╰─')}
          <Text dimColor>{tail}</Text>
          {rule(`${tail ? ' ' : ''}${'─'.repeat(Math.max(0, columns - (tail ? 5 + tail.length : 3)))}╯`)}
        </Box>,
      )
    }
    return <Box flexDirection="column">{out}</Box>
  })
}
