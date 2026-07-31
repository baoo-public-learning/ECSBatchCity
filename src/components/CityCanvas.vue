<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSimulationStore } from '../stores/simulation'
import { createWorldRenderer } from '../three/create-world-renderer'

const canvas = ref<HTMLCanvasElement | null>(null)
const store = useSimulationStore()
let dispose: (() => void) | undefined

onMounted(() => {
  if (!canvas.value) return
  const world = createWorldRenderer(canvas.value)
  world.update(store.snapshot)
  const stopWatch = watch(() => store.snapshot, (snapshot) => world.update(snapshot), { deep: false })
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  world.setReducedMotion(media.matches)
  const onMotionPreferenceChange = (event: MediaQueryListEvent): void => world.setReducedMotion(event.matches)
  media.addEventListener('change', onMotionPreferenceChange)
  dispose = () => {
    media.removeEventListener('change', onMotionPreferenceChange)
    stopWatch()
    world.dispose()
  }
})

onBeforeUnmount(() => dispose?.())
</script>

<template>
  <canvas ref="canvas" class="h-full w-full" aria-label="ECS Batch City 3D visualization" />
</template>
