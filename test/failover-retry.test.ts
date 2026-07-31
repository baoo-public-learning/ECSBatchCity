import { describe, expect, it } from 'vitest'
import { runTask, runToCompletion } from '../src/sim/model'

describe('failover retry policy', () => {
  const retryConfig = {
    scenario: 'WRITER_FAILOVER' as const,
    executorType: 'BATCH' as const,
    statementCount: 10,
    flushThreshold: 4,
    failAtStatement: 6,
    failoverPolicy: 'RETRY_TASKLET' as const,
  }

  it('retries the tasklet on a new transaction after reconnecting', () => {
    const done = runToCompletion(runTask(retryConfig))
    expect(done.writerHost).toBe('aurora-writer-2')
    expect(done.failoverState).toBe('RECONNECTED')
    expect(done.attempt).toBe(2)
    expect(done.transaction).toBe('COMMITTED')
    expect(done.batchStatus).toBe('COMPLETED')
    expect(done.applicationExitCode).toBe(0)
    expect(done.containerExitCode).toBe(0)
  })

  it('counts updates only from the retry attempt, not the lost one', () => {
    const done = runToCompletion(runTask(retryConfig))
    expect(done.updateCount).toBe(10)
    const attempts = done.batchResults.map((result) => result.attempt)
    expect(attempts).toEqual([1, 2, 2, 2])
    expect(done.batchResults.filter((result) => result.attempt === 2).flatMap((result) => result.updateCounts)).toHaveLength(10)
  })

  it('keeps the lost attempt results as diagnostics', () => {
    const done = runToCompletion(runTask(retryConfig))
    const lost = done.batchResults.filter((result) => result.attempt === 1)
    expect(lost).toHaveLength(1)
    expect(lost[0].updateCounts).toEqual([1, 1, 1, 1])
  })

  it('does not fail over twice in a retried run', () => {
    const done = runToCompletion(runTask(retryConfig))
    expect(done.batchStatus).toBe('COMPLETED')
    expect(done.applicationResult).toBe('NORMAL')
  })

  it('accumulates SIMPLE sql executions across the lost and retried attempts', () => {
    const done = runToCompletion(runTask({
      scenario: 'WRITER_FAILOVER',
      executorType: 'SIMPLE',
      statementCount: 10,
      failAtStatement: 4,
      failoverPolicy: 'RETRY_TASKLET',
    }))
    expect(done.sqlExecutions).toBe(14)
    expect(done.mapperCalls).toBe(10)
    expect(done.applicationExitCode).toBe(0)
  })

  it('defaults to failing the job when no policy is chosen', () => {
    const done = runToCompletion(runTask({
      scenario: 'WRITER_FAILOVER',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    }))
    expect(done.applicationExitCode).toBe(101)
    expect(done.attempt).toBe(1)
  })
})
