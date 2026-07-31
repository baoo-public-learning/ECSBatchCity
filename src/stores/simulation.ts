import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { createInitialState, flushStatements, runTask, stopTask, tick } from '../sim/model'
import type { ExecutorType, Scenario, SimulationConfig, SimulationState } from '../sim/types'

export const useSimulationStore = defineStore('simulation', () => {
  // simulationは常にプレーンなオブジェクトで保持する。reactive proxyを
  // sim層へ渡すとstructuredCloneが失敗するため、refには表示用の
  // snapshotだけを公開する。
  let current: SimulationState = createInitialState()
  const snapshot = shallowRef<SimulationState>(current)
  const speed = ref(1)
  const playing = ref(true)

  const isActive = computed(() => !['IDLE', 'STOPPED'].includes(snapshot.value.ecsStatus))

  function publish(next: SimulationState): void {
    current = next
    snapshot.value = next
  }

  function start(config: Partial<SimulationConfig>): void {
    publish(runTask(config, current))
    playing.value = true
  }

  function advance(deltaSeconds: number): void {
    if (!playing.value) return
    publish(tick(current, deltaSeconds * speed.value))
  }

  function stop(): void {
    publish(stopTask(current))
  }

  function flush(): void {
    publish(flushStatements(current))
  }

  function setExecutorType(executorType: ExecutorType): void {
    if (isActive.value) return
    publish(createInitialState({ ...current.config, executorType }))
  }

  function setScenario(scenario: Scenario): void {
    if (isActive.value) return
    publish(createInitialState({ ...current.config, scenario }))
  }

  return { snapshot, speed, playing, isActive, start, advance, stop, flush, setExecutorType, setScenario }
})
