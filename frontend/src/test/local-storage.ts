// Node 24 installs an experimental global `localStorage` that is inert unless the
// process is started with `--localstorage-file`; it shadows the working one jsdom
// provides, so its getter returns `undefined` and the device language store
// (`i18n/index.ts`) has nothing to read or write. An in-memory Storage restores it.
if (!window.localStorage) {
  const entries = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return entries.size
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
    clear: () => entries.clear(),
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
}
