/**
 * docs/slack-ui-sample.html SAMPLE_DETAILS 와 동일 — PC mock E2E용
 * key = apvApltNo
 */
export const MOCK_APPROVAL_DETAILS = {
  '202607200012': {
    apvApltNo: '202607200012',
    apvTitle: '시스템 계정 신청 (DEV)',
    apvReqUserInfo: '김기안 (kim.draft)',
    apvReqDttm: '2026.07.20 09:15',
    apvApltStateCodeNm: '결재 대기',
    apvApltStateCode: '01',
    summaryContents: '시스템 계정 신규 신청 — DEV / 일반사용자 / 2026.07.21 ~ 2026.08.20',
    htmlCnts:
      '<table>' +
      '<tr><th>신청 유형</th><td>시스템 계정 신규</td></tr>' +
      '<tr><th>대상 시스템</th><td>HIWARE DEV</td></tr>' +
      '<tr><th>계정 ID</th><td>kim.draft</td></tr>' +
      '<tr><th>권한</th><td>일반 사용자</td></tr>' +
      '<tr><th>사용 기간</th><td>2026.07.21 ~ 2026.08.20</td></tr>' +
      '<tr><th>사유</th><td>프로젝트 PoC 검증용 계정 필요</td></tr>' +
      '</table>',
  },
  '202607200101': {
    apvApltNo: '202607200101',
    apvTitle: '서버 접근 권한 신청',
    apvReqUserInfo: '이서버 (lee.srv)',
    apvReqDttm: '2026.07.20 10:05',
    apvApltStateCodeNm: '결재 대기',
    apvApltStateCode: '01',
    summaryContents: '서버 접근 권한 신청 3건 — was-dev-01, was-dev-02, batch-dev-01 (기간 7일)',
    htmlCnts:
      '<p><b>신청 개요</b></p>' +
      '<table>' +
      '<tr><th>신청 유형</th><td>서버 접근 권한</td></tr>' +
      '<tr><th>접근 방식</th><td>SSH (계정 접속)</td></tr>' +
      '<tr><th>권한</th><td>일반 사용자</td></tr>' +
      '<tr><th>사용 기간</th><td>2026.07.21 ~ 2026.07.27</td></tr>' +
      '<tr><th>사유</th><td>배포 검증 및 로그 확인</td></tr>' +
      '</table>' +
      '<p><b>대상 서버 (3건)</b></p>' +
      '<table>' +
      '<tr><th>No</th><th>호스트명</th><th>IP</th><th>OS</th><th>환경</th></tr>' +
      '<tr><td>1</td><td>was-dev-01</td><td>10.20.30.11</td><td>RHEL 8</td><td>DEV</td></tr>' +
      '<tr><td>2</td><td>was-dev-02</td><td>10.20.30.12</td><td>RHEL 8</td><td>DEV</td></tr>' +
      '<tr><td>3</td><td>batch-dev-01</td><td>10.20.30.21</td><td>RHEL 8</td><td>DEV</td></tr>' +
      '</table>',
  },
};

export function getMockApprovalDetail(apvApltNo) {
  const key = String(apvApltNo || '');
  if (MOCK_APPROVAL_DETAILS[key]) return MOCK_APPROVAL_DETAILS[key];
  return {
    apvApltNo: key,
    apvTitle: '[MOCK] 로컬 테스트 결재',
    apvReqUserInfo: 'mock-requester',
    apvReqDttm: '2026.07.28 23:54',
    summaryContents: 'PC 로컬 mock 상세입니다. 승인/반려 테스트용.',
    htmlCnts: '<p>상세 HTML mock 내용</p>',
    apvApltStateCodeNm: '결재 대기',
    apvApltStateCode: '01',
  };
}
