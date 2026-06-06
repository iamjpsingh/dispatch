import * as XLSX from 'xlsx'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { logger } from '../utils/logger'
import { isValidEmail } from '../utils/validation'
import type { Contact } from '../types/index'

export class FileService {
  static async parseExcelFile(filePath: string): Promise<Contact[]> {
    try {
      logger.debug(`Parsing Excel file: ${filePath}`)

      if (!existsSync(filePath)) {
        throw new Error('File does not exist')
      }

      const workbook = XLSX.readFile(filePath)
      const sheetName = workbook.SheetNames[0]

      if (!sheetName) {
        throw new Error('No sheets found in Excel file')
      }

      const worksheet = workbook.Sheets[sheetName]

      // Convert to JSON with header option
      const data = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
      }) as any[][]

      if (data.length < 2) {
        throw new Error('Excel file must have at least a header row and one data row')
      }

      // Get headers from first row
      const headers = data[0]
      logger.debug('Excel headers:', headers)

      // Find Email column (case insensitive)
      const emailColumnIndex = headers.findIndex(
        (header: string) => typeof header === 'string' && header.toLowerCase().includes('email')
      )

      if (emailColumnIndex === -1) {
        throw new Error('No Email column found. Please ensure your Excel file has an "Email" column.')
      }

      // Convert data rows to contact objects
      const contacts: Contact[] = []

      for (let i = 1; i < data.length; i++) {
        const row = data[i]

        if (!row || row.length === 0) {
          continue // Skip empty rows
        }

        const contact: Contact = {
          Email: '',
        }

        // Map each column to contact properties
        headers.forEach((header: string, index: number) => {
          if (typeof header === 'string' && header.trim() !== '') {
            const cleanHeader = header.trim()
            const value = row[index] ? String(row[index]).trim() : ''

            // Store with ORIGINAL column name exactly as in Excel
            contact[cleanHeader] = value

            // Set Email field for validation (find any email-like column)
            if (cleanHeader.toLowerCase().includes('email') && value.includes('@')) {
              contact.Email = value
            }
          }
        })

        // Only include contacts with valid email addresses
        if (contact.Email && isValidEmail(contact.Email)) {
          contacts.push(contact)
        } else {
          logger.debug(`Skipping row ${i + 1}: Invalid or missing email (${contact.Email})`)
        }
      }

      logger.debug(`Successfully parsed ${contacts.length} valid contacts`)

      if (contacts.length === 0) {
        throw new Error('No valid email addresses found in the Excel file')
      }

      return contacts
    } catch (error) {
      logger.error('Excel parsing error:', error)
      if (error instanceof Error) {
        throw new Error(`Failed to parse Excel file: ${error.message}`)
      } else {
        throw new Error('Failed to parse Excel file: Unknown error')
      }
    }
  }

  static async saveUploadedFile(file: Uint8Array, filename: string): Promise<string> {
    try {
      // Ensure uploads directory exists
      const uploadDir = './uploads'
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true })
      }

      const uploadPath = `${uploadDir}/${filename}`
      await writeFile(uploadPath, file)
      logger.debug(`File saved: ${uploadPath}`)
      return uploadPath
    } catch (error) {
      logger.error('File save error:', error)
      throw new Error(`Failed to save uploaded file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  static async readHTMLTemplate(filePath: string): Promise<string> {
    try {
      if (!existsSync(filePath)) {
        throw new Error('HTML template file does not exist')
      }

      const content = await readFile(filePath, 'utf-8')
      logger.debug(`HTML template loaded: ${filePath} (${content.length} characters)`)
      return content
    } catch (error) {
      logger.error('HTML template read error:', error)
      throw new Error(`Failed to read HTML template: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  static replacePlaceholders(template: string, contact: Contact): string {
    if (!template || !contact) {
      return template || ''
    }

    let result = template

    // Process dynamic content blocks first: {{#smart}} ... {{/smart}}
    result = FileService.processDynamicBlocks(result, contact)

    // Replace placeholders with exact key match
    // Match {{anything}} pattern
    result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (contact[key] !== undefined) {
        return String(contact[key] || '')
      }
      return match
    })

    return result
  }

  /**
   * Process dynamic content blocks.
   * Syntax:
   *   {{#smart}}
   *     {{#when field "country" equals "US"}} ... {{/when}}
   *     {{#when field "tags" contains "VIP"}} ... {{/when}}
   *     {{#default}} ... {{/default}}
   *   {{/smart}}
   */
  static processDynamicBlocks(template: string, contact: Contact): string {
    return template.replace(
      /\{\{#smart\}\}([\s\S]*?)\{\{\/smart\}\}/g,
      (_match, blockContent: string) => {
        // Extract {{#when ...}} ... {{/when}} blocks
        const whenRegex = /\{\{#when\s+field\s+"(\w+)"\s+(\w+)\s+"([^"]+)"\}\}([\s\S]*?)\{\{\/when\}\}/g
        let whenMatch: RegExpExecArray | null
        while ((whenMatch = whenRegex.exec(blockContent)) !== null) {
          const [, field, operator, value, content] = whenMatch
          if (FileService.evaluateFieldCondition(contact, field, operator, value)) {
            return content.trim()
          }
        }

        // Fall back to {{#default}} ... {{/default}}
        const defaultMatch = blockContent.match(/\{\{#default\}\}([\s\S]*?)\{\{\/default\}\}/)
        if (defaultMatch) {
          return defaultMatch[1].trim()
        }

        return '' // No match, remove block
      }
    )
  }

  private static evaluateFieldCondition(contact: Contact, field: string, operator: string, value: string): boolean {
    const contactValue = String(contact[field] || '')

    switch (operator) {
      case 'equals': return contactValue.toLowerCase() === value.toLowerCase()
      case 'not_equals': return contactValue.toLowerCase() !== value.toLowerCase()
      case 'contains': return contactValue.toLowerCase().includes(value.toLowerCase())
      case 'not_contains': return !contactValue.toLowerCase().includes(value.toLowerCase())
      case 'starts_with': return contactValue.toLowerCase().startsWith(value.toLowerCase())
      case 'ends_with': return contactValue.toLowerCase().endsWith(value.toLowerCase())
      case 'greater_than': return Number(contactValue) > Number(value)
      case 'less_than': return Number(contactValue) < Number(value)
      case 'exists': return contactValue !== '' && contactValue !== 'undefined'
      case 'not_exists': return contactValue === '' || contactValue === 'undefined'
      default: return false
    }
  }
}
