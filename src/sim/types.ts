export type EcsTaskStatus =
  | 'IDLE'
  | 'PROVISIONING'
  | 'PENDING'
  | 'ACTIVATING'
  | 'RUNNING'
  | 'DEACTIVATING'
  | 'STOPPING'
  | 'DEPROVISIONING'
  | 'STOPPED'

export type SpringStatus = 'NOT_STARTED' | 'STARTING' | 'READY' | 'CLOSING' | 'CLOSED' | 'FAILED'
export type BatchStatus = 'UNKNOWN' | 'STARTING' | 'STARTED' | 'STOPPING' | 'STOPPED' | 'COMPLETED' | 'FAILED'
export type ExecutorType = 'SIMPLE' | 'BATCH'
export type Scenario =
  | 'NORMAL'
  | 'WARNING'
  | 'ABNORMAL'
  | 'FLUSH_FAILURE'
  | 'DB_CONNECT_FAILURE'
  | 'WRITER_FAILOVER'
  | 'JVM_OOM'
  | 'ECS_OOM_KILL'
  | 'LAUNCH_FAILURE'
// LOST: 接続喪失によりアプリからtransactionの結果が確認できない状態
// (TransactionStateUnknownSQLException / SQLState 08007)。
export type TransactionStatus = 'NONE' | 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK' | 'LOST'

export type FailoverState = 'NONE' | 'DETECTING' | 'REFRESHING_TOPOLOGY' | 'RECONNECTED'

// 再接続後の方針はアプリ/Spring Batch側の判断であり、Wrapperの機能ではない。
export type FailoverPolicy = 'FAIL_JOB' | 'RETRY_TASKLET'
export type ApplicationResult = 'PENDING' | 'NORMAL' | 'WARNING' | 'ABNORMAL' | 'PLATFORM_FAILURE'

export type Phase =
  | 'IDLE'
  | 'PROVISION_ENI'
  | 'WAIT_CAPACITY'
  | 'PULL_IMAGE'
  | 'START_JVM'
  | 'START_SPRING'
  | 'START_JOB'
  | 'RUN_TASKLET'
  | 'FLUSH_BATCH'
  | 'FAILOVER_DETECT'
  | 'TOPOLOGY_REFRESH'
  | 'RECONNECT'
  | 'FORCE_KILL'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'CLOSE_SPRING'
  | 'STOP_CONTAINER'
  | 'RELEASE_ENI'
  | 'DONE'

export interface BatchResult {
  flushIndex: number
  attempt: number
  mappedStatementId: string
  sql: string
  parameterCount: number
  updateCounts: number[]
  successfulStatementCount: number
  failedStatementIndex: number | null
}

export interface TimelineEvent {
  id: number
  at: number
  label: string
  kind: 'info' | 'success' | 'warning' | 'error'
}

export interface SimulationConfig {
  executorType: ExecutorType
  scenario: Scenario
  statementCount: number
  flushThreshold: number
  failAtStatement: number
  hangOnSigterm: boolean
  failoverPolicy: FailoverPolicy
  autoFlush: boolean
  taskCpu: number
  taskMemoryMiB: number
  initialRamPercentage: number
  maxRamPercentage: number
}

export interface SimulationState {
  now: number
  runId: number
  taskArn: string
  ecsStatus: EcsTaskStatus
  desiredStatus: 'RUNNING' | 'STOPPED'
  phase: Phase
  phaseElapsed: number
  progress: number
  springStatus: SpringStatus
  batchStatus: BatchStatus
  batchExitStatus: 'UNKNOWN' | 'COMPLETED' | 'WARNING' | 'FAILED'
  taskletRepeatStatus: 'NONE' | 'FINISHED'
  transaction: TransactionStatus
  writerHost: string
  failoverState: FailoverState
  attempt: number
  executorType: ExecutorType
  mapperCalls: number
  pendingStatements: number
  flushedStatements: number
  batchResults: BatchResult[]
  flushRequested: boolean
  sqlExecutions: number
  updateCount: number | null
  applicationResult: ApplicationResult
  applicationExitCode: number | null
  containerExitCode: number | null
  stopCode: string | null
  stoppedReason: string | null
  containerReason: string | null
  launchFailed: boolean
  java: {
    version: 21
    taskCpu: number
    taskMemoryMiB: number
    initialRamPercentage: number
    maxRamPercentage: number
    initialHeapMiB: number
    maxHeapMiB: number
    // Fargateはcpu-shares制御でJVM認識CPUが環境依存になるため、
    // 教材では-XX:ActiveProcessorCountで決定論的に固定する。
    assignedVcpus: number
    activeProcessorCount: number
    gcName: 'G1' | 'Serial'
    javaToolOptions: string
    // 説明用の予算であり上限ではない。
    nativeBudget: {
      metaspaceMiB: number
      threadStacksMiB: number
      codeCacheMiB: number
      directBuffersMiB: number
      otherMiB: number
    }
  }
  config: SimulationConfig
  // 教材用の縮尺値。young GCの回数と停止時間の累計。
  gc: { youngCount: number; pauseMs: number }
  events: TimelineEvent[]
  nextEventId: number
}
