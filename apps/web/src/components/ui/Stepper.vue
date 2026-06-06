<script setup lang="ts">
import { Check } from 'lucide-vue-next'

const props = defineProps<{
  steps: Array<{ label: string; completed?: boolean; active?: boolean }>
  currentStep: number
}>()

const emit = defineEmits<{
  (e: 'step-click', index: number): void
}>()

function handleClick(idx: number) {
  // Allow clicking on completed steps or the current step
  if (idx < props.currentStep || props.steps[idx]?.completed) {
    emit('step-click', idx)
  }
}

function isClickable(idx: number): boolean {
  return idx < props.currentStep || !!props.steps[idx]?.completed
}
</script>

<template>
  <div class="stepper">
    <div
      v-for="(step, idx) in steps"
      :key="idx"
      class="stepper__step"
      :class="{
        'stepper__step--completed': step.completed || idx < currentStep,
        'stepper__step--active': idx === currentStep,
        'stepper__step--clickable': isClickable(idx),
      }"
      @click="handleClick(idx)"
    >
      <div class="stepper__indicator">
        <Check v-if="step.completed || idx < currentStep" :size="14" />
        <span v-else>{{ idx + 1 }}</span>
      </div>
      <span class="stepper__label">{{ step.label }}</span>
      <div v-if="idx < steps.length - 1" class="stepper__connector" />
    </div>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
  gap: 0;
}
.stepper__step {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  position: relative;
}
.stepper__step--clickable {
  cursor: pointer;
}
.stepper__step--clickable:hover .stepper__indicator {
  transform: scale(1.1);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}
.stepper__indicator {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-muted);
  color: var(--color-muted-foreground);
  border: 2px solid var(--color-border);
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.stepper__step--active .stepper__indicator {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}
.stepper__step--completed .stepper__indicator {
  background: var(--color-success);
  border-color: var(--color-success);
  color: #fff;
}
.stepper__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted-foreground);
  white-space: nowrap;
}
.stepper__step--active .stepper__label {
  color: var(--color-foreground);
  font-weight: 600;
}
.stepper__step--completed .stepper__label {
  color: var(--color-muted-foreground);
}
.stepper__connector {
  flex: 1;
  height: 2px;
  background: var(--color-border);
  margin: 0 8px;
  min-width: 20px;
}
.stepper__step--completed .stepper__connector {
  background: var(--color-success);
}
</style>
