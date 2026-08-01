import { describe, expect, it } from 'vitest'
import { createInitialState, runTask, runToCompletion } from '../src/sim/model'

describe('GC activity', () => {
  it('starts with no GC events', () => {
    const state = createInitialState()
    expect(state.gc).toEqual({ youngCount: 0, pauseMs: 0 })
  })

  it('accumulates young GCs on context start, flushes, and commit', () => {
    const done = runToCompletion(runTask({
      scenario: 'NORMAL',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
    }))
    // Spring起動1回 + flush3回 + commit1回
    expect(done.gc.youngCount).toBe(5)
  })

  it('charges longer pauses under SerialGC than G1', () => {
    const serial = runToCompletion(runTask({
      scenario: 'NORMAL', executorType: 'BATCH', statementCount: 10, flushThreshold: 4,
      taskCpu: 1024, taskMemoryMiB: 2048,
    }))
    const g1 = runToCompletion(runTask({
      scenario: 'NORMAL', executorType: 'BATCH', statementCount: 10, flushThreshold: 4,
      taskCpu: 2048, taskMemoryMiB: 4096,
    }))
    expect(serial.gc.youngCount).toBe(g1.gc.youngCount)
    expect(serial.gc.pauseMs).toBeGreaterThan(g1.gc.pauseMs)
  })

  it('does not run GC after the JVM dies', () => {
    const done = runToCompletion(runTask({ scenario: 'JVM_OOM', executorType: 'BATCH' }))
    // Spring起動分の1回だけ(OOMで即死し、flush/commitに到達しない)
    expect(done.gc.youngCount).toBe(1)
  })
})
