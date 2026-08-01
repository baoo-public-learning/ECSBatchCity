import { describe, expect, it } from 'vitest'
import { flowForPhase } from '../src/three/flows'

describe('phase flows', () => {
  it('maps provisioning and startup phases forward through the districts', () => {
    expect(flowForPhase('PROVISION_ENI')).toEqual({ from: 0, to: 1 })
    expect(flowForPhase('PULL_IMAGE')).toEqual({ from: 0, to: 1 })
    expect(flowForPhase('START_JVM')).toEqual({ from: 1, to: 2 })
    expect(flowForPhase('START_JOB')).toEqual({ from: 2, to: 3 })
  })

  it('sends SQL work toward Aurora and rollback backwards', () => {
    expect(flowForPhase('RUN_TASKLET', 'BATCH')).toEqual({ from: 2, to: 3 })
    expect(flowForPhase('FLUSH_BATCH')).toEqual({ from: 3, to: 5 })
    expect(flowForPhase('COMMIT')).toEqual({ from: 4, to: 5 })
    expect(flowForPhase('ROLLBACK')).toEqual({ from: 5, to: 4 })
  })

  it('runs SIMPLE statements all the way to Aurora during the tasklet', () => {
    expect(flowForPhase('RUN_TASKLET', 'SIMPLE')).toEqual({ from: 2, to: 5 })
  })

  it('reverses shutdown flows back toward ECS', () => {
    expect(flowForPhase('CLOSE_SPRING')).toEqual({ from: 2, to: 1 })
    expect(flowForPhase('STOP_CONTAINER')).toEqual({ from: 1, to: 0 })
    expect(flowForPhase('RELEASE_ENI')).toEqual({ from: 1, to: 0 })
  })

  it('keeps failover traffic between JDBC and Aurora', () => {
    expect(flowForPhase('FAILOVER_DETECT')).toEqual({ from: 5, to: 4 })
    expect(flowForPhase('TOPOLOGY_REFRESH')).toEqual({ from: 4, to: 4 })
    expect(flowForPhase('RECONNECT')).toEqual({ from: 4, to: 5 })
  })

  it('has no flow when idle or done', () => {
    expect(flowForPhase('IDLE')).toBeNull()
    expect(flowForPhase('DONE')).toBeNull()
  })
})
