import { useCallback, useState } from 'react'

export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValueState] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored ? (JSON.parse(stored) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue = useCallback(
    (nextValue: T | ((current: T) => T)) => {
      setValueState((current) => {
        const resolved = typeof nextValue === 'function' ? (nextValue as (current: T) => T)(current) : nextValue
        window.localStorage.setItem(key, JSON.stringify(resolved))
        return resolved
      })
    },
    [key]
  )

  return [value, setValue] as const
}
