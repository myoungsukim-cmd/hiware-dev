import { config, needsApvUserPwd } from '../config/index.js';
import { htmlToPlainText, truncate } from './htmlToText.js';

/** @typedef {object} ApprovalDetail
 * @property {string} apvApltNo
 * @property {string} [apvTitle]
 * @property {string} [apvReqUserInfo]
 * @property {string} [apvReqDttm]
 * @property {string} [summaryContents]
 * @property {string} [htmlCnts]
 * @property {string} [apvApltStateCodeNm]
 */

export const SLACK_ACTIONS = {
  OPEN_MODAL: 'approval_open_modal',
  ASSENT: 'approval_assent',
  REJECT: 'approval_reject',
};

export const MODAL_CALLBACK_ID = 'approval_action_modal';

/**
 * 결재자 DM — 요약 + [상세/처리하기]
 * NOTE: 템플릿 리터럴(백틱) 미사용 — 터미널 복붙 시 백틱 유실 방지
 */
export function buildApprovalDm({ detail, fallbackText }) {
  const title = detail.apvTitle || '제목 없음';
  const requester = detail.apvReqUserInfo || '-';
  const reqDttm = detail.apvReqDttm || '-';
  const summary = truncate(detail.summaryContents || detail.apvTitle || '', 300);

  const text = fallbackText || ('결재 요청: ' + title);

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*[결재 요청]*',
            '*제목:* ' + title,
            '*기안자:* ' + requester,
            '*요청일시:* ' + reqDttm,
            '*상태:* ' + (detail.apvApltStateCodeNm || '결재 대기'),
            '*내용:* ' + summary,
          ].join('\n'),
        },
      },
      {
        type: 'actions',
        block_id: 'approval_dm_' + detail.apvApltNo,
        elements: [
          {
            type: 'button',
            action_id: SLACK_ACTIONS.OPEN_MODAL,
            text: { type: 'plain_text', text: '상세/처리하기' },
            style: 'primary',
            value: String(detail.apvApltNo),
          },
        ],
      },
    ],
  };
}

/**
 * 처리 Modal — 상세 + 코멘트 + 비밀번호 + 승인/반려 버튼
 */
export function buildApprovalDetailModal(detail, { channelId, messageTs, slackUserId } = {}) {
  const title = truncate(detail.apvTitle || '결재 요청', 24);
  const summary = truncate(detail.summaryContents || detail.apvTitle || '-', 500);
  // Slack section text 최대 3000 — 상세가 길면 블록을 여러 개로 나눔
  const detailText = htmlToPlainText(detail.htmlCnts, 12000);
  const detailBlocks = splitDetailSections(detailText, 2800);

  const privateMetadata = JSON.stringify({
    apvApltNo: detail.apvApltNo,
    channelId: channelId || '',
    messageTs: messageTs || '',
    slackUserId: slackUserId || '',
  });

  return {
    type: 'modal',
    callback_id: MODAL_CALLBACK_ID,
    private_metadata: privateMetadata,
    title: { type: 'plain_text', text: title },
    // input 블록이 있으면 Slack이 submit 필드를 필수 — 실제 승인은 actions 버튼 사용
    submit: { type: 'plain_text', text: '확인' },
    close: { type: 'plain_text', text: '닫기' },
    blocks: [
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '*제목*\n' + (detail.apvTitle || '-') },
          { type: 'mrkdwn', text: '*기안자*\n' + (detail.apvReqUserInfo || '-') },
          { type: 'mrkdwn', text: '*요청일시*\n' + (detail.apvReqDttm || '-') },
          { type: 'mrkdwn', text: '*결재번호*\n' + detail.apvApltNo },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*내용*\n' + summary },
      },
      ...detailBlocks.map((chunk, i) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: (i === 0 ? '*상세 내용*\n' : '') + chunk,
        },
      })),
      {
        type: 'input',
        block_id: 'approval_comment_block',
        label: { type: 'plain_text', text: '결재 코멘트' },
        element: {
          type: 'plain_text_input',
          action_id: 'approval_comment',
          multiline: true,
          min_length: config.approval.commentMinLength,
          placeholder: {
            type: 'plain_text',
            text: '승인/반려 코멘트를 ' + config.approval.commentMinLength + '자 이상 입력하세요',
          },
        },
      },
      ...(needsApvUserPwd()
        ? [{
            type: 'input',
            block_id: 'password_block',
            label: {
              type: 'plain_text',
              text: config.approval.applyAsApprover
                ? 'HIWARE 비밀번호'
                : 'HIWARE 결재 비밀번호',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'password_input',
              placeholder: {
                type: 'plain_text',
                text: config.approval.applyAsApprover
                  ? '본인 HIWARE 로그인 비밀번호 (DB/로그 저장 안 함)'
                  : '결재 비밀번호 (DB/로그 저장 안 함)',
              },
            },
          }]
        : []),
      {
        type: 'actions',
        block_id: 'approval_action_block',
        elements: [
          {
            type: 'button',
            action_id: SLACK_ACTIONS.ASSENT,
            text: { type: 'plain_text', text: '승인' },
            style: 'primary',
            value: String(detail.apvApltNo),
          },
          {
            type: 'button',
            action_id: SLACK_ACTIONS.REJECT,
            text: { type: 'plain_text', text: '반려' },
            style: 'danger',
            value: String(detail.apvApltNo),
          },
        ],
      },
    ],
  };
}

