/**
 * Automation Flow Builder — Node Type Registry
 *
 * Inspired by Mautic (3-type event system: Action/Decision/Condition)
 * and n8n (Vue Flow canvas, side panel config, multi-handle nodes).
 *
 * 5 categories: Trigger, Action, Decision, Condition, Timing
 * Each node defines: handles, color, config fields, connection restrictions
 */

import { markRaw, type Component } from 'vue'
import BaseNode from './BaseNode.vue'
import {
  Workflow, Mail, Clock, GitBranch, Filter, Shuffle, Globe, Tag, Minus, UserCog,
  ArrowRightLeft, Zap, Square, MessageSquare, Bell, Eye, MousePointerClick,
  FormInput, Shield, Users, Hash, CheckCircle, XCircle, FileText, Timer,
  CalendarClock, Send, ArrowDown, Ban, Undo2, Megaphone,
} from 'lucide-vue-next'

// ============================================================================
// Types
// ============================================================================

export type NodeCategory = 'trigger' | 'action' | 'decision' | 'condition' | 'timing' | 'end'

export interface HandleDef {
  id: string
  label: string
  color: string
}

export interface NodeFieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'template-picker' | 'wa-template-picker' |
        'list-picker' | 'tag-picker' | 'field-picker' | 'operator-select' | 'duration' | 'datetime'
  placeholder?: string
  options?: { value: string; label: string }[]
  required?: boolean
  helpText?: string
}

export interface NodeTypeDef {
  label: string
  icon: Component
  color: string
  bgColor: string
  borderColor: string
  category: NodeCategory
  description: string
  // Handle configuration
  hasTargetHandle: boolean
  outputs: HandleDef[]
  // Config fields for the side panel
  fields: NodeFieldDef[]
  // Connection restrictions: this node can only follow nodes of these types
  connectionRestrictions?: string[]
}

// ============================================================================
// Operators for conditions
// ============================================================================

export const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Not Contains' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
  { value: 'greater_equal', label: 'Greater or Equal' },
  { value: 'less_equal', label: 'Less or Equal' },
  { value: 'exists', label: 'Exists' },
  { value: 'not_exists', label: 'Not Exists' },
  { value: 'has_tag', label: 'Has Tag' },
  { value: 'not_has_tag', label: 'Does Not Have Tag' },
  { value: 'is_empty', label: 'Is Empty' },
  { value: 'is_not_empty', label: 'Is Not Empty' },
]

export const CONTACT_FIELDS = [
  { value: 'email', label: 'Email' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'company', label: 'Company' },
  { value: 'phone', label: 'Phone' },
  { value: 'status', label: 'Status' },
  { value: 'engagement_score', label: 'Engagement Score' },
  { value: 'tags', label: 'Tags' },
  { value: 'city', label: 'City' },
  { value: 'country', label: 'Country' },
]

// ============================================================================
// Standard handle definitions
// ============================================================================

const SINGLE_OUTPUT: HandleDef[] = [
  { id: 'default', label: '', color: 'var(--color-border)' },
]

const YES_NO_OUTPUTS: HandleDef[] = [
  { id: 'true', label: 'Yes', color: '#22c55e' },
  { id: 'false', label: 'No', color: '#ef4444' },
]

// ============================================================================
// Node Type Definitions
// ============================================================================

