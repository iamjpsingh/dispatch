/**
 * Notification Email Templates
 * HTML template functions for job completion notification emails
 */
import type { JobStats, NotificationTemplateData } from '../services/notificationService'

/**
 * Create notification email subject line
 */
export function createNotificationSubject(stats: JobStats): string {
  const status = stats.successRate >= 95 ? 'Success' : stats.successRate >= 50 ? 'Warning' : 'Alert'
  return `Campaign Complete [${status}]: ${stats.sent}/${stats.total} emails sent (${stats.successRate}%)`
}

/**
 * Get status icon based on success rate
 */
export function getStatusIcon(successRate: number): string {
  if (successRate >= 95) {
    return `✅`
  } else if (successRate >= 50) {
    return `⚠️`
  } else {
    return `❌`
  }
}

/**
 * Get performance insights HTML block based on campaign results
 */
export function getPerformanceInsights(stats: JobStats): string {
  if (stats.successRate >= 98) {
    return `
      <div style="background: #e8f5e8; border-left: 4px solid #4CAF50; padding: 15px; border-radius: 0 8px 8px 0;">
        <h4 style="margin: 0 0 10px 0; color: #2e7d32; font-size: 16px;">🎉 Excellent Performance!</h4>
        <p style="margin: 0; color: #2e7d32; font-size: 14px;">
          Outstanding delivery rate! Your email configuration and content are optimized perfectly.
        </p>
      </div>
    `
  } else if (stats.successRate >= 90) {
    return `
      <div style="background: #fff3e0; border-left: 4px solid #FF9800; padding: 15px; border-radius: 0 8px 8px 0;">
        <h4 style="margin: 0 0 10px 0; color: #ef6c00; font-size: 16px;">👍 Good Performance</h4>
        <p style="margin: 0; color: #ef6c00; font-size: 14px;">
          Solid delivery rate. Consider reviewing failed emails to improve future campaigns.
        </p>
      </div>
    `
  } else {
    return `
      <div style="background: #ffebee; border-left: 4px solid #f44336; padding: 15px; border-radius: 0 8px 8px 0;">
        <h4 style="margin: 0 0 10px 0; color: #c62828; font-size: 16px;">⚠️ Needs Attention</h4>
        <p style="margin: 0; color: #c62828; font-size: 14px;">
          Lower than expected delivery rate. Check SMTP settings, email content, and contact list quality.
        </p>
      </div>
    `
  }
}

/**
 * Create the full notification HTML email content
 */
