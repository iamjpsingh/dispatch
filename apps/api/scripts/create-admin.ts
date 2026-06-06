#!/usr/bin/env bun
/**
 * Create Super Admin
 * Usage: bun run create-admin
 *
 * Creates the first platform super admin via terminal.
 * This must be run before any user can register.
 */
import { initDatabase } from '../src/db'
import { authLocalService } from '../src/services/authLocalService'

// Initialize database (runs migrations if needed)
initDatabase()

console.log('\n--- Create Platform Super Admin ---\n')

const email = prompt('Email: ')
if (!email?.trim()) {
  console.error('Email is required')
  process.exit(1)
}

const name = prompt('Name: ')
if (!name?.trim()) {
  console.error('Name is required')
  process.exit(1)
}

const password = prompt('Password (min 8 chars): ')
if (!password || password.length < 8) {
  console.error('Password must be at least 8 characters')
  process.exit(1)
}

// Check if user already exists
const existing = authLocalService.getUserByEmail(email.trim())
if (existing) {
  if (existing.is_platform_admin) {
    console.log(`\n${email} is already a platform admin.`)
  } else {
    authLocalService.promoteToPlatformAdmin(existing.id)
    console.log(`\nPromoted existing user ${email} to platform admin.`)
  }
  process.exit(0)
}

// Create platform admin
const admin = await authLocalService.createPlatformAdmin(email.trim(), password, name.trim())
if (!admin) {
  console.error('\nFailed to create admin. Email may already be in use.')
  process.exit(1)
}

console.log(`\nPlatform admin created successfully!`)
console.log(`  Email: ${admin.email}`)
console.log(`  Name:  ${admin.name}`)
console.log(`  ID:    ${admin.id}`)
console.log(`\nYou can now start the server with: bun run dev`)
console.log(`Login at http://localhost:5173/login\n`)
