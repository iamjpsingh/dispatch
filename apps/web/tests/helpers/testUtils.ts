import { mount, VueWrapper } from '@vue/test-utils'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { vi } from 'vitest'

// Common stubs for lucide icons
export const iconStub = {
  template: '<svg />',
}

// Create a mock router for testing
export function createMockRouter(routes?: RouteRecordRaw[]) {
  return createRouter({
    history: createWebHistory(),
    routes: routes || [
      { path: '/', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  })
}

// Mock the api module
export function mockApi() {
  return {
    get: vi.fn().mockResolvedValue({ success: true, data: null }),
    post: vi.fn().mockResolvedValue({ success: true, data: null }),
    put: vi.fn().mockResolvedValue({ success: true, data: null }),
    delete: vi.fn().mockResolvedValue({ success: true, data: null }),
  }
}

// Global stubs that most component tests need
export const globalStubs = {
  // Stub all lucide icons
  stubs: {
    teleport: true,
  },
}
