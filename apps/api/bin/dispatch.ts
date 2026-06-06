#!/usr/bin/env bun
// bin/dispatch.ts - Dispatch CLI Tool
// Usage: bun run bin/dispatch.ts <command> [options]

const API_URL = process.env.DISPATCH_API_URL || 'http://localhost:3000'
const API_KEY = process.env.DISPATCH_API_KEY || ''

// ============================================================================
// HTTP Client
// ============================================================================

async function request(method: string, path: string, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const json = await res.json()

  if (!json.success) {
    throw new Error(json.message || `Request failed: ${res.status}`)
  }

  return json.data || json
}

// ============================================================================
// Commands
// ============================================================================

const commands: Record<string, {
  description: string
  usage: string
  handler: (args: string[]) => Promise<void>
}> = {
  send: {
    description: 'Send emails using a template and list',
    usage: 'dispatch send --template=<id> --list=<id> [--subject="..."] [--from="name <email>"]',
    handler: async (args) => {
      const opts = parseArgs(args)

      if (!opts.template && !opts.subject) {
        console.error('Error: --template or --subject required')
        process.exit(1)
      }

      console.log('Sending emails...')
      const result = await request('POST', '/send', {
        template_id: opts.template,
        list_id: opts.list,
        subject: opts.subject,
        from_name: opts['from-name'],
        from_email: opts['from-email'],
      })

      console.log(`✅ ${result.message || 'Send initiated'}`)
      if (result.jobId) console.log(`   Job ID: ${result.jobId}`)
    },
  },

  templates: {
    description: 'Manage email templates',
    usage: 'dispatch templates <list|get|create|delete> [options]',
    handler: async (args) => {
      const subcommand = args[0] || 'list'
      const opts = parseArgs(args.slice(1))

      switch (subcommand) {
        case 'list': {
          const data = await request('GET', `/templates?limit=${opts.limit || 50}`)
          const templates = data.templates || data || []
          if (templates.length === 0) {
            console.log('No templates found.')
            return
          }
          console.log(`\n${'ID'.padEnd(30)} ${'Name'.padEnd(25)} ${'Category'.padEnd(15)} Updated`)
          console.log('─'.repeat(90))
          for (const t of templates) {
            console.log(`${t.id.padEnd(30)} ${(t.name || '').padEnd(25)} ${(t.category || '').padEnd(15)} ${t.updated_at || ''}`)
          }
          console.log(`\n${templates.length} template(s)`)
          break
        }
        case 'get': {
          if (!opts.id) { console.error('--id required'); process.exit(1) }
          const t = await request('GET', `/templates/${opts.id}`)
          console.log(JSON.stringify(t, null, 2))
          break
        }
        case 'delete': {
          if (!opts.id) { console.error('--id required'); process.exit(1) }
          await request('DELETE', `/templates/${opts.id}`)
          console.log('✅ Template deleted')
          break
        }
        default:
          console.error(`Unknown subcommand: ${subcommand}`)
      }
    },
  },

  campaigns: {
    description: 'Manage campaigns',
    usage: 'dispatch campaigns <list|get|status|launch|pause|cancel> [options]',
    handler: async (args) => {
      const subcommand = args[0] || 'list'
      const opts = parseArgs(args.slice(1))

      switch (subcommand) {
        case 'list': {
          const data = await request('GET', `/campaigns?limit=${opts.limit || 20}`)
          const campaigns = data.campaigns || data || []
          if (campaigns.length === 0) {
            console.log('No campaigns found.')
            return
          }
          console.log(`\n${'ID'.padEnd(30)} ${'Name'.padEnd(25)} ${'Status'.padEnd(12)} ${'Sent'.padEnd(8)} Progress`)
          console.log('─'.repeat(95))
          for (const c of campaigns) {
            const total = c.total_recipients || 0
            const pct = total > 0 ? Math.round((c.sent_count / total) * 100) : 0
            console.log(`${c.id.padEnd(30)} ${(c.name || '').padEnd(25)} ${(c.status || '').padEnd(12)} ${String(c.sent_count || 0).padEnd(8)} ${pct}%`)
          }
          console.log(`\n${campaigns.length} campaign(s)`)
          break
        }
        case 'status':
        case 'get': {
          if (!opts.id) { console.error('--id required'); process.exit(1) }
          const c = await request('GET', `/campaigns/${opts.id}`)
          console.log(JSON.stringify(c, null, 2))
          break
        }
        case 'launch': {
          if (!opts.id) { console.error('--id required'); process.exit(1) }
          await request('POST', `/campaigns/${opts.id}/launch`)
          console.log('✅ Campaign launched')
          break
        }
        case 'pause': {
          if (!opts.id) { console.error('--id required'); process.exit(1) }
          await request('POST', `/campaigns/${opts.id}/pause`)
          console.log('✅ Campaign paused')
          break
        }
        case 'cancel': {
          if (!opts.id) { console.error('--id required'); process.exit(1) }
          await request('POST', `/campaigns/${opts.id}/cancel`)
          console.log('✅ Campaign cancelled')
          break
        }
        default:
          console.error(`Unknown subcommand: ${subcommand}`)
      }
    },
  },

  contacts: {
    description: 'Manage contacts',
    usage: 'dispatch contacts <lists|import|search> [options]',
    handler: async (args) => {
      const subcommand = args[0] || 'lists'
      const opts = parseArgs(args.slice(1))

      switch (subcommand) {
        case 'lists': {
          const data = await request('GET', '/contacts/lists')
          const lists = data.lists || data || []
          if (lists.length === 0) {
            console.log('No contact lists found.')
            return
          }
          console.log(`\n${'ID'.padEnd(30)} ${'Name'.padEnd(25)} Contacts`)
          console.log('─'.repeat(70))
          for (const l of lists) {
            console.log(`${l.id.padEnd(30)} ${(l.name || '').padEnd(25)} ${l.contact_count || 0}`)
          }
          break
        }
        case 'import': {
          if (!opts.file || !opts.list) {
            console.error('--file and --list required')
            process.exit(1)
          }

          const file = Bun.file(opts.file)
          if (!await file.exists()) {
            console.error(`File not found: ${opts.file}`)
            process.exit(1)
          }

          const formData = new FormData()
          formData.append('file', file)

          const res = await fetch(`${API_URL}/contacts/${opts.list}/import`, {
            method: 'POST',
            headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
            body: formData,
          })

          const json = await res.json()
          if (!json.success) throw new Error(json.message || 'Import failed')

          const result = json.data || json
          console.log(`✅ Import complete: ${result.imported} imported, ${result.duplicates} duplicates, ${result.invalid} invalid`)
          break
        }
        case 'search': {
          const q = opts.q || args[1]
          if (!q) { console.error('Search query required'); process.exit(1) }
          const data = await request('GET', `/contacts/search?q=${encodeURIComponent(q)}`)
          const contacts = data.contacts || data || []
          console.log(`Found ${contacts.length} contact(s)`)
          for (const c of contacts) {
            console.log(`  ${c.email} — ${c.first_name || ''} ${c.last_name || ''} (${c.status})`)
          }
          break
        }
        default:
          console.error(`Unknown subcommand: ${subcommand}`)
      }
    },
  },

  queue: {
    description: 'View job queue status',
    usage: 'dispatch queue [status]',
    handler: async (args) => {
      const status = args[0]
      const params = status ? `?status=${status}` : ''
      const data = await request('GET', `/queue/jobs${params}`)
      const jobs = data || []

      if (jobs.length === 0) {
        console.log('No jobs in queue.')
        return
      }

      console.log(`\n${'ID'.padEnd(30)} ${'Status'.padEnd(12)} ${'Subject'.padEnd(30)} Progress`)
      console.log('─'.repeat(85))
      for (const j of jobs) {
        console.log(`${j.id.padEnd(30)} ${(j.status || '').padEnd(12)} ${(j.subject || '').substring(0, 28).padEnd(30)} ${j.sent_count}/${j.total_count}`)
      }
    },
  },

  stats: {
    description: 'Show dashboard stats',
    usage: 'dispatch stats',
    handler: async () => {
      const data = await request('GET', '/dashboard/stats')
      const stats = data.stats || data

      console.log('\n📊 Dispatch Stats')
      console.log('─'.repeat(40))
      console.log(`  Total emails: ${stats.total || 0}`)
      console.log(`  Sent:         ${stats.sent || 0}`)
      console.log(`  Failed:       ${stats.failed || 0}`)
      if (stats.opened !== undefined) console.log(`  Opened:       ${stats.opened} (${stats.openRate || 0}%)`)
      if (stats.clicked !== undefined) console.log(`  Clicked:      ${stats.clicked} (${stats.clickRate || 0}%)`)
    },
  },

  analytics: {
    description: 'View analytics summary',
    usage: 'dispatch analytics [--campaign=<id>] [--export=csv|json]',
    handler: async (args) => {
      const opts = parseArgs(args)

      if (opts.campaign) {
        const report = await request('GET', `/analytics/campaigns/${opts.campaign}`)
        console.log(JSON.stringify(report, null, 2))
      } else if (opts.export) {
        const format = opts.export === 'csv' ? 'csv' : 'json'
        const res = await fetch(`${API_URL}/analytics/export/summary?format=${format}`, {
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
        })
        const text = await res.text()
        console.log(text)
      } else {
        const summary = await request('GET', '/analytics/summary')
        console.log('\n📈 Analytics Summary')
        console.log('─'.repeat(40))
        console.log(`  Campaigns:      ${summary.total_campaigns || 0}`)
        console.log(`  Emails sent:    ${summary.total_emails_sent || 0}`)
        console.log(`  Avg open rate:  ${summary.avg_open_rate || 0}%`)
        console.log(`  Avg click rate: ${summary.avg_click_rate || 0}%`)
        if (summary.best_send_time) {
          console.log(`  Best send time: ${summary.best_send_time.best_day} at ${summary.best_send_time.best_hour}:00`)
        }
      }
    },
  },

  health: {
    description: 'Check API health',
    usage: 'dispatch health',
    handler: async () => {
      const res = await fetch(`${API_URL}/health`)
      const json = await res.json()
      console.log(`Status: ${json.status}`)
      console.log(`Version: ${json.version}`)
      console.log(`Time: ${json.timestamp}`)
    },
  },

  help: {
    description: 'Show this help message',
    usage: 'dispatch help',
    handler: async () => {
      printHelp()
    },
  },
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, ...valueParts] = arg.substring(2).split('=')
      result[key] = valueParts.join('=') || 'true'
    }
  }
  return result
}

