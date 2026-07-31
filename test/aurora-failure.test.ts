import { describe, expect, it } from 'vitest'
import { createInitialState, runTask, runToCompletion, tick } from '../src/sim/model'

describe('DB connect failure', () => {
  it('fails the job when the step transaction cannot acquire a connection', () => {
    const done = runToCompletion(runTask({ scenario: 'DB_CONNECT_FAILURE', executorType: 'BATCH' }))
    expect(done.batchStatus).toBe('FAILED')
    expect(done.batchExitStatus).toBe('FAILED')
    expect(done.applicationResult).toBe('ABNORMAL')
    expect(done.applicationExitCode).toBe(101)
    expect(done.containerExitCode).toBe(101)
    expect(done.ecsStatus).toBe('STOPPED')
    expect(done.stopCode).toBe('EssentialContainerExited')
  })

  it('never begins a transaction or executes SQL', () => {
    const done = runToCompletion(runTask({ scenario: 'DB_CONNECT_FAILURE', executorType: 'BATCH' }))
    expect(done.transaction).toBe('NONE')
    expect(done.taskletRepeatStatus).toBe('NONE')
    expect(done.mapperCalls).toBe(0)
    expect(done.sqlExecutions).toBe(0)
    expect(done.batchResults).toEqual([])
    expect(done.updateCount).toBeNull()
  })
})

describe('writer failover', () => {
  it('starts on writer-1 with no failover in progress', () => {
    const state = createInitialState()
    expect(state.writerHost).toBe('aurora-writer-1')
    expect(state.failoverState).toBe('NONE')
  })

  it('reconnects to the new writer but still fails the job', () => {
    const done = runToCompletion(runTask({
      scenario: 'WRITER_FAILOVER',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    }))
    expect(done.writerHost).toBe('aurora-writer-2')
    expect(done.failoverState).toBe('RECONNECTED')
    expect(done.batchStatus).toBe('FAILED')
    expect(done.applicationExitCode).toBe(101)
    expect(done.containerExitCode).toBe(101)
    expect(done.updateCount).toBeNull()
  })

  it('leaves the interrupted transaction LOST, not cleanly rolled back', () => {
    const done = runToCompletion(runTask({
      scenario: 'WRITER_FAILOVER',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    }))
    expect(done.transaction).toBe('LOST')
    expect(done.transaction).not.toBe('COMMITTED')
  })

  it('produces no BatchResult for the interrupted flush and does not retry', () => {
    const done = runToCompletion(runTask({
      scenario: 'WRITER_FAILOVER',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    }))
    expect(done.batchResults).toHaveLength(1)
    expect(done.batchResults[0].updateCounts).toEqual([1, 1, 1, 1])
    expect(done.flushedStatements).toBe(4)
    expect(done.mapperCalls).toBe(8)
  })

  it('loses the connection mid-statement in SIMPLE mode too', () => {
    const done = runToCompletion(runTask({
      scenario: 'WRITER_FAILOVER',
      executorType: 'SIMPLE',
      statementCount: 10,
      failAtStatement: 4,
    }))
    expect(done.sqlExecutions).toBe(4)
    expect(done.mapperCalls).toBe(4)
    expect(done.transaction).toBe('LOST')
    expect(done.writerHost).toBe('aurora-writer-2')
    expect(done.failoverState).toBe('RECONNECTED')
    expect(done.applicationExitCode).toBe(101)
    expect(done.batchResults).toEqual([])
  })

  it('passes through detect, topology refresh, and reconnect phases', () => {
    let state = runTask({
      scenario: 'WRITER_FAILOVER',
      executorType: 'BATCH',
      statementCount: 10,
      flushThreshold: 4,
      failAtStatement: 6,
    })
    const phases = new Set<string>()
    let guard = 0
    while (state.phase !== 'DONE' && guard++ < 500) {
      state = tick(state, 0.25)
      phases.add(state.phase)
    }
    expect(phases.has('FAILOVER_DETECT')).toBe(true)
    expect(phases.has('TOPOLOGY_REFRESH')).toBe(true)
    expect(phases.has('RECONNECT')).toBe(true)
  })
})
