import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      try { return nextResolve(specifier.replace(/\.js$/, '.ts'), context) } catch {}
    }
    return nextResolve(specifier, context)
  },
})
const { renderPrompt } = await import(new URL('../src/services/promptVariables.ts', import.meta.url).href)
const now = new Date(2026, 10, 18, 9, 5)
const out = renderPrompt('{{user}}/{{char}}/{{date}}/{{time}}/{{original}} {{unknown}}', { user: '旅行者', char: '小鱼', original: 'ORIGINAL', now })
assert.equal(out, '旅行者/小鱼/2026-11-18/09:05/ORIGINAL {{unknown}}')
assert.equal(renderPrompt('{{char}}', { char: '' }), 'Assistant')
assert.equal(renderPrompt('plain'), 'plain')
console.log('prompt variables test passed')