// ============================================================================
// Help
// ============================================================================

function printHelp() {
  console.log(`
  Dispatch CLI — Bulk Email Campaign Platform

  Usage: bun run bin/dispatch.ts <command> [options]

  Environment:
    DISPATCH_API_URL   API base URL (default: http://localhost:3000)
    DISPATCH_API_KEY   API key for authentication

  Commands:
`)

  for (const [name, cmd] of Object.entries(commands)) {
    console.log(`    ${name.padEnd(14)} ${cmd.description}`)
    console.log(`    ${''.padEnd(14)} ${cmd.usage}`)
    console.log()
  }

  console.log(`  Examples:
    bun run bin/dispatch.ts health
    bun run bin/dispatch.ts templates list
    bun run bin/dispatch.ts campaigns list
    bun run bin/dispatch.ts contacts import --file=leads.csv --list=lst_123
    bun run bin/dispatch.ts stats
    bun run bin/dispatch.ts analytics --export=csv
`)
}

// ============================================================================
// Stdin Pipe Support
// ============================================================================

async function handlePipeInput(): Promise<string | null> {
  if (process.stdin.isTTY) return null

  const chunks: Uint8Array[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf-8').trim()
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const commandName = args[0]

  if (!commandName || commandName === 'help' || commandName === '--help' || commandName === '-h') {
    printHelp()
    return
  }

  const command = commands[commandName]
  if (!command) {
    console.error(`Unknown command: ${commandName}`)
    console.error('Run "dispatch help" for available commands.')
    process.exit(1)
  }

  try {
    // Check for pipe input
    const pipeInput = await handlePipeInput()
    const commandArgs = args.slice(1)

    if (pipeInput && commandName === 'send') {
      // Pipe support: cat emails.csv | dispatch send
      commandArgs.push(`--pipe-data=${pipeInput}`)
    }

    await command.handler(commandArgs)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

main()
