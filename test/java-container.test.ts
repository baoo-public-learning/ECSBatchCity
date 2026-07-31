import { describe, expect, it } from 'vitest'
import { createInitialState, runTask, runToCompletion } from '../src/sim/model'

describe('Java 21 container settings', () => {
  it('derives heap, cpu, and gc from the task size', () => {
    const state = createInitialState({ taskCpu: 2048, taskMemoryMiB: 4096, maxRamPercentage: 50, initialRamPercentage: 20 })
    expect(state.java.maxHeapMiB).toBe(2048)
    expect(state.java.initialHeapMiB).toBe(819)
    expect(state.java.assignedVcpus).toBe(2)
    expect(state.java.activeProcessorCount).toBe(2)
    expect(state.java.gcName).toBe('G1')
  })

  it('falls back to SerialGC on a single-cpu or small-memory task', () => {
    expect(createInitialState({ taskCpu: 1024, taskMemoryMiB: 4096 }).java.gcName).toBe('Serial')
    expect(createInitialState({ taskCpu: 2048, taskMemoryMiB: 1024 }).java.gcName).toBe('Serial')
  })

  it('counts fractional vCPUs as one active processor', () => {
    const state = createInitialState({ taskCpu: 256 })
    expect(state.java.assignedVcpus).toBe(0.25)
    expect(state.java.activeProcessorCount).toBe(1)
  })

  it('renders JAVA_TOOL_OPTIONS from the settings', () => {
    const state = createInitialState({ taskCpu: 2048, initialRamPercentage: 20, maxRamPercentage: 70 })
    expect(state.java.javaToolOptions).toContain('-XX:InitialRAMPercentage=20')
    expect(state.java.javaToolOptions).toContain('-XX:MaxRAMPercentage=70')
    expect(state.java.javaToolOptions).toContain('-XX:+ExitOnOutOfMemoryError')
    expect(state.java.javaToolOptions).toContain('-XX:ActiveProcessorCount=2')
  })

  it('splits non-heap memory into a labeled native budget', () => {
    const state = createInitialState({ taskMemoryMiB: 2048, maxRamPercentage: 70 })
    const budget = state.java.nativeBudget
    const total = budget.metaspaceMiB + budget.threadStacksMiB + budget.codeCacheMiB + budget.directBuffersMiB + budget.otherMiB
    expect(total).toBe(2048 - state.java.maxHeapMiB)
    expect(budget.metaspaceMiB).toBeGreaterThan(0)
  })

  it('normalizes initial percentage to stay at or below max', () => {
    const state = createInitialState({ initialRamPercentage: 90, maxRamPercentage: 50 })
    expect(state.config.initialRamPercentage).toBeLessThanOrEqual(state.config.maxRamPercentage)
  })

  it('OOMs when the batch heap demand exceeds the max heap', () => {
    const done = runToCompletion(runTask({
      scenario: 'NORMAL',
      executorType: 'BATCH',
      taskMemoryMiB: 512,
      maxRamPercentage: 25,
      statementCount: 10,
      flushThreshold: 10,
    }))
    expect(done.containerExitCode).toBe(3)
    expect(done.applicationExitCode).toBeNull()
    expect(done.batchStatus).toBe('STARTED')
    expect(done.applicationResult).toBe('PLATFORM_FAILURE')
  })

  it('avoids the same OOM with a smaller flush threshold', () => {
    const done = runToCompletion(runTask({
      scenario: 'NORMAL',
      executorType: 'BATCH',
      taskMemoryMiB: 512,
      maxRamPercentage: 25,
      statementCount: 10,
      flushThreshold: 4,
    }))
    expect(done.applicationExitCode).toBe(0)
    expect(done.batchStatus).toBe('COMPLETED')
  })
})
