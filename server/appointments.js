// 裁判派场：给每场比赛配齐一名主裁与两名助理，并守住三条派场口径
// 一、同一天同一人不能出现在两场比赛里（硬拒）
// 二、相邻两天都有派场时给出提示（不拦截）
// 三、一季派场总数超过个人上限时当场拒绝，并说明超出几场
const crypto = require('crypto');
const { load, save, MAX_NOTE, APPOINT_SLOTS } = require('./store');
const { ApiError, pickText } = require('./errors');
const { nameMaps } = require('./standings');

// 取消的场次不再占用裁判，也不计入季派场数
function isActive(match) {
  return Boolean(match) && match.status !== '取消';
}

function appointmentsOf(data, matchId) {
  return data.appointments.filter((item) => item.matchId === matchId);
}

function slotMapOf(data, matchId) {
  const map = new Map();
  appointmentsOf(data, matchId).forEach((item) => map.set(item.slot, item));
  return map;
}

// 一场配齐要三个槽位都有人
function isComplete(data, matchId) {
  const taken = slotMapOf(data, matchId);
  return APPOINT_SLOTS.every((slot) => taken.has(slot));
}

function matchIndex(data) {
  return new Map(data.matches.map((item) => [item.id, item]));
}

// 个人本季已派场数：取消的场次不算
function refereeCount(data, refereeId, excludeMatchId) {
  const matches = matchIndex(data);
  return data.appointments.filter((item) => item.refereeId === refereeId
    && item.matchId !== excludeMatchId
    && isActive(matches.get(item.matchId))).length;
}

function shiftDay(dateIso, delta) {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

// 查这个人在指定日期的另一场派场，用于同日冲突的硬校验
function findSameDayClash(data, refereeId, date, selfMatchId) {
  const matches = matchIndex(data);
  return data.appointments.find((item) => item.refereeId === refereeId
    && item.matchId !== selfMatchId
    && matches.get(item.matchId)
    && isActive(matches.get(item.matchId))
    && matches.get(item.matchId).date === date) || null;
}

// 查这个人前一天或后一天的派场，只做提示，不拦截
function findAdjacent(data, refereeId, date, selfMatchId) {
  const matches = matchIndex(data);
  const result = [];
  [-1, 1].forEach((delta) => {
    const nearDate = shiftDay(date, delta);
    const found = data.appointments.find((item) => item.refereeId === refereeId
      && item.matchId !== selfMatchId
      && matches.get(item.matchId)
      && isActive(matches.get(item.matchId))
      && matches.get(item.matchId).date === nearDate);
    if (found) result.push({ refereeId, date: nearDate, matchId: found.matchId, side: delta === -1 ? '前一天' : '后一天' });
  });
  return result;
}

// 改期时复查这场现有的三名裁判会不会在新日期与别的场次撞车
function findDateMoveClashes(data, matchId, newDate) {
  const matches = matchIndex(data);
  const problems = [];
  appointmentsOf(data, matchId).forEach((appt) => {
    const clash = findSameDayClash(data, appt.refereeId, newDate, matchId);
    if (clash) {
      problems.push({
        refereeId: appt.refereeId,
        refereeName: data.referees.find((r) => r.id === appt.refereeId)?.name || '未知裁判',
        slot: appt.slot,
        otherMatchId: clash.matchId,
        otherMatch: matches.get(clash.matchId),
      });
    }
  });
  return problems;
}

// 到点开赛了没有：延期的比赛已明确推迟，不算开赛；已赛与取消也不提醒，只提醒到点却没打的待赛场
function hasStarted(match, now) {
  const probe = now || new Date();
  if (match.status !== '待赛') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(match.kickoff)) return false;
  return new Date(`${match.date}T${match.kickoff}:00`).getTime() <= probe.getTime();
}

function matchLabel(match, teams) {
  const home = teams.get(match.homeTeamId);
  const away = teams.get(match.awayTeamId);
  return `第 ${match.round} 轮 ${home ? home.name : '未知球队'} 对 ${away ? away.name : '未知球队'}（${match.date}）`;
}

