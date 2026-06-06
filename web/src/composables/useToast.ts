import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  type: ToastType
  message: string
  duration: number
}

const toasts = ref<Toast[]>([])
let seq = 1

function push(type: ToastType, message: string, duration = 3000) {
  const id = seq++
  toasts.value.push({ id, type, message, duration })
  if (duration > 0) {
    setTimeout(() => remove(id), duration)
  }
  return id
}

function remove(id: number) {
  const idx = toasts.value.findIndex(t => t.id === id)
  if (idx >= 0) toasts.value.splice(idx, 1)
}

export function useToast() {
  return {
    toasts,
    remove,
    success: (msg: string, d?: number) => push('success', msg, d),
    error: (msg: string, d?: number) => push('error', msg, d),
    info: (msg: string, d?: number) => push('info', msg, d),
    warning: (msg: string, d?: number) => push('warning', msg, d),
  }
}