export const NODE_TYPES: Record<string, NodeTypeDef> = {

  // ── TRIGGERS ──────────────────────────────────────────────────────────────
  trigger: {
    label: 'Trigger',
    icon: markRaw(Workflow),
    color: '#22c55e',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-green-500/40',
    category: 'trigger',
    description: 'Entry point — how contacts enter this automation',
    hasTargetHandle: false,
    outputs: SINGLE_OUTPUT,
    fields: [],
  },

  // ── ACTIONS: Channels ─────────────────────────────────────────────────────
  send_email: {
    label: 'Send Email',
    icon: markRaw(Mail),
    color: '#6366f1',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-indigo-500/40',
    category: 'action',
    description: 'Send an email using a template',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'template_id', label: 'Email Template', type: 'template-picker', required: true, helpText: 'Select from your email templates' },
      { key: 'subject', label: 'Subject Line', type: 'text', placeholder: 'Override template subject (optional)' },
      { key: 'from_name', label: 'From Name', type: 'text', placeholder: 'Override sender name (optional)' },
    ],
  },

  send_whatsapp: {
    label: 'Send WhatsApp',
    icon: markRaw(MessageSquare),
    color: '#25d366',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-green-500/40',
    category: 'action',
    description: 'Send a WhatsApp template message',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'config_id', label: 'WhatsApp Account', type: 'select', required: true, helpText: 'Select connected WhatsApp Business account' },
      { key: 'template_name', label: 'Template', type: 'wa-template-picker', required: true, helpText: 'Only approved Meta templates can be sent' },
      { key: 'language', label: 'Language', type: 'select', options: [
        { value: 'en', label: 'English' }, { value: 'en_US', label: 'English (US)' },
        { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
        { value: 'de', label: 'German' }, { value: 'hi', label: 'Hindi' },
        { value: 'pt_BR', label: 'Portuguese (BR)' }, { value: 'ar', label: 'Arabic' },
      ] },
    ],
  },

  send_notification: {
    label: 'Internal Notification',
    icon: markRaw(Bell),
    color: '#f59e0b',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-amber-500/40',
    category: 'action',
    description: 'Notify your team via email',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'to_email', label: 'Notify Email', type: 'text', required: true, placeholder: 'team@company.com' },
      { key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Alert: {{contact.first_name}} did X' },
      { key: 'message', label: 'Message', type: 'textarea', placeholder: 'Details about this notification...' },
    ],
  },

  // ── ACTIONS: Contact Management ───────────────────────────────────────────
  add_tag: {
    label: 'Add Tag',
    icon: markRaw(Tag),
    color: '#10b981',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-emerald-500/40',
    category: 'action',
    description: 'Apply a tag to the contact',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'tag', label: 'Tag', type: 'tag-picker', required: true, helpText: 'Pick existing or type new tag' },
    ],
  },

  remove_tag: {
    label: 'Remove Tag',
    icon: markRaw(Minus),
    color: '#ef4444',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-red-500/40',
    category: 'action',
    description: 'Remove a tag from the contact',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'tag', label: 'Tag', type: 'tag-picker', required: true },
    ],
  },

  update_contact: {
    label: 'Update Contact',
    icon: markRaw(UserCog),
    color: '#3b82f6',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-blue-500/40',
    category: 'action',
    description: 'Update a field on the contact record',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'field', label: 'Field', type: 'field-picker', required: true },
      { key: 'value', label: 'New Value', type: 'text', required: true, placeholder: 'Value to set' },
    ],
  },

  move_to_list: {
    label: 'Move to List',
    icon: markRaw(ArrowRightLeft),
    color: '#14b8a6',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-teal-500/40',
    category: 'action',
    description: 'Move contact to a different list',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'list_id', label: 'Target List', type: 'list-picker', required: true },
    ],
  },

  score_change: {
    label: 'Change Score',
    icon: markRaw(Zap),
    color: '#eab308',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-yellow-500/40',
    category: 'action',
    description: 'Add or subtract engagement score points',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'amount', label: 'Score Change', type: 'number', required: true, helpText: 'Positive to add, negative to subtract' },
      { key: 'reason', label: 'Reason', type: 'text', placeholder: 'Optional reason for scoring' },
    ],
  },

  add_dnc: {
    label: 'Do Not Contact',
    icon: markRaw(Ban),
    color: '#dc2626',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-red-600/40',
    category: 'action',
    description: 'Add contact to Do Not Contact list',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: [
        { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'all', label: 'All Channels' },
      ] },
      { key: 'reason', label: 'Reason', type: 'text', placeholder: 'Why this contact should not be contacted' },
    ],
  },

  remove_dnc: {
    label: 'Remove DNC',
    icon: markRaw(Undo2),
    color: '#16a34a',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-green-600/40',
    category: 'action',
    description: 'Remove contact from Do Not Contact list',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: [
        { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'all', label: 'All Channels' },
      ] },
    ],
  },

  // ── ACTIONS: Integrations ─────────────────────────────────────────────────
  webhook: {
    label: 'Webhook',
    icon: markRaw(Globe),
    color: '#0ea5e9',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-sky-500/40',
    category: 'action',
    description: 'Send data to an external URL',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://...' },
      { key: 'method', label: 'Method', type: 'select', options: [
        { value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' },
        { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' },
      ] },
      { key: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Authorization": "Bearer ..."}' },
    ],
  },

  http_request: {
    label: 'HTTP Request',
    icon: markRaw(Send),
    color: '#06b6d4',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-cyan-500/40',
    category: 'action',
    description: 'Call an external API endpoint',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://api.example.com/...' },
      { key: 'method', label: 'Method', type: 'select', options: [
        { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' }, { value: 'PATCH', label: 'PATCH' }, { value: 'DELETE', label: 'DELETE' },
      ] },
      { key: 'body', label: 'Body Template', type: 'textarea', placeholder: '{"contactId": "{{contact.id}}"}' },
    ],
  },

  // ── DECISIONS (Yes/No branching — contact did or didn't do something) ─────
  email_opened: {
    label: 'Opened Email',
    icon: markRaw(Eye),
    color: '#22c55e',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-green-500/40',
    category: 'decision',
    description: 'Did the contact open the email?',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'wait_duration', label: 'Wait for', type: 'number', helpText: 'How long to wait for the open before taking No path' },
      { key: 'wait_unit', label: 'Unit', type: 'select', options: [
        { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' },
      ] },
    ],
    connectionRestrictions: ['send_email'],
  },

  email_clicked: {
    label: 'Clicked Link',
    icon: markRaw(MousePointerClick),
    color: '#3b82f6',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-blue-500/40',
    category: 'decision',
    description: 'Did the contact click a link in the email?',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'url_filter', label: 'Specific URL (optional)', type: 'text', placeholder: 'Leave empty for any link' },
      { key: 'wait_duration', label: 'Wait for', type: 'number' },
      { key: 'wait_unit', label: 'Unit', type: 'select', options: [
        { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' },
      ] },
    ],
    connectionRestrictions: ['send_email'],
  },

  form_submitted: {
    label: 'Submitted Form',
    icon: markRaw(FormInput),
    color: '#8b5cf6',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-violet-500/40',
    category: 'decision',
    description: 'Did the contact submit a specific form?',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'form_id', label: 'Form', type: 'select', required: true, helpText: 'Select which form to watch for' },
      { key: 'wait_duration', label: 'Wait for', type: 'number' },
      { key: 'wait_unit', label: 'Unit', type: 'select', options: [
        { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' },
      ] },
    ],
  },

  whatsapp_delivered: {
    label: 'WhatsApp Delivered',
    icon: markRaw(CheckCircle),
    color: '#25d366',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-green-500/40',
    category: 'decision',
    description: 'Was the WhatsApp message delivered?',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'wait_duration', label: 'Wait for', type: 'number', helpText: 'How long to wait for delivery confirmation' },
      { key: 'wait_unit', label: 'Unit', type: 'select', options: [
        { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' },
      ] },
    ],
    connectionRestrictions: ['send_whatsapp'],
  },

  whatsapp_read: {
    label: 'WhatsApp Read',
    icon: markRaw(Eye),
    color: '#25d366',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-green-500/40',
    category: 'decision',
    description: 'Did the contact read the WhatsApp message?',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'wait_duration', label: 'Wait for', type: 'number' },
      { key: 'wait_unit', label: 'Unit', type: 'select', options: [
        { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' },
      ] },
    ],
    connectionRestrictions: ['send_whatsapp'],
  },

  // ── CONDITIONS (check contact state right now — Yes/No branching) ─────────
  condition: {
    label: 'Contact Field',
    icon: markRaw(GitBranch),
    color: '#f59e0b',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-amber-500/40',
    category: 'condition',
    description: 'Check a contact field value',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'field', label: 'Contact Field', type: 'field-picker', required: true },
      { key: 'operator', label: 'Operator', type: 'operator-select', required: true },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'Comparison value' },
    ],
  },

  has_tag: {
    label: 'Has Tag',
    icon: markRaw(Tag),
    color: '#f97316',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-orange-500/40',
    category: 'condition',
    description: 'Check if contact has a specific tag',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'tag', label: 'Tag', type: 'tag-picker', required: true },
    ],
  },

  in_list: {
    label: 'In List',
    icon: markRaw(Users),
    color: '#8b5cf6',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-violet-500/40',
    category: 'condition',
    description: 'Check if contact is in a specific list',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'list_id', label: 'List', type: 'list-picker', required: true },
    ],
  },

  score_check: {
    label: 'Score Check',
    icon: markRaw(Hash),
    color: '#eab308',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-yellow-500/40',
    category: 'condition',
    description: 'Check if contact score meets threshold',
    hasTargetHandle: true,
    outputs: YES_NO_OUTPUTS,
    fields: [
      { key: 'operator', label: 'Operator', type: 'select', required: true, options: [
        { value: 'greater_than', label: 'Greater Than' }, { value: 'less_than', label: 'Less Than' },
        { value: 'greater_equal', label: 'Greater or Equal' }, { value: 'less_equal', label: 'Less or Equal' },
        { value: 'equals', label: 'Equals' },
      ] },
      { key: 'value', label: 'Score Threshold', type: 'number', required: true },
    ],
  },

  filter: {
    label: 'Filter',
    icon: markRaw(Filter),
    color: '#f97316',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-orange-500/40',
    category: 'condition',
    description: 'Filter: pass or exit automation (no "No" path)',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'field', label: 'Contact Field', type: 'field-picker', required: true },
      { key: 'operator', label: 'Operator', type: 'operator-select', required: true },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'Contacts not matching will exit' },
    ],
  },

  // ── LOGIC ─────────────────────────────────────────────────────────────────
  split_test: {
    label: 'A/B Split',
    icon: markRaw(Shuffle),
    color: '#ec4899',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-pink-500/40',
    category: 'condition',
    description: 'Randomly split contacts into paths by percentage',
    hasTargetHandle: true,
    outputs: [
      { id: 'true', label: 'Path A', color: '#22c55e' },
      { id: 'false', label: 'Path B', color: '#3b82f6' },
    ],
    fields: [
      { key: 'percentage_a', label: 'Path A %', type: 'number', required: true },
      { key: 'percentage_b', label: 'Path B %', type: 'number', required: true },
    ],
  },

  // ── TIMING ────────────────────────────────────────────────────────────────
  wait: {
    label: 'Wait',
    icon: markRaw(Clock),
    color: '#8b5cf6',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-violet-500/40',
    category: 'timing',
    description: 'Wait for a specified duration',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'duration', label: 'Duration', type: 'number', required: true },
      { key: 'unit', label: 'Unit', type: 'select', required: true, options: [
        { value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' },
        { value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' },
      ] },
    ],
  },

  delay_until: {
    label: 'Wait Until',
    icon: markRaw(CalendarClock),
    color: '#a78bfa',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-violet-400/40',
    category: 'timing',
    description: 'Wait until a specific date/time',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'date', label: 'Date/Time', type: 'datetime' },
      { key: 'field', label: 'Or Contact Date Field', type: 'field-picker', helpText: 'Wait until value of this field (e.g. birthday)' },
    ],
  },

  send_window: {
    label: 'Send Window',
    icon: markRaw(Timer),
    color: '#7c3aed',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-purple-500/40',
    category: 'timing',
    description: 'Only proceed during specific hours/days',
    hasTargetHandle: true,
    outputs: SINGLE_OUTPUT,
    fields: [
      { key: 'start_hour', label: 'Start Hour', type: 'number', placeholder: '9', helpText: '24h format (0-23)' },
      { key: 'end_hour', label: 'End Hour', type: 'number', placeholder: '17' },
      { key: 'days', label: 'Days', type: 'text', helpText: 'Comma-separated: mon,tue,wed,thu,fri' },
    ],
  },

  // ── END ───────────────────────────────────────────────────────────────────
  end: {
    label: 'End',
    icon: markRaw(Square),
    color: '#ef4444',
    bgColor: 'var(--color-surface-1)',
    borderColor: 'border-red-500/40',
    category: 'end',
    description: 'End the automation for this contact',
    hasTargetHandle: true,
    outputs: [],
    fields: [],
  },
} as const

