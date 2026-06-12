import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Group {
  groupId: string
  name: string
  ownerDeviceId: string
  ownerName?: string
  createdAt: number
}

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref<Group[]>([])

  function setGroups(list: Group[]) {
    groups.value = list
  }

  function addGroup(group: Group) {
    if (!groups.value.some(g => g.groupId === group.groupId)) {
      groups.value.push(group)
    }
  }

  return {
    groups,
    setGroups,
    addGroup
  }
})
