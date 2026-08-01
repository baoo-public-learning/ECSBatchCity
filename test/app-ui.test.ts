// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { useSimulationStore } from '../src/stores/simulation'

function mountApp() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(App, {
    global: {
      plugins: [pinia],
      stubs: { CityCanvas: true },
    },
  })
  return { wrapper, store: useSimulationStore() }
}

function findButton(wrapper: ReturnType<typeof mountApp>['wrapper'], text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  if (!button) throw new Error(`button not found: ${text}`)
  return button
}

describe('App UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('disables RunTask and the scenario select while a task is active', async () => {
    const { wrapper, store } = mountApp()
    expect(findButton(wrapper, 'RunTask').attributes('disabled')).toBeUndefined()
    await findButton(wrapper, 'RunTask').trigger('click')
    expect(store.isActive).toBe(true)
    expect(findButton(wrapper, 'RunTask').attributes('disabled')).toBeDefined()
    expect(wrapper.find('select').attributes('disabled')).toBeDefined()
  })

  it('shows the warning exit code 1 as a non-zero result', async () => {
    const { wrapper, store } = mountApp()
    store.start({ scenario: 'WARNING', executorType: 'SIMPLE' })
    for (let i = 0; i < 200 && store.snapshot.phase !== 'DONE'; i++) store.advance(0.25)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('WARNING · 1')
    expect(wrapper.text()).not.toContain('WARNING · 0')
  })

  it('offers the manual flush button only while a flush is waiting', async () => {
    const { wrapper, store } = mountApp()
    store.start({ executorType: 'BATCH', autoFlush: false, statementCount: 10, flushThreshold: 10 })
    for (let i = 0; i < 200 && store.snapshot.phase !== 'FLUSH_BATCH'; i++) store.advance(0.25)
    await wrapper.vm.$nextTick()
    const flushButton = findButton(wrapper, 'flushStatements()')
    await flushButton.trigger('click')
    expect(store.snapshot.flushRequested).toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('button').some((candidate) => candidate.text() === 'flushStatements()')).toBe(false)
  })

  it('stops advancing the simulation after unmount', async () => {
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const { wrapper } = mountApp()
    wrapper.unmount()
    expect(clearSpy).toHaveBeenCalled()
  })

  it('labels every control button with readable text', () => {
    const { wrapper } = mountApp()
    for (const button of wrapper.findAll('button')) {
      expect(button.text().trim().length).toBeGreaterThan(0)
    }
  })

  it('announces the application result via a live region', () => {
    const { wrapper } = mountApp()
    const status = wrapper.find('[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.attributes('aria-live')).toBe('polite')
  })

  it('associates every form control with a label', () => {
    const { wrapper } = mountApp()
    for (const control of wrapper.findAll('select, input')) {
      const wrapped = control.element.closest('label')
      expect(wrapped, `unlabeled control: ${control.html().slice(0, 60)}`).not.toBeNull()
    }
  })

  it('keeps the 3D layer names available to assistive technology', () => {
    const { wrapper } = mountApp()
    const srText = wrapper.find('.sr-only')
    expect(srText.exists()).toBe(true)
    for (const label of ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA']) {
      expect(srText.text()).toContain(label)
    }
  })
})
