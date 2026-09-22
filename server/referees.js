const crypto = require('crypto');
const {
  load, save, MAX_REFEREE_NAME, MAX_NOTE, REFEREE_LEVELS, REFEREE_STATUS, SEASON_ASSIGNMENT_LIMIT,
} = require('./store');
const { ApiError, pickText } = require('./errors');

function validatePayload(input, data, selfId) {
  const source = input && typeof input === 'object' ? input : {};

  const name = pickText(source.name);
  if (!name) throw new ApiError(400, 'NAME_REQUIRED', '请填写裁判姓名', 'name');
  if (name.length > MAX_REFEREE_NAME) {
    throw new ApiError(400, 'NAME_TOO_LONG', `裁判姓名不能超过 ${MAX_REFEREE_NAME} 个字`, 'name');
  }
  if (data.referees.some((item) => item.id !== selfId && item.name === name)) {
    throw new ApiError(409, 'NAME_DUPLICATED', `${name} 已经登记过了`, 'name');
  }

  const level = pickText(source.level);
  if (!REFEREE_LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', '级别只能填国家级、一级或者二级', 'level');
  }

  const status = pickText(source.status) || '在册';
  if (!REFEREE_STATUS.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', '状态只能填在册或者停用', 'status');
  }

  if (source.note !== undefined && source.note !== null && String(source.note).length > MAX_NOTE) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE} 个字`, 'note');
  }

  return { name, level, status, note: pickText(source.note) };
}

// 裁判记录总数（含已赛留档与取消场），删除前用它把关
function assignmentCountOf(data, refereeId) {
  return data.assignments.filter((item) => item.refereeId === refereeId).length;
}

// 占用赛季名额的场次：已取消的比赛不再占名额
function quotaCountOf(data, refereeId) {
  return data.assignments
    .filter((item) => item.refereeId === refereeId)
    .filter((item) => {
      const match = data.matches.find((m) => m.id === item.matchId);
      return match && match.status !== '取消';
    }).length;
}

function decorate(referee, data) {
  const count = quotaCountOf(data, referee.id);
  return {
    ...referee,
    assignmentCount: count,
    limit: SEASON_ASSIGNMENT_LIMIT,
    overLimit: count > SEASON_ASSIGNMENT_LIMIT,
    remaining: Math.max(0, SEASON_ASSIGNMENT_LIMIT - count),
  };
}

function listReferees(options) {
  const input = options && typeof options === 'object' ? options : {};
  const status = pickText(input.status);
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();

  let list = data.referees.slice();
  if (status) list = list.filter((item) => item.status === status);
  if (keyword) {
    list = list.filter((item) => item.name.toLowerCase().includes(keyword)
      || item.level.toLowerCase().includes(keyword)
      || item.note.toLowerCase().includes(keyword));
  }
  // 在册的在前，再按级别（国家级、一级、二级）与姓名排
  const levelRank = new Map(REFEREE_LEVELS.map((item, index) => [item, index]));
  list.sort((a, b) => (a.status === b.status ? 0 : a.status === '在册' ? -1 : 1)
    || levelRank.get(a.level) - levelRank.get(b.level)
    || (a.name < b.name ? -1 : 1));

  return {
    referees: list.map((item) => decorate(item, data)),
    total: data.referees.length,
    activeCount: data.referees.filter((item) => item.status === '在册').length,
    limit: SEASON_ASSIGNMENT_LIMIT,
  };
}

function createReferee(payload) {
  const data = load();
  const checked = validatePayload(payload, data, '');
  const now = new Date().toISOString();
  const created = { id: crypto.randomUUID(), ...checked, createdAt: now, updatedAt: now };
  data.referees.push(created);
  save(data);
  return decorate(created, data);
}

function updateReferee(id, payload) {
  const data = load();
  const found = data.referees.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这名裁判不存在或已被删除', '');
  const merged = { ...found, ...(payload && typeof payload === 'object' ? payload : {}) };
  const checked = validatePayload(merged, data, found.id);
  Object.assign(found, checked);
  found.updatedAt = new Date().toISOString();
  save(data);
  return decorate(found, data);
}

// 裁判还挂着派场时不直接删，避免比赛已经开赛却找不到人；先改派再停用
function deleteReferee(id) {
  const data = load();
  const index = data.referees.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'REFEREE_NOT_FOUND', '这名裁判不存在或已被删除', '');
  const count = assignmentCountOf(data, id);
  if (count > 0) {
    throw new ApiError(409, 'REFEREE_IN_USE', `这名裁判还挂着 ${count} 场派场，先在派场里把这些场次改派或清空再删`, '');
  }
  const [removed] = data.referees.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

module.exports = { listReferees, createReferee, updateReferee, deleteReferee, assignmentCountOf };
