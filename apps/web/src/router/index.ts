import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../stores/auth'
import { usePermissions } from '../composables/usePermissions'

const routes = [
  // Guest routes (no layout)
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { guest: true },
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('../views/ForgotPasswordView.vue'),
    meta: { guest: true },
  },
  {
    path: '/reset-password/:token',
    name: 'ResetPassword',
    component: () => import('../views/ResetPasswordView.vue'),
    meta: { guest: true },
  },
  {
    path: '/invite/:token',
    name: 'AcceptInvite',
    component: () => import('../views/AcceptInviteView.vue'),
  },

  // Platform Admin routes (own layout, solo user with all features + platform powers)
  {
    path: '/platform',
    component: () => import('../views/platform/PlatformLayout.vue'),
    meta: { requiresAuth: true, platformOnly: true },
    children: [
      // Same features as org users
      { path: '', name: 'PlatformDashboard', component: () => import('../views/platform/PlatformDashboard.vue') },
      { path: 'compose', name: 'PlatformCompose', component: () => import('../views/ComposeView.vue') },
      { path: 'campaigns', name: 'PlatformCampaigns', component: () => import('../views/CampaignsView.vue') },
      { path: 'campaigns/:id', name: 'PlatformCampaignDetail', component: () => import('../views/CampaignDetailView.vue') },
      { path: 'templates', name: 'PlatformTemplates', component: () => import('../views/TemplatesView.vue') },
      { path: 'contacts', name: 'PlatformContacts', component: () => import('../views/ContactsView.vue') },
      { path: 'contacts/:id', name: 'PlatformContactDetail', component: () => import('../views/ContactDetailView.vue'), meta: { breadcrumb: 'Contact Detail', parent: { name: 'Contacts', path: '/platform/contacts' } } },
      { path: 'automations', name: 'PlatformAutomations', component: () => import('../views/AutomationsView.vue') },
      { path: 'whatsapp', name: 'PlatformWhatsApp', component: () => import('../views/WhatsAppView.vue'), meta: { breadcrumb: 'WhatsApp' } },
      { path: 'forms', name: 'PlatformForms', component: () => import('../views/FormsView.vue') },
      { path: 'forms/:id', name: 'PlatformFormDetail', component: () => import('../views/FormDetailView.vue') },
      { path: 'pages', name: 'PlatformPages', component: () => import('../views/PagesView.vue') },
      { path: 'pages/:id', name: 'PlatformPageDetail', component: () => import('../views/PageDetailView.vue') },
      { path: 'calendar', name: 'PlatformCalendar', component: () => import('../views/CalendarView.vue') },
      { path: 'analytics', name: 'PlatformAnalytics', component: () => import('../views/AnalyticsView.vue') },
      { path: 'reports', name: 'PlatformReports', component: () => import('../views/ReportsView.vue') },
      // Settings (platform admin's own delivery servers)
      {
        path: 'settings',
        component: () => import('../views/settings/SettingsLayout.vue'),
        children: [
          { path: '', redirect: { name: 'PlatformSettingsServers' } },
          { path: 'delivery-servers', name: 'PlatformSettingsServers', component: () => import('../views/settings/DeliveryServers.vue') },
          { path: 'api-keys', name: 'PlatformSettingsApiKeys', component: () => import('../views/settings/ApiKeysSettings.vue') },
          { path: 'webhooks', name: 'PlatformSettingsWebhooks', component: () => import('../views/settings/WebhooksSettings.vue') },
          { path: 'domains', name: 'PlatformSettingsDomains', component: () => import('../views/settings/DomainsSettings.vue') },
          { path: 'tracking', name: 'PlatformSettingsTracking', component: () => import('../views/settings/TrackingSettings.vue') },
        ],
      },
      // Platform-only powers (god mode)
      { path: 'organizations', name: 'PlatformOrgs', component: () => import('../views/platform/PlatformOrganizations.vue') },
      { path: 'users', name: 'PlatformUsers', component: () => import('../views/platform/PlatformUsers.vue') },
      { path: 'system-settings', name: 'PlatformSystemSettings', component: () => import('../views/admin/PlatformSettingsPage.vue') },
      { path: 'monitoring', name: 'PlatformMonitoring', component: () => import('../views/platform/PlatformDashboard.vue') },
    ],
  },

  // Authenticated routes (wrapped in MainLayout — org context required)
  {
    path: '/',
    component: () => import('../components/layout/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { breadcrumb: 'Dashboard' },
      },
      {
        path: 'compose',
        name: 'Compose',
        component: () => import('../views/ComposeView.vue'),
        meta: { breadcrumb: 'Compose' },
      },
      {
        path: 'campaigns',
        name: 'Campaigns',
        component: () => import('../views/CampaignsView.vue'),
        meta: { breadcrumb: 'Campaigns' },
      },
      {
        path: 'campaigns/:id',
        name: 'CampaignDetail',
        component: () => import('../views/CampaignDetailView.vue'),
        meta: { breadcrumb: 'Campaign Detail', parent: { name: 'Campaigns', path: '/campaigns' } },
      },
      {
        path: 'contacts',
        name: 'Contacts',
        component: () => import('../views/ContactsView.vue'),
        meta: { breadcrumb: 'Contacts' },
      },
      {
        path: 'contacts/:id',
        name: 'ContactDetail',
        component: () => import('../views/ContactDetailView.vue'),
        meta: { breadcrumb: 'Contact Detail', parent: { name: 'Contacts', path: '/contacts' } },
      },
      {
        path: 'templates',
        name: 'Templates',
        component: () => import('../views/TemplatesView.vue'),
        meta: { breadcrumb: 'Templates' },
      },
      {
        path: 'automations',
        name: 'Automations',
        component: () => import('../views/AutomationsView.vue'),
        meta: { breadcrumb: 'Automations' },
      },
      {
        path: 'whatsapp',
        name: 'WhatsApp',
        component: () => import('../views/WhatsAppView.vue'),
        meta: { breadcrumb: 'WhatsApp' },
      },
      {
        path: 'forms',
        name: 'Forms',
        component: () => import('../views/FormsView.vue'),
        meta: { breadcrumb: 'Forms' },
      },
      {
        path: 'forms/:id',
        name: 'FormDetail',
        component: () => import('../views/FormDetailView.vue'),
        meta: { breadcrumb: 'Form Detail', parent: { name: 'Forms', path: '/forms' } },
      },
      {
        path: 'pages',
        name: 'Pages',
        component: () => import('../views/PagesView.vue'),
        meta: { breadcrumb: 'Pages' },
      },
      {
        path: 'pages/:id',
        name: 'PageDetail',
        component: () => import('../views/PageDetailView.vue'),
        meta: { breadcrumb: 'Page Detail', parent: { name: 'Pages', path: '/pages' } },
      },
      {
        path: 'calendar',
        name: 'Calendar',
        component: () => import('../views/CalendarView.vue'),
        meta: { breadcrumb: 'Calendar' },
      },
      {
        path: 'analytics',
        name: 'Analytics',
        component: () => import('../views/AnalyticsView.vue'),
        meta: { breadcrumb: 'Analytics' },
      },
      {
        path: 'reports',
        name: 'Reports',
        component: () => import('../views/ReportsView.vue'),
        meta: { breadcrumb: 'Reports' },
      },

      // Settings — unified delivery servers + sending domains
      {
        path: 'settings',
        component: () => import('../views/settings/SettingsLayout.vue'),
        meta: { breadcrumb: 'Settings' },
        children: [
          { path: '', redirect: { name: 'SettingsDeliveryServers' } },
          {
            path: 'delivery-servers',
            name: 'SettingsDeliveryServers',
            component: () => import('../views/settings/DeliveryServers.vue'),
            meta: { breadcrumb: 'Delivery Servers' },
          },
          {
            path: 'api-keys',
            name: 'SettingsApiKeys',
            component: () => import('../views/settings/ApiKeysSettings.vue'),
            meta: { breadcrumb: 'API Keys' },
          },
          {
            path: 'webhooks',
            name: 'SettingsWebhooks',
            component: () => import('../views/settings/WebhooksSettings.vue'),
            meta: { breadcrumb: 'Webhooks' },
          },
          {
            path: 'domains',
            name: 'SettingsDomains',
            component: () => import('../views/settings/DomainsSettings.vue'),
            meta: { breadcrumb: 'Domains' },
          },
          {
            path: 'tracking',
            name: 'SettingsTracking',
            component: () => import('../views/settings/TrackingSettings.vue'),
            meta: { breadcrumb: 'Tracking' },
          },
        ],
      },

      // Admin — nested sub-pages
      {
        path: 'admin',
        component: () => import('../views/admin/AdminLayout.vue'),
        meta: { breadcrumb: 'Admin' },
        children: [
          { path: '', redirect: { name: 'AdminOrg' } },
          {
            path: 'organization',
            name: 'AdminOrg',
            component: () => import('../views/admin/OrgSettings.vue'),
            meta: { breadcrumb: 'Organization' },
          },
          {
            path: 'members',
            name: 'AdminMembers',
            component: () => import('../views/admin/MembersPage.vue'),
            meta: { breadcrumb: 'Members' },
          },
          {
            path: 'teams',
            name: 'AdminTeams',
            component: () => import('../views/admin/TeamsPage.vue'),
            meta: { breadcrumb: 'Teams' },
          },
          {
            path: 'roles',
            name: 'AdminRoles',
            component: () => import('../views/admin/RolesPage.vue'),
            meta: { breadcrumb: 'Roles' },
          },
          {
            path: 'audit',
            name: 'AdminAudit',
            component: () => import('../views/admin/AuditPage.vue'),
            meta: { breadcrumb: 'Audit Logs' },
          },
          {
            path: 'platform',
            name: 'AdminPlatform',
            component: () => import('../views/admin/PlatformPage.vue'),
            meta: { breadcrumb: 'Platform' },
          },
          {
            path: 'platform-settings',
            name: 'AdminPlatformSettings',
            component: () => import('../views/admin/PlatformSettingsPage.vue'),
            meta: { breadcrumb: 'Platform Settings' },
          },
        ],
      },
    ],
  },

  // 404
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  },
})

