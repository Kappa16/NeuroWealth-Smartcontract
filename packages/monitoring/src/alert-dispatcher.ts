/**
 * Sends alerts to configured webhooks (Slack, Discord, Telegram)
 */

import axios from "axios";
import pino from "pino";
import { Alert, AlertWebhook } from "./types";

export class AlertDispatcher {
  private logger = pino();

  constructor(private webhooks: AlertWebhook[]) {}

  async dispatch(alert: Alert): Promise<void> {
    const relevantWebhooks = this.webhooks.filter(
      (w) =>
        !w.severity ||
        alert.severity === w.severity ||
        this.isSeverityHigher(alert.severity, w.severity || "info"),
    );

    for (const webhook of relevantWebhooks) {
      try {
        await this.sendAlert(alert, webhook);
      } catch (error) {
        this.logger.error(
          { error, webhook: webhook.name },
          "Failed to send alert",
        );
      }
    }
  }

  private async sendAlert(alert: Alert, webhook: AlertWebhook): Promise<void> {
    const payload = this.formatPayload(alert, webhook.type);

    await axios.post(webhook.url, payload, {
      timeout: 10000,
    });

    this.logger.info(
      { webhook: webhook.name, alert_id: alert.id },
      "Alert sent",
    );
  }

  private formatPayload(alert: Alert, type: string) {
    const severity_emoji = {
      info: "ℹ️",
      warning: "⚠️",
      critical: "🚨",
    };

    const emoji = severity_emoji[alert.severity];
    const timestamp = new Date(alert.timestamp).toISOString();

    if (type === "slack") {
      return {
        text: `${emoji} ${alert.title}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `${emoji} ${alert.title}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: alert.message,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `*Type:* ${alert.type} | *Severity:* ${alert.severity} | *Time:* ${timestamp}`,
              },
            ],
          },
          ...(alert.metrics
            ? [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*Metrics:*\n${Object.entries(alert.metrics)
                      .map(([k, v]) => `• ${k}: ${v}`)
                      .join("\n")}`,
                  },
                },
              ]
            : []),
        ],
      };
    }

    if (type === "discord") {
      const color = { info: 3447003, warning: 15105570, critical: 15158332 }[
        alert.severity
      ];

      return {
        embeds: [
          {
            title: `${emoji} ${alert.title}`,
            description: alert.message,
            color,
            fields: alert.metrics
              ? Object.entries(alert.metrics).map(([k, v]) => ({
                  name: k,
                  value: String(v),
                  inline: true,
                }))
              : [],
            footer: {
              text: `Type: ${alert.type} | Severity: ${alert.severity}`,
            },
            timestamp: new Date(alert.timestamp).toISOString(),
          },
        ],
      };
    }

    if (type === "telegram") {
      let message = `${emoji} <b>${alert.title}</b>\n\n${alert.message}\n\n`;
      if (alert.metrics) {
        message += "<b>Metrics:</b>\n";
        message += Object.entries(alert.metrics)
          .map(([k, v]) => `<code>${k}</code>: ${v}`)
          .join("\n");
      }
      message += `\n\n<i>Type: ${alert.type} | Severity: ${alert.severity} | ${timestamp}</i>`;

      return {
        text: message,
        parse_mode: "HTML",
      };
    }

    // Generic webhook
    return {
      alert_id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      metrics: alert.metrics,
      timestamp: alert.timestamp,
    };
  }

  private isSeverityHigher(current: string, minimum: string): boolean {
    const levels = { info: 0, warning: 1, critical: 2 };
    return (
      levels[current as keyof typeof levels] >=
      levels[minimum as keyof typeof levels]
    );
  }
}