export type NodeTypeName = keyof typeof NODE_TYPES

// ============================================================================
// Palette — organized by category for the "Add Node" panel
// ============================================================================

export const NODE_PALETTE = [
  {
    category: 'Channels',
    description: 'Send messages to contacts',
    items: ['send_email', 'send_whatsapp', 'send_notification'],
  },
  {
    category: 'Contact Actions',
    description: 'Modify contact data',
    items: ['add_tag', 'remove_tag', 'update_contact', 'move_to_list', 'score_change', 'add_dnc', 'remove_dnc'],
  },
  {
    category: 'Decisions',
    description: 'Branch based on contact behavior (Yes/No)',
    items: ['email_opened', 'email_clicked', 'form_submitted', 'whatsapp_delivered', 'whatsapp_read'],
  },
  {
    category: 'Conditions',
    description: 'Branch based on contact state (Yes/No)',
    items: ['condition', 'has_tag', 'in_list', 'score_check', 'filter', 'split_test'],
  },
  {
    category: 'Timing',
    description: 'Control when steps execute',
    items: ['wait', 'delay_until', 'send_window'],
  },
  {
    category: 'Integrations',
    description: 'Connect to external services',
    items: ['webhook', 'http_request'],
  },
  {
    category: 'End',
    description: 'Complete the automation',
    items: ['end'],
  },
]

