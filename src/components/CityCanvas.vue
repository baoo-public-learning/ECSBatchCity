<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSimulationStore } from '../stores/simulation'
import { createWorldRenderer } from '../three/create-world-renderer'
import { nextDistrictForKey } from '../three/district-keyboard'

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
  keyboardSelection = district
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

let keyboardSelection: string | null = null

function onKeydown(event: KeyboardEvent): void {
  // 端の地区でも矢印キーはこの操作系が処理済みとし、ページスクロール等の
  // ブラウザ既定動作へ漏らさない。
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Escape') event.preventDefault()
  const next = nextDistrictForKey(keyboardSelection, event.key)
  if (next === keyboardSelection) return
  keyboardSelection = next
  world?.setSelected(next)
  world?.focusDistrict(next)
  emit('select', next)
}

function resetView(): void {
  keyboardSelection = null
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
    class="h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
    tabindex="0"
    role="application"
    aria-label="ECS Batch City 3D visualization。左右矢印キーで地区を選択、Escapeで解除"
    @click="onClick"
    @pointermove="onPointerMove"
    @keydown="onKeydown"
  />
</template>
