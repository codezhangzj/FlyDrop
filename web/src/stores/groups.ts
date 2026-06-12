import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Group {
  groupId: string
  name: string
  ownerDeviceId: string
  ownerName?: string
  createdAt: number
}

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref<Group[]>([])
  // 各群未读消息数（按 groupId）
  const unread = ref<Record<string, number>>({})
  // 当前正在查看的群（在该群内收到消息不计未读）
  const activeGroupId = ref<string | null>(null)

  function setGroups(list: Group[]) {
    groups.value = list
  }

  function addGroup(group: Group) {
    if (!groups.value.some(g => g.groupId === group.groupId)) {
      groups.value.push(group)
    }
  }

  function has(groupId: string) {
    return groups.value.some(g => g.groupId === groupId)
  }

  // 收到群消息时累加未读（正在查看的群不计）
  function incUnread(groupId: string) {
    if (activeGroupId.value === groupId) return
    unread.value[groupId] = (unread.value[groupId] ?? 0) + 1
  }

  function markRead(groupId: string) {
    if (unread.value[groupId]) unread.value[groupId] = 0
  }

  function setActiveGroup(groupId: string | null) {
    activeGroupId.value = groupId
    if (groupId) markRead(groupId)
  }

  function unreadFor(groupId: string) {
    return unread.value[groupId] ?? 0
  }

  const totalUnread = computed(() =>
    Object.values(unread.value).reduce((s, n) => s + n, 0)
  )

  return {
    groups,
    unread,
    activeGroupId,
    setGroups,
    addGroup,
    has,
    incUnread,
    markRead,
    setActiveGroup,
    unreadFor,
    totalUnread,
  }
})