export function createNotificationHTML(data: NotificationTemplateData): string {
  const { stats, details, user } = data

  const statusColor = stats.successRate >= 95 ? '#4CAF50' : stats.successRate >= 50 ? '#FF9800' : '#f44336'

  const statusIcon = getStatusIcon(stats.successRate)

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Campaign Completion Report</title>
      </head>
      <body
        style="
          margin: 0;
          padding: 0;
          background-color: #f5f5f5;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
            'Helvetica Neue', Arial, sans-serif;
        "
      >
        <div
          style="
            max-width: 600px;
            margin: 0 auto;
            background-color: white;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            overflow: hidden;
          "
        >
          <!-- Compact Header -->
          <div
            style="
              background: linear-gradient(135deg, ${statusColor}, ${statusColor}dd);
              color: white;
              padding: 25px 20px;
              text-align: center;
            "
          >
            <div
              style="
                display: inline-flex;
                align-items: center;
                gap: 10px;
                font-size: 24px;
                font-weight: 600;
                margin-bottom: 8px;
              "
            >
              <span
                style="
                  background: rgba(255, 255, 255, 0.2);
                  border-radius: 50%;
                  width: 40px;
                  height: 40px;
                  display: inline-flex;
                  align-items: center;
                  justify-content: center;
                  color: white;
                "
                >${statusIcon}</span
              >
              Campaign Completed
            </div>
            <p style="margin: 0; opacity: 0.9; font-size: 14px">
              Your bulk email campaign has finished processing
            </p>
          </div>

          <!-- User Greeting -->
          <div style="padding: 20px; border-bottom: 1px solid #f0f0f0">
            <p style="margin: 0; font-size: 16px; color: #333">
              Hi <strong>${user.name}</strong>,
            </p>
            <p style="margin: 8px 0 0 0; color: #666; font-size: 14px">
              Your email campaign "<strong>${details.subject}</strong>" has been
              completed. Here's your detailed report:
            </p>
          </div>

          <!-- Compact Statistics Grid -->
          <div style="padding: 25px 20px">
            <h2
              style="
                margin: 0 0 18px 0;
                color: #333;
                font-size: 18px;
                font-weight: 600;
                border-bottom: 2px solid #f0f0f0;
                padding-bottom: 8px;
              "
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 8px;">
                <path d="M9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4zm2-12H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"/>
              </svg>
              Campaign Results
            </h2>

            <div
              style="
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
                margin-bottom: 20px;
              "
            >
              <!-- Success Rate Card -->
              <div
                style="background: #f8f9fa; border-left: 3px solid ${statusColor}; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"
              >
                <div
                  style="font-size: 24px; font-weight: bold; color: ${statusColor}; margin-bottom: 4px;"
                >
                  ${stats.successRate}%
                </div>
                <div
                  style="
                    color: #666;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    font-weight: 500;
                  "
                >
                  Success Rate
                </div>
              </div>

              <!-- Total Contacts Card -->
              <div
                style="
                  background: #f8f9fa;
                  border-left: 3px solid #2196f3;
                  padding: 15px;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                "
              >
                <div
                  style="
                    font-size: 24px;
                    font-weight: bold;
                    color: #2196f3;
                    margin-bottom: 4px;
                  "
                >
                  ${stats.total}
                </div>
                <div
                  style="
                    color: #666;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    font-weight: 500;
                  "
                >
                  Total Contacts
                </div>
              </div>

              <!-- Sent Successfully Card -->
              <div
                style="
                  background: #f8f9fa;
                  border-left: 3px solid #4caf50;
                  padding: 15px;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                "
              >
                <div
                  style="
                    font-size: 24px;
                    font-weight: bold;
                    color: #4caf50;
                    margin-bottom: 4px;
                  "
                >
                  ${stats.sent}
                </div>
                <div
                  style="
                    color: #666;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    font-weight: 500;
                  "
                >
                  Sent Successfully
                </div>
              </div>

              <!-- Failed Card -->
              <div
                style="
                  background: #f8f9fa;
                  border-left: 3px solid #f44336;
                  padding: 15px;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                "
              >
                <div
                  style="
                    font-size: 24px;
                    font-weight: bold;
                    color: #f44336;
                    margin-bottom: 4px;
                  "
                >
                  ${stats.failed}
                </div>
                <div
                  style="
                    color: #666;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    font-weight: 500;
                  "
                >
                  Failed Deliveries
                </div>
              </div>
            </div>

            <!-- Progress Bar -->
            <div
              style="
                background: #eee;
                border-radius: 6px;
                overflow: hidden;
                margin-bottom: 20px;
                height: 8px;
              "
            >
              <div
                style="background: ${statusColor}; height: 100%; width: ${stats.successRate}%; transition: width 0.3s ease;"
              ></div>
            </div>

            <!-- Campaign Details -->
            <h3
              style="
                margin: 0 0 12px 0;
                color: #333;
                font-size: 16px;
                font-weight: 600;
              "
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 6px;">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
              </svg>
              Campaign Details
            </h3>
            <table
              style="
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 20px;
                font-size: 14px;
              "
            >
              <tr>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #666;
                    font-weight: 500;
                  "
                >
                  Campaign ID:
                </td>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #333;
                    font-family: 'Monaco', 'Menlo', monospace;
                    font-size: 13px;
                  "
                >
                  ${details.id}
                </td>
              </tr>
              <tr>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #666;
                    font-weight: 500;
                  "
                >
                  Subject:
                </td>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #333;
                  "
                >
                  ${details.subject}
                </td>
              </tr>
              <tr>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #666;
                    font-weight: 500;
                  "
                >
                  Configuration:
                </td>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #333;
                  "
                >
                  ${details.configUsed}
                </td>
              </tr>
              <tr>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #666;
                    font-weight: 500;
                  "
                >
                  Processing Mode:
                </td>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #333;
                  "
                >
                  ${details.batchMode ? 'Batch Processing' : 'Normal Sending'}
                </td>
              </tr>
              <tr>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #666;
                    font-weight: 500;
                  "
                >
                  Duration:
                </td>
                <td
                  style="
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f0f0;
                    color: #333;
                  "
                >
                  ${details.duration}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: 500">
                  Completed:
                </td>
                <td style="padding: 8px 0; color: #333">
                  ${new Date(details.endTime).toLocaleString()}
                </td>
              </tr>
            </table>

            <!-- Action Items -->
            <div
              style="
                background: linear-gradient(135deg, #e3f2fd, #f3e5f5);
                border-radius: 8px;
                padding: 18px;
                margin-bottom: 18px;
              "
            >
              <h3
                style="
                  margin: 0 0 12px 0;
                  color: #1976d2;
                  font-size: 16px;
                  font-weight: 600;
                "
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 6px;">
                  <path d="M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7H14A7,7 0 0,1 21,14H22A1,1 0 0,1 23,15V18A1,1 0 0,1 22,19H21V20A2,2 0 0,1 19,22H5A2,2 0 0,1 3,20V19H2A1,1 0 0,1 1,18V15A1,1 0 0,1 2,14H3A7,7 0 0,1 10,7H11V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2M7.5,13A2.5,2.5 0 0,0 5,15.5A2.5,2.5 0 0,0 7.5,18A2.5,2.5 0 0,0 10,15.5A2.5,2.5 0 0,0 7.5,13M16.5,13A2.5,2.5 0 0,0 14,15.5A2.5,2.5 0 0,0 16.5,18A2.5,2.5 0 0,0 19,15.5A2.5,2.5 0 0,0 16.5,13Z"/>
                </svg>
                Next Steps
              </h3>
              <ul
                style="
                  margin: 0;
                  padding-left: 18px;
                  color: #333;
                  line-height: 1.5;
                  font-size: 14px;
                "
              >
                <li style="margin-bottom: 6px">
                  View detailed logs in your dashboard for individual email status
                </li>
                <li style="margin-bottom: 6px">
                  Download comprehensive reports in CSV or JSON format
                </li>
                <li style="margin-bottom: 6px">
                  Analyze failed deliveries and update your contact list
                </li>
                ${
                  stats.successRate < 95
                    ? `
                <li style="margin-bottom: 6px; color: #f57c00">
                  <strong
                    >Consider reviewing failed emails and checking SMTP
                    settings</strong
                  >
                </li>
                `
                    : ''
                }
                <li>Schedule your next campaign or set up automated follow-ups</li>
              </ul>
            </div>

            <!-- Performance Insights -->
            ${getPerformanceInsights(stats)}
          </div>

          <!-- Professional Footer -->
          <div
            style="
              background: #263238;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 0 0 8px 8px;
            "
          >
            <div
              style="
                display: inline-flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
              "
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
                />
              </svg>
              <span style="font-size: 16px; font-weight: 500"
                >Bulk Email Sender</span
              >
            </div>
            <p style="margin: 0 0 12px 0; font-size: 13px; opacity: 0.8">
              Report generated on ${new Date().toLocaleString()}
            </p>
            <div
              style="
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px solid #37474f;
              "
            >
              <a
                href="http://localhost:5500"
                style="
                  color: #64b5f6;
                  text-decoration: none;
                  font-weight: 500;
                  margin-right: 20px;
                  font-size: 14px;
                "
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style="vertical-align: middle; margin-right: 4px"
                >
                  <path
                    d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"
                  />
                </svg>
                View Dashboard
              </a>
              <a
                href="http://localhost:5500#report"
                style="
                  color: #64b5f6;
                  text-decoration: none;
                  font-weight: 500;
                  font-size: 14px;
                "
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style="vertical-align: middle; margin-right: 4px"
                >
                  <path
                    d="M9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4zm2-12H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"
                  />
                </svg>
                Detailed Reports
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  `
}