function decorateMatch(data, item, teams, venues, now) {
  const home = teams.get(item.homeTeamId);
  const away = teams.get(item.awayTeamId);
  const venue = item.venueId ? venues.get(item.venueId) : venues.get(home ? home.venueId : '');
  const taken = slotMapOf(data, item.id);
  const slots = APPOINT_SLOTS.map((slot) => {
    const appt = taken.get(slot);
    const referee = appt ? data.referees.find((r) => r.id === appt.refereeId) : null;
    return {
      slot,
      appointmentId: appt ? appt.id : '',
      refereeId: referee ? referee.id : '',
      refereeName: referee ? referee.name : '',
      refereeLevel: referee ? referee.level : '',
      refereeStatus: referee ? referee.status : '',
    };
  });
  const warnings = [];
  slots.forEach((row) => {
    if (!row.refereeId) return;
    findAdjacent(data, row.refereeId, item.date, item.id).forEach((near) => {
      const other = data.matches.find((m) => m.id === near.matchId);
      warnings.push({
        slot: row.slot,
        refereeId: row.refereeId,
        refereeName: row.refereeName,
        text: `${row.refereeName} ${near.side}（${near.date}）还有一场第 ${other ? other.round : '?'} 轮的派场，连着吹请注意休息`,
      });
    });
  });
  return {
    matchId: item.id,
    round: item.round,
    date: item.date,
    kickoff: item.kickoff,
    status: item.status,
    homeTeamId: item.homeTeamId,
    awayTeamId: item.awayTeamId,
    homeName: home ? home.name : '未知球队',
    awayName: away ? away.name : '未知球队',
    venueName: venue ? venue.name : '未指定',
    slots,
    complete: isComplete(data, item.id),
    started: hasStarted(item, now),
    warnings,
  };
}

// 派场视图：逐场列出三个槽位，另给没配齐与已经开赛的缺口清单
function listAppointments(options) {
  const input = options && typeof options === 'object' ? options : {};
  const round = Number(pickText(input.round));
  const status = pickText(input.status);
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();
  const { teams, venues } = nameMaps();
  const now = new Date();

  let list = data.matches.filter((item) => item.status !== '取消');
  if (Number.isInteger(round) && round > 0) list = list.filter((item) => item.round === round);
  if (status) list = list.filter((item) => item.status === status);
  if (keyword) {
    list = list.filter((item) => {
      const home = teams.get(item.homeTeamId);
      const away = teams.get(item.awayTeamId);
      return `${home ? home.name + home.city : ''}${away ? away.name + away.city : ''}`.toLowerCase().includes(keyword);
    });
  }
  list.sort((a, b) => (a.round - b.round) || (a.date < b.date ? -1 : 1) || (a.kickoff < b.kickoff ? -1 : 1));

  const gapMatches = data.matches.filter((item) => (item.status === '待赛' || item.status === '延期') && !isComplete(data, item.id));
  const gaps = gapMatches.map((item) => decorateMatch(data, item, teams, venues, now));
  const urgentGaps = gaps.filter((item) => item.started);

  const activeCount = data.matches.filter((item) => item.status !== '取消').length;
  return {
    matches: list.map((item) => decorateMatch(data, item, teams, venues, now)),
    rounds: Array.from(new Set(data.matches.map((item) => item.round))).sort((a, b) => a - b)
      .map((value) => ({ round: value })),
    gaps,
    urgentGaps,
    total: activeCount,
    completeCount: data.matches.filter((item) => item.status !== '取消' && isComplete(data, item.id)).length,
    gapCount: gaps.length,
    urgentGapCount: urgentGaps.length,
    season: data.meta.season,
  };
}

