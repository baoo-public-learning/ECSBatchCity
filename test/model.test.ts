import { describe, expect, it } from 'vitest'
import { createInitialState, flushStatements, runTask, runToCompletion, stopTask, tick } from '../src/sim/model'

describe('ECS batch lifecycle', () => {
  it('runs from RunTask to STOPPED with exit code 0', () => {
    const done = runToCompletion(runTask({ scenario: 'NORMAL', executorType: 'BATCH' }))
    expect(done.ecsStatus).toBe('STOPPED')
    expect(done.batchStatus).toBe('COMPLETED')
    expect(done.applicationExitCode).toBe(0)
    expect(done.containerExitCode).toBe(0)
    expect(done.stopCode).toBe('EssentialContainerExited')
  })

  it('does not start Spring when image launch fails', () => {
    const done = runToCompletion(runTask({ scenario: 'LAUNCH_FAILURE' }))
    expect(done.springStatus).toBe('NOT_STARTED')
    expect(done.applicationExitCode).toBeNull()
    expect(done.stopCode).toBe('TaskFailedToStart')
  })

  it('keeps ECS RUNNING distinct from batch success', () => {
    const running = tick(runTask(), 3)
    expect(running.ecsStatus).toBe('RUNNING')
    expect(running.batchStatus).not.toBe('COMPLETED')
  })

  it('maps warning and abnormal application results independently', () => {
    const warning = runToCompletion(runTask({ scenario: 'WARNING' }))
    const abnormal = runToCompletion(runTask({ scenario: 'ABNORMAL' }))
    expect([warning.batchStatus, warning.batchExitStatus, warning.applicationExitCode]).toEqual(['COMPLETED', 'WARNING', 1])
    expect([abnormal.batchStatus, abnormal.transaction, abnormal.applicationExitCode]).toEqual(['FAILED', 'ROLLED_BACK', 101])
  })

  it('handles StopTask as a platform initiated non-zero exit', () => {
    const stopped = runToCompletion(stopTask(tick(runTask(), 5)))
    expect(stopped.applicationResult).toBe('PLATFORM_FAILURE')
    expect(stopped.containerExitCode).toBe(143)
  })
})

describe('MyBatis executors', () => {
  it('executes each mapper call in SIMPLE mode', () => {
    const done = runToCompletion(runTask({ executorType: 'SIMPLE', statementCount: 8 }))
    expect(done.mapperCalls).toBe(8)
    expect(done.sqlExecutions).toBe(8)
    expect(done.flushedStatements).toBe(0)
  })

  it('keeps BATCH statements pending until flush', () => {
    let state = runTask({ executorType: 'BATCH', statementCount: 8 })
    while (state.phase !== 'FLUSH_BATCH') state = tick(state, 0.25)
    expect(state.pendingStatements).toBe(8)
    expect(state.sqlExecutions).toBe(0)
    const flushed = tick(state, 1)
    expect(flushed.pendingStatements).toBe(0)
    expect(flushed.flushedStatements).toBe(8)
    expect(flushed.sqlExecutions).toBe(1)
    expect(flushed.transaction).toBe('ACTIVE')
  })

  it('rolls flushed work back on abnormal completion', () => {
    const done = runToCompletion(runTask({ executorType: 'BATCH', scenario: 'ABNORMAL' }))
    expect(done.flushedStatements).toBe(10)
    expect(done.transaction).toBe('ROLLED_BACK')
    expect(done.applicationExitCode).toBe(101)
  })

  it('waits for an explicit flush when auto flush is disabled', () => {
    let state = runTask({ executorType: 'BATCH', autoFlush: false })
    while (state.phase !== 'FLUSH_BATCH') state = tick(state, 0.25)
    const waiting = tick(state, 5)
    expect(waiting.phase).toBe('FLUSH_BATCH')
    expect(waiting.pendingStatements).toBe(10)
    const requested = flushStatements(waiting)
    expect(requested.flushRequested).toBe(true)
    const flushed = tick(requested, 1)
    expect(flushed.flushedStatements).toBe(10)
    expect(flushed.transaction).toBe('ACTIVE')
  })

  it('creates an idle deterministic initial state', () => {
    expect(createInitialState()).toMatchObject({ phase: 'IDLE', ecsStatus: 'IDLE', now: 0 })
  })
})
