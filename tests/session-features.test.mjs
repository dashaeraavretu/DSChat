#!/usr/bin/env node
/**
 * Session feature static checks (zero dependencies, no build required).
 *
 * The store/db modules depend on IndexedDB, React and bundler-only assets, so
 * this test reads the TypeScript sources and asserts the invariants that make
 * temporary sessions and pinned sessions correct:
 * - ephemeral sessions never reach IndexedDB and are filtered from reads/search;
 * - pinned state is kept in both the session and its summary, including when the
 *   session detail is not loaded yet;
 * - ephemeral sessions are never evicted from the in-memory detail cache;
 * - pinned sessions are grouped first and excluded from time groups.
 *
 * Run with: node tests/session-features.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const source = (relativePath) => ({
  path: relativePath,
  text: read(relativePath),
})

const assertContains = ({ path: file, text }, pattern, message) => {
  assert.match(text, pattern, `${file}: ${message}`)
}

const db = source('src/services/chat/db.ts')
const store = source('src/services/chat/store.ts')
const types = source('src/services/chat/types.ts')
const groups = source('src/services/chat/sessionGroups.ts')
const sider = source('src/components/sider/Sider.tsx')
const item = source('src/components/sider/SessionItem.tsx')
const itemCss = source('src/components/sider/SessionItem.module.css')

// --- IndexedDB: ephemeral sessions are memory-only -------------------------

assertContains(
  db,
  /const storedSummary = \(session: Session\): StoredSessionSummary => \(\{\s*\.\.\.toSessionSummary\(session\)/,
  'summary must be built through toSessionSummary so pinned/ephemeral are preserved'
)

assertContains(
  db,
  /if \(session\.ephemeral\) \{\s*return\s*\}/,
  'saveSession must refuse to persist an ephemeral session'
)

assertContains(
  db,
  /stored\.filter\(\(summary\) => !summary\.ephemeral\)\.map\(toSessionSummary\)/,
  'loadSessionSummaries must not return persisted ephemeral summaries'
)

assertContains(
  db,
  /getAll\('sessions'\)[\s\S]{0,80}!session\.ephemeral/,
  'loadAllSessions must exclude ephemeral sessions so search cannot see them'
)

assertContains(
  db,
  /if \(session && !session\.ephemeral\)/,
  'renameSession must not write an ephemeral session back'
)

assertContains(
  db,
  /export const setSessionPinned = async \(id: string, pinned: boolean\)/,
  'db must expose setSessionPinned for sessions whose detail is not loaded'
)

assertContains(
  db,
  /await sessions\.put\(session\)\s*await tx\.objectStore\('sessionSummaries'\)\.put\(storedSummary\(session\)\)/,
  'setSessionPinned must write the full session and its summary atomically'
)

// --- Store: metadata comparisons and persistence --------------------------

assertContains(
  store,
  /Boolean\(a\.pinned\) === Boolean\(b\.pinned\)/,
  'sameSummary must compare pinned'
)

assertContains(
  store,
  /Boolean\(a\.ephemeral\) === Boolean\(b\.ephemeral\)/,
  'sameSummary must compare ephemeral'
)

assertContains(
  store,
  /if \(session\?\.ephemeral\) \{\s*return\s*\}/,
  'persist must skip ephemeral sessions'
)

assertContains(
  store,
  /!state\.sessionCache\[id\]\?\.ephemeral/,
  'trimSessionCache must keep ephemeral sessions (they cannot be reloaded)'
)

assertContains(
  store,
  /Number\(b\.pinned === true\) - Number\(a\.pinned === true\)/,
  'sortSessions must place pinned sessions first'
)

assertContains(
  store,
  /const summary = get\(\)\.sessions\.find\(\(item\) => item\.id === sessionId\)/,
  'toggleSessionPin must handle summaries without loaded detail'
)

assertContains(
  store,
  /db\.setSessionPinned\(sessionId, pinned\)/,
  'toggleSessionPin must persist pin state for unloaded ordinary sessions'
)

assertContains(
  store,
  /if \(!summary\.ephemeral\) \{\s*void db\.setSessionPinned/,
  'toggleSessionPin must not write ephemeral pin state to IndexedDB'
)

assertContains(
  store,
  /if \(ephemeral\) \{[\s\S]{0,120}void db\.deleteSession\(id\)\.catch/,
  'removing an ephemeral session must not block on its missing IndexedDB record'
)

assertContains(
  store,
  /sessions: sortSessions\(summaries\)[\s\S]{0,400}ephemeralNewChat: false/,
  'replaceHistory (import/clear history) must discard the ephemeral-new-chat intent'
)

const ephemeralResets = store.text.match(/ephemeralNewChat: false/g) ?? []
assert.ok(
  ephemeralResets.length >= 2,
  'selectSession/newChat and replaceHistory must reset the ephemeral-new-chat intent'
)

// --- Session creation binds the default preset snapshot --------------------

assertContains(
  store,
  /const preset = getDefaultPreset\(\)/,
  'new sessions must read the default preset'
)

assertContains(
  store,
  /\.\.\.\(preset \? \{ preset: snapshotPreset\(preset\) \} : \{\}\)/,
  'new sessions must store a preset snapshot instead of a live reference'
)

// --- Summary serialization keeps the new metadata -------------------------

assertContains(
  types,
  /\.\.\.\(session\.pinned \? \{ pinned: true \} : \{\}\)/,
  'toSessionSummary must keep pinned'
)

assertContains(
  types,
  /\.\.\.\(session\.ephemeral \? \{ ephemeral: true \} : \{\}\)/,
  'toSessionSummary must keep ephemeral'
)

// --- Sider grouping and menu ----------------------------------------------

assertContains(
  groups,
  /const pinned = sessions\.filter\(\(session\) => session\.pinned\)/,
  'groupSessions must collect pinned sessions into their own group'
)

assertContains(
  groups,
  /if \(session\.pinned\) \{\s*continue\s*\}/,
  'groupSessions must not repeat pinned sessions in date groups'
)

assertContains(
  sider,
  /newChat\(true\)/,
  'Sider must expose a temporary-chat entry point'
)

assertContains(
  item,
  /toggleSessionPin\(session\.id\)/,
  'SessionItem menu must toggle pinning'
)

assertContains(itemCss, /\.pin\s*\{/, 'SessionItem styles must define the pin icon')
assertContains(itemCss, /\.badge\s*\{/, 'SessionItem styles must define the temporary badge')

// --- i18n keys used by the sider -----------------------------------------

for (const locale of ['zh', 'en']) {
  const text = read(`src/i18n/${locale}.ts`)
  for (const key of [
    'ephemeralChat',
    'ephemeralBadge',
    'pinnedSessions',
    'pinnedSession',
    'pinSession',
    'unpinSession',
    'newChatMenu',
  ]) {
    assert.match(text, new RegExp(`\\b${key}:`), `src/i18n/${locale}.ts: missing ${key}`)
  }
}

// eslint-disable-next-line no-console
console.log('session feature static checks passed')
