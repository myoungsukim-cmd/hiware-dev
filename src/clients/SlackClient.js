import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

/**
 * Slack Web API — Worker/비동기에서 호출 (3초 제한 무관)
 */
export class SlackClient {
  constructor(cfg = config.slack) {
    this.botToken = cfg.botToken;
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} body
   * @param {{ form?: boolean }} [opts] form=true → x-www-form-urlencoded (lookupByEmail 등)
   */
  async api(method, body = {}, { form = false } = {}) {
    if (!this.botToken) {
      logger.warn('SlackClient: SLACK_BOT_TOKEN 미설정 — skip', { method });
      return null;
    }

    const headers = {
      Authorization: 'Bearer ' + this.botToken,
    };
    let payload;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(
        Object.fromEntries(
          Object.entries(body).map(([k, v]) => [k, v == null ? '' : String(v)])
        )
      ).toString();
    } else {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(body);
    }

    const res = await fetch('https://slack.com/api/' + method, {
      method: 'POST',
      headers,
      body: payload,
    });
    const data = await res.json();
    if (!data.ok) {
      logger.error('Slack API error', {
        method,
        error: data.error,
        detail: data.response_metadata?.messages || data.response_metadata,
      });
    }
    return data;
  }

  openModal(triggerId, view) {
    return this.api('views.open', { trigger_id: triggerId, view });
  }

  openConversation(slackUserId) {
    return this.api('conversations.open', { users: slackUserId });
  }

  lookupUserByEmail(email) {
    // users.lookupByEmail 은 JSON body 미지원 → form-urlencoded 필수
    return this.api('users.lookupByEmail', { email }, { form: true });
  }

  updateModal(viewId, hash, view) {
    const body = { view_id: viewId, view };
    // hash 생략 가능 — 처리중→완료처럼 연속 update 시 hash_conflict 방지
    if (hash) body.hash = hash;
    return this.api('views.update', body);
  }

  postMessage(channel, blocks, text) {
    return this.api('chat.postMessage', { channel, blocks, text });
  }

  updateMessage(channel, ts, blocks, text) {
    return this.api('chat.update', { channel, ts, blocks, text });
  }
}

export const slackClient = new SlackClient();
