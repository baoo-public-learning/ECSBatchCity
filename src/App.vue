<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CityCanvas from './components/CityCanvas.vue'
import { narrationFor } from './narration'
import { scenarioLabel } from './sim/model'
import { DISTRICT_LABELS } from './three/create-world-renderer'
import { flowForPhase } from './three/flows'
import type { ExecutorType, FailoverPolicy, Scenario, TimelineEvent } from './sim/types'
import { useSimulationStore } from './stores/simulation'

const store = useSimulationStore()
const scenario = ref<Scenario>('NORMAL')
const executorType = ref<ExecutorType>('BATCH')
const statementCount = ref(10)
const flushThreshold = ref(10)
const failAtStatement = ref(6)
const autoFlush = ref(true)
const hangOnSigterm = ref(false)
const rewriteBatchedInserts = ref(false)
const failoverPolicy = ref<FailoverPolicy>('FAIL_JOB')
const taskCpu = ref(1024)
const taskMemoryMiB = ref(2048)
// Fargateで有効なtask CPU × memoryの組み合わせだけを選べるようにする。
const memoryOptionsByCpu: Record<number, number[]> = {
  256: [512, 1024, 2048],
  512: [1024, 2048, 4096],
  1024: [2048, 4096, 8192],
  2048: [4096, 8192],
  4096: [8192],
}
const memoryOptions = computed(() => memoryOptionsByCpu[taskCpu.value] ?? [2048])
watch(taskCpu, () => {
  if (!memoryOptions.value.includes(taskMemoryMiB.value)) taskMemoryMiB.value = memoryOptions.value[0]
})
const initialRamPercentage = ref(20)
const maxRamPercentage = ref(70)
let timer = 0

const state = computed(() => store.snapshot)
const cityCanvas = ref<InstanceType<typeof CityCanvas> | null>(null)
const selectedDistrict = ref<string | null>(null)
// モバイルでは左右パネルをドロワー化(nullなら閉)。lg以上では常時表示。
const mobilePanel = ref<'control' | 'inspector' | null>(null)

const districtInfo: Record<string, string> = {
  ECS: 'RunTaskを受け付けるcontrol plane。desiredStatusと実状態(lastStatus)を別々に管理し、停止理由はstopCode / stoppedReasonとして残ります。',
  CONTAINER: 'Fargate上のcontainer。JVM processの終了コードがcontainer exit codeとしてECSへ伝わります。',
  SPRING: 'Spring Boot ApplicationContextとSpring Batch Job / TaskletStep。BatchStatusとExitStatusは別物です。',
  MYBATIS: 'MapperをSQLへ変換するレイヤー。ExecutorType.BATCHではflushStatements()までpending batchに蓄積されます。',
  JDBC: 'HikariCP → AWS Advanced JDBC Wrapper → pgJDBC。writer failoverの検出とtopology更新を担いますが、transactionの再実行はしません。',
  AURORA: 'Aurora PostgreSQL writer。flush済みでもcommit前の変更はrollbackで取り消せます。',
}

function onDistrictSelect(district: string | null): void {
  selectedDistrict.value = district
}

function resetView(): void {
  selectedDistrict.value = null
  cityCanvas.value?.resetView?.()
}

// 紙芝居: phaseの説明カードと、当該地区へのカメラカット。
const narration = computed(() => narrationFor(state.value))
const followCamera = ref(true)
const narrationTone: Record<string, string> = {
  info: 'border-sky-500/50',
  success: 'border-emerald-500/60',
  warning: 'border-amber-500/60',
  error: 'border-red-500/60',
}
// step: phaseごとに一時停止し「次へ」で進む(既定)。auto: 連続再生。
const paceMode = ref<'step' | 'auto'>('step')
const waitingManualFlush = computed(() => state.value.phase === 'FLUSH_BATCH' && !state.value.flushRequested)
function nextStep(): void {
  store.playing = true
}
watch(() => state.value.phase, (phase) => {
  if (phase === 'IDLE') return
  if (paceMode.value === 'step' && phase !== 'DONE') store.playing = false
  if (!followCamera.value) return
  if (phase === 'DONE') {
    cityCanvas.value?.resetView?.()
    return
  }
  const flow = flowForPhase(phase, state.value.executorType)
  if (flow) cityCanvas.value?.focusDistrict?.(DISTRICT_LABELS[flow.to])
})
const resultTone = computed(() => ({
  NORMAL: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
  WARNING: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
  ABNORMAL: 'text-red-300 border-red-400/40 bg-red-400/10',
  PLATFORM_FAILURE: 'text-purple-300 border-purple-400/40 bg-purple-400/10',
  PENDING: 'text-sky-300 border-sky-400/40 bg-sky-400/10',
}[state.value.applicationResult]))

