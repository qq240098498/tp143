const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const SEASON = '2026 春季联赛';
const MAX_TEAM_NAME = 24;
const MAX_SHORT_NAME = 4;
const MAX_VENUE_NAME = 30;
const MAX_NOTE = 200;
const MAX_TEAMS = 12;
const MAX_REFEREE_NAME = 12;
const STATUS_POOL = ['待赛', '已赛', '延期', '取消'];
// 派场口径：每场一名主裁加两名助理，一人一季最多派七场（七轮比赛日各一场已经排满）
const SEASON_ASSIGNMENT_LIMIT = 7;
const REFEREE_LEVELS = ['国家级', '一级', '二级'];
const REFEREE_STATUS = ['在册', '停用'];
const ASSIGN_ROLES = ['主裁', '助理'];
const ASSISTANT_SLOTS = 2;

// 第一轮 2026-03-07（周六）开打，之后每轮隔七天；直接拼字符串会拼出 03-35 这种不存在的日期
function roundDate(round) {
  const date = new Date(Date.UTC(2026, 2, 7 + (round - 1) * 7));
  return date.toISOString().slice(0, 10);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

// 初始数据：八支球队、四个场地（其中两支球队共用中立体育场）、七轮单循环共二十八场，
// 前三轮已经打完并记了比分，第四轮有一场延期，其余待赛；
// 十四名裁判，第四轮的三场待赛已派齐主裁与助理，延期那场只派了主裁，留作派不齐的示例
function seedData() {
  const at = '2026-02-20T02:00:00.000Z';
  const teams = [
    { id: 'team-1001', name: '江城铁马', shortName: 'JCTM', city: '江城', venueId: 'venue-2001', seedRank: 1, status: '参赛', note: '上赛季冠军', createdAt: at, updatedAt: at },
    { id: 'team-1002', name: '海陵海燕', shortName: 'HLHY', city: '海陵', venueId: 'venue-2002', seedRank: 2, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1003', name: '云岭苍狼', shortName: 'YLCW', city: '云岭', venueId: 'venue-2003', seedRank: 3, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1004', name: '平原飞驰', shortName: 'PYFC', city: '平原', venueId: 'venue-2004', seedRank: 4, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1005', name: '沙洲锚队', shortName: 'SZMD', city: '沙洲', venueId: 'venue-2004', seedRank: 5, status: '参赛', note: '与平原飞驰共用中立体育场', createdAt: at, updatedAt: at },
    { id: 'team-1006', name: '白鹿白鹭', shortName: 'BLBL', city: '白鹿', venueId: 'venue-2004', seedRank: 6, status: '参赛', note: '与平原飞驰共用中立体育场', createdAt: at, updatedAt: at },
    { id: 'team-1007', name: '青峰青松', shortName: 'QFQS', city: '青峰', venueId: 'venue-2005', seedRank: 7, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1008', name: '洛水洛神', shortName: 'LSLS', city: '洛水', venueId: 'venue-2006', seedRank: 8, status: '参赛', note: '', createdAt: at, updatedAt: at },
  ];

  const venues = [
    { id: 'venue-2001', name: '江城体育中心', city: '江城', capacity: 32000, weekdays: [6], note: '主场馆', createdAt: at, updatedAt: at },
    { id: 'venue-2002', name: '海陵湾球场', city: '海陵', capacity: 18000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2003', name: '云岭高地', city: '云岭', capacity: 12000, weekdays: [6, 0], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2004', name: '中立体育场', city: '中立', capacity: 24000, weekdays: [6, 0], note: '平原、沙洲、白鹿三家共用', createdAt: at, updatedAt: at },
    { id: 'venue-2005', name: '青峰山球场', city: '青峰', capacity: 9000, weekdays: [0], note: '只有周日可用', createdAt: at, updatedAt: at },
    { id: 'venue-2006', name: '洛水古渡球场', city: '洛水', capacity: 8000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
  ];

  // 单循环轮转表：八支球队七轮，每轮四场，主场按轮次左右交替
  const order = ['team-1001', 'team-1002', 'team-1003', 'team-1004', 'team-1005', 'team-1006', 'team-1007', 'team-1008'];
  const scores = {
    '整轮1场1': [2, 0], '整轮1场2': [1, 1], '整轮1场3': [3, 1], '整轮1场4': [0, 2],
    '整轮2场1': [1, 2], '整轮2场2': [2, 2], '整轮2场3': [0, 0], '整轮2场4': [4, 1],
    '整轮3场1': [2, 1], '整轮3场2': [1, 0], '整轮3场3': [1, 3], '整轮3场4': [2, 0],
  };

  const matches = [];
  const rounds = 7;
  let counter = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const date = roundDate(round);
    for (let i = 0; i < order.length / 2; i += 1) {
      const home = order[i];
      const away = order[order.length - 1 - i];
      counter += 1;
      const key = `整轮${round}场${i + 1}`;
      const played = Object.prototype.hasOwnProperty.call(scores, key);
      const isPostponed = round === 4 && i === 1;
      matches.push({
        id: `match-3001-${String(counter).padStart(2, '0')}`,
        round,
        date,
        kickoff: i % 2 === 0 ? '15:30' : '19:30',
        venueId: i === 3 ? 'venue-2004' : null,
        homeTeamId: i % 2 === 0 ? home : away,
        awayTeamId: i % 2 === 0 ? away : home,
        status: played ? '已赛' : (isPostponed ? '延期' : '待赛'),
        homeGoals: played ? scores[key][0] : null,
        awayGoals: played ? scores[key][1] : null,
        note: isPostponed ? '主队场地检修，日期待定' : '',
        createdAt: at,
        updatedAt: at,
      });
    }
    // 轮转：第一支不动，其余顺时针轮换
    const fixed = order[0];
    const rest = order.slice(1);
    rest.unshift(rest.pop());
    order.splice(0, order.length, fixed, ...rest);
  }

  const referees = [
    { id: 'ref-4001', name: '陈一帆', level: '国家级', status: '在册', note: '足协推荐', createdAt: at, updatedAt: at },
    { id: 'ref-4002', name: '王砚秋', level: '国家级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4003', name: '李慕白', level: '国家级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4004', name: '周谨', level: '一级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4005', name: '吴望', level: '一级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4006', name: '郑回', level: '一级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4007', name: '孙照', level: '一级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4008', name: '赵启', level: '一级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4009', name: '钱进', level: '一级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4010', name: '冯远', level: '二级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4011', name: '褚亮', level: '二级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4012', name: '卫澜', level: '二级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4013', name: '蒋松', level: '二级', status: '在册', note: '', createdAt: at, updatedAt: at },
    { id: 'ref-4014', name: '韩江', level: '二级', status: '在册', note: '', createdAt: at, updatedAt: at },
  ];

  // 前三轮各四场都已打完，裁判组留档：每轮用十二名裁判，轮次之间轮换，一人一天只吹一场
  const assignments = [];
  const pushCrew = (matchId, headId, assistantIds) => {
    const nextId = () => `assign-5001-${String(assignments.length + 1).padStart(2, '0')}`;
    assignments.push({ id: nextId(), matchId, role: '主裁', refereeId: headId, createdAt: at, updatedAt: at });
    assistantIds.forEach((refereeId) => {
      assignments.push({ id: nextId(), matchId, role: '助理', refereeId, createdAt: at, updatedAt: at });
    });
  };
  // 在十四名裁判里按偏移循环取第 n 位（n 从 1 开始）
  const refAt = (n) => `ref-40${String(((n - 1) % 14) + 1).padStart(2, '0')}`;
  for (let round = 1; round <= 3; round += 1) {
    const offset = round - 1;
    for (let i = 0; i < 4; i += 1) {
      const matchId = `match-3001-${String((round - 1) * 4 + i + 1).padStart(2, '0')}`;
      pushCrew(matchId, refAt(1 + offset + i), [refAt(5 + offset + i * 2), refAt(6 + offset + i * 2)]);
    }
  }

  // 第四轮的三场待赛各派齐三人，延期那场先只派主裁，留作派不齐的示例；同一比赛日内一人只出现一次
  pushCrew('match-3001-13', 'ref-4001', ['ref-4004', 'ref-4010']);
  pushCrew('match-3001-14', 'ref-4002', []);
  pushCrew('match-3001-15', 'ref-4003', ['ref-4005', 'ref-4011']);
  pushCrew('match-3001-16', 'ref-4006', ['ref-4007', 'ref-4012']);

  return {
    meta: { season: SEASON, points: { win: 3, draw: 1, loss: 0 }, updatedAt: at },
    teams,
    venues,
    matches,
    referees,
    assignments,
    assignmentLogs: [],
  };
}

// 球队、场地、赛程、裁判与派场各自整理成固定结构，引用不存在的场地、球队、赛程或裁判的记录一律丢弃
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = seedData();
  const meta = source.meta && typeof source.meta === 'object'
    ? {
      season: typeof source.meta.season === 'string' && source.meta.season ? source.meta.season : base.meta.season,
      points: {
        win: Number.isInteger(Number(source.meta.points && source.meta.points.win)) ? Number(source.meta.points.win) : base.meta.points.win,
        draw: Number.isInteger(Number(source.meta.points && source.meta.points.draw)) ? Number(source.meta.points.draw) : base.meta.points.draw,
        loss: Number.isInteger(Number(source.meta.points && source.meta.points.loss)) ? Number(source.meta.points.loss) : base.meta.points.loss,
      },
      updatedAt: typeof source.meta.updatedAt === 'string' ? source.meta.updatedAt : base.meta.updatedAt,
    }
    : base.meta;

  const venueSource = Array.isArray(source.venues) ? source.venues : base.venues;
  const venues = [];
  const venueIds = new Set();
  venueSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `venue-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || venueIds.has(id)) return;
    venueIds.add(id);
    venues.push({
      id,
      name,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      capacity: Number.isInteger(Number(item.capacity)) ? Number(item.capacity) : 0,
      weekdays: Array.isArray(item.weekdays) ? item.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [],
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  const teamSource = Array.isArray(source.teams) ? source.teams : base.teams;
  const teams = [];
  const teamIds = new Set();
  teamSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `team-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const shortName = typeof item.shortName === 'string' ? item.shortName.trim() : '';
    if (!id || !name || !shortName || teamIds.has(id)) return;
    teamIds.add(id);
    teams.push({
      id,
      name,
      shortName,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      seedRank: Number.isInteger(Number(item.seedRank)) ? Number(item.seedRank) : index + 1,
      status: STATUS_POOL.includes(item.status) ? item.status : '参赛',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  const matchSource = Array.isArray(source.matches) ? source.matches : base.matches;
  const matches = [];
  const matchIds = new Set();
  matchSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `match-restored-${index + 1}`;
    const home = teamIds.has(item.homeTeamId) ? item.homeTeamId : '';
    const away = teamIds.has(item.awayTeamId) ? item.awayTeamId : '';
    if (!id || !home || !away || home === away || matchIds.has(id)) return;
    matchIds.add(id);
    const status = ['待赛', '已赛', '延期', '取消'].includes(item.status) ? item.status : '待赛';
    const fallbackRound = Number.isInteger(Number(item.round)) && Number(item.round) > 0 ? Number(item.round) : 1;
    const rawDate = typeof item.date === 'string' ? item.date : '';
    matches.push({
      id,
      round: Number.isInteger(Number(item.round)) ? Number(item.round) : 1,
      date: isValidDate(rawDate) ? rawDate : roundDate(fallbackRound),
      kickoff: typeof item.kickoff === 'string' ? item.kickoff : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      homeTeamId: home,
      awayTeamId: away,
      status,
      homeGoals: status === '已赛' && item.homeGoals !== null && item.homeGoals !== undefined ? Number(item.homeGoals) : null,
      awayGoals: status === '已赛' && item.awayGoals !== null && item.awayGoals !== undefined ? Number(item.awayGoals) : null,
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  const refereeSource = Array.isArray(source.referees) ? source.referees : base.referees;
  const referees = [];
  const refereeIds = new Set();
  refereeSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `ref-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || refereeIds.has(id)) return;
    refereeIds.add(id);
    referees.push({
      id,
      name,
      level: REFEREE_LEVELS.includes(item.level) ? item.level : '二级',
      status: REFEREE_STATUS.includes(item.status) ? item.status : '在册',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  // 派场逐条核对：赛程与裁判都要还在；同一场主裁最多一名、助理最多两名，且同一人不能占两个位置
  const assignmentSource = Array.isArray(source.assignments) ? source.assignments : base.assignments;
  const assignments = [];
  const assignmentIds = new Set();
  const crewShape = new Map();
  assignmentSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `assign-restored-${index + 1}`;
    if (!id || assignmentIds.has(id)) return;
    if (!matchIds.has(item.matchId) || !refereeIds.has(item.refereeId)) return;
    if (!ASSIGN_ROLES.includes(item.role)) return;
    const shape = crewShape.get(item.matchId) || { head: 0, assistants: 0, people: new Set() };
    if (shape.people.has(item.refereeId)) return;
    if (item.role === '主裁' && shape.head >= 1) return;
    if (item.role === '助理' && shape.assistants >= ASSISTANT_SLOTS) return;
    if (item.role === '主裁') shape.head += 1;
    else shape.assistants += 1;
    shape.people.add(item.refereeId);
    crewShape.set(item.matchId, shape);
    assignmentIds.add(id);
    assignments.push({
      id,
      matchId: item.matchId,
      role: item.role,
      refereeId: item.refereeId,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  // 改派留痕是历史记录，名字与对阵都按当时快照存，人删了记录也还在
  const logSource = Array.isArray(source.assignmentLogs) ? source.assignmentLogs : base.assignmentLogs;
  const assignmentLogs = [];
  const logIds = new Set();
  logSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `assignlog-restored-${index + 1}`;
    if (!id || logIds.has(id)) return;
    logIds.add(id);
    assignmentLogs.push({
      id,
      kind: typeof item.kind === 'string' ? item.kind : '改派',
      matchId: typeof item.matchId === 'string' ? item.matchId : '',
      matchLabel: typeof item.matchLabel === 'string' ? item.matchLabel : '',
      role: ASSIGN_ROLES.includes(item.role) ? item.role : '主裁',
      fromRefereeId: typeof item.fromRefereeId === 'string' ? item.fromRefereeId : '',
      fromName: typeof item.fromName === 'string' ? item.fromName : '',
      toRefereeId: typeof item.toRefereeId === 'string' ? item.toRefereeId : '',
      toName: typeof item.toName === 'string' ? item.toName : '',
      reason: typeof item.reason === 'string' ? item.reason : '',
      operator: typeof item.operator === 'string' ? item.operator : '',
      at: typeof item.at === 'string' ? item.at : new Date().toISOString(),
    });
  });

  return { meta, teams, venues, matches, referees, assignments, assignmentLogs };
}

// 读取数据文件：文件缺失或内容损坏时回落到初始数据并立刻补写
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (err) {
    const data = seedData();
    save(data);
    return data;
  }
}

// 先写临时文件再改名，写入中途被打断也不会把正式数据文件写坏
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(normalize(data), null, 2)}\n`;
  fs.writeFileSync(TEMP_FILE, text, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

module.exports = {
  load,
  save,
  seedData,
  normalize,
  SEASON,
  MAX_TEAM_NAME,
  MAX_SHORT_NAME,
  MAX_VENUE_NAME,
  MAX_NOTE,
  MAX_TEAMS,
  MAX_REFEREE_NAME,
  SEASON_ASSIGNMENT_LIMIT,
  REFEREE_LEVELS,
  REFEREE_STATUS,
  ASSIGN_ROLES,
  ASSISTANT_SLOTS,
  MATCH_STATUS: ['待赛', '已赛', '延期', '取消'],
  TEAM_STATUS: ['参赛', '退赛'],
  DATA_FILE,
};
