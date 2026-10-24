import type { AtsKind } from '@autoapply/shared';

export interface DetectedAts {
  ats: AtsKind;
  /** Greenhouse board token / Lever site / Ashby org. */
  board?: string;
  jobId?: string;
  /** Where the application form lives (may differ from the job page). */
  formUrl: string;
}

const safeUrl = (u: string) => {
  try {
    return new URL(u);
  } catch {
    return null;
  }
};

/** Tracking system from the job/apply URL, falling back to markers in the page HTML (research R2). */
export function detectAts(url: string, html?: string): DetectedAts {
  const u = safeUrl(url);
  if (u) {
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    if (/(^|\.)greenhouse\.io$/.test(host)) {
      if (parts[0] === 'embed' && u.searchParams.get('for')) {
        const board = u.searchParams.get('for')!;
        const jobId = u.searchParams.get('token') ?? undefined;
        return { ats: 'greenhouse', board, jobId, formUrl: jobId ? `https://job-boards.greenhouse.io/${board}/jobs/${jobId}` : url };
      }
      const i = parts.indexOf('jobs');
      if (i >= 1 && parts[i + 1]) {
        const board = parts[i - 1]!;
        const jobId = parts[i + 1]!.replace(/\D.*$/, '');
        return { ats: 'greenhouse', board, jobId, formUrl: `https://job-boards.greenhouse.io/${board}/jobs/${jobId}` };
      }
    }
    if (host === 'jobs.lever.co' && parts.length >= 2) {
      const [site, jobId] = parts as [string, string];
      return { ats: 'lever', board: site, jobId, formUrl: `https://jobs.lever.co/${site}/${jobId}/apply` };
    }
    if (host === 'jobs.ashbyhq.com' && parts.length >= 2) {
      const [org, jobId] = parts as [string, string];
      return { ats: 'ashby', board: decodeURIComponent(org), jobId, formUrl: `https://jobs.ashbyhq.com/${org}/${jobId}/application` };
    }
    const ghJid = u.searchParams.get('gh_jid');
    if (ghJid && html) {
      const board = html.match(/greenhouse\.io\/(?:embed\/job_board\/js\?for=|embed\/job_app\?for=)([\w-]+)/)?.[1];
      if (board) return { ats: 'greenhouse', board, jobId: ghJid, formUrl: `https://job-boards.greenhouse.io/${board}/jobs/${ghJid}` };
    }
  }
  if (html) {
    const gh = html.match(/(?:boards|job-boards)\.greenhouse\.io\/embed\/job_app\?for=([\w-]+)(?:&amp;|&)token=(\d+)/);
    if (gh) return { ats: 'greenhouse', board: gh[1], jobId: gh[2], formUrl: `https://job-boards.greenhouse.io/${gh[1]}/jobs/${gh[2]}` };
    const lever = html.match(/https:\/\/jobs\.lever\.co\/([\w.-]+)\/([0-9a-f-]{36})/i);
    if (lever) return { ats: 'lever', board: lever[1], jobId: lever[2], formUrl: `https://jobs.lever.co/${lever[1]}/${lever[2]}/apply` };
    const ashby = html.match(/https:\/\/jobs\.ashbyhq\.com\/([\w%.-]+)\/([0-9a-f-]{36})/i);
    if (ashby) return { ats: 'ashby', board: decodeURIComponent(ashby[1]!), jobId: ashby[2], formUrl: `https://jobs.ashbyhq.com/${ashby[1]}/${ashby[2]}/application` };
  }
  return { ats: 'generic', formUrl: url };
}

/** Frame URL belongs to a dedicated system (embedded forms on company pages). */
export function atsOfFrame(frameUrl: string): AtsKind | null {
  const d = detectAts(frameUrl);
  return d.ats === 'generic' ? null : d.ats;
}
