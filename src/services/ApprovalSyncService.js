import { config } from '../config/index.js';
import { hiwareClient } from '../clients/HiwareClient.js';
import { slackUserMappingRepository } from '../repositories/SlackUserMappingRepository.js';
import { approvalItemRepository } from '../repositories/ApprovalItemRepository.js';
import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import { mapHiwareIntrayRow } from '../slack/blockKit.js';
import { logger } from '../lib/logger.js';

/**
 * §13.3 intray 기반 미결재 동기화 (View Table 없을 때 §6.1)
 */
export class ApprovalSyncService {
  async syncFromIntray() {
    const mappings = await slackUserMappingRepository.findAllMapped();
    let items = 0;
    const seenApv = new Map();

    for (const mapping of mappings) {
      const res = await hiwareClient.getIntray({ userNo: mapping.hiware_user_no, limit: 100 });
      for (const raw of res?.content || []) {
        const mapped = mapHiwareIntrayRow(raw);
        await approvalItemRepository.upsertFromIntray(mapped);
        const step = config.approval.defaultStep;
        await approvalApproverRepository.upsertFromIntray({
          apv_aplt_no: mapped.apv_aplt_no,
          hiware_user_no: mapping.hiware_user_no,
          hiware_user_id: mapping.hiware_user_id,
          hiware_user_name: mapping.hiware_user_name,
          slack_user_id: mapping.slack_user_id,
          approval_step: step,
          approval_rule: 'SINGLE',
          approval_group_key: null,
        });
        const key = `${mapped.apv_aplt_no}:${step}`;
        seenApv.set(key, (seenApv.get(key) || 0) + 1);
        items += 1;
      }
    }

    for (const [key, count] of seenApv) {
      if (count > 1) {
        const [apv, step] = key.split(':');
        await approvalApproverRepository.markParallelRule(apv, Number(step));
      }
    }

    logger.info('ApprovalSyncService done', { mappings: mappings.length, intrayRows: items });
    return items;
  }

  /** 승인 후 최종 여부 — HIWARE 상세 + intray 잔존 여부 */
  async isApprovalFinal(apvApltNo, hiwareResultMessage = '') {
    if (/완료/.test(hiwareResultMessage)) return true;
    try {
      const raw = await hiwareClient.getApprovalDetail(apvApltNo);
      const c = raw?.content;
      const stateNm = c?.apvApltStateCodeNm || '';
      if (/완료/.test(stateNm) || c?.apvApltStateCode === '05') return true;

      const mappings = await slackUserMappingRepository.findAllMapped();
      for (const m of mappings) {
        const intray = await hiwareClient.getIntray({ userNo: m.hiware_user_no, limit: 50 });
        if ((intray?.content || []).some((r) => String(r.apvApltNo) === String(apvApltNo))) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const approvalSyncService = new ApprovalSyncService();
