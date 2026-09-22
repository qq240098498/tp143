const crypto = require('crypto');
const {
  load, save, MAX_NOTE, SEASON_ASSIGNMENT_LIMIT, ASSISTANT_SLOTS,
} = require('./store');
const { ApiError, pickText } = require('./errors');

const DAY_MS = 24 * 60 * 60 * 1000;
// 派场只面向还没吹的比赛：已赛场次的裁判组锁死留档，取消的比赛不需要派场
const OPEN_STATUS = ['待赛', '延期'];

function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

function teamName(data, id) {
  const team = data.teams.find((item) => item.id === id);
  return team ? team.name : '未知球队';
}

function matchLabel(data, match) {
  return `第 ${match.round} 轮 ${match.date} ${match.kickoff} ${teamName(data, match.homeTeamId)} vs ${teamName(data, match.awayTeamId)}`;
}

function refereeView(data, assignment) {
  const referee = data.referees.find((item) => item.id === assignment.refereeId);
  return {
    assignmentId: assignment.id,
    refereeId: assignment.refereeId,
    name: referee ? referee.name : '未知裁判',
    level: referee ? referee.level : '',
    status: referee ? referee.status : '停用',
  };
}

function crewOf(data, matchId) {
  const rows = data.assignments.filter((item) => item.matchId === matchId);
  return {
    head: rows.find((item) => item.role === '主裁') || null,
    assistants: rows.filter((item) => item.role === '助理'),
  };
}

// 这名裁判在其他场次（不含本场）的派场记录；已经取消的场次不再占用名额
function otherAssignments(data, refereeId, matchId) {
  return data.assignments
    .filter((item) => item.refereeId === refereeId && item.matchId !== matchId)
    .map((item) => ({ assignment: item, match: data.matches.find((m) => m.id === item.matchId) }))
    .filter((item) => item.match && item.match.status !== '取消');
}

// 相邻两天提示用：找出日期相差正好一天的其他场次
function adjacentMatches(data, refereeId, date, matchId) {
  return otherAssignments(data, refereeId, matchId)
    .filter((item) => Math.abs(dayDiff(date, item.match.date)) === 1)
    .map((item) => ({ matchId: item.match.id, date: item.match.date, label: matchLabel(data, item.match) }));
}

function assertMatchOpen(match) {
  if (match.status === '已赛') {
    throw new ApiError(409, 'MATCH_ALREADY_PLAYED', '这场已经开赛并打完，裁判组不能再改动', '');
  }
  if (match.status === '取消') {
    throw new ApiError(409, 'MATCH_CANCELED', '这场已经取消，不需要派场', '');
  }
}

// 派场前的三条硬口径：人要在册、同一天不兼场、一季总数不超上限
// adjacent 收集相邻两天的软提示，调用方决定是否回给页面；fieldName 让页面把错误标回具体位置
function checkRefereePick(data, match, refereeId, adjacent, fieldName) {
  const field = fieldName || 'refereeId';
  const referee = data.referees.find((item) => item.id === refereeId);
  if (!referee) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这名裁判没有登记过', field);
  if (referee.status !== '在册') {
    throw new ApiError(409, 'REFEREE_NOT_ACTIVE', `${referee.name} 已经停用，不能派场，先在裁判里恢复在册状态`, field);
  }

  const sameDay = otherAssignments(data, refereeId, match.id).find((item) => item.match.date === match.date);
  if (sameDay) {
    throw new ApiError(
      409,
      'SAME_DAY_CONFLICT',
      `${match.date} 这天 ${referee.name} 已经在吹「${matchLabel(data, sameDay.match)}」，同一天不能再派第二场`,
      field,
    );
  }

  const otherCount = otherAssignments(data, refereeId, match.id).length;
  const remaining = SEASON_ASSIGNMENT_LIMIT - otherCount;
  if (remaining <= 0) {
    const over = otherCount + 1 - SEASON_ASSIGNMENT_LIMIT;
    throw new ApiError(
      409,
      'SEASON_LIMIT_EXCEEDED',
      `${referee.name} 本季已派 ${otherCount} 场、上限 ${SEASON_ASSIGNMENT_LIMIT} 场，再派这一场就是 ${otherCount + 1} 场，超出上限 ${over} 场，请改派别人`,
      field,
    );
  }

  if (adjacent) {
    const neighbors = adjacentMatches(data, refereeId, match.date, match.id);
    if (neighbors.length > 0 && !adjacent.some((item) => item.refereeId === refereeId)) {
      adjacent.push({ refereeId, name: referee.name, matches: neighbors });
    }
  }
}

