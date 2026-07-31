import type { Phase, Scenario, SimulationConfig, SimulationState, TimelineEvent } from './types'

const DEFAULT_CONFIG: SimulationConfig = {
  executorType: 'BATCH',
  scenario: 'NORMAL',
  statementCount: 10,
  flushThreshold: 10,
  autoFlush: true,
  taskCpu: 1024,
  taskMemoryMiB: 2048,
  maxRamPercentage: 70,
}

const PHASE_DURATION: Record<Phase, number> = {
  IDLE: Number.POSITIVE_INFINITY,
  PROVISION_ENI: 0.9,
  WAIT_CAPACITY: 0.7,
  PULL_IMAGE: 1.2,
  START_JVM: 0.8,
  START_SPRING: 1.1,
  START_JOB: 0.55,
  RUN_TASKLET: 1.8,
  FLUSH_BATCH: 0.9,
  COMMIT: 0.65,
  ROLLBACK: 0.65,
  CLOSE_SPRING: 0.7,
  STOP_CONTAINER: 0.6,
  RELEASE_ENI: 0.7,
  DONE: Number.POSITIVE_INFINITY,
}

function event(state: SimulationState, label: string, kind: TimelineEvent['kind'] = 'info'): void {
  state.events.push({ id: state.nextEventId++, at: state.now, label, kind })
}

function enter(state: SimulationState, phase: Phase): void {
  state.phase = phase
  state.phaseElapsed = 0
  switch (phase) {
    case 'PROVISION_ENI':
      state.ecsStatus = 'PROVISIONING'
      event(state, 'RunTask accepted · ENIを作成')
      break
    case 'WAIT_CAPACITY':
      state.ecsStatus = 'PENDING'
      event(state, 'Fargate capacityを待機')
      break
    case 'PULL_IMAGE':
      state.ecsStatus = 'ACTIVATING'
      event(state, 'ECRからcontainer imageをpull')
      break
    case 'START_JVM':
      state.ecsStatus = 'RUNNING'
      event(state, 'Container RUNNING · Java 21を起動')
      break
    case 'START_SPRING':
      state.springStatus = 'STARTING'
      event(state, 'Spring ApplicationContextを構築')
      break
    case 'START_JOB':
      state.springStatus = 'READY'
      state.batchStatus = 'STARTING'
      event(state, 'Spring READY · JobExecutionを開始')
      break
    case 'RUN_TASKLET':
      state.batchStatus = 'STARTED'
      state.transaction = 'ACTIVE'
      event(state, `Tasklet開始 · ExecutorType.${state.executorType}`)
      break
    case 'FLUSH_BATCH':
      state.flushRequested = state.config.autoFlush
      event(state, `MyBatis batch待機 · pending ${state.pendingStatements}件`)
      if (state.flushRequested) event(state, '自動 flushStatements() を要求')
      break
    case 'COMMIT':
      state.taskletRepeatStatus = 'FINISHED'
      event(state, 'Tasklet FINISHED · transactionはまだACTIVE')
      break
    case 'ROLLBACK':
      state.batchStatus = 'FAILED'
      state.batchExitStatus = 'FAILED'
      event(state, '例外を検出 · ROLLBACK', 'error')
      break
    case 'CLOSE_SPRING':
      state.springStatus = 'CLOSING'
      event(state, `SpringApplication.exit() = ${state.applicationExitCode ?? '—'}`, state.applicationResult === 'NORMAL' ? 'success' : state.applicationResult === 'WARNING' ? 'warning' : 'error')
      break
    case 'STOP_CONTAINER':
      state.ecsStatus = 'STOPPING'
      state.springStatus = state.springStatus === 'FAILED' ? 'FAILED' : 'CLOSED'
      state.containerExitCode = state.applicationExitCode
      event(state, `JVM process終了 · container exitCode ${state.containerExitCode ?? '—'}`)
      break
    case 'RELEASE_ENI':
      state.ecsStatus = 'DEPROVISIONING'
      event(state, 'ENIとFargate resourceを解放')
      break
    case 'DONE':
      state.ecsStatus = 'STOPPED'
      state.stopCode = state.config.scenario === 'LAUNCH_FAILURE' ? 'TaskFailedToStart' : 'EssentialContainerExited'
      state.stoppedReason = state.config.scenario === 'LAUNCH_FAILURE' ? 'CannotPullContainerError' : 'Essential container in task exited'
      event(state, `ECS Task STOPPED · ${state.stopCode}`, state.applicationResult === 'NORMAL' ? 'success' : 'warning')
      break
    case 'IDLE':
      break
  }
}

