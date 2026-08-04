// Vitest global setup. Polyfills browser APIs the runner's jsdom doesn't fully provide, so
// components that touch them at module-load time don't crash the whole test file.
//
// Why localStorage: the Node worker exposes an experimental Web Storage `localStorage` global
// (see the "--localstorage-file was provided without a valid path" warning) whose `getItem` is
// not callable, and it shadows jsdom's. `useSidebar.ts` reads `localStorage.getItem(...)` at
// module load (imported transitively by MainLayout), so every test that renders MainLayout —
// the router guard tests and most view tests — threw `localStorage.getItem is not a function`.

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  const value = new MemoryStorage()
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, { value, configurable: true, writable: true })
  }
}

install('localStorage')
install('sessionStorage')

// jsdom doesn't implement scrollTo (the router's scrollBehavior + views call it) — stub to a no-op.
if (typeof window !== 'undefined') {
  window.scrollTo = window.scrollTo ?? ((() => {}) as typeof window.scrollTo)
}