function warningText(adjacent) {
  return adjacent.map((item) => {
    const dates = Array.from(new Set(item.matches.map((m) => m.date))).join('、');
    return `${item.name} 在相邻的 ${dates} 也有派场，请注意连着吹两场`;
  });
}

function decorateMatch(data, match) {
  const crew = crewOf(data, match.id);
  const head = crew.head ? refereeView(data, crew.head) : null;
  const slots = [];
  for (let i = 0; i < ASSISTANT_SLOTS; i += 1) {
    slots.push(crew.assistants[i] ? refereeView(data, crew.assistants[i]) : null);
  }
  const people = [];
  if (head) people.push(head);
  slots.forEach((slot) => { if (slot) people.push(slot); });
  const adjacentFlags = [];
  people.forEach((person) => {
    const neighbors = adjacentMatches(data, person.refereeId, match.date, match.id);
    if (neighbors.length > 0) {
      adjacentFlags.push({ refereeId: person.refereeId, name: person.name, text: warningText([{ refereeId: person.refereeId, name: person.name, matches: neighbors }])[0] });
    }
  });
  return {
    id: match.id,
    round: match.round,
    date: match.date,
    kickoff: match.kickoff,
    status: match.status,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeName: teamName(data, match.homeTeamId),
    awayName: teamName(data, match.awayTeamId),
    head,
    assistantSlots: slots,
    complete: Boolean(head) && slots.every(Boolean),
    open: OPEN_STATUS.includes(match.status),
    adjacentFlags,
  };
}

// 派场看板：未派满的排到最前面单独提醒，其余按轮次日期排
function listBoard(options) {
  const input = options && typeof options === 'object' ? options : {};
  const round = Number(pickText(input.round));
  const data = load();

  let list = data.matches.filter((item) => item.status !== '取消');
  if (Number.isInteger(round) && round > 0) list = list.filter((item) => item.round === round);
  const decorated = list.map((item) => decorateMatch(data, item));
  decorated.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    return (a.round - b.round) || (a.date < b.date ? -1 : 1) || (a.kickoff < b.kickoff ? -1 : 1);
  });

  const needCrew = data.matches.filter((item) => item.status !== '取消');
  const incomplete = needCrew.filter((match) => !decorateMatch(data, match).complete);
  const openIncomplete = incomplete.filter((match) => OPEN_STATUS.includes(match.status));
  return {
    matches: decorated,
    limit: SEASON_ASSIGNMENT_LIMIT,
    stats: {
      total: needCrew.length,
      complete: needCrew.length - incomplete.length,
      incomplete: incomplete.length,
      openIncomplete: openIncomplete.length,
    },
    rounds: Array.from(new Set(data.matches.map((item) => item.round))).sort((a, b) => a - b),
  };
}

function appendLog(data, entry) {
  data.assignmentLogs.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry });
}