export function createInitialState(config: Partial<SimulationConfig> = {}): SimulationState {
  const resolved = { ...DEFAULT_CONFIG, ...config }
  return {
    now: 0,
    runId: 0,
    taskArn: '—',
    ecsStatus: 'IDLE',
    desiredStatus: 'STOPPED',
    phase: 'IDLE',
    phaseElapsed: 0,
    progress: 0,
    springStatus: 'NOT_STARTED',
    batchStatus: 'UNKNOWN',
    batchExitStatus: 'UNKNOWN',
    taskletRepeatStatus: 'NONE',
    transaction: 'NONE',
    executorType: resolved.executorType,
    mapperCalls: 0,
    pendingStatements: 0,
    flushedStatements: 0,
    flushRequested: false,
    sqlExecutions: 0,
    updateCount: null,
    applicationResult: 'PENDING',
    applicationExitCode: null,
    containerExitCode: null,
    stopCode: null,
    stoppedReason: null,
    java: {
      version: 21,
      taskCpu: resolved.taskCpu,
      taskMemoryMiB: resolved.taskMemoryMiB,
      maxRamPercentage: resolved.maxRamPercentage,
      maxHeapMiB: Math.floor(resolved.taskMemoryMiB * resolved.maxRamPercentage / 100),
    },
    config: resolved,
    events: [],
    nextEventId: 1,
  }
}

export function runTask(config: Partial<SimulationConfig> = {}, previous?: SimulationState): SimulationState {
  const state = createInitialState({ ...(previous?.config ?? {}), ...config })
  state.runId = (previous?.runId ?? 0) + 1
  state.taskArn = `task/ecs-batch-city/${String(state.runId).padStart(6, '0')}`
  state.desiredStatus = 'RUNNING'
  enter(state, 'PROVISION_ENI')
  return state
}

function completeWork(state: SimulationState): void {
  if (state.config.scenario === 'ABNORMAL') {
    state.updateCount = null
    enter(state, 'ROLLBACK')
    return
  }

  state.updateCount = state.config.scenario === 'WARNING' ? 0 : state.config.statementCount
  enter(state, 'COMMIT')
}

