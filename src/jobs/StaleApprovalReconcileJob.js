import { approvalSyncService } from '../services/ApprovalSyncService.js';
import { approvalItemRepository } from '../repositories/ApprovalItemRepository.js';
import { hiwareClient } from '../clients/HiwareClient.js';
import { requesterNotifier } from '../services/RequesterNotifier.js';
import { logger } from '../lib/logger.js';

export class StaleApprovalReconcileJob {
  async run() {
    await approvalSyncService.syncFromIntray();
    const active = await approvalItemRepository.findActiveItems();
    let reconciled = 0;
    let requesterRetried = 0;

    for (const item of active) {
      try {
        const raw = await hiwareClient.getApprovalDetail(item.apv_aplt_no);
        const c = raw?.content;
        if (!c) continue;
        const stateNm = c.apvApltStateCodeNm || '';
        let newStatus = item.status;
        if (/반려/.test(stateNm)) newStatus = 'REJECTED';
        else if (/완료/.test(stateNm) || c.apvApltStateCode === '05') newStatus = 'APPROVED';
        else if (/취소/.test(stateNm)) newStatus = 'CANCELED';

        if (newStatus !== item.status && ['APPROVED', 'REJECTED', 'CANCELED'].includes(newStatus)) {
          await approvalItemRepository.updateStatus(item.apv_aplt_no, {
            status: newStatus,
            apv_state_code: c.apvApltStateCode,
            apv_state_name: stateNm,
            completed_at: new Date(),
          });
          await requesterNotifier.notifyRequesterIfFinal(item.apv_aplt_no);
          reconciled += 1;
        }
      } catch (err) {
        logger.warn('reconcile item failed', { apv: item.apv_aplt_no, error: err.message });
      }
    }

    // 이미 최종 처리됐지만 기안자 DM이 누락된 건 재시도
    const pendingNotify = await approvalItemRepository.findPendingRequesterNotify();
    for (const item of pendingNotify) {
      try {
        const sent = await requesterNotifier.notifyRequesterIfFinal(item.apv_aplt_no);
        if (sent) requesterRetried += 1;
      } catch (err) {
        logger.warn('requester notify retry failed', { apv: item.apv_aplt_no, error: err.message });
      }
    }

    logger.info('StaleApprovalReconcileJob done', {
      active: active.length,
      reconciled,
      pendingNotify: pendingNotify.length,
      requesterRetried,
    });
    return reconciled;
  }
}

export const staleApprovalReconcileJob = new StaleApprovalReconcileJob();
