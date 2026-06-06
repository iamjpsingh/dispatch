<script setup lang="ts">
import { ref, computed } from 'vue'
import Modal from './Modal.vue'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-vue-next'

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
  title: 'Select Date & Time'
})

const emit = defineEmits<Emits>()

const currentMonth = ref(new Date())
const selectedDate = ref<Date | null>(null)
const selectedHour = ref(12)
const selectedMinute = ref(0)
const selectedPeriod = ref<'AM' | 'PM'>('PM')

// Initialize from modelValue
if (props.modelValue) {
  try {
    const date = new Date(props.modelValue)
    selectedDate.value = date
    currentMonth.value = new Date(date.getFullYear(), date.getMonth(), 1)

    let hours = date.getHours()
    selectedPeriod.value = hours >= 12 ? 'PM' : 'AM'
    selectedHour.value = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    selectedMinute.value = date.getMinutes()
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
  const daysCount = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()

  const days: (Date | null)[] = []

  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null)
  }

  for (let day = 1; day <= daysCount; day++) {
    days.push(new Date(year, month, day))
  }

  return days
})

const timeDisplay = computed(() => {
  const hour = selectedHour.value.toString().padStart(2, '0')
  const minute = selectedMinute.value.toString().padStart(2, '0')
  return `${hour}:${minute}`
})

function handleDateSelect(date: Date) {
  selectedDate.value = date
}

function updateDateTime() {
  if (!selectedDate.value) return

  let hours = selectedHour.value
  if (selectedPeriod.value === 'PM' && hours !== 12) {
    hours += 12
  } else if (selectedPeriod.value === 'AM' && hours === 12) {
    hours = 0
  }

  const dateTime = new Date(selectedDate.value)
  dateTime.setHours(hours, selectedMinute.value, 0, 0)

  emit('update:modelValue', dateTime.toISOString().slice(0, 16))
}

