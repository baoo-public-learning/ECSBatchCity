import { describe, expect, it } from 'vitest'
import { narrationFor } from '../src/narration'
import { createInitialState, runTask, runToCompletion, tick } from '../src/sim/model'

describe('narration', () => {
  it('is silent while idle and narrates every running phase', () => {
    expect(narrationFor(createInitialState())).toBeNull()
    let state = runTask({ scenario: 'NORMAL', executorType: 'BATCH' })
    let guard = 0
    while (state.phase !== 'DONE' && guard++ < 500) {
      expect(narrationFor(state), `phase ${state.phase} should narrate`).not.toBeNull()
      state = tick(state, 0.25)
    }
  })

  it('mentions the pending count while batching', () => {
    let state = runTask({ executorType: 'BATCH', statementCount: 10, flushThreshold: 10, autoFlush: false })
    let guard = 0
    while (state.phase !== 'FLUSH_BATCH' && guard++ < 200) state = tick(state, 0.25)
    const card = narrationFor(state)
    expect(card?.body).toContain('10件')
    expect(card?.title).toContain('flush待機')
  })

  it('summarizes the result when done', () => {
    const done = runToCompletion(runTask({ scenario: 'NORMAL', executorType: 'BATCH' }))
    const card = narrationFor(done)
    expect(card?.tone).toBe('success')
    expect(card?.title).toContain('NORMAL')
    expect(card?.body).toContain('EssentialContainerExited')
  })

  it('distinguishes SIMPLE and BATCH tasklet narration', () => {
    let simple = runTask({ executorType: 'SIMPLE' })
    let guard = 0
    while (simple.phase !== 'RUN_TASKLET' && guard++ < 200) simple = tick(simple, 0.25)
    expect(narrationFor(simple)?.body).toContain('SIMPLE')
  })
})
