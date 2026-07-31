import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSimulationStore } from '../src/stores/simulation'

describe('simulation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('advances a running simulation through reactive state', () => {
    const store = useSimulationStore()
    store.start({ scenario: 'NORMAL', executorType: 'BATCH' })
    store.advance(1)
    expect(store.snapshot.now).toBeGreaterThan(0)
    expect(store.snapshot.ecsStatus).not.toBe('IDLE')
  })

  it('runs to completion through repeated advance calls', () => {
    const store = useSimulationStore()
    store.start({ scenario: 'NORMAL', executorType: 'BATCH', statementCount: 10, flushThreshold: 4 })
    for (let i = 0; i < 500 && store.snapshot.phase !== 'DONE'; i++) store.advance(0.25)
    expect(store.snapshot.phase).toBe('DONE')
    expect(store.snapshot.applicationExitCode).toBe(0)
    expect(store.snapshot.batchResults).toHaveLength(3)
  })

  it('applies manual flush through the store action', () => {
    const store = useSimulationStore()
    store.start({ executorType: 'BATCH', autoFlush: false, statementCount: 10, flushThreshold: 10 })
    for (let i = 0; i < 100 && store.snapshot.phase !== 'FLUSH_BATCH'; i++) store.advance(0.25)
    expect(store.snapshot.phase).toBe('FLUSH_BATCH')
    store.flush()
    store.advance(1)
    expect(store.snapshot.flushedStatements).toBe(10)
  })

  it('stops a running task through the store action', () => {
    const store = useSimulationStore()
    store.start({ scenario: 'NORMAL' })
    store.advance(5)
    store.stop()
    for (let i = 0; i < 100 && store.snapshot.phase !== 'DONE'; i++) store.advance(0.25)
    expect(store.snapshot.containerExitCode).toBe(143)
  })
})
