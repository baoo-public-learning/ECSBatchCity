import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createInitialState, flushStatements, runTask, stopTask, tick } from '../sim/model'
import type { ExecutorType, Scenario, SimulationConfig, SimulationState } from '../sim/types'

export const useSimulationStore = defineStore('simulation', () => {
  const snapshot = ref<SimulationState>(createInitialState())
  const speed = ref(1)
  const playing = ref(true)

  const isActive = computed(() => !['IDLE', 'STOPPED'].includes(snapshot.value.ecsStatus))

  function start(config: Partial<SimulationConfig>): void {
    snapshot.value = runTask(config, snapshot.value)
    playing.value = true
  }

  function advance(deltaSeconds: number): void {
    if (!playing.value) return
    snapshot.value = tick(snapshot.value, deltaSeconds * speed.value)
  }

  function stop(): void {
    snapshot.value = stopTask(snapshot.value)
  }

  function flush(): void {
    snapshot.value = flushStatements(snapshot.value)
  }

  function setExecutorType(executorType: ExecutorType): void {
    if (isActive.value) return
    snapshot.value = createInitialState({ ...snapshot.value.config, executorType })
  }

  function setScenario(scenario: Scenario): void {
    if (isActive.value) return
    snapshot.value = createInitialState({ ...snapshot.value.config, scenario })
  }

  return { snapshot, speed, playing, isActive, start, advance, stop, flush, setExecutorType, setScenario }
})
