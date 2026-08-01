<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSimulationStore } from '../stores/simulation'
import { createWorldRenderer } from '../three/create-world-renderer'

const emit = defineEmits<{ (event: 'select', district: string | null): void }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const store = useSimulationStore()
let world: ReturnType<typeof createWorldRenderer> | undefined
let dispose: (() => void) | undefined
let lastHoverCheck = 0

function toNdc(event: MouseEvent): { x: number; y: number } | null {
  if (!canvas.value) return null
  const rect = canvas.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
  }
}

// clickはタップ確定時のみ発火するため、タッチスクロール開始を選択として
// 誤認しない(pointerdownだとスクロールでも選択されてしまう)。
function onClick(event: MouseEvent): void {
  const ndc = toNdc(event)
  if (!ndc || !world) return
  const district = world.pickAt(ndc.x, ndc.y)
  world.setSelected(district)
  world.focusDistrict(district)
  emit('select', district)
}

function onPointerMove(event: PointerEvent): void {
  const now = performance.now()
  if (now - lastHoverCheck < 80) return
  lastHoverCheck = now
  const ndc = toNdc(event)
  if (!ndc || !world || !canvas.value) return
  canvas.value.style.cursor = world.pickAt(ndc.x, ndc.y) ? 'pointer' : 'default'
}

function resetView(): void {
  world?.setSelected(null)
  world?.focusDistrict(null)
}

defineExpose({ resetView })

onMounted(() => {
  if (!canvas.value) return
  world = createWorldRenderer(canvas.value)
  world.update(store.snapshot)
  const stopWatch = watch(() => store.snapshot, (snapshot) => world?.update(snapshot), { deep: false })
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  world.setReducedMotion(media.matches)
  const onMotionPreferenceChange = (event: MediaQueryListEvent): void => world?.setReducedMotion(event.matches)
  media.addEventListener('change', onMotionPreferenceChange)
  dispose = () => {
    media.removeEventListener('change', onMotionPreferenceChange)
    stopWatch()
    world?.dispose()
    world = undefined
  }
})

onBeforeUnmount(() => dispose?.())
</script>

<template>
  <canvas
    ref="canvas"
    class="h-full w-full"
    aria-label="ECS Batch City 3D visualization"
    @click="onClick"
    @pointermove="onPointerMove"
  />
</template>