/** Slack section 3000자 제한 대비 — 줄 단위로 청크 분할 */
function splitDetailSections(text, maxChunk) {
  const src = String(text || '').trim() || '(내용 없음)';
  if (src.length <= maxChunk) return [src];

  const chunks = [];
  let buf = '';
  for (const line of src.split('\n')) {
    const next = buf ? buf + '\n' + line : line;
    if (next.length > maxChunk && buf) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);

  // 모달 블록 수 여유 (헤더/입력/버튼 포함해 대략 10개 이하 권장)
  const MAX_CHUNKS = 6;
  if (chunks.length > MAX_CHUNKS) {
    const kept = chunks.slice(0, MAX_CHUNKS);
    const last = kept[MAX_CHUNKS - 1];
    kept[MAX_CHUNKS - 1] = last.slice(0, Math.max(0, maxChunk - 1)) + '…';
    return kept;
  }
  return chunks;
}

export function buildModalStatusView(title, message, { closeLabel = '닫기' } = {}) {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: truncate(title, 24) },
    close: { type: 'plain_text', text: closeLabel },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: message },
      },
    ],
  };
}

export function buildProcessingModal() {
  return buildModalStatusView(
    '처리 중',
    ':hourglass_flowing_sand: *결재 처리 중입니다.*\n잠시 후 결과가 표시됩니다.'
  );
}

/**
 * [상세/처리하기] 즉시 오픈용 — HIWARE 조회 전 로딩 Modal
 */
export function buildLoadingDetailModal(apvApltNo, { channelId, messageTs, slackUserId } = {}) {
  return {
    type: 'modal',
    callback_id: MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({
      apvApltNo: String(apvApltNo || ''),
      channelId: channelId || '',
      messageTs: messageTs || '',
      slackUserId: slackUserId || '',
    }),
    title: { type: 'plain_text', text: '결재 상세' },
    close: { type: 'plain_text', text: '닫기' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':hourglass_flowing_sand: *결재 상세를 불러오는 중입니다.*\n잠시만 기다려 주세요.',
        },
      },
    ],
  };
}

export function buildCompletedModal(actionLabel) {
  return buildModalStatusView(
    '처리 완료',
    ':white_check_mark: *' + actionLabel + ' 처리 완료*'
  );
}

export function buildErrorModal(message) {
  return buildModalStatusView('오류', ':warning: ' + message);
}

/** 처리자 본인 DM */
export function buildCompletedDmBlocks({ title, actorName, resultLabel, comment, processedAt }) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*[결재 처리 완료]*',
          '*제목:* ' + title,
          '*처리자:* ' + actorName,
          '*처리결과:* ' + resultLabel,
          '*처리일시:* ' + processedAt,
          '*코멘트:* ' + (comment || '-'),
        ].join('\n'),
      },
    },
  ];
}

