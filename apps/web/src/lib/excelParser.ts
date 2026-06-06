/**
 * Excel/CSV parsing utility for contact file uploads.
 * Extracts contacts from uploaded spreadsheet files.
 */

export interface ParsedContact {
  [key: string]: any
}

export interface ParseResult {
  contacts: ParsedContact[]
  columns: string[]
}

/**
 * Parse an Excel or CSV file and extract contacts with column headers.
 * Uses the xlsx library with a CSV fallback.
 */
export async function parseExcelFile(file: File): Promise<ParseResult> {
  try {
    const XLSX = await import('xlsx')
    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      throw new Error('No sheets found in workbook')
    }
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) {
      throw new Error('Worksheet not found')
    }
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]

    if (jsonData.length < 2) {
      throw new Error('File must have at least a header row and one data row')
    }

    const headerRow = jsonData[0]
    if (!headerRow) {
      throw new Error('No header row found')
    }
    const headers = headerRow.map((h: any) => String(h).trim())

    const parsedContacts: ParsedContact[] = []
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i]
      if (!row || row.length === 0) continue

      const contact: ParsedContact = {}
      headers.forEach((header, index) => {
        contact[header] = row[index] !== undefined ? String(row[index]).trim() : ''
      })

      const hasEmail = Object.values(contact).some((v) => typeof v === 'string' && v.includes('@'))
      if (hasEmail || Object.values(contact).some((v) => v)) {
        parsedContacts.push(contact)
      }
    }

    return { contacts: parsedContacts, columns: headers }
  } catch (err) {
    console.error('Error parsing file:', err)
    // Fallback to simple CSV parsing
    return parseCsvFallback(file)
  }
}

async function parseCsvFallback(file: File): Promise<ParseResult> {
  const text = await file.text()
  const lines = text.split('\n').filter((l) => l.trim())

  if (lines.length < 2) {
    return { contacts: [], columns: [] }
  }

  const headerLine = lines[0]
  if (!headerLine) {
    return { contacts: [], columns: [] }
  }

  const headers = headerLine.split(',').map((h) => h.trim())
  const parsedContacts: ParsedContact[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const values = line.split(',')
    const contact: ParsedContact = {}
    headers.forEach((header, index) => {
      contact[header] = values[index]?.trim() || ''
    })
    parsedContacts.push(contact)
  }

  return { contacts: parsedContacts, columns: headers }
}

/**
 * Find the email field value from a contact record (handles various column name conventions).
 */
export function getContactEmail(contact: Record<string, any>): string {
  const emailKeys = ['Email', 'email', 'EMAIL', 'E-mail', 'e-mail', 'EmailAddress', 'email_address']
  for (const key of emailKeys) {
    if (contact[key] && contact[key].includes('@')) {
      return contact[key]
    }
  }
  // Fallback: find any field with @ symbol
  for (const value of Object.values(contact)) {
    if (typeof value === 'string' && value.includes('@')) {
      return value
    }
  }
  return ''
}

/**
 * Find the name field value from a contact record (handles various column name conventions).
 */
export function getContactName(contact: Record<string, any>): string {
  if (contact.FirstName) {
    return `${contact.FirstName} ${contact.LastName || ''}`.trim()
  }
  if (contact.Name) return contact.Name
  if (contact.name) return contact.name
  if (contact.FullName) return contact.FullName
  if (contact.full_name) return contact.full_name
  return ''
}

/**
 * Replace {{placeholder}} tokens in text with values from a contact record.
 */
export function replacePlaceholders(text: string, contact: Record<string, any>): string {
  if (!text) return ''
  let result = text
  for (const [key, value] of Object.entries(contact)) {
    const placeholder = `{{${key}}}`
    result = result.split(placeholder).join(value || '')
  }
  return result
}
