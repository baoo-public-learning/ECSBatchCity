import type { Phase, Scenario, SimulationConfig, SimulationState, TimelineEvent } from './types'

const DEFAULT_CONFIG: SimulationConfig = {
  executorType: 'BATCH',
  scenario: 'NORMAL',
  statementCount: 10,
  flushThreshold: 10,
  failAtStatement: 6,
  hangOnSigterm: false,
  failoverPolicy: 'FAIL_JOB',
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
  FAILOVER_DETECT: 0.8,
  TOPOLOGY_REFRESH: 0.9,
  RECONNECT: 0.7,
  FORCE_KILL: 1.2,
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
      if (state.mapperCalls === 0) {
        event(state, `Tasklet開始 · ExecutorType.${state.executorType}`)
      } else {
        event(state, `Tasklet再開 · 残りMapper呼び出し ${state.config.statementCount - state.mapperCalls}件`)
      }
      break
    case 'FAILOVER_DETECT':
      state.failoverState = 'DETECTING'
      event(state, 'Wrapper failover plugin(v2)が接続障害を検出', 'warning')
      break
    case 'TOPOLOGY_REFRESH':
      state.failoverState = 'REFRESHING_TOPOLOGY'
      event(state, 'Aurora topologyを更新 · new writerを特定', 'warning')
      break
    case 'RECONNECT':
      event(state, 'aurora-writer-2へ再接続を試行', 'warning')
      break
    case 'FORCE_KILL':
      event(state, 'ECS stopTimeoutを待機(縮尺表示)', 'warning')
      break
    case 'FLUSH_BATCH':
      state.flushRequested = state.config.autoFlush
      if (state.mapperCalls >= state.config.statementCount && state.pendingStatements < state.config.flushThreshold) {
        event(state, `全Mapper呼び出し完了 · commit前にpending ${state.pendingStatements}件をflush`)
      } else {
        event(state, `flush threshold ${state.config.flushThreshold}件到達 · pending ${state.pendingStatements}件`)
      }
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
      state.containerExitCode = state.containerExitCode ?? state.applicationExitCode
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
  resolved.statementCount = Math.max(1, Math.floor(resolved.statementCount))
  resolved.flushThreshold = Math.max(1, Math.floor(resolved.flushThreshold))
  resolved.failAtStatement = Math.min(resolved.statementCount, Math.max(1, Math.floor(resolved.failAtStatement)))
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
    writerHost: 'aurora-writer-1',
    failoverState: 'NONE',
    attempt: 1,
    executorType: resolved.executorType,
    mapperCalls: 0,
    pendingStatements: 0,
    flushedStatements: 0,
    batchResults: [],
    flushRequested: false,
    sqlExecutions: 0,
    updateCount: null,
    applicationResult: 'PENDING',
    applicationExitCode: null,
    containerExitCode: null,
    stopCode: null,
    stoppedReason: null,
    containerReason: null,
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
  if (state.config.scenario === 'ABNORMAL' || state.config.scenario === 'FLUSH_FAILURE') {
    state.updateCount = null
    enter(state, 'ROLLBACK')
    return
  }

  // 失われたattemptのupdate countsは確定件数に含めない。
  state.updateCount = state.executorType === 'BATCH'
    ? state.batchResults
      .filter((result) => result.attempt === state.attempt)
      .reduce((sum, result) => sum + result.updateCounts.reduce((a, b) => a + b, 0), 0)
    : state.config.scenario === 'WARNING' ? 0 : state.config.statementCount
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
      if (state.config.scenario === 'DB_CONNECT_FAILURE') {
        state.batchStatus = 'FAILED'
        state.batchExitStatus = 'FAILED'
        state.applicationResult = 'ABNORMAL'
        state.applicationExitCode = 101
        state.springStatus = 'FAILED'
        state.updateCount = null
        event(state, 'Step transaction開始時に接続を取得できない · CannotGetJdbcConnectionException', 'error')
        event(state, 'CannotCreateTransactionException · Taskletは未実行のままJob FAILED', 'error')
        enter(state, 'CLOSE_SPRING')
        break
      }
      enter(state, 'RUN_TASKLET')
      break
    case 'RUN_TASKLET': {
      if (state.config.scenario === 'JVM_OOM' || state.config.scenario === 'ECS_OOM_KILL') {
        state.mapperCalls = state.config.failAtStatement
        state.applicationResult = 'PLATFORM_FAILURE'
        state.springStatus = 'FAILED'
        state.pendingStatements = 0
        state.transaction = state.transaction === 'ACTIVE' ? 'ROLLED_BACK' : state.transaction
        if (state.config.scenario === 'JVM_OOM') {
          state.containerExitCode = 3
          event(state, 'heap枯渇 · java.lang.OutOfMemoryError: Java heap space', 'error')
          event(state, 'ExitOnOutOfMemoryError · shutdown hookなしでJVM即終了 exit 3', 'error')
        } else {
          state.containerExitCode = 137
          state.containerReason = 'OutOfMemoryError: Container killed due to memory usage'
          event(state, 'containerがtask memory limitを超過', 'error')
          event(state, 'container runtimeがSIGKILL · exitCode 137', 'error')
        }
        event(state, 'jobRepositoryにはSTARTEDが残る · 次回起動前にrecoverまたは手動修復が必要', 'warning')
        event(state, 'DBが接続断を検出し未commit変更をrollback')
        enter(state, 'STOP_CONTAINER')
        break
      }
      if (state.executorType === 'SIMPLE') {
        if (state.config.scenario === 'FLUSH_FAILURE') {
          state.mapperCalls = state.config.failAtStatement
          state.sqlExecutions = state.config.failAtStatement
          event(state, `SQL実行 ${state.config.failAtStatement}件目でSQL例外 · DataAccessException`, 'error')
          completeWork(state)
          break
        }
        if (state.config.scenario === 'WRITER_FAILOVER' && state.failoverState === 'NONE') {
          state.mapperCalls = state.config.failAtStatement
          state.sqlExecutions = state.config.failAtStatement
          state.transaction = 'LOST'
          event(state, `SQL実行 ${state.config.failAtStatement}件目でwriter障害 · 接続を喪失`, 'error')
          enter(state, 'FAILOVER_DETECT')
          break
        }
        state.mapperCalls += state.config.statementCount
        state.sqlExecutions += state.config.statementCount
        completeWork(state)
        break
      }
      const remaining = state.config.statementCount - state.mapperCalls
      const chunk = Math.min(state.config.flushThreshold, remaining)
      state.mapperCalls += chunk
      state.pendingStatements += chunk
      enter(state, 'FLUSH_BATCH')
      break
    }
    case 'FLUSH_BATCH': {
      const pending = state.pendingStatements
      const failoverHere = state.config.scenario === 'WRITER_FAILOVER'
        && state.failoverState === 'NONE'
        && state.config.failAtStatement > state.flushedStatements
        && state.config.failAtStatement <= state.flushedStatements + pending
      if (failoverHere) {
        // 接続喪失なのでdriverからBatchResultは返らない(本モデル上の定義)。
        state.pendingStatements = 0
        state.sqlExecutions += 1
        state.transaction = 'LOST'
        event(state, 'executeBatch()中にwriter障害 · 接続を喪失', 'error')
        enter(state, 'FAILOVER_DETECT')
        break
      }
      const failsHere = state.config.scenario === 'FLUSH_FAILURE'
        && state.config.failAtStatement > state.flushedStatements
        && state.config.failAtStatement <= state.flushedStatements + pending
      if (failsHere) {
        // pgjdbcはautoCommit=falseのbatch失敗時、全長EXECUTE_FAILED(-3)の
        // update countsを返す。-3は「未実行」ではなく「成功として保証できない」。
        state.batchResults.push({
          flushIndex: state.batchResults.length + 1,
          attempt: state.attempt,
          mappedStatementId: 'RecordMapper.upsertRecord',
          sql: 'UPDATE records SET payload = ? WHERE id = ?',
          parameterCount: pending,
          updateCounts: Array.from({ length: pending }, () => -3),
          successfulStatementCount: 0,
          failedStatementIndex: state.config.failAtStatement - state.flushedStatements,
        })
        state.pendingStatements = 0
        state.sqlExecutions += 1
        state.updateCount = null
        event(state, `executeBatch() 失敗 · ${state.config.failAtStatement}件目でBatchUpdateException`, 'error')
        event(state, 'update countsは全件EXECUTE_FAILED · BatchExecutorException → DataAccessException', 'error')
        enter(state, 'ROLLBACK')
        break
      }
      const perStatementUpdateCount = state.config.scenario === 'WARNING' ? 0 : 1
      state.batchResults.push({
        flushIndex: state.batchResults.length + 1,
        attempt: state.attempt,
        mappedStatementId: 'RecordMapper.upsertRecord',
        sql: 'UPDATE records SET payload = ? WHERE id = ?',
        parameterCount: pending,
        updateCounts: Array.from({ length: pending }, () => perStatementUpdateCount),
        successfulStatementCount: pending,
        failedStatementIndex: null,
      })
      state.pendingStatements = 0
      state.flushedStatements += pending
      state.sqlExecutions += 1
      event(state, `executeBatch() 完了 · BatchResult #${state.batchResults.length} update counts ${pending}件`)
      if (state.mapperCalls < state.config.statementCount) {
        enter(state, 'RUN_TASKLET')
      } else {
        completeWork(state)
      }
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
    case 'FORCE_KILL':
      state.containerExitCode = 137
      state.applicationResult = 'PLATFORM_FAILURE'
      state.springStatus = 'FAILED'
      state.pendingStatements = 0
      state.transaction = state.transaction === 'ACTIVE' ? 'ROLLED_BACK' : state.transaction
      event(state, 'stopTimeout経過 · SIGKILL exitCode 137', 'error')
      event(state, 'jobRepositoryにはSTARTEDが残る · graceful shutdownは完了していない', 'warning')
      enter(state, 'STOP_CONTAINER')
      break
    case 'FAILOVER_DETECT':
      enter(state, 'TOPOLOGY_REFRESH')
      break
    case 'TOPOLOGY_REFRESH':
      enter(state, 'RECONNECT')
      break
    case 'RECONNECT':
      state.writerHost = 'aurora-writer-2'
      state.failoverState = 'RECONNECTED'
      event(state, 'new writerへ再接続 · TransactionStateUnknownSQLException(08007)', 'error')
      if (state.config.failoverPolicy === 'RETRY_TASKLET') {
        state.attempt += 1
        state.transaction = 'ACTIVE'
        state.mapperCalls = 0
        state.pendingStatements = 0
        state.flushedStatements = 0
        event(state, `アプリ方針によりTaskletを再試行 · attempt ${state.attempt} · 新しいtransactionを開始`, 'warning')
        event(state, '再試行はSpring Batch/アプリの判断であり、Wrapperの自動機能ではない', 'warning')
        enter(state, 'RUN_TASKLET')
        break
      }
      state.batchStatus = 'FAILED'
      state.batchExitStatus = 'FAILED'
      state.applicationResult = 'ABNORMAL'
      state.applicationExitCode = 101
      state.springStatus = 'FAILED'
      state.updateCount = null
      event(state, '再接続はtransactionの再実行ではない · 中断transactionの結果は不明のままJob FAILED', 'error')
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
    if (state.phase === 'FLUSH_BATCH' && !state.flushRequested) break
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
  if (state.phase === 'FORCE_KILL' || state.phase === 'CLOSE_SPRING' || state.phase === 'STOP_CONTAINER' || state.phase === 'RELEASE_ENI' || state.phase === 'DONE') {
    event(state, 'StopTask · 既に停止処理中のため終了結果は変更されない')
    return state
  }
  if (state.config.hangOnSigterm) {
    event(state, 'StopTask · SIGTERMを送信', 'warning')
    event(state, 'shutdownがTasklet完了待ちでhang · graceful shutdownが進まない', 'warning')
    enter(state, 'FORCE_KILL')
    return state
  }
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
  return { NORMAL: '正常終了', WARNING: '警告終了', ABNORMAL: '異常終了', FLUSH_FAILURE: 'flush失敗', DB_CONNECT_FAILURE: 'DB接続失敗', WRITER_FAILOVER: 'writer failover', JVM_OOM: 'JVM OOM', ECS_OOM_KILL: 'ECS OOM kill', LAUNCH_FAILURE: '起動失敗' }[scenario]
}