const reversedEvents = computed(() => [...state.value.events].reverse())

function start(): void {
  mobilePanel.value = null
  store.start({
    scenario: scenario.value,
    executorType: executorType.value,
    statementCount: statementCount.value,
    flushThreshold: flushThreshold.value,
    failAtStatement: failAtStatement.value,
    autoFlush: autoFlush.value,
    hangOnSigterm: hangOnSigterm.value,
    rewriteBatchedInserts: rewriteBatchedInserts.value,
    failoverPolicy: failoverPolicy.value,
    taskCpu: taskCpu.value,
    taskMemoryMiB: taskMemoryMiB.value,
    initialRamPercentage: initialRamPercentage.value,
    maxRamPercentage: maxRamPercentage.value,
  })
}

function eventDot(event: TimelineEvent): string {
  return {
    info: 'bg-sky-400',
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
    error: 'bg-red-400',
  }[event.kind]
}

function updateCountTotal(updateCounts: number[]): string {
  if (updateCounts.some((count) => count === -3)) return '—(保証なし)'
  if (updateCounts.some((count) => count === -2)) return '不明(SUCCESS_NO_INFO)'
  return String(updateCounts.reduce((total, count) => total + count, 0))
}

function updateCountLabel(count: number): string {
  if (count === -3) return '×'
  if (count === -2) return '?'
  return String(count)
}

onMounted(() => {
  // デモ・スクリーンショット用: ?autorun=1 で読み込み直後にRunTaskする(自動再生)。
  if (new URLSearchParams(window.location.search).has('autorun')) {
    paceMode.value = 'auto'
    start()
  }
  let previous = performance.now()
  timer = window.setInterval(() => {
    const current = performance.now()
    store.advance(Math.min((current - previous) / 1000, 0.25))
    previous = current
  }, 80)
})

onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <main class="relative h-[100dvh] w-full overflow-hidden bg-[#0b1520]">
    <div class="absolute inset-0">
      <CityCanvas ref="cityCanvas" @select="onDistrictSelect" />
    </div>
    <p class="sr-only">3Dシーンのレイヤー: ECS、CONTAINER、SPRING、MYBATIS、JDBC、AURORA。現在の状態は下部のステータスタイルとExecution inspectorに表示されます。</p>

    <header class="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-slate-900/30 bg-slate-950/70 px-5 py-3 backdrop-blur lg:px-8">
      <div>
        <div class="flex items-center gap-3">
          <span class="grid size-9 place-items-center rounded-lg border border-sky-400/30 bg-sky-400/10 text-sm font-black text-sky-300">EC</span>
          <div>
            <h1 class="text-xl font-bold tracking-tight text-white">ECSBatchCity</h1>
            <p class="text-xs tracking-[0.16em] text-sky-200/60">RUN TASK → SPRING BATCH → AURORA</p>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs lg:gap-3">
        <button class="rounded-full border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-semibold text-sky-200 lg:hidden" @click="mobilePanel = mobilePanel === 'control' ? null : 'control'">設定</button>
        <button class="rounded-full border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-semibold text-sky-200 lg:hidden" @click="mobilePanel = mobilePanel === 'inspector' ? null : 'inspector'">詳細</button>
        <span class="hidden rounded-full border border-slate-600/60 bg-slate-800/60 px-3 py-1.5 sm:inline">Java 21</span>
        <span class="hidden rounded-full border border-slate-600/60 bg-slate-800/60 px-3 py-1.5 sm:inline">Fargate · awsvpc</span>
        <span role="status" aria-live="polite" class="mono rounded-full border px-3 py-1.5" :class="resultTone">
          {{ state.applicationResult }} · {{ state.applicationExitCode ?? '—' }}
        </span>
      </div>
    </header>

    <section>
      <aside class="absolute bottom-24 left-2 right-2 top-16 z-30 overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950/90 p-4 backdrop-blur lg:bottom-24 lg:left-4 lg:right-auto lg:top-20 lg:z-10 lg:block lg:w-80 lg:bg-slate-950/80" :class="mobilePanel === 'control' ? 'block' : 'hidden'">
        <div class="mb-5 flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/70">Control plane</p>
            <h2 class="mt-1 text-lg font-semibold">RunTask設定</h2>
          </div>
          <span class="mono text-xs text-slate-400">rev:1</span>
        </div>

        <div class="space-y-4">
          <label class="block text-sm text-slate-300">
            シナリオ
            <select v-model="scenario" :disabled="store.isActive" class="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2.5 text-white disabled:opacity-50">
              <option value="NORMAL">正常終了 · 0</option>
              <option value="WARNING">警告終了 · 1</option>
              <option value="ABNORMAL">異常終了 · 101</option>
              <option value="FLUSH_FAILURE">flush失敗 · 101</option>
              <option value="DB_CONNECT_FAILURE">DB接続失敗 · 101</option>
              <option value="WRITER_FAILOVER">writer failover · 方針依存</option>
              <option value="JVM_OOM">JVM OOM · 3</option>
              <option value="ECS_OOM_KILL">ECS OOM kill · 137</option>
              <option value="LAUNCH_FAILURE">TaskFailedToStart</option>
            </select>
          </label>

          <div>
            <p class="mb-1.5 text-sm text-slate-300">MyBatis ExecutorType</p>
            <div class="grid grid-cols-2 gap-2">
              <button v-for="type in (['SIMPLE', 'BATCH'] as ExecutorType[])" :key="type" :disabled="store.isActive" class="rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-50" :class="executorType === type ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-slate-700 bg-slate-900/60 text-slate-400'" @click="executorType = type">
                {{ type }}
              </button>
            </div>
          </div>

          <label class="block text-sm text-slate-300">
            Mapper呼び出し数 <span class="mono float-right text-sky-300">{{ statementCount }}</span>
            <input v-model.number="statementCount" :disabled="store.isActive" type="range" min="1" max="100" class="mt-2 w-full accent-sky-400 disabled:opacity-50" />
          </label>

          <label v-if="executorType === 'BATCH'" class="block text-sm text-slate-300">
            Flush threshold <span class="mono float-right text-sky-300">{{ flushThreshold }}</span>
            <input v-model.number="flushThreshold" :disabled="store.isActive" type="range" min="1" :max="statementCount" class="mt-2 w-full accent-sky-400 disabled:opacity-50" />
          </label>

          <label v-if="['FLUSH_FAILURE', 'WRITER_FAILOVER', 'JVM_OOM', 'ECS_OOM_KILL'].includes(scenario)" class="block text-sm text-slate-300">
            障害発生statement位置 <span class="mono float-right text-red-300">{{ Math.min(failAtStatement, statementCount) }}件目</span>
            <input v-model.number="failAtStatement" :disabled="store.isActive" type="range" min="1" :max="statementCount" class="mt-2 w-full accent-red-400 disabled:opacity-50" />
          </label>

          <label v-if="executorType === 'BATCH'" class="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-300">
            <span>
              reWriteBatchedInserts
              <span class="block text-[10px] text-slate-500">INSERTを複数行へ書き換えて高速化。個別のupdate countは?(-2)になる</span>
            </span>
            <input v-model="rewriteBatchedInserts" :disabled="store.isActive" type="checkbox" class="size-4 shrink-0 accent-sky-400 disabled:opacity-50" />
          </label>

          <label v-if="executorType === 'BATCH'" class="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-300">
            <span>
              flushStatements()を自動実行
              <span class="block text-[10px] text-slate-500">OFF: threshold到達ごとに手動flushを待つ</span>
            </span>
            <input v-model="autoFlush" :disabled="store.isActive" type="checkbox" class="size-4 shrink-0 accent-sky-400 disabled:opacity-50" />
          </label>

          <button v-if="state.phase === 'FLUSH_BATCH' && !state.flushRequested" class="w-full rounded-lg border border-amber-400/50 bg-amber-400/10 px-4 py-3 font-bold text-amber-200 transition hover:bg-amber-400/20" @click="store.flush">
            flushStatements()
          </button>

          <div v-if="scenario === 'WRITER_FAILOVER'">
            <p class="mb-1.5 text-sm text-slate-300">再接続後のアプリ方針</p>
            <div class="grid grid-cols-2 gap-2">
              <button v-for="policy in (['FAIL_JOB', 'RETRY_TASKLET'] as FailoverPolicy[])" :key="policy" :disabled="store.isActive" class="rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-50" :class="failoverPolicy === policy ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-slate-700 bg-slate-900/60 text-slate-400'" @click="failoverPolicy = policy">
                {{ policy === 'FAIL_JOB' ? 'Job FAILED' : 'Tasklet再試行' }}
              </button>
            </div>
            <p class="mt-1.5 text-[10px] leading-4 text-slate-500">どちらもアプリ/Spring Batchの判断です。Wrapperが自動で再実行することはありません。</p>
          </div>

          <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-300">
            <span>
              SIGTERMでhangする
              <span class="block text-[10px] text-slate-500">ON: StopTask後にstopTimeout経過でSIGKILL 137</span>
            </span>
            <input v-model="hangOnSigterm" :disabled="store.isActive" type="checkbox" class="size-4 shrink-0 accent-red-400 disabled:opacity-50" />
          </label>

          <div class="rounded-lg border border-slate-700 bg-slate-950/45 p-3">
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky-300/70">Java 21 container設定</p>
            <div class="grid grid-cols-2 gap-2">
              <label class="block text-xs text-slate-300">
                Task CPU
                <select v-model.number="taskCpu" :disabled="store.isActive" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/80 px-2 py-1.5 text-white disabled:opacity-50">
                  <option v-for="cpu in [256, 512, 1024, 2048, 4096]" :key="cpu" :value="cpu">{{ cpu }} ({{ cpu / 1024 }} vCPU)</option>
                </select>
              </label>
              <label class="block text-xs text-slate-300">
                Task memory
                <select v-model.number="taskMemoryMiB" :disabled="store.isActive" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/80 px-2 py-1.5 text-white disabled:opacity-50">
                  <option v-for="mem in memoryOptions" :key="mem" :value="mem">{{ mem }} MiB</option>
                </select>
              </label>
            </div>
            <label class="mt-2 block text-xs text-slate-300">
              InitialRAMPercentage <span class="mono float-right text-sky-300">{{ initialRamPercentage }}%</span>
              <input v-model.number="initialRamPercentage" :disabled="store.isActive" type="range" min="5" :max="maxRamPercentage" class="mt-1 w-full accent-sky-400 disabled:opacity-50" />
            </label>
            <label class="mt-2 block text-xs text-slate-300">
              MaxRAMPercentage <span class="mono float-right text-sky-300">{{ maxRamPercentage }}%</span>
              <input v-model.number="maxRamPercentage" :disabled="store.isActive" type="range" min="10" max="90" class="mt-1 w-full accent-sky-400 disabled:opacity-50" />
            </label>
          </div>

          <div class="grid grid-cols-2 gap-2 pt-2">
            <button :disabled="store.isActive" class="rounded-lg bg-sky-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40" @click="start">RunTask</button>
            <button :disabled="!store.isActive" class="rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-3 font-bold text-red-200 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-30" @click="store.stop">StopTask</button>
          </div>
        </div>

        <div class="mt-6 border-t border-slate-700/60 pt-4 text-xs leading-6 text-slate-400">
          <p class="font-semibold text-slate-200">現在の説明</p>
          <p v-if="state.phase === 'FLUSH_BATCH'">flushはpending SQLを実行しますが、transactionはまだcommitされません。</p>
          <p v-else-if="state.phase === 'COMMIT'">TaskletはFINISHEDです。ただしOS終了コードはJob結果の変換後に決まります。</p>
          <p v-else-if="state.ecsStatus === 'RUNNING'">ECS RUNNINGはcontainer稼働中を示し、Job成功を意味しません。</p>
          <p v-else>RunTaskからECS、JVM、Spring、MyBatis、Auroraへの流れを追跡します。</p>
        </div>
      </aside>

      <div v-if="selectedDistrict" class="absolute left-1/2 top-20 z-10 w-full max-w-sm -translate-x-1/2 rounded-xl border border-sky-700/50 bg-slate-950/85 p-3 text-xs backdrop-blur">
        <div class="flex items-center justify-between gap-3">
          <span class="font-bold tracking-[0.14em] text-sky-200">{{ selectedDistrict }}</span>
          <button class="rounded border border-slate-600 px-2 py-0.5 text-[10px] text-slate-300 transition hover:bg-slate-800" @click="resetView">視点リセット</button>
        </div>
        <p class="mt-1.5 leading-5 text-slate-300">{{ districtInfo[selectedDistrict] }}</p>
      </div>
      <p v-else class="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded bg-slate-950/60 px-3 py-1 text-[11px] text-slate-300">ドラッグで回転 · ホイールでズーム · 建物クリックで説明と視点</p>

      <transition name="fade" mode="out-in">
        <div v-if="narration" :key="narration.title" class="absolute bottom-44 left-1/2 z-10 w-[min(88vw,620px)] lg:bottom-28 -translate-x-1/2 rounded-2xl border-2 bg-slate-950/85 p-4 backdrop-blur" :class="narrationTone[narration.tone]">
          <div class="flex items-start justify-between gap-3">
            <p class="text-base font-bold text-white">{{ narration.title }}</p>
            <div class="flex shrink-0 items-center gap-3 text-[10px] text-slate-400">
              <label class="flex items-center gap-1">
                自動再生
                <input type="checkbox" :checked="paceMode === 'auto'" class="size-3.5 accent-sky-400" @change="paceMode = paceMode === 'auto' ? 'step' : 'auto'; if (paceMode === 'auto') nextStep()" />
              </label>
              <label class="flex items-center gap-1">
                カメラ追従
                <input v-model="followCamera" type="checkbox" class="size-3.5 accent-sky-400" />
              </label>
            </div>
          </div>
          <p class="mt-1.5 text-sm leading-6 text-slate-200">{{ narration.body }}</p>
          <button v-if="paceMode === 'step' && !store.playing && state.phase !== 'DONE' && !waitingManualFlush" class="mt-3 w-full rounded-lg bg-sky-400 px-4 py-2.5 font-bold text-slate-950 transition hover:bg-sky-300" @click="nextStep">
            次へ ▶
          </button>
        </div>
      </transition>

      <section>
        <div>
          <div class="absolute bottom-4 left-1/2 z-10 grid w-[min(88vw,860px)] -translate-x-1/2 grid-cols-3 gap-2 sm:grid-cols-6">
            <div v-for="item in [
              ['ECS', state.ecsStatus],
              ['SPRING', state.springStatus],
              ['BATCH', state.batchStatus],
              ['TX', state.transaction],
              ['PENDING', state.pendingStatements],
              ['FLUSHED', state.flushedStatements],
            ]" :key="String(item[0])" class="rounded-lg border border-slate-700/70 bg-slate-950/85 px-2 py-2 text-center backdrop-blur">
              <p class="text-[9px] tracking-widest text-slate-500">{{ item[0] }}</p>
              <p class="mono mt-1 truncate text-xs font-bold text-slate-100">{{ item[1] }}</p>
            </div>
          </div>
        </div>
      </section>

      <aside class="absolute bottom-24 left-2 right-2 top-16 z-30 overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950/90 p-4 backdrop-blur lg:bottom-24 lg:left-auto lg:right-4 lg:top-20 lg:z-10 lg:block lg:w-[22.5rem] lg:bg-slate-950/80" :class="mobilePanel === 'inspector' ? 'block' : 'hidden'">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/70">Execution inspector</p>
            <h2 class="mt-1 text-lg font-semibold">{{ scenarioLabel(state.config.scenario) }}</h2>
          </div>
          <span class="mono rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-[10px] text-slate-400">{{ state.taskArn }}</span>
        </div>

        <div class="mt-5 grid grid-cols-2 gap-2 text-xs">
          <div v-for="item in [
            ['Tasklet return', state.taskletRepeatStatus],
            ['BatchStatus', state.batchStatus],
            ['ExitStatus', state.batchExitStatus],
            ['App result', state.applicationResult],
            ['Spring exit', state.applicationExitCode ?? '—'],
            ['Container exit', state.containerExitCode ?? '—'],
            ['Stop code', state.stopCode ?? '—'],
            ['Stopped reason', state.stoppedReason ?? '—'],
          ]" :key="String(item[0])" class="rounded-lg border border-slate-700/60 bg-slate-950/45 p-2.5">
            <p class="text-slate-500">{{ item[0] }}</p>
            <p class="mono mt-1 break-words font-bold text-slate-100">{{ item[1] }}</p>
          </div>
        </div>

        <p v-if="state.containerReason" class="mt-2 rounded-lg border border-red-400/40 bg-red-400/5 p-2.5 text-xs text-red-200">
          container reason: <span class="mono">{{ state.containerReason }}</span>
          <span class="mt-1 block text-[10px] text-slate-500">containerのreasonとtaskのstoppedReasonは別のmetadataです。</span>
        </p>

        <div class="mt-5 rounded-xl border border-slate-700/60 bg-slate-950/50 p-3">
          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold text-slate-200">Java 21 container</span>
            <span class="mono text-sky-300">{{ state.java.maxHeapMiB }} MiB heap</span>
          </div>
          <dl class="mt-3 grid grid-cols-2 gap-y-2 text-xs">
            <dt class="text-slate-500">Task CPU</dt><dd class="mono text-right">{{ state.java.taskCpu }} ({{ state.java.assignedVcpus }} vCPU)</dd>
            <dt class="text-slate-500">JVM認識CPU</dt><dd class="mono text-right">{{ state.java.activeProcessorCount }}(固定)</dd>
            <dt class="text-slate-500">Task memory</dt><dd class="mono text-right">{{ state.java.taskMemoryMiB }} MiB</dd>
            <dt class="text-slate-500">Initial heap</dt><dd class="mono text-right">{{ state.java.initialHeapMiB }} MiB ({{ state.java.initialRamPercentage }}%)</dd>
            <dt class="text-slate-500">Max heap</dt><dd class="mono text-right">{{ state.java.maxHeapMiB }} MiB ({{ state.java.maxRamPercentage }}%)</dd>
            <dt class="text-slate-500">GC</dt><dd class="mono text-right">{{ state.java.gcName }}</dd>
            <dt class="text-slate-500">GC activity</dt><dd class="mono text-right">young {{ state.gc.youngCount }}回 · {{ state.gc.pauseMs }}ms</dd>
            <dt class="text-slate-500">JDBC stack</dt><dd class="text-right">AWS Wrapper → pgJDBC</dd>
            <dt class="text-slate-500">Writer host</dt><dd class="mono text-right">{{ state.writerHost }}</dd>
            <dt class="text-slate-500">Failover</dt><dd class="mono text-right" :class="state.failoverState === 'NONE' ? '' : 'text-amber-300'">{{ state.failoverState }}</dd>
          </dl>
          <div class="mt-3 border-t border-slate-700/60 pt-2 text-[10px] leading-4">
            <p class="text-slate-400">heap以外のnative領域(説明用予算、上限ではない):</p>
            <p class="mono text-slate-500">
              Metaspace {{ state.java.nativeBudget.metaspaceMiB }} · thread stack {{ state.java.nativeBudget.threadStacksMiB }} · code cache {{ state.java.nativeBudget.codeCacheMiB }} · direct buffer {{ state.java.nativeBudget.directBuffersMiB }} · その他 {{ state.java.nativeBudget.otherMiB }} MiB
            </p>
            <p class="mono mt-1 break-words text-slate-500">JAVA_TOOL_OPTIONS: {{ state.java.javaToolOptions }}</p>
            <p class="mt-1 text-slate-500">Max heapは予約上限であり、起動時の使用量ではありません。GCはCPU2以上かつメモリ2GiB以上でG1、それ以外はSerialが選ばれます。</p>
          </div>
          <p v-if="state.failoverState === 'RECONNECTED'" class="mt-2 text-[10px] leading-4 text-slate-500">
            RECONNECTEDは接続状態です。中断されたtransactionの再実行を意味しません。
          </p>
        </div>

        <div v-if="state.executorType === 'BATCH'" class="mt-5 rounded-xl border border-slate-700/60 bg-slate-950/50 p-3">
          <h3 class="text-sm font-semibold text-slate-200">BatchResult</h3>

          <p v-if="!state.batchResults.length" class="mt-3 text-xs leading-5 text-slate-500">
            flushStatements()の結果がここに表示されます
          </p>

          <ol v-else class="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
            <li v-for="result in state.batchResults" :key="result.flushIndex" class="min-w-0 rounded-lg border p-3 text-xs" :class="result.failedStatementIndex !== null ? 'border-red-400/40 bg-red-400/5' : 'border-slate-700/60 bg-slate-950/50'">
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold" :class="result.failedStatementIndex !== null ? 'text-red-300' : 'text-sky-300'">
                  flush #{{ result.flushIndex }}
                  <span v-if="state.attempt > 1" class="mono ml-1 rounded border px-1 text-[10px]" :class="result.attempt < state.attempt ? 'border-slate-600 text-slate-500' : 'border-sky-500/50 text-sky-300'">attempt {{ result.attempt }}</span>
                </span>
                <span class="mono shrink-0 text-slate-400">parameters: {{ result.parameterCount }}</span>
              </div>
              <p v-if="state.attempt > 1 && result.attempt < state.attempt" class="mt-1 text-[10px] text-slate-500">
                失われたtransactionの結果 · 確定件数に含まれない
              </p>
              <p class="mono mt-2 break-all text-slate-300">{{ result.mappedStatementId }}</p>
              <p class="mono mt-1 break-words text-[10px] leading-4 text-slate-500">{{ result.sql }}</p>
              <p v-if="result.failedStatementIndex !== null" class="mt-2 font-semibold text-red-300">
                statement {{ result.failedStatementIndex }}件目でBatchUpdateException
              </p>
              <div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-slate-400">
                <span>update counts: {{ result.updateCounts.length }}件</span>
                <span class="mono">合計 {{ updateCountTotal(result.updateCounts) }}</span>
              </div>
              <p v-if="result.updateCounts.length <= 10" class="mono mt-1 break-words text-[10px] text-slate-500">
                [{{ result.updateCounts.map(updateCountLabel).join(', ') }}]
              </p>
              <p v-if="result.failedStatementIndex !== null" class="mt-1 text-[10px] leading-4 text-slate-500">
                × = EXECUTE_FAILED(成功として保証されない)
              </p>
              <p v-else-if="result.updateCounts.includes(-2)" class="mt-1 text-[10px] leading-4 text-slate-500">
                ? = SUCCESS_NO_INFO(成功したが個別件数は不明)
              </p>
            </li>
          </ol>

          <p class="mt-3 border-t border-slate-700/60 pt-3 text-[10px] leading-4 text-slate-500">
            update countsはflush結果であり、commit前は未確定です。rollbackで取り消せます。partial update countsはpartial commitを意味しません。
          </p>
        </div>

        <div class="mt-5">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold">Lifecycle timeline</h3>
            <span class="mono text-[10px] text-slate-500">{{ state.now.toFixed(1) }}s</span>
          </div>
          <ol class="max-h-72 space-y-3 overflow-y-auto pr-1">
            <li v-if="!reversedEvents.length" class="text-xs text-slate-500">RunTaskを実行するとイベントが表示されます。</li>
            <li v-for="entry in reversedEvents" :key="entry.id" class="flex gap-3 text-xs">
              <span class="mt-1 size-2 shrink-0 rounded-full" :class="eventDot(entry)" />
              <div class="min-w-0">
                <p class="leading-5 text-slate-200">{{ entry.label }}</p>
                <p class="mono text-[10px] text-slate-600">T+{{ entry.at.toFixed(1) }}s</p>
              </div>
            </li>
          </ol>
        </div>
      </aside>
    </section>

    <footer class="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2 text-center text-[10px] text-slate-400">
      実AWSへ接続しない決定論的な教材モデルです。時間と数量は視認性のため縮尺しています。
    </footer>
  </main>
</template>
