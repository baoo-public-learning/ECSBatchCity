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
export type Scenario = 'NORMAL' | 'WARNING' | 'ABNORMAL' | 'LAUNCH_FAILURE'
export type TransactionStatus = 'NONE' | 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK'
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
  | 'COMMIT'
  | 'ROLLBACK'
  | 'CLOSE_SPRING'
  | 'STOP_CONTAINER'
  | 'RELEASE_ENI'
  | 'DONE'

export interface BatchResult {
  flushIndex: number
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
  autoFlush: boolean
  taskCpu: number
  taskMemoryMiB: number
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
  java: {
    version: 21
    taskCpu: number
    taskMemoryMiB: number
    maxRamPercentage: number
    maxHeapMiB: number
  }
  config: SimulationConfig
  events: TimelineEvent[]
  nextEventId: number
}