// Global navigation guard
router.beforeEach(async (to, _from, next) => {
  const { isAuthenticated, isInitialized, initializeAuth, isPlatformAdmin } = useAuth()

  if (!isInitialized.value) {
    await initializeAuth()
  }

  const requiresAuth = to.matched.some(r => r.meta.requiresAuth)
  const isGuestRoute = to.meta.guest
  const isPlatformRoute = to.path.startsWith('/platform')

  if (requiresAuth && !isAuthenticated.value) {
    next({ path: '/login', replace: true })
  } else if (isGuestRoute && isAuthenticated.value) {
    // After login redirect: platform admin → /platform, normal user → /
    if (isPlatformAdmin.value) {
      next({ path: '/platform', replace: true })
    } else {
      next({ path: '/', replace: true })
    }
  } else if (requiresAuth && isAuthenticated.value) {

    // Platform admin: can ONLY access /platform/* routes
    if (isPlatformAdmin.value && !isPlatformRoute) {
      next({ path: '/platform', replace: true })
      return
    }

    // Normal users: CANNOT access /platform/* routes
    if (!isPlatformAdmin.value && isPlatformRoute) {
      next({ path: '/', replace: true })
      return
    }

    // Permission gating: only block admin routes (org admin needs admin role)
    // Settings routes are open to all authenticated users — the pages handle their own permission display
    if (to.path.startsWith('/admin')) {
      const { isAdmin } = usePermissions()
      if (!isAdmin.value) {
        next({ path: '/', replace: true })
        return
      }
    }

    next()
  } else {
    next()
  }
})

export default router
