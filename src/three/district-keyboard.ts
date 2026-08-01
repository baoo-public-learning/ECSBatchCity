import { DISTRICT_LABELS } from './create-world-renderer'

// canvasにフォーカスがある時の地区選択キー操作。矢印で巡回、Escapeで解除。
export function nextDistrictForKey(current: string | null, key: string): string | null {
  if (key === 'Escape') return null
  const index = current ? DISTRICT_LABELS.indexOf(current as (typeof DISTRICT_LABELS)[number]) : -1
  if (key === 'ArrowRight') {
    if (index < 0) return DISTRICT_LABELS[0]
    return DISTRICT_LABELS[Math.min(DISTRICT_LABELS.length - 1, index + 1)]
  }
  if (key === 'ArrowLeft') {
    if (index < 0) return DISTRICT_LABELS[DISTRICT_LABELS.length - 1]
    return DISTRICT_LABELS[Math.max(0, index - 1)]
  }
  return current
}
