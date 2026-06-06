// 跨路由暂存待发送文件（拖拽到设备卡片 / 全局拖拽 -> 选择设备时取用）
// File 对象无法通过路由参数序列化传递，用模块级响应式变量临时持有。
import { ref, computed } from 'vue'

const files = ref<File[]>([])

export const pendingCount = computed(() => files.value.length)

export function setPendingFiles(f: File[]) {
  files.value = f
}

export function takePendingFiles(): File[] {
  const f = files.value
  files.value = []
  return f
}

export function clearPendingFiles() {
  files.value = []
}
