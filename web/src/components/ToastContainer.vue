<script setup lang="ts">
import { useToast } from '../composables/useToast'
import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-vue-next'

const { toasts, remove } = useToast()

const iconMap = {
  success: CircleCheck,
  error: CircleX,
  info: Info,
  warning: TriangleAlert,
}
</script>

<template>
  <div class="toast-container">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="t.type"
        role="alert"
        @click="remove(t.id)"
      >
        <component :is="iconMap[t.type]" :size="18" class="toast-icon" />
        <span class="toast-msg">{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: calc(var(--topbar-h) + 12px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: none;
  width: max-content;
  max-width: 90vw;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lg);
  font-size: 0.88rem;
  cursor: pointer;
  pointer-events: auto;
  max-width: 100%;
}

.toast-icon {
  flex-shrink: 0;
}

.toast-msg {
  word-break: break-word;
}

.toast.success .toast-icon { color: var(--color-success); }
.toast.error .toast-icon { color: var(--color-danger); }
.toast.warning .toast-icon { color: var(--color-warning); }
.toast.info .toast-icon { color: var(--color-primary); }

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