// 配齐抽屉里的候选人：逐个槽位标出能不能选，以及不能选的原因
function matchOptions(matchId) {
  const data = load();
  const match = data.matches.find((item) => item.id === matchId);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  const { teams, venues } = nameMaps();
  const current = slotMapOf(data, matchId);

  const slots = APPOINT_SLOTS.map((slot) => {
    const incumbent = current.get(slot);
    const candidates = data.referees.map((referee) => {
      const reasons = [];
      if (referee.status === '停派') reasons.push('该裁判已停派，暂时不能接场');
      if (slot === '主裁' && referee.level !== '主裁') reasons.push('主裁槽位只能由主裁级裁判担任');
      // 这人当前在这场的另一个槽位：不做硬禁用（允许两个槽位对调），交给表单按本次选择实时判重
      const otherSlot = APPOINT_SLOTS.find((name) => name !== slot
        && current.has(name) && current.get(name).refereeId === referee.id) || '';
      const clash = findSameDayClash(data, referee.id, match.date, matchId);
      if (clash) {
        const other = data.matches.find((m) => m.id === clash.matchId);
        reasons.push(`同日 ${match.date} 已在第 ${other ? other.round : '?'} 轮出场，一天不能吹两场`);
      }
      const used = refereeCount(data, referee.id, matchId);
      if (used + 1 > referee.seasonLimit) reasons.push(`本季已派 ${used} 场，超过上限 ${referee.seasonLimit} 场`);
      const adjacent = findAdjacent(data, referee.id, match.date, matchId)
        .map((item) => ({ date: item.date, side: item.side, matchId: item.matchId }));
      return {
        id: referee.id,
        name: referee.name,
        level: referee.level,
        status: referee.status,
        count: used,
        seasonLimit: referee.seasonLimit,
        remaining: Math.max(0, referee.seasonLimit - used),
        incumbent: Boolean(incumbent && incumbent.refereeId === referee.id),
        sameMatchSlot: otherSlot,
        adjacent,
        available: reasons.length === 0,
        reasons,
      };
    });
    return {
      slot,
      refereeId: incumbent ? incumbent.refereeId : '',
      candidates,
    };
  });

  return {
    match: decorateMatch(data, match, teams, venues, new Date()),
    locked: match.status === '已赛' || match.status === '取消',
    slots,
  };
}

function assertReferee(data, refereeId) {
  const referee = data.referees.find((item) => item.id === refereeId);
  if (!referee) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这个裁判没有登记过', 'refereeId');
  return referee;
}

// 对单个槽位的候选人做全部硬校验，返回相邻天提示。
// occupiedSlots 是“本次提交后”各槽位的人选，用于同场去重（允许把已在场的人换到另一个槽位）
function checkCandidate(data, match, slot, refereeId, occupiedSlots) {
  const referee = assertReferee(data, refereeId);
  if (referee.status === '停派') {
    throw new ApiError(409, 'REFEREE_UNAVAILABLE', `${referee.name} 现在处于停派状态，不能派场；如需换人请改派给别人`, slot);
  }
  if (slot === '主裁' && referee.level !== '主裁') {
    throw new ApiError(400, 'REFEREE_LEVEL_MISMATCH', '主裁槽位只能由主裁级裁判担任', slot);
  }
  const otherSlot = APPOINT_SLOTS.find((name) => name !== slot
    && occupiedSlots.has(name) && occupiedSlots.get(name) === refereeId);
  if (otherSlot) {
    throw new ApiError(409, 'SLOT_SAME_REFEREE', `${referee.name} 已经是这场的${otherSlot}，同一场的主裁与助理不能是同一人`, slot);
  }
  const clash = findSameDayClash(data, refereeId, match.date, match.id);
  if (clash) {
    const other = data.matches.find((item) => item.id === clash.matchId);
    const { teams } = nameMaps();
    throw new ApiError(409, 'REFEREE_SAME_DAY', `${referee.name} 在 ${match.date} 已经排了${matchLabel(other, teams)}，同一天不能再吹这一场`, slot);
  }
  const used = refereeCount(data, refereeId, match.id);
  if (used + 1 > referee.seasonLimit) {
    const over = used + 1 - referee.seasonLimit;
    throw new ApiError(409, 'REFEREE_LIMIT_EXCEEDED',
      `${referee.name} 本季已派 ${used} 场，个人上限是 ${referee.seasonLimit} 场，再派这一场将超出 ${over} 场，不能再安排`, slot);
  }
  return referee;
}