/** ANY_ONE — 다른 결재자 처리 */
export function buildSkippedByOtherDmBlocks({ title, actorName, resultLabel, processedAt }) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*[결재 처리 완료]*',
          '*제목:* ' + title,
          '*안내:* 이 결재는 다른 결재자가 이미 처리했습니다.',
          '*처리자:* ' + actorName,
          '*처리결과:* ' + resultLabel,
          '*처리일시:* ' + processedAt,
        ].join('\n'),
      },
    },
  ];
}

/** 반려로 종료 */
export function buildClosedRejectedDmBlocks({ title, actorName, processedAt }) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*[결재 종료]*',
          '*제목:* ' + title,
          '*안내:* 이 결재는 반려되어 더 이상 처리할 수 없습니다.',
          '*처리자:* ' + actorName,
          '*처리일시:* ' + processedAt,
        ].join('\n'),
      },
    },
  ];
}

/** 기안자 최종 */
export function buildRequesterFinalDmBlocks({ title, requesterName, notifyType, actorName, processedAt, comment }) {
  const header = notifyType === 'FINAL_APPROVED' ? '*[결재 최종 승인]*' : '*[결재 반려]*';
  const actorLabel = notifyType === 'FINAL_APPROVED' ? '최종 처리자' : '반려자';
  const whenLabel = notifyType === 'FINAL_APPROVED' ? '완료' : '반려';
  const commentLabel = notifyType === 'FINAL_APPROVED' ? '코멘트' : '반려 사유';
  const lines = [
    header,
    '*제목:* ' + title,
    '*기안자:* ' + requesterName,
    '*' + actorLabel + ':* ' + actorName,
    '*' + whenLabel + '일시:* ' + processedAt,
  ];
  if (comment) lines.push('*' + commentLabel + ':* ' + comment);
  return [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }];
}

/** 재알림 DM */
export function buildReminderDmBlocks({ detail, reminderNo }) {
  const base = buildApprovalDm({ detail });
  const body = base.blocks[0].text.text.replace('*[결재 요청]*\n', '');
  base.blocks[0].text.text = '*:bell: [결재 리마인더 ' + reminderNo + '회차]*\n' + body;
  return base.blocks;
}

export function mapHiwareIntrayRow(row) {
  return {
    apv_aplt_no: String(row.apvApltNo),
    apv_title: row.apvReqTitleNm || row.sbtNm || '',
    apv_req_user_no: String(row.apvReqUserNo ?? ''),
    apv_req_user_id: row.apvReqUserId,
    apv_req_user_name: row.apvReqUserNm,
    apv_req_dttm: parseHiwareDate(row.apvReqDttm),
    apv_state_code: row.apvApltStateCode,
    apv_state_name: row.apvApltStateCodeNm,
    apv_reflt_state_code: row.apvApltRefltStateCode,
    apv_reflt_state_name: row.apvApltRefltStateCodeNm,
    summary_contents: row.apvReqTitleNm || row.sbtNm,
    raw_json: row,
  };
}

function parseHiwareDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':00';
}

/** HIWARE API content → ApprovalDetail */
export function mapHiwareApprovalDetail(content) {
  if (!content) return null;
  const c = content.content ?? content;
  return {
    apvApltNo: String(c.apvApltNo ?? ''),
    apvTitle: c.apvTitle || c.apvReqTitleNm,
    apvReqUserInfo: c.apvReqUserInfo || c.apvReqUserNm,
    apvReqDttm: c.apvReqDttm,
    summaryContents: c.summaryContents ?? c.apvTitle,
    htmlCnts: c.htmlCnts,
    apvApltStateCodeNm: c.apvApltStateCodeNm,
  };
}

export function extractModalActionValues(view) {
  const meta = JSON.parse(view?.private_metadata || '{}');
  const comment = view?.state?.values?.approval_comment_block?.approval_comment?.value || '';
  const apvUserPwd = view?.state?.values?.password_block?.password_input?.value || '';
  return { ...meta, comment, apvUserPwd };
}

export function parseSlackPayload(body) {
  if (!body?.payload) return null;
  try {
    return JSON.parse(body.payload);
  } catch {
    return null;
  }
}
