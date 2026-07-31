import { describe, expect, it } from 'vitest'
import { runTask, runToCompletion, stopTask, tick } from '../src/sim/model'

describe('JVM OOM with ExitOnOutOfMemoryError', () => {
  it('kills the JVM without a Spring exit code', () => {
    const done = runToCompletion(runTask({
      scenario: 'JVM_OOM',
      executorType: 'BATCH',
      statementCount: 10,
      failAtStatement: 6,
    }))
    expect(done.applicationResult).toBe('PLATFORM_FAILURE')
    expect(done.applicationExitCode).toBeNull()
    expect(done.containerExitCode).toBe(3)
    expect(done.ecsStatus).toBe('STOPPED')
  })

  it('leaves the job repository status STARTED, not FAILED', () => {
    const done = runToCompletion(runTask({
      scenario: 'JVM_OOM',
      executorType: 'BATCH',
      statementCount: 10,
      failAtStatement: 6,
    }))
    expect(done.batchStatus).toBe('STARTED')
    expect(done.batchExitStatus).toBe('UNKNOWN')
    expect(done.transaction).toBe('ROLLED_BACK')
    expect(done.applicationExitCode).not.toBe(101)
  })
})

describe('ECS memory limit kill', () => {
  it('reports SIGKILL 137 with an OutOfMemory stopped reason', () => {
    const done = runToCompletion(runTask({
      scenario: 'ECS_OOM_KILL',
      executorType: 'BATCH',
      statementCount: 10,
      failAtStatement: 6,
    }))
    expect(done.containerExitCode).toBe(137)
    expect(done.applicationExitCode).toBeNull()
    expect(done.applicationResult).toBe('PLATFORM_FAILURE')
    expect(done.stoppedReason).toBe('Essential container in task exited')
    expect(done.containerReason).toContain('OutOfMemoryError')
    expect(done.batchStatus).toBe('STARTED')
  })

  it('keeps the container-level reason separate from the task stop metadata', () => {
    const done = runToCompletion(runTask({ scenario: 'ECS_OOM_KILL' }))
    expect(done.stopCode).toBe('EssentialContainerExited')
    expect(done.containerReason).not.toBe(done.stoppedReason)
  })
})

describe('stop timeout SIGKILL', () => {
  it('escalates to SIGKILL when graceful shutdown hangs', () => {
    let state = runTask({ scenario: 'NORMAL', executorType: 'BATCH', hangOnSigterm: true })
    state = tick(state, 6)
    expect(state.ecsStatus).toBe('RUNNING')
    const done = runToCompletion(stopTask(state))
    expect(done.containerExitCode).toBe(137)
    expect(done.applicationExitCode).toBeNull()
    expect(done.applicationResult).toBe('PLATFORM_FAILURE')
    expect(done.batchStatus).toBe('STARTED')
  })

  it('ignores a second StopTask while waiting out the stop timeout', () => {
    let state = tick(runTask({ scenario: 'NORMAL', executorType: 'BATCH', hangOnSigterm: true }), 6)
    state = stopTask(state)
    expect(state.phase).toBe('FORCE_KILL')
    const again = stopTask(tick(state, 0.5))
    expect(again.phase).toBe('FORCE_KILL')
    expect(again.events.filter((entry) => entry.label.includes('SIGTERMを送信'))).toHaveLength(1)
    const done = runToCompletion(again)
    expect(done.containerExitCode).toBe(137)
  })

  it('ignores StopTask once the container is already stopping', () => {
    let state = runTask({ scenario: 'NORMAL', executorType: 'BATCH', hangOnSigterm: true })
    let guard = 0
    while (state.phase !== 'STOP_CONTAINER' && guard++ < 500) state = tick(state, 0.25)
    expect(state.phase).toBe('STOP_CONTAINER')
    const done = runToCompletion(stopTask(state))
    expect(done.containerExitCode).toBe(0)
    expect(done.applicationExitCode).toBe(0)
    expect(done.applicationResult).toBe('NORMAL')
  })

  it('still shuts down gracefully with 143 when the app cooperates', () => {
    const done = runToCompletion(stopTask(tick(runTask({ hangOnSigterm: false }), 5)))
    expect(done.containerExitCode).toBe(143)
    expect(done.applicationExitCode).toBe(143)
  })
})