function assertEditable(match) {
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  if (match.status === '已赛') throw new ApiError(409, 'MATCH_LOCKED', '这场比赛已经打完，裁判名单不能再改动', '');
  if (match.status === '取消') throw new ApiError(409, 'MATCH_CANCELLED', '这场比赛已取消，不需要派裁判', '');
}

function appendLog(data, entry) {
  data.logs.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry });
}

// 一次性配齐一场的三个槽位；按槽位与旧记录比对，新增的记"配齐"，换人记"改派"
function assignMatch(matchId, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rawSlots = source.slots && typeof source.slots === 'object' ? source.slots : source;
  const operator = pickText(source.operator) || '未署名';
  const reason = pickText(source.reason) || '整组配齐';
  if (reason.length > MAX_NOTE) throw new ApiError(400, 'REASON_TOO_LONG', `改派说明不能超过 ${MAX_NOTE} 个字`, 'reason');

  const data = load();
  const match = data.matches.find((item) => item.id === matchId);
  assertEditable(match);

  const picks = [];
  APPOINT_SLOTS.forEach((slot) => {
    const refereeId = pickText(rawSlots[slot]);
    if (!refereeId) throw new ApiError(400, 'SLOT_EMPTY', `${slot}还没有选人，一场要配齐一名主裁与两名助理`, slot);
    picks.push({ slot, refereeId });
  });
  // 三个槽位之间不能重复
  picks.forEach((pick) => {
    const dup = picks.find((other) => other.slot !== pick.slot && other.refereeId === pick.refereeId);
    if (dup) {
      const referee = assertReferee(data, pick.refereeId);
      throw new ApiError(409, 'SLOT_SAME_REFEREE', `${referee.name} 不能同时担任这场的${pick.slot}与${dup.slot}，同一场的主裁与助理不能是同一人`, pick.slot);
    }
  });

  const oldMap = slotMapOf(data, matchId);
  // 本次提交后三个槽位的人选，同场去重按这张表判，允许把已在场的人换到另一槽位
  const occupiedSlots = new Map(picks.map((pick) => [pick.slot, pick.refereeId]));
  // 先把旧记录摘出来统一校验，任何一条不过都不落盘
  picks.forEach((pick) => checkCandidate(data, match, pick.slot, pick.refereeId, occupiedSlots));

  const now = new Date().toISOString();
  const warnings = [];
  picks.forEach((pick) => {
    const old = oldMap.get(pick.slot);
    if (old && old.refereeId === pick.refereeId) return;
    if (old) {
      const fromId = old.refereeId;
      old.refereeId = pick.refereeId;
      old.updatedAt = now;
      appendLog(data, {
        matchId, slot: pick.slot, action: '改派',
        refereeFromId: fromId, refereeToId: pick.refereeId,
        reason, operator,
      });
    } else {
      const created = { id: crypto.randomUUID(), matchId, refereeId: pick.refereeId, slot: pick.slot, createdAt: now, updatedAt: now };
      data.appointments.push(created);
      appendLog(data, {
        matchId, slot: pick.slot, action: '配齐',
        refereeFromId: '', refereeToId: pick.refereeId, reason: '初始配齐', operator,
      });
    }
    findAdjacent(data, pick.refereeId, match.date, matchId).forEach((near) => {
      const referee = data.referees.find((r) => r.id === pick.refereeId);
      const other = data.matches.find((m) => m.id === near.matchId);
      warnings.push({
        slot: pick.slot, refereeId: pick.refereeId, refereeName: referee ? referee.name : '',
        text: `${referee ? referee.name : '该裁判'} ${near.side}（${near.date}）还有第 ${other ? other.round : '?'} 轮的一场，连着吹已记下请注意`,
      });
    });
  });

  save(data);
  const { teams, venues } = nameMaps();
  return { match: decorateMatch(data, match, teams, venues, new Date()), warnings };
}

