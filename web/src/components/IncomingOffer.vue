<script setup lang="ts">
import { computed } from 'vue'
import { useTransfersStore } from '../stores/transfers'
import { wsClient } from '../services/ws'
import { useToast } from '../composables/useToast'
import { formatSize } from '../services/format'
import { Download, X, FileText, Image as ImageIcon } from 'lucide-vue-next'

const store = useTransfersStore()
const toast = useToast()

// 当前待确认的第一个传输
const current = computed(() => store.awaitingTransfers[0] ?? null)

function accept() {
  const t = current.value
  if (!t) return
  wsClient.send({ type: 'transfer:accept', payload: { transferId: t.transferId } })
  store.onAccepted(t.transferId)
  toast.success('已接受，开始接收')
}

function reject() {
  const t = current.value
  if (!t) return
  wsClient.send({ type: 'transfer:reject', payload: { transferId: t.transferId } })
  store.onReject(t.transferId)
  toast.info('已拒绝')
}
</script>

<template>
  <transition name="modal">
    <div v-if="current" class="overlay">
      <div class="dialog card">
        <div class="dialog-head">
          <span class="from">{{ current.peerName || '未知设备' }}</span>
          <span class="sub">想要发送 {{ current.files.length }} 个文件（{{ formatSize(current.totalBytes) }}）</span>
        </div>

        <div class="file-list">
          <div v-for="f in current.files.slice(0, 5)" :key="f.fileId" class="file-row">
            <ImageIcon v-if="f.mime.startsWith('image/')" :size="16" class="ficon" />
            <FileText v-else :size="16" class="ficon" />
            <span class="fname">{{ f.name }}</span>
            <span class="fsize">{{ formatSize(f.size) }}</span>
          </div>
          <div v-if="current.files.length > 5" class="more">
            还有 {{ current.files.length - 5 }} 个文件…
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary" @click="reject">
            <X :size="16" /> 拒绝
          </button>
          <button class="btn btn-primary" @click="accept">
            <Download :size="16" /> 接受
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}

.dialog {
  width: 100%;
  max-width: 380px;
}

.dialog-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}

.from {
  font-size: 1.05rem;
  font-weight: 700;
}

.sub {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-bg);
  border-radius: var(--radius-sm);
}

.ficon {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.fname {
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fsize {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.more {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  padding-left: 8px;
}

.actions {
  display: flex;
  gap: 10px;
}

.actions .btn {
  flex: 1;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active .dialog,
.modal-leave-active .dialog {
  transition: transform 0.2s ease;
}
.modal-enter-from .dialog,
.modal-leave-to .dialog {
  transform: scale(0.92);
}
</style>
