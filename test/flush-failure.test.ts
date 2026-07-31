import { describe, expect, it } from 'vitest'
import { createInitialState, runTask, runToCompletion } from '../src/sim/model'

describe('flush failure (BatchUpdateException)', () => {
  it('fails the flush containing the configured statement and rolls back with 101', () => {
    const done = runToCompletion(runTask({
      executorType: 'BATCH',
      scenario: 'FLUSH_FAILURE',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    }))
    expect(done.batchResults).toHaveLength(2)
    expect(done.transaction).toBe('ROLLED_BACK')
    expect(done.batchStatus).toBe('FAILED')
    expect(done.batchExitStatus).toBe('FAILED')
    expect(done.applicationResult).toBe('ABNORMAL')
    expect(done.applicationExitCode).toBe(101)
    expect(done.containerExitCode).toBe(101)
    expect(done.updateCount).toBeNull()
  })

  it('returns a full-length EXECUTE_FAILED array like pgjdbc in a managed transaction', () => {
    const done = runToCompletion(runTask({
      executorType: 'BATCH',
      scenario: 'FLUSH_FAILURE',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    }))
    const failed = done.batchResults[1]
    expect(failed.updateCounts).toEqual([-3, -3, -3, -3])
    expect(failed.parameterCount).toBe(4)
    expect(failed.successfulStatementCount).toBe(0)
    expect(failed.failedStatementIndex).toBe(2)
  })

  it('keeps earlier successful flushes as diagnostics without counting them as committed', () => {
    const done = runToCompletion(runTask({
      executorType: 'BATCH',
      scenario: 'FLUSH_FAILURE',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    }))
    const first = done.batchResults[0]
    expect(first.updateCounts).toEqual([1, 1, 1, 1])
    expect(first.failedStatementIndex).toBeNull()
    expect(done.flushedStatements).toBe(4)
    expect(done.transaction).toBe('ROLLED_BACK')
  })

  it('does not run further tasklet chunks after the failing flush', () => {
    const done = runToCompletion(runTask({
      executorType: 'BATCH',
      scenario: 'FLUSH_FAILURE',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 2,
    }))
    expect(done.batchResults).toHaveLength(1)
    expect(done.batchResults[0].failedStatementIndex).toBe(2)
    expect(done.mapperCalls).toBe(4)
    expect(done.applicationExitCode).toBe(101)
  })

  it('treats FLUSH_FAILURE in SIMPLE mode as a statement failure at the configured position', () => {
    const done = runToCompletion(runTask({
      executorType: 'SIMPLE',
      scenario: 'FLUSH_FAILURE',
      statementCount: 10,
      failAtStatement: 4,
    }))
    expect(done.batchResults).toEqual([])
    expect(done.mapperCalls).toBe(4)
    expect(done.sqlExecutions).toBe(4)
    expect(done.transaction).toBe('ROLLED_BACK')
    expect(done.applicationExitCode).toBe(101)
  })

  it('normalizes failAtStatement into the statement range', () => {
    expect(createInitialState({ statementCount: 5, failAtStatement: 99 }).config.failAtStatement).toBe(5)
    expect(createInitialState({ statementCount: 5, failAtStatement: 0 }).config.failAtStatement).toBe(1)
    expect(createInitialState({ statementCount: 5, failAtStatement: 2.9 }).config.failAtStatement).toBe(2)
  })
})