function handleConfirm() {
  if (selectedDate.value) {
    updateDateTime()
  }
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

function setToNow() {
  const now = new Date()
  selectedDate.value = now
  currentMonth.value = new Date(now.getFullYear(), now.getMonth(), 1)

  let hours = now.getHours()
  selectedPeriod.value = hours >= 12 ? 'PM' : 'AM'
  selectedHour.value = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  selectedMinute.value = now.getMinutes()

  updateDateTime()
}

function clearDateTime() {
  selectedDate.value = null
  selectedHour.value = 12
  selectedMinute.value = 0
  selectedPeriod.value = 'PM'
  emit('update:modelValue', '')
  emit('close')
}

function handleClose() {
  emit('close')
}

function incrementHour() {
  selectedHour.value = selectedHour.value === 12 ? 1 : selectedHour.value + 1
}

function decrementHour() {
  selectedHour.value = selectedHour.value === 1 ? 12 : selectedHour.value - 1
}

function incrementMinute() {
  selectedMinute.value = selectedMinute.value === 59 ? 0 : selectedMinute.value + 1
}

function decrementMinute() {
  selectedMinute.value = selectedMinute.value === 0 ? 59 : selectedMinute.value - 1
}

function togglePeriod() {
  selectedPeriod.value = selectedPeriod.value === 'AM' ? 'PM' : 'AM'
}
</script>

<template>
  <Modal :show="show" :title="title" size="md" @close="handleClose">
    <div class="py-2">
      <!-- Calendar Section -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-5">
          <button
            type="button"
            class="flex items-center justify-center w-9 h-9 border-none bg-transparent text-muted-foreground rounded-lg cursor-pointer transition-all hover:bg-accent/10 hover:text-accent"
            @click="previousMonth"
          >
            <ChevronLeft :size="18" />
          </button>
          <h3 class="text-base font-semibold text-foreground m-0">{{ monthName }}</h3>
          <button
            type="button"
            class="flex items-center justify-center w-9 h-9 border-none bg-transparent text-muted-foreground rounded-lg cursor-pointer transition-all hover:bg-accent/10 hover:text-accent"
            @click="nextMonth"
          >
            <ChevronRight :size="18" />
          </button>
        </div>

        <div class="mb-4">
          <div class="grid grid-cols-7 gap-1 mb-3">
            <div
              v-for="day in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']"
              :key="day"
              class="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-2"
            >
              {{ day }}
            </div>
          </div>

          <div class="grid grid-cols-7 gap-1">
            <button
              v-for="(day, index) in daysInMonth"
              :key="index"
              type="button"
              class="flex items-center justify-center w-9 h-9 border-none bg-transparent text-muted-foreground rounded-lg cursor-pointer text-sm font-medium transition-all"
              :class="{
                'hover:bg-accent/10 hover:text-accent': day && !isSelected(day),
                'bg-accent/15 text-accent font-semibold border border-accent/30': day && isToday(day) && !isSelected(day),
                'bg-accent text-white font-semibold hover:bg-accent': day && isSelected(day),
                'opacity-0 pointer-events-none cursor-default': !day,
              }"
              :disabled="!day"
              @click="day && handleDateSelect(day)"
            >
              {{ day ? day.getDate() : '' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Time Section -->
      <div class="pt-5 border-t border-border">
        <div class="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
          <Clock :size="16" />
          <span>Time</span>
        </div>

        <div class="flex items-center justify-center gap-3 mb-4">
          <!-- Hour -->
          <div class="flex flex-col items-center gap-2">
            <button
              class="w-8 h-8 border-none bg-secondary text-foreground rounded-lg cursor-pointer text-base font-semibold transition-all hover:bg-accent hover:text-white"
              @click="incrementHour"
            >+</button>
            <div class="w-12 h-12 flex items-center justify-center bg-secondary border border-border rounded-lg text-lg font-semibold text-foreground font-mono">
              {{ selectedHour.toString().padStart(2, '0') }}
            </div>
            <button
              class="w-8 h-8 border-none bg-secondary text-foreground rounded-lg cursor-pointer text-base font-semibold transition-all hover:bg-accent hover:text-white"
              @click="decrementHour"
            >-</button>
          </div>

          <div class="text-2xl font-semibold text-foreground mx-2">:</div>

          <!-- Minute -->
          <div class="flex flex-col items-center gap-2">
            <button
              class="w-8 h-8 border-none bg-secondary text-foreground rounded-lg cursor-pointer text-base font-semibold transition-all hover:bg-accent hover:text-white"
              @click="incrementMinute"
            >+</button>
            <div class="w-12 h-12 flex items-center justify-center bg-secondary border border-border rounded-lg text-lg font-semibold text-foreground font-mono">
              {{ selectedMinute.toString().padStart(2, '0') }}
            </div>
            <button
              class="w-8 h-8 border-none bg-secondary text-foreground rounded-lg cursor-pointer text-base font-semibold transition-all hover:bg-accent hover:text-white"
              @click="decrementMinute"
            >-</button>
          </div>

          <!-- AM/PM -->
          <div class="flex flex-col items-center gap-2">
            <button
              class="w-12 h-12 border border-border bg-secondary text-foreground rounded-lg cursor-pointer text-sm font-semibold transition-all hover:bg-accent hover:text-white hover:border-accent"
              @click="togglePeriod"
            >
              {{ selectedPeriod }}
            </button>
          </div>
        </div>

        <div class="text-center text-xl font-semibold text-accent font-mono py-3 bg-accent/10 rounded-lg border border-accent/20">
          {{ timeDisplay }} {{ selectedPeriod }}
        </div>
      </div>
    </div>

    <!-- Footer Actions -->
    <template #footer>
      <Button variant="ghost" @click="clearDateTime">Clear</Button>
      <Button variant="secondary" @click="setToNow">Now</Button>
      <Button @click="handleConfirm" :disabled="!selectedDate">Confirm</Button>
    </template>
  </Modal>
</template>
