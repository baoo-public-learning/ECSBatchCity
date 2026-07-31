import { describe, expect, it } from 'vitest'
import { runTask, runToCompletion, stopTask, tick } from '../src/sim/model'

describe('ECS stop metadata', () => {
  it('reports UserInitiated when the user stops a running task', () => {
    const done = runToCompletion(stopTask(tick(runTask(), 6)))
    expect(done.stopCode).toBe('UserInitiated')
    expect(done.stoppedReason).toBe('Task stopped by user')
    expect(done.containerExitCode).toBe(143)
  })

  it('keeps EssentialContainerExited for a normal completion', () => {
    const done = runToCompletion(runTask({ scenario: 'NORMAL' }))
    expect(done.stopCode).toBe('EssentialContainerExited')
    expect(done.stoppedReason).toBe('Essential container in task exited')
  })

  it('cancels provisioning without SIGTERM semantics before the container runs', () => {
    const state = tick(runTask({ hangOnSigterm: true }), 1)
    expect(state.ecsStatus).not.toBe('RUNNING')
    const done = runToCompletion(stopTask(state))
    expect(done.stopCode).toBe('UserInitiated')
    expect(done.containerExitCode).toBeNull()
    expect(done.applicationExitCode).toBeNull()
    expect(done.springStatus).toBe('NOT_STARTED')
    expect(done.events.some((entry) => entry.label.includes('SIGTERM'))).toBe(false)
  })

  it('reports a user cancellation, not TaskFailedToStart, when a LAUNCH_FAILURE run is stopped early', () => {
    const done = runToCompletion(stopTask(tick(runTask({ scenario: 'LAUNCH_FAILURE' }), 1)))
    expect(done.stopCode).toBe('UserInitiated')
    expect(done.stoppedReason).toBe('Task stopped by user')
  })

  it('still reports TaskFailedToStart when the pull actually failed before a late StopTask', () => {
    let state = runTask({ scenario: 'LAUNCH_FAILURE' })
    let guard = 0
    while (state.phase !== 'RELEASE_ENI' && guard++ < 200) state = tick(state, 0.25)
    const done = runToCompletion(stopTask(state))
    expect(done.stopCode).toBe('TaskFailedToStart')
  })

  it('cancels provisioning the same way without the hang flag', () => {
    const done = runToCompletion(stopTask(tick(runTask(), 1)))
    expect(done.stopCode).toBe('UserInitiated')
    expect(done.containerExitCode).toBeNull()
    expect(done.applicationResult).toBe('PLATFORM_FAILURE')
  })
})