// ============================================================================
// Helpers
// ============================================================================

/** Get summary text for display on the node */
export function getNodeSummary(type: string, config: Record<string, any>): string {
  switch (type) {
    case 'send_email': return config.subject || config.template_id || 'No template'
    case 'send_whatsapp': return config.template_name || 'No template'
    case 'send_notification': return config.subject || 'No subject'
    case 'add_tag': case 'remove_tag': return config.tag || 'No tag'
    case 'update_contact': return config.field ? `${config.field} = ${config.value || ''}` : 'Not configured'
    case 'move_to_list': return config.list_id || 'No list'
    case 'score_change': return config.amount ? `${config.amount > 0 ? '+' : ''}${config.amount}` : 'Not set'
    case 'add_dnc': case 'remove_dnc': return config.channel || 'All channels'
    case 'webhook': case 'http_request': return config.url || 'No URL'
    case 'wait': return `${config.duration || '?'} ${config.unit || 'days'}`
    case 'delay_until': return config.date || config.field || 'Not set'
    case 'send_window': return config.start_hour != null ? `${config.start_hour}:00 - ${config.end_hour}:00` : 'Not set'
    case 'condition': return config.field ? `${config.field} ${config.operator || '='} ${config.value || ''}` : 'Not configured'
    case 'has_tag': return config.tag || 'No tag'
    case 'in_list': return config.list_id || 'No list'
    case 'score_check': return config.value != null ? `Score ${config.operator || '>'} ${config.value}` : 'Not set'
    case 'filter': return config.field ? `${config.field} ${config.operator || '='} ${config.value || ''}` : 'Not configured'
    case 'split_test': return `${config.percentage_a || 50}% / ${config.percentage_b || 50}%`
    case 'email_opened': return config.wait_duration ? `Wait ${config.wait_duration} ${config.wait_unit || 'days'}` : 'Immediate'
    case 'email_clicked': return config.url_filter || 'Any link'
    case 'form_submitted': return config.form_id || 'No form'
    case 'whatsapp_delivered': case 'whatsapp_read': return config.wait_duration ? `Wait ${config.wait_duration} ${config.wait_unit || 'hours'}` : 'Immediate'
    default: return ''
  }
}

/** Check if a connection from sourceType to targetType is allowed */
export function isConnectionAllowed(sourceType: string, targetType: string): boolean {
  const targetDef = NODE_TYPES[targetType]
  if (!targetDef) return true
  if (!targetDef.connectionRestrictions || targetDef.connectionRestrictions.length === 0) return true
  return targetDef.connectionRestrictions.includes(sourceType)
}

/** Get category color */
export function getCategoryColor(category: NodeCategory): string {
  switch (category) {
    case 'trigger': return '#22c55e'
    case 'action': return '#6366f1'
    case 'decision': return '#22c55e'
    case 'condition': return '#f59e0b'
    case 'timing': return '#8b5cf6'
    case 'end': return '#ef4444'
  }
}

export { BaseNode }