// 单个槽位改派：必须写清换成谁与换人原因，原场次与新场次都留痕
function reassignSlot(matchId, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const slot = pickText(source.slot);
  if (!APPOINT_SLOTS.includes(slot)) throw new ApiError(400, 'SLOT_INVALID', '槽位只能是主裁、助理一或助理二', 'slot');
  const refereeId = pickText(source.refereeId);
  if (!refereeId) throw new ApiError(400, 'REFEREE_REQUIRED', '请选择要换成的裁判', 'refereeId');
  const reason = pickText(source.reason);
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', '改派要写清原因，例如本人临时不能来', 'reason');
  if (reason.length > MAX_NOTE) throw new ApiError(400, 'REASON_TOO_LONG', `改派说明不能超过 ${MAX_NOTE} 个字`, 'reason');
  const operator = pickText(source.operator) || '未署名';

  const data = load();
  const match = data.matches.find((item) => item.id === matchId);
  assertEditable(match);
  const currentMap = slotMapOf(data, matchId);
  const old = currentMap.get(slot);
  if (!old) throw new ApiError(409, 'SLOT_EMPTY', `这场的${slot}还没配人，先配齐再谈改派`, slot);
  if (old.refereeId === refereeId) {
    throw new ApiError(409, 'REASSIGN_SAME', '换上来的裁判就是原来的人，没有变化', 'refereeId');
  }
  const fromReferee = assertReferee(data, old.refereeId);
  // 同场去重按“换上来之后”的槽位表判
  const occupiedSlots = new Map(APPOINT_SLOTS.map((name) => {
    const appt = currentMap.get(name);
    return [name, name === slot ? refereeId : (appt ? appt.refereeId : '')];
  }));
  const target = checkCandidate(data, match, slot, refereeId, occupiedSlots);

  old.refereeId = refereeId;
  old.updatedAt = new Date().toISOString();
  appendLog(data, {
    matchId, slot, action: '改派',
    refereeFromId: fromReferee.id, refereeToId: target.id,
    reason, operator,
  });
  const warnings = [];
  findAdjacent(data, target.id, match.date, matchId).forEach((near) => {
    const other = data.matches.find((m) => m.id === near.matchId);
    warnings.push({
      slot, refereeId: target.id, refereeName: target.name,
      text: `${target.name} ${near.side}（${near.date}）还有第 ${other ? other.round : '?'} 轮的一场，连着吹请注意`,
    });
  });
  save(data);
  const { teams, venues } = nameMaps();
  return {
    match: decorateMatch(data, match, teams, venues, new Date()),
    from: { id: fromReferee.id, name: fromReferee.name },
    to: { id: target.id, name: target.name },
    warnings,
  };
}

// 改派与配齐留痕：支持按比赛或按裁判（含原裁判、新裁判）过滤
function listLogs(options) {
  const input = options && typeof options === 'object' ? options : {};
  const matchId = pickText(input.matchId);
  const refereeId = pickText(input.refereeId);
  const data = load();
  const { teams } = nameMaps();

  let list = data.logs.slice();
  if (matchId) list = list.filter((item) => item.matchId === matchId);
  if (refereeId) list = list.filter((item) => item.refereeFromId === refereeId || item.refereeToId === refereeId);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return {
    logs: list.map((item) => {
      const match = data.matches.find((m) => m.id === item.matchId);
      const from = data.referees.find((r) => r.id === item.refereeFromId);
      const to = data.referees.find((r) => r.id === item.refereeToId);
      return {
        id: item.id,
        matchId: item.matchId,
        matchText: match ? matchLabel(match, teams) : '已删除的场次',
        round: match ? match.round : 0,
        date: match ? match.date : '',
        slot: item.slot,
        action: item.action,
        refereeFromId: item.refereeFromId,
        refereeFromName: from ? from.name : (item.refereeFromId ? '已删除' : ''),
        refereeToId: item.refereeToId,
        refereeToName: to ? to.name : (item.refereeToId ? '已删除' : ''),
        reason: item.reason,
        operator: item.operator,
        createdAt: item.createdAt,
      };
    }),
  };
}

module.exports = {
  listAppointments,
  matchOptions,
  assignMatch,
  reassignSlot,
  listLogs,
  isComplete,
  refereeCount,
  findDateMoveClashes,
  slotMapOf,
  appointmentsOf,
};