// 整场一次派齐（或调整）：主裁一个、助理两个位置，空字符串表示该位置先空着
function assignMatch(matchId, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const match = data.matches.find((item) => item.id === matchId);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  assertMatchOpen(match);

  const reason = pickText(source.reason);
  if (reason.length > MAX_NOTE) throw new ApiError(400, 'REASON_TOO_LONG', `改派说明不能超过 ${MAX_NOTE} 个字`, 'reason');
  const operator = pickText(source.operator);

  const headId = pickText(source.headRefereeId);
  const rawAssistants = Array.isArray(source.assistantRefereeIds) ? source.assistantRefereeIds.slice(0, ASSISTANT_SLOTS) : [];
  const assistantIds = [];
  for (let i = 0; i < ASSISTANT_SLOTS; i += 1) assistantIds.push(pickText(rawAssistants[i]));

  const picks = [];
  if (headId) picks.push({ role: '主裁', refereeId: headId, field: 'headRefereeId' });
  assistantIds.forEach((id, index) => {
    if (id) picks.push({ role: '助理', refereeId: id, field: `assistant${index + 1}RefereeId` });
  });

  // 同一场的主裁与助理不能是同一人
  const pickedIds = picks.map((item) => item.refereeId);
  if (new Set(pickedIds).size !== pickedIds.length) {
    throw new ApiError(409, 'ROLE_SAME_PERSON', '同一场的主裁与助理不能是同一人，请给每个位置选不同的裁判', 'headRefereeId');
  }

  const adjacent = [];
  picks.forEach((item) => checkRefereePick(data, match, item.refereeId, adjacent, item.field));

  const crew = crewOf(data, match.id);
  const oldSlots = [
    { role: '主裁', from: crew.head ? crew.head.refereeId : '', assignment: crew.head },
    { role: '助理', from: crew.assistants[0] ? crew.assistants[0].refereeId : '', assignment: crew.assistants[0] || null },
    { role: '助理', from: crew.assistants[1] ? crew.assistants[1].refereeId : '', assignment: crew.assistants[1] || null },
  ];
  const newIds = [headId, assistantIds[0], assistantIds[1]];
  const label = matchLabel(data, match);

  data.assignments = data.assignments.filter((item) => item.matchId !== matchId);
  const now = new Date().toISOString();
  newIds.forEach((id, index) => {
    if (!id) return;
    data.assignments.push({
      id: crypto.randomUUID(),
      matchId,
      role: index === 0 ? '主裁' : '助理',
      refereeId: id,
      createdAt: now,
      updatedAt: now,
    });
  });

  // 每个发生变化的位置都留痕：空→人是派场，人→人是改派，人→空是撤场
  oldSlots.forEach((slot, index) => {
    const to = newIds[index];
    if (slot.from === to) return;
    const kind = slot.from && to ? '改派' : (to ? '派场' : '撤场');
    appendLog(data, {
      kind,
      matchId,
      matchLabel: label,
      role: slot.role,
      fromRefereeId: slot.from,
      fromName: slot.from ? data.referees.find((r) => r.id === slot.from)?.name || '未知裁判' : '',
      toRefereeId: to,
      toName: to ? data.referees.find((r) => r.id === to)?.name || '未知裁判' : '',
      reason,
      operator,
    });
  });

  save(data);
  return { match: decorateMatch(data, match), warnings: warningText(adjacent) };
}

// 单个位置改派（裁判临时不能来时用）：assignmentId 定位主裁或某位助理，toRefereeId 传空表示先撤下
function reassignSlot(matchId, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const match = data.matches.find((item) => item.id === matchId);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  assertMatchOpen(match);

  const assignmentId = pickText(source.assignmentId);
  const assignment = data.assignments.find((item) => item.id === assignmentId && item.matchId === matchId);
  if (!assignment) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', '这个派场位置不存在，可能已经被整场重派覆盖', 'assignmentId');

  const toId = pickText(source.toRefereeId);
  const reason = pickText(source.reason);
  if (reason.length > MAX_NOTE) throw new ApiError(400, 'REASON_TOO_LONG', `改派说明不能超过 ${MAX_NOTE} 个字`, 'reason');
  const operator = pickText(source.operator);
  const fromId = assignment.refereeId;
  if (toId === fromId) {
    throw new ApiError(400, 'NO_CHANGE', '新裁判与原裁判是同一人，不需要改派', 'toRefereeId');
  }

  if (toId) {
    // 不能顶掉自己人：同一场其他位置已经是这名裁判
    const duplicated = data.assignments.some((item) => item.matchId === matchId && item.id !== assignmentId && item.refereeId === toId);
    if (duplicated) {
      throw new ApiError(409, 'ROLE_SAME_PERSON', '同一场的主裁与助理不能是同一人，请换一名裁判', 'toRefereeId');
    }
    const adjacent = [];
    checkRefereePick(data, match, toId, adjacent);
    assignment.refereeId = toId;
    assignment.updatedAt = new Date().toISOString();
    const label = matchLabel(data, match);
    appendLog(data, {
      kind: '改派',
      matchId,
      matchLabel: label,
      role: assignment.role,
      fromRefereeId: fromId,
      fromName: data.referees.find((r) => r.id === fromId)?.name || '未知裁判',
      toRefereeId: toId,
      toName: data.referees.find((r) => r.id === toId)?.name || '未知裁判',
      reason,
      operator,
    });
    save(data);
    return { match: decorateMatch(data, match), warnings: warningText(adjacent) };
  }

  // 撤下这个位置
  const label = matchLabel(data, match);
  data.assignments = data.assignments.filter((item) => item.id !== assignmentId);
  appendLog(data, {
    kind: '撤场',
    matchId,
    matchLabel: label,
    role: assignment.role,
    fromRefereeId: fromId,
    fromName: data.referees.find((r) => r.id === fromId)?.name || '未知裁判',
    toRefereeId: '',
    toName: '',
    reason,
    operator,
  });
  save(data);
  return { match: decorateMatch(data, match), warnings: [] };
}

