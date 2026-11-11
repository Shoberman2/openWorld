// The `team` block of GET /api/stats, from the local event log. The learning metric: of the game
// sessions connected to a team, the share where at least one teammate was online at the same time.
import { existsSync, readFileSync } from 'node:fs';
import { PATHS } from '../config.ts';

export function teamStats() {
  const lines = existsSync(PATHS.events) ? readFileSync(PATHS.events, 'utf8').split('\n').filter(Boolean) : [];
  const onTeam = new Set<string>(), together = new Set<string>(), met = new Set<string>();
  const count = { team_hosted: 0, team_joined: 0, team_message_sent: 0, team_teleport: 0, team_seen_together: 0 };
  for (const line of lines) {
    if (!line.includes('"team_')) continue;
    try {
      const e = JSON.parse(line);
      if (e.props?.automated) continue;
      const s = e.props?.session;
      if (e.name === 'team_online' && s) onTeam.add(s);
      if (e.name === 'team_company' && s) together.add(s);
      if (e.name === 'team_seen_together' && s) met.add(s);
      if (e.name in count) count[e.name as keyof typeof count]++;
    } catch { /* skip bad line */ }
  }
  return {
    hosted: count.team_hosted,
    joined: count.team_joined,
    messagesSent: count.team_message_sent,
    teleports: count.team_teleport,
    seenTogether: count.team_seen_together,
    /** Game sessions that were connected to a team. */
    teamSessions: onTeam.size,
    /** ...of those, sessions where 2+ people were online at once. */
    sessionsWithCompany: together.size,
    companyShare: onTeam.size ? Math.round((together.size / onTeam.size) * 1000) / 1000 : 0,
    /** Sessions where two players stood within 50 m of each other. */
    sessionsMetUp: met.size,
  };
}
