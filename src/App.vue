<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CityCanvas from './components/CityCanvas.vue'
import { scenarioLabel } from './sim/model'
import type { ExecutorType, Scenario, TimelineEvent } from './sim/types'
import { useSimulationStore } from './stores/simulation'

const store = useSimulationStore()
const scenario = ref<Scenario>('NORMAL')
const executorType = ref<ExecutorType>('BATCH')
const statementCount = ref(10)
const flushThreshold = ref(10)
const failAtStatement = ref(6)
const autoFlush = ref(true)
const hangOnSigterm = ref(false)
let timer = 0

const state = computed(() => store.snapshot)
const resultTone = computed(() => ({
  NORMAL: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
  WARNING: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
  ABNORMAL: 'text-red-300 border-red-400/40 bg-red-400/10',
  PLATFORM_FAILURE: 'text-purple-300 border-purple-400/40 bg-purple-400/10',
  PENDING: 'text-sky-300 border-sky-400/40 bg-sky-400/10',
}[state.value.applicationResult]))

const reversedEvents = computed(() => [...state.value.events].reverse())

function start(): void {
  store.start({
    scenario: scenario.value,
    executorType: executorType.value,
    statementCount: statementCount.value,
    flushThreshold: flushThreshold.value,
    failAtStatement: failAtStatement.value,
    autoFlush: autoFlush.value,
    hangOnSigterm: hangOnSigterm.value,
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
  if (updateCounts.some((count) => count < 0)) return '—(保証なし)'
  return String(updateCounts.reduce((total, count) => total + count, 0))
}

function updateCountLabel(count: number): string {
  return count === -3 ? '×' : String(count)
}

onMounted(() => {
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
  <main class="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,#163c5b_0%,#07111f_46%,#040a12_100%)]">
    <header class="flex flex-wrap items-center justify-between gap-4 border-b border-sky-900/50 px-5 py-4 lg:px-8">
      <div>
        <div class="flex items-center gap-3">
          <span class="grid size-9 place-items-center rounded-lg border border-sky-400/30 bg-sky-400/10 text-sm font-black text-sky-300">EC</span>
          <div>
            <h1 class="text-xl font-bold tracking-tight text-white">ECSBatchCity</h1>
            <p class="text-xs tracking-[0.16em] text-sky-200/60">RUN TASK → SPRING BATCH → AURORA</p>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3 text-xs">
        <span class="rounded-full border border-slate-600/60 bg-slate-800/60 px-3 py-1.5">Java 21</span>
        <span class="rounded-full border border-slate-600/60 bg-slate-800/60 px-3 py-1.5">Fargate · awsvpc</span>
        <span class="mono rounded-full border px-3 py-1.5" :class="resultTone">
          {{ state.applicationResult }} · {{ state.applicationExitCode ?? '—' }}
        </span>
      </div>
    </header>

    <section class="grid gap-4 p-4 lg:grid-cols-[310px_minmax(0,1fr)_340px] lg:p-6">
      <aside class="panel order-2 rounded-2xl p-4 lg:order-1">
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
              <option value="WRITER_FAILOVER">writer failover · 101</option>
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
              flushStatements()を自動実行
              <span class="block text-[10px] text-slate-500">OFF: threshold到達ごとに手動flushを待つ</span>
            </span>
            <input v-model="autoFlush" :disabled="store.isActive" type="checkbox" class="size-4 shrink-0 accent-sky-400 disabled:opacity-50" />
          </label>

          <button v-if="state.phase === 'FLUSH_BATCH' && !state.flushRequested" class="w-full rounded-lg border border-amber-400/50 bg-amber-400/10 px-4 py-3 font-bold text-amber-200 transition hover:bg-amber-400/20" @click="store.flush">
            flushStatements()
          </button>

          <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-300">
            <span>
              SIGTERMでhangする
              <span class="block text-[10px] text-slate-500">ON: StopTask後にstopTimeout経過でSIGKILL 137</span>
            </span>
            <input v-model="hangOnSigterm" :disabled="store.isActive" type="checkbox" class="size-4 shrink-0 accent-red-400 disabled:opacity-50" />
          </label>

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

      <section class="order-1 min-h-[430px] overflow-hidden rounded-2xl border border-sky-900/50 bg-slate-950/50 lg:order-2 lg:min-h-[680px]">
        <div class="relative h-full min-h-[430px] lg:min-h-[680px]">
          <CityCanvas />
          <div class="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap gap-2">
            <span v-for="label in ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA']" :key="label" class="rounded border border-sky-700/40 bg-slate-950/75 px-2 py-1 text-[10px] font-bold tracking-[0.14em] text-sky-200">{{ label }}</span>
          </div>
          <div class="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
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

      <aside class="panel order-3 rounded-2xl p-4">
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
            <dt class="text-slate-500">Task CPU</dt><dd class="mono text-right">{{ state.java.taskCpu }}</dd>
            <dt class="text-slate-500">Task memory</dt><dd class="mono text-right">{{ state.java.taskMemoryMiB }} MiB</dd>
            <dt class="text-slate-500">MaxRAMPercentage</dt><dd class="mono text-right">{{ state.java.maxRamPercentage }}%</dd>
            <dt class="text-slate-500">JDBC stack</dt><dd class="text-right">AWS Wrapper → pgJDBC</dd>
            <dt class="text-slate-500">Writer host</dt><dd class="mono text-right">{{ state.writerHost }}</dd>
            <dt class="text-slate-500">Failover</dt><dd class="mono text-right" :class="state.failoverState === 'NONE' ? '' : 'text-amber-300'">{{ state.failoverState }}</dd>
          </dl>
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
                <span class="font-semibold" :class="result.failedStatementIndex !== null ? 'text-red-300' : 'text-sky-300'">flush #{{ result.flushIndex }}</span>
                <span class="mono shrink-0 text-slate-400">parameters: {{ result.parameterCount }}</span>
              </div>
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

    <footer class="px-6 pb-6 text-center text-xs text-slate-600">
      実AWSへ接続しない決定論的な教材モデルです。時間と数量は視認性のため縮尺しています。
    </footer>
  </main>
</template>
