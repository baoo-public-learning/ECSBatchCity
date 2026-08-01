import { describe, expect, it } from 'vitest'
import { runTask, runToCompletion } from '../src/sim/model'

describe('reWriteBatchedInserts', () => {
  it('returns SUCCESS_NO_INFO counts when the rewritten group succeeds', () => {
    const done = runToCompletion(runTask({
      scenario: 'NORMAL',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      rewriteBatchedInserts: true,
    }))
    expect(done.batchResults.flatMap((result) => result.updateCounts).every((count) => count === -2)).toBe(true)
    expect(done.batchResults[0].successfulStatementCount).toBe(4)
    expect(done.batchResults[0].mappedStatementId).toContain('insert')
    expect(done.updateCount).toBeNull()
    expect(done.batchStatus).toBe('COMPLETED')
    expect(done.applicationExitCode).toBe(0)
  })

  it('still reports zero counts when the whole group updates nothing', () => {
    // グループ全体が0件のときpgjdbcは-2ではなく0を返すため、更新0件警告は検出できる。
    const done = runToCompletion(runTask({
      scenario: 'WARNING',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      rewriteBatchedInserts: true,
    }))
    expect(done.batchResults.flatMap((result) => result.updateCounts).every((count) => count === 0)).toBe(true)
    expect(done.updateCount).toBe(0)
    expect(done.applicationExitCode).toBe(1)
  })

  it('does not change the failure path', () => {
    const done = runToCompletion(runTask({
      scenario: 'FLUSH_FAILURE',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
      rewriteBatchedInserts: true,
    }))
    expect(done.batchResults[1].updateCounts).toEqual([-3, -3, -3, -3])
    expect(done.applicationExitCode).toBe(101)
  })

  it('keeps real per-statement counts when the rewrite is off', () => {
    const done = runToCompletion(runTask({
      scenario: 'NORMAL',
      executorType: 'BATCH',
      statementCount: 4,
      flushThreshold: 4,
      rewriteBatchedInserts: false,
    }))
    expect(done.batchResults[0].updateCounts).toEqual([1, 1, 1, 1])
    expect(done.updateCount).toBe(4)
  })
})
