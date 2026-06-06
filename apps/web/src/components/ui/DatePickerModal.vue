<script setup lang="ts">
import { ref, computed } from 'vue'
import Modal from './Modal.vue'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

interface Props {
  show: boolean
  modelValue?: string
  title?: string
}

interface Emits {
  (e: 'close'): void
  (e: 'update:modelValue', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Select Date'
})

const emit = defineEmits<Emits>()

const currentMonth = ref(new Date())
const selectedDate = ref<Date | null>(null)

// Initialize selected date from modelValue
if (props.modelValue) {
  try {
    selectedDate.value = new Date(props.modelValue)
    currentMonth.value = new Date(selectedDate.value.getFullYear(), selectedDate.value.getMonth(), 1)
  } catch {
    selectedDate.value = null
  }
}

const monthName = computed(() => {
  return currentMonth.value.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  })
})

const daysInMonth = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()
  
  const days = []
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null)
  }
  
  // Add days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day))
  }
  
  return days
})

function handleDateSelect(date: Date) {
  selectedDate.value = date
  const isoString = date.toISOString().split('T')[0] || ''
  emit('update:modelValue', isoString)
  emit('close')
}

function previousMonth() {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() - 1, 1)
}

function nextMonth() {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + 1, 1)
}

function isToday(date: Date) {
  const today = new Date()
  return date.toDateString() === today.toDateString()
}

function isSelected(date: Date) {
  if (!selectedDate.value) return false
  return date.toDateString() === selectedDate.value.toDateString()
}

function goToToday() {
  const today = new Date()
  currentMonth.value = new Date(today.getFullYear(), today.getMonth(), 1)
  handleDateSelect(today)
}

function clearDate() {
  selectedDate.value = null
  emit('update:modelValue', '')
  emit('close')
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <Modal
    :show="show"
    :title="title"
    size="sm"
    @close="handleClose"
  >
    <div class="date-picker-modal">
      <!-- Calendar Header -->
      <div class="calendar-header">
        <button type="button" class="nav-btn" @click="previousMonth">
          <ChevronLeft :size="18" />
        </button>
        <h3 class="month-title">{{ monthName }}</h3>
        <button type="button" class="nav-btn" @click="nextMonth">
          <ChevronRight :size="18" />
        </button>
      </div>
      
      <!-- Calendar Grid -->
      <div class="calendar-grid">
        <!-- Weekday Headers -->
        <div class="weekday-header">
          <div class="weekday">Su</div>
          <div class="weekday">Mo</div>
          <div class="weekday">Tu</div>
          <div class="weekday">We</div>
          <div class="weekday">Th</div>
          <div class="weekday">Fr</div>
          <div class="weekday">Sa</div>
        </div>
        
        <!-- Days Grid -->
        <div class="days-grid">
          <button
            v-for="(day, index) in daysInMonth"
            :key="index"
            type="button"
            :class="[
              'day-btn',
              {
                'is-today': day && isToday(day),
                'is-selected': day && isSelected(day),
                'is-empty': !day
              }
            ]"
            :disabled="!day"
            @click="day && handleDateSelect(day)"
          >
            {{ day ? day.getDate() : '' }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- Footer Actions -->
    <template #footer>
      <Button variant="ghost" @click="clearDate">
        Clear
      </Button>
      <Button @click="goToToday">
        Today
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.date-picker-modal { padding: 10px 0; }
.calendar-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.nav-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: none; background: transparent; color: var(--color-muted-foreground); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease; }
.nav-btn:hover { background: rgba(99, 102, 241, 0.1); color: var(--color-accent); }
.month-title { font-size: 16px; font-weight: 600; color: var(--color-foreground); margin: 0; }
.calendar-grid { margin-bottom: 16px; }
.weekday-header { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 12px; }
.weekday { text-align: center; font-size: 12px; font-weight: 600; color: var(--color-muted-foreground); padding: 8px 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.days-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.day-btn { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: none; background: transparent; color: var(--color-muted-foreground); border-radius: var(--radius-md); cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s ease; }
.day-btn:hover:not(:disabled):not(.is-empty) { background: rgba(99, 102, 241, 0.1); color: var(--color-accent); transform: scale(1.05); }
.day-btn.is-today { background: rgba(99, 102, 241, 0.15); color: var(--color-accent); font-weight: 600; border: 1px solid rgba(99, 102, 241, 0.3); }
.day-btn.is-selected { background: var(--color-accent); color: var(--color-background); font-weight: 600; }
.day-btn.is-selected:hover { background: #4f46e5; transform: scale(1.05); }
.day-btn.is-empty { cursor: default; opacity: 0; pointer-events: none; }
</style>