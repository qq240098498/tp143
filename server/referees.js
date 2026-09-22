// 裁判登记与个人派场清单：按人列出已派的场次与数量，停派时把未吹的场次列出来供改派
const crypto = require('crypto');
const {
  load, save, MAX_REFEREE_NAME, MAX_NOTE, MAX_REFEREES,
  REFEREE_LEVELS, REFEREE_STATUS, DEFAULT_REFEREE_LIMIT,
} = require('./store');
const { ApiError, pickText } = require('./errors');
const { nameMaps } = require('./standings');
const { refereeCount } = require('./appointments');

function validatePayload(input, data, selfId) {
  const source = input && typeof input === 'object' ? input : {};

  const name = pickText(source.name);
  if (!name) throw new ApiError(400, 'NAME_REQUIRED', '请填写裁判姓名', 'name');
  if (name.length > MAX_REFEREE_NAME) throw new ApiError(400, 'NAME_TOO_LONG', `裁判姓名不能超过 ${MAX_REFEREE_NAME} 个字`, 'name');
  if (data.referees.some((item) => item.id !== selfId && item.name === name)) {
    throw new ApiError(409, 'NAME_DUPLICATED', `${name} 已经登记过了`, 'name');
  }

  const level = pickText(source.level) || '助理';
  if (!REFEREE_LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', '级别只能填主裁或者助理', 'level');
  }

  const seasonLimit = Number(source.seasonLimit);
  if (!Number.isInteger(seasonLimit) || seasonLimit < 1 || seasonLimit > 100) {
    throw new ApiError(400, 'LIMIT_INVALID', '一季派场上限要填 1 到 100 之间的整数', 'seasonLimit');
  }

  const status = pickText(source.status) || '在岗';
  if (!REFEREE_STATUS.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', '状态只能填在岗或者停派', 'status');
  }

  if (source.note !== undefined && source.note !== null && String(source.note).length > MAX_NOTE) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE} 个字`, 'note');
  }

  return { name, level, seasonLimit, status, note: pickText(source.note) };
}

function decorateReferee(data, referee, teams, now) {
  const matchesById = new Map(data.matches.map((item) => [item.id, item]));
  const records = data.appointments
    .filter((item) => item.refereeId === referee.id)
    .map((appt) => {
      const match = matchesById.get(appt.matchId);
      if (!match) return null;
      const home = teams.get(match.homeTeamId);
      const away = teams.get(match.awayTeamId);
      return {
        appointmentId: appt.id,
        matchId: match.id,
        round: match.round,
        date: match.date,
        kickoff: match.kickoff,
        status: match.status,
        slot: appt.slot,
        homeName: home ? home.name : '未知球队',
        awayName: away ? away.name : '未知球队',
        started: match.status === '待赛' && new Date(`${match.date}T${match.kickoff}:00`).getTime() <= now.getTime(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.kickoff < b.kickoff ? -1 : 1));

  const activeRecords = records.filter((item) => item.status !== '取消');
  const assignedCount = activeRecords.length;
  // 临时不能来时要处理的：还没吹且没取消的场次
  const upcoming = activeRecords.filter((item) => item.status !== '已赛');
  return {
    ...referee,
    assignedCount,
    remaining: Math.max(0, referee.seasonLimit - assignedCount),
    overLimit: assignedCount > referee.seasonLimit,
    upcomingCount: upcoming.length,
    matches: records,
    upcoming,
  };
}

function listReferees(options) {
  const input = options && typeof options === 'object' ? options : {};
  const keyword = pickText(input.keyword).toLowerCase();
  const status = pickText(input.status);
  const level = pickText(input.level);
  const data = load();
  const { teams } = nameMaps();
  const now = new Date();

  let list = data.referees.slice();
  if (status) list = list.filter((item) => item.status === status);
  if (level) list = list.filter((item) => item.level === level);
  if (keyword) {
    list = list.filter((item) => item.name.toLowerCase().includes(keyword) || item.note.toLowerCase().includes(keyword));
  }
  list.sort((a, b) => (a.level === b.level ? a.name < b.name ? -1 : 1 : a.level === '主裁' ? -1 : 1));

  const decorated = list.map((item) => decorateReferee(data, item, teams, now));
  return {
    referees: decorated,
    total: data.referees.length,
    activeCount: data.referees.filter((item) => item.status === '在岗').length,
    mainCount: data.referees.filter((item) => item.level === '主裁').length,
    assistantCount: data.referees.filter((item) => item.level === '助理').length,
    defaultLimit: DEFAULT_REFEREE_LIMIT,
    limit: MAX_REFEREES,
  };
}

function createReferee(payload) {
  const data = load();
  if (data.referees.length >= MAX_REFEREES) {
    throw new ApiError(409, 'REFEREE_LIMIT_REACHED', `裁判名单最多 ${MAX_REFEREES} 人`, 'name');
  }
  const checked = validatePayload(payload, data, '');
  const now = new Date().toISOString();
  const created = { id: crypto.randomUUID(), ...checked, createdAt: now, updatedAt: now };
  data.referees.push(created);
  save(data);
  const { teams } = nameMaps();
  return decorateReferee(data, created, teams, new Date());
}

function updateReferee(id, payload) {
  const data = load();
  const found = data.referees.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这个裁判不存在或已被删除', '');
  const merged = { ...found, ...(payload && typeof payload === 'object' ? payload : {}) };
  const checked = validatePayload(merged, data, found.id);
  Object.assign(found, checked);
  found.updatedAt = new Date().toISOString();
  save(data);
  const { teams } = nameMaps();
  return decorateReferee(data, found, teams, new Date());
}

// 停派/复岗：停派时把这个人还没吹的场次一并带回，页面逐场提供改派
function setRefereeStatus(id, payload) {
  const data = load();
  const found = data.referees.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这个裁判不存在或已被删除', '');
  const status = pickText(payload && payload.status);
  if (!REFEREE_STATUS.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', '状态只能填在岗或者停派', 'status');
  }
  found.status = status;
  found.updatedAt = new Date().toISOString();
  save(data);
  const { teams } = nameMaps();
  const decorated = decorateReferee(data, found, teams, new Date());
  return {
    referee: decorated,
    message: status === '停派'
      ? `${found.name} 已停派，名下还有 ${decorated.upcomingCount} 场没吹，请逐场改派`
      : `${found.name} 已恢复在岗，可以接新的派场`,
  };
}

function deleteReferee(id) {
  const data = load();
  const index = data.referees.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这个裁判不存在或已被删除', '');
  const related = data.appointments.filter((item) => item.refereeId === id).length;
  if (related > 0) {
    throw new ApiError(409, 'REFEREE_IN_USE', `这位裁判名下还有 ${related} 场派场记录（含已赛留痕），不能直接删除；临时不能来请用停派并改派`, '');
  }
  const [removed] = data.referees.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

module.exports = {
  listReferees,
  createReferee,
  updateReferee,
  setRefereeStatus,
  deleteReferee,
};