function advancePhase(state: SimulationState): void {
  switch (state.phase) {
    case 'PROVISION_ENI':
      enter(state, 'WAIT_CAPACITY')
      break
    case 'WAIT_CAPACITY':
      enter(state, 'PULL_IMAGE')
      break
    case 'PULL_IMAGE':
      if (state.config.scenario === 'LAUNCH_FAILURE') {
        state.applicationResult = 'PLATFORM_FAILURE'
        state.springStatus = 'NOT_STARTED'
        state.applicationExitCode = null
        enter(state, 'RELEASE_ENI')
      } else {
        enter(state, 'START_JVM')
      }
      break
    case 'START_JVM':
      enter(state, 'START_SPRING')
      break
    case 'START_SPRING':
      enter(state, 'START_JOB')
      break
    case 'START_JOB':
      enter(state, 'RUN_TASKLET')
      break
    case 'RUN_TASKLET':
      state.mapperCalls = state.config.statementCount
      if (state.executorType === 'SIMPLE') {
        state.sqlExecutions = state.config.statementCount
        completeWork(state)
      } else {
        state.pendingStatements = state.config.statementCount
        enter(state, 'FLUSH_BATCH')
      }
      break
    case 'FLUSH_BATCH': {
      const pending = state.pendingStatements
      state.pendingStatements = 0
      state.flushedStatements += pending
      state.sqlExecutions += 1
      completeWork(state)
      break
    }
    case 'COMMIT':
      state.transaction = 'COMMITTED'
      state.batchStatus = 'COMPLETED'
      if (state.updateCount === 0) {
        state.batchExitStatus = 'WARNING'
        state.applicationResult = 'WARNING'
        state.applicationExitCode = 1
        event(state, 'COMMIT · 更新0件のためWARNING', 'warning')
      } else {
        state.batchExitStatus = 'COMPLETED'
        state.applicationResult = 'NORMAL'
        state.applicationExitCode = 0
        event(state, 'COMMIT · Job COMPLETED', 'success')
      }
      enter(state, 'CLOSE_SPRING')
      break
    case 'ROLLBACK':
      state.pendingStatements = 0
      state.transaction = 'ROLLED_BACK'
      state.applicationResult = 'ABNORMAL'
      state.applicationExitCode = 101
      state.springStatus = 'FAILED'
      event(state, 'ROLLBACK完了 · Job FAILED', 'error')
      enter(state, 'CLOSE_SPRING')
      break
    case 'CLOSE_SPRING':
      enter(state, 'STOP_CONTAINER')
      break
    case 'STOP_CONTAINER':
      enter(state, 'RELEASE_ENI')
      break
    case 'RELEASE_ENI':
      enter(state, 'DONE')
      break
    case 'IDLE':
    case 'DONE':
      break
  }
}

export function tick(source: SimulationState, deltaSeconds: number): SimulationState {
  if (deltaSeconds <= 0 || source.phase === 'IDLE' || source.phase === 'DONE') return structuredClone(source)
  if (source.phase === 'FLUSH_BATCH' && !source.flushRequested) return structuredClone(source)
  const state = structuredClone(source)
  let remaining = deltaSeconds
  while (remaining > 0 && state.phase !== 'DONE') {
    const duration = PHASE_DURATION[state.phase]
    const available = duration - state.phaseElapsed
    const consumed = Math.min(remaining, available)
    state.now += consumed
    state.phaseElapsed += consumed
    state.progress = Number.isFinite(duration) ? Math.min(1, state.phaseElapsed / duration) : 0
    remaining -= consumed
    if (state.phaseElapsed >= duration) advancePhase(state)
  }
  return state
}

export function flushStatements(source: SimulationState): SimulationState {
  const state = structuredClone(source)
  if (state.phase !== 'FLUSH_BATCH' || state.flushRequested) return state
  state.flushRequested = true
  event(state, `手動 flushStatements() · pending ${state.pendingStatements}件`)
  return state
}

export function stopTask(source: SimulationState): SimulationState {
  const state = structuredClone(source)
  if (state.ecsStatus === 'IDLE' || state.ecsStatus === 'STOPPED') return state
  state.desiredStatus = 'STOPPED'
  state.applicationResult = 'PLATFORM_FAILURE'
  state.applicationExitCode = 143
  state.batchStatus = state.batchStatus === 'STARTED' ? 'STOPPED' : state.batchStatus
  state.transaction = state.transaction === 'ACTIVE' ? 'ROLLED_BACK' : state.transaction
  state.pendingStatements = 0
  event(state, 'StopTask · SIGTERMを送信', 'warning')
  enter(state, 'CLOSE_SPRING')
  return state
}

export function runToCompletion(state: SimulationState, step = 0.25): SimulationState {
  let current = state
  let guard = 0
  while (current.phase !== 'DONE' && guard++ < 500) current = tick(current, step)
  return current
}

export function scenarioLabel(scenario: Scenario): string {
  return { NORMAL: '正常終了', WARNING: '警告終了', ABNORMAL: '異常終了', LAUNCH_FAILURE: '起動失敗' }[scenario]
}