// 按人给出已派场清单，并标出相邻两天连着吹的场次
function refereeSchedule(refereeId) {
  const data = load();
  const referee = data.referees.find((item) => item.id === refereeId);
  if (!referee) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这名裁判不存在或已被删除', '');

  const rows = data.assignments
    .filter((item) => item.refereeId === refereeId)
    .map((item) => {
      const match = data.matches.find((m) => m.id === item.matchId);
      return match ? { assignment: item, match } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.match.date < b.match.date ? -1 : 1) || (a.match.kickoff < b.match.kickoff ? -1 : 1));

  // 赛季名额只数还没取消的场次；取消场仍列在清单里留档，但标注不计名额
  const counting = rows.filter((item) => item.match.status !== '取消');
  const dates = new Set(counting.map((item) => item.match.date));
  const matches = rows.map(({ assignment, match }) => {
    const counts = match.status !== '取消';
    const before = counts && Array.from(dates).some((date) => dayDiff(date, match.date) === 1);
    const after = counts && Array.from(dates).some((date) => dayDiff(match.date, date) === 1);
    return {
      assignmentId: assignment.id,
      matchId: match.id,
      role: assignment.role,
      round: match.round,
      date: match.date,
      kickoff: match.kickoff,
      status: match.status,
      homeName: teamName(data, match.homeTeamId),
      awayName: teamName(data, match.awayTeamId),
      label: matchLabel(data, match),
      open: OPEN_STATUS.includes(match.status),
      countsTowardLimit: counts,
      adjacentBefore: before,
      adjacentAfter: after,
      consecutive: before || after,
    };
  });

  return {
    referee: {
      id: referee.id,
      name: referee.name,
      level: referee.level,
      status: referee.status,
      note: referee.note,
    },
    total: counting.length,
    listedCount: matches.length,
    limit: SEASON_ASSIGNMENT_LIMIT,
    remaining: Math.max(0, SEASON_ASSIGNMENT_LIMIT - counting.length),
    consecutiveCount: matches.filter((item) => item.consecutive).length,
    matches,
  };
}

function listLogs() {
  const data = load();
  const logs = data.assignmentLogs.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  return { logs, total: logs.length };
}

// 开赛哨兵：状态转成已赛前，裁判组必须齐整
function requireCrewComplete(data, match) {
  const view = decorateMatch(data, match);
  if (!view.complete) {
    const missing = [];
    if (!view.head) missing.push('主裁');
    view.assistantSlots.forEach((slot, index) => { if (!slot) missing.push(`助理 ${index + 1}`); });
    throw new ApiError(
      409,
      'CREW_INCOMPLETE',
      `「${matchLabel(data, match)}」还没派齐裁判（缺 ${missing.join('、')}），不能开赛登记比分`,
      '',
    );
  }
}

module.exports = {
  listBoard,
  assignMatch,
  reassignSlot,
  refereeSchedule,
  listLogs,
  requireCrewComplete,
  matchLabel,
};
