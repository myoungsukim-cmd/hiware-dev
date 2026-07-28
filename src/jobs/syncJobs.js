import { hiwareClient } from '../clients/HiwareClient.js';
import { slackClient } from '../clients/SlackClient.js';
import { hiwareUserRepository } from '../repositories/HiwareUserRepository.js';
import { slackUserMappingRepository } from '../repositories/SlackUserMappingRepository.js';
import { approvalSyncService } from '../services/ApprovalSyncService.js';
import { pickEmail, isMaskedEmail } from '../lib/hiwareUser.js';
import { logger } from '../lib/logger.js';

export class HiwareUserSyncJob {
  /**
   * 목록 API(/users)는 emailAddr 마스킹 → userNo별 상세 API로 이메일 보완
   */
  async run() {
    let start = 0;
    const limit = 100;
    let total = 0;
    let detailOk = 0;
    let detailFail = 0;

    while (true) {
      const res = await hiwareClient.getUsers({ start, limit });
      const users = res?.content || [];
      if (!users.length) break;

      for (const u of users) {
        let detail = u;
        try {
          const detailRes = await hiwareClient.getUser(u.userNo, 'userNo');
          if (detailRes?.content) {
            detail = { ...u, ...detailRes.content };
            detailOk += 1;
          }
        } catch (err) {
          detailFail += 1;
          logger.warn('user detail fetch failed', { userNo: u.userNo, error: err.message });
        }

        await hiwareUserRepository.upsert({
          hiware_user_no: String(detail.userNo ?? u.userNo),
          hiware_user_id: detail.userId ?? u.userId,
          hiware_user_name: detail.userNm ?? u.userNm,
          email_addr: pickEmail(detail.emailAddr, u.emailAddr),
          hp_no: detail.hpNo ?? u.hpNo,
          user_group_no: detail.userGrpNo != null ? String(detail.userGrpNo) : (u.userGrpNo != null ? String(u.userGrpNo) : null),
          user_state_code: detail.userStateTpCode ?? u.userStateTpCode,
          raw_json: detail,
        });
        total += 1;
      }

      if (users.length < limit) break;
      start += limit;
    }

    logger.info('HiwareUserSyncJob done', { total, detailOk, detailFail });
    return total;
  }
}

export const hiwareUserSyncJob = new HiwareUserSyncJob();

export class SlackUserMappingJob {
  async run() {
    const users = await hiwareUserRepository.findWithEmail();
    let mapped = 0;
    let failed = 0;
    for (const user of users) {
      if (isMaskedEmail(user.email_addr)) {
        logger.debug('skip mapping — no valid email', { userNo: user.hiware_user_no });
        failed += 1;
        continue;
      }
      try {
        const res = await slackClient.lookupUserByEmail(user.email_addr);
        if (!res?.ok || !res?.user?.id) {
          await slackUserMappingRepository.upsertNotFound(
            {
              hiware_user_no: user.hiware_user_no,
              hiware_user_id: user.hiware_user_id,
              hiware_user_name: user.hiware_user_name,
              email_addr: user.email_addr,
            },
            res?.error || 'Slack user not found'
          );
          failed += 1;
          continue;
        }
        await slackUserMappingRepository.upsertMapped({
          hiware_user_no: user.hiware_user_no,
          hiware_user_id: user.hiware_user_id,
          hiware_user_name: user.hiware_user_name,
          email_addr: user.email_addr,
          slack_team_id: res.user.team_id,
          slack_user_id: res.user.id,
        });
        mapped += 1;
      } catch (err) {
        logger.warn('mapping failed', { userNo: user.hiware_user_no, error: err.message });
        failed += 1;
      }
    }
    logger.info('SlackUserMappingJob done', { mapped, failed });
    return { mapped, failed };
  }
}

export const slackUserMappingJob = new SlackUserMappingJob();

export class HiwareApprovalSyncJob {
  async run() {
    return approvalSyncService.syncFromIntray();
  }
}

export const hiwareApprovalSyncJob = new HiwareApprovalSyncJob();
