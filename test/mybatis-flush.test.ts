import { describe, expect, it } from 'vitest'
import { createInitialState, flushStatements, runTask, runToCompletion, tick } from '../src/sim/model'

describe('flush threshold', () => {
  it('flushes in threshold-sized chunks and accumulates BatchResults', () => {
    const done = runToCompletion(runTask({ executorType: 'BATCH', statementCount: 10, flushThreshold: 4 }))
    expect(done.flushedStatements).toBe(10)
    expect(done.pendingStatements).toBe(0)
    expect(done.sqlExecutions).toBe(3)
    expect(done.batchResults.map((result) => result.updateCounts.length)).toEqual([4, 4, 2])
    expect(done.batchResults.map((result) => result.flushIndex)).toEqual([1, 2, 3])
    expect(done.updateCount).toBe(10)
    expect(done.applicationExitCode).toBe(0)
  })

  it('records mapped statement metadata on each BatchResult', () => {
    const done = runToCompletion(runTask({ executorType: 'BATCH', statementCount: 5, flushThreshold: 5 }))
    expect(done.batchResults).toHaveLength(1)
    const result = done.batchResults[0]
    expect(result.mappedStatementId).toContain('Mapper')
    expect(result.parameterCount).toBe(5)
    expect(result.successfulStatementCount).toBe(5)
    expect(result.failedStatementIndex).toBeNull()
  })

  it('keeps BATCH update counts unresolved until flush results arrive', () => {
    let state = runTask({ executorType: 'BATCH', statementCount: 6, flushThreshold: 3 })
    while (state.phase !== 'FLUSH_BATCH') state = tick(state, 0.25)
    expect(state.updateCount).toBeNull()
    const done = runToCompletion(state)
    expect(done.updateCount).toBe(6)
  })

  it('sums zero update counts from flush results into a WARNING exit', () => {
    const done = runToCompletion(runTask({ executorType: 'BATCH', scenario: 'WARNING', statementCount: 6, flushThreshold: 3 }))
    expect(done.batchResults.flatMap((result) => result.updateCounts).every((count) => count === 0)).toBe(true)
    expect(done.updateCount).toBe(0)
    expect([done.batchStatus, done.batchExitStatus, done.applicationExitCode]).toEqual(['COMPLETED', 'WARNING', 1])
  })

  it('waits for a manual flush at every threshold when auto flush is off', () => {
    let state = runTask({ executorType: 'BATCH', statementCount: 10, flushThreshold: 4, autoFlush: false })
    let manualFlushes = 0
    let guard = 0
    while (state.phase !== 'DONE' && guard++ < 500) {
      if (state.phase === 'FLUSH_BATCH' && !state.flushRequested) {
        state = flushStatements(state)
        manualFlushes += 1
      }
      state = tick(state, 0.25)
    }
    expect(manualFlushes).toBe(3)
    expect(state.flushedStatements).toBe(10)
    expect(state.applicationExitCode).toBe(0)
  })

  it('does not cross an unrequested flush gate inside a single large tick', () => {
    const state = runTask({ executorType: 'BATCH', statementCount: 10, flushThreshold: 4, autoFlush: false })
    const blocked = tick(state, 100)
    expect(blocked.phase).toBe('FLUSH_BATCH')
    expect(blocked.pendingStatements).toBe(4)
    expect(blocked.flushedStatements).toBe(0)
  })

  it('keeps BatchResults as diagnostics after rollback without confirming updates', () => {
    const done = runToCompletion(runTask({ executorType: 'BATCH', scenario: 'ABNORMAL', statementCount: 10, flushThreshold: 4 }))
    expect(done.batchResults).toHaveLength(3)
    expect(done.transaction).toBe('ROLLED_BACK')
    expect(done.updateCount).toBeNull()
    expect(done.applicationExitCode).toBe(101)
  })

  it('produces no BatchResults in SIMPLE mode', () => {
    const done = runToCompletion(runTask({ executorType: 'SIMPLE', statementCount: 6 }))
    expect(done.batchResults).toEqual([])
  })

  it('normalizes invalid flush thresholds deterministically', () => {
    expect(createInitialState({ flushThreshold: 0 }).config.flushThreshold).toBe(1)
    expect(createInitialState({ flushThreshold: 2.7 }).config.flushThreshold).toBe(2)
    expect(createInitialState({ flushThreshold: -3 }).config.flushThreshold).toBe(1)
  })
})
