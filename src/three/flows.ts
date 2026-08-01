import type { ExecutorType, Phase } from '../sim/types'

// phaseごとの処理フローを地区index(ECS=0 … AURORA=5)の始点→終点で表す。
// rollbackやshutdownは逆方向に流れることで「何が巻き戻るか」を見せる。
export interface Flow {
  from: number
  to: number
}

export function flowForPhase(phase: Phase, executorType: ExecutorType = 'BATCH'): Flow | null {
  switch (phase) {
    case 'PROVISION_ENI':
    case 'WAIT_CAPACITY':
    case 'PULL_IMAGE':
      return { from: 0, to: 1 }
    case 'START_JVM':
      return { from: 1, to: 2 }
    case 'START_SPRING':
      return { from: 2, to: 2 }
    case 'START_JOB':
      return { from: 2, to: 3 }
    case 'RUN_TASKLET':
      // SIMPLEは各Mapper呼び出しのSQLが即Auroraまで到達する。BATCHは
      // flushまでMyBatisのpending batchに蓄積される。
      return executorType === 'SIMPLE' ? { from: 2, to: 5 } : { from: 2, to: 3 }
    case 'FLUSH_BATCH':
      return { from: 3, to: 5 }
    case 'FAILOVER_DETECT':
      return { from: 5, to: 4 }
    case 'TOPOLOGY_REFRESH':
      return { from: 4, to: 4 }
    case 'RECONNECT':
      return { from: 4, to: 5 }
    case 'COMMIT':
      return { from: 4, to: 5 }
    case 'ROLLBACK':
      return { from: 5, to: 4 }
    case 'CLOSE_SPRING':
      return { from: 2, to: 1 }
    case 'FORCE_KILL':
      return { from: 0, to: 1 }
    case 'STOP_CONTAINER':
    case 'RELEASE_ENI':
      return { from: 1, to: 0 }
    case 'IDLE':
    case 'DONE':
      return null
  }
}
