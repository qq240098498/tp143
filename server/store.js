const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const SEASON = '2026 春季联赛';
const MAX_TEAM_NAME = 24;
const MAX_SHORT_NAME = 4;
const MAX_VENUE_NAME = 30;
const MAX_REFEREE_NAME = 24;
const MAX_NOTE = 200;
const MAX_TEAMS = 12;
const MAX_REFEREES = 20;
// 每名裁判一季派场总数的默认上限，可在裁判个人条目上用 seasonLimit 单独放宽或收紧
const DEFAULT_REFEREE_LIMIT = 12;
const STATUS_POOL = ['待赛', '已赛', '延期', '取消'];
const REFEREE_LEVELS = ['主裁', '助理'];
const REFEREE_STATUS = ['在岗', '停派'];
// 一场比赛三个执法槽位：一名主裁加两名助理
const APPOINT_SLOTS = ['主裁', '助理一', '助理二'];
const ASSIGN_ACTIONS = ['配齐', '改派'];

// 初始数据：八支球队、四个场地（其中两支球队共用中立体育场）、七轮单循环共二十八场，
// 前三轮已经打完并记了比分，第四轮有一场延期，其余待赛
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
  // 赛程日期锚定今天：前三轮排在过去并已打完，第四轮起排在未来待赛，
  // 保证任何时候用初始数据打开，都不会一上来就是一堆“已开赛却没配齐裁判”
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const roundDate = (round) => new Date(today.getTime() + ((round - 4) * 7 + 3) * 86400000)
    .toISOString().slice(0, 10);
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

  // 裁判名单：四名可担任主裁，八名担任助理，共十二人；前三轮每轮正好每人派一场
  const refereeNames = [
    '铁面', '明镜', '惊雷', '长风',
    '远山', '流水', '青松', '白桦', '云海', '星河', '晨曦', '暮鼓',
  ];
  const referees = refereeNames.map((name, index) => ({
    id: `referee-40${String(index + 1).padStart(2, '0')}`,
    name,
    level: index < 4 ? '主裁' : '助理',
    seasonLimit: DEFAULT_REFEREE_LIMIT,
    status: '在岗',
    note: '',
    createdAt: at,
    updatedAt: at,
  }));
  const refereeId = (index) => referees[index].id;

  // 前三轮已赛场次全部配齐：主裁四人轮转，助理八人两两轮换，保证同一天每人只出现在一场
  const appointments = [];
  const logs = [];
  matches.filter((item) => item.status === '已赛').forEach((item) => {
    const orderIndex = item.round - 1;
    const seq = Number(item.id.split('-').pop());
    const column = seq - 1 - (item.round - 1) * 4;
    const pickMain = (column + orderIndex) % 4;
    const pickA = 4 + ((column * 2) + orderIndex) % 8;
    const pickB = 4 + ((column * 2 + 1) + orderIndex) % 8;
    const picked = [
      { slot: '主裁', referee: pickMain },
      { slot: '助理一', referee: pickA },
      { slot: '助理二', referee: pickB },
    ];
    picked.forEach((entry) => {
      // 留痕时间排在该场比赛当天中午，和动态生成的比赛日期保持一致
      const stampedAt = `${item.date}T12:00:00.000Z`;
      appointments.push({
        id: `appt-${item.id.replace('match-', '')}-${entry.slot}`,
        matchId: item.id,
        refereeId: refereeId(entry.referee),
        slot: entry.slot,
        createdAt: stampedAt,
        updatedAt: stampedAt,
      });
      logs.push({
        id: `log-${item.id.replace('match-', '')}-${entry.slot}`,
        matchId: item.id,
        slot: entry.slot,
        action: '配齐',
        refereeFromId: '',
        refereeToId: refereeId(entry.referee),
        reason: '初始派场',
        operator: '系统初始化',
        createdAt: at,
      });
    });
  });

  return {
    meta: { season: SEASON, points: { win: 3, draw: 1, loss: 0 }, updatedAt: at },
    teams,
    venues,
    matches,
    referees,
    appointments,
    logs,
  };
}

// 球队、场地、赛程三块各自整理成固定结构，引用不存在的场地或球队的记录一律丢弃
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
    matches.push({
      id,
      round: Number.isInteger(Number(item.round)) ? Number(item.round) : 1,
      date: typeof item.date === 'string' ? item.date : '',
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
    const id = typeof item.id === 'string' && item.id ? item.id : `referee-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || refereeIds.has(id)) return;
    refereeIds.add(id);
    const level = REFEREE_LEVELS.includes(item.level) ? item.level : '助理';
    let seasonLimit = Number(item.seasonLimit);
    if (!Number.isInteger(seasonLimit) || seasonLimit < 1 || seasonLimit > 100) seasonLimit = DEFAULT_REFEREE_LIMIT;
    referees.push({
      id,
      name,
      level,
      seasonLimit,
      status: REFEREE_STATUS.includes(item.status) ? item.status : '在岗',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  // 派场记录：比赛、裁判、槽位三者都要对得上；同一场同一槽位只保留第一条，同人同场重复槽位丢弃
  const apptSource = Array.isArray(source.appointments) ? source.appointments : base.appointments;
  const appointments = [];
  const apptIds = new Set();
  const slotTaken = new Set();
  const pairTaken = new Set();
  apptSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `appt-restored-${index + 1}`;
    const matchId = matchIds.has(item.matchId) ? item.matchId : '';
    const refereeId = refereeIds.has(item.refereeId) ? item.refereeId : '';
    const slot = APPOINT_SLOTS.includes(item.slot) ? item.slot : '';
    if (!id || !matchId || !refereeId || !slot || apptIds.has(id)) return;
    const slotKey = `${matchId}|${slot}`;
    const pairKey = `${matchId}|${refereeId}`;
    if (slotTaken.has(slotKey) || pairTaken.has(pairKey)) return;
    slotTaken.add(slotKey);
    pairTaken.add(pairKey);
    apptIds.add(id);
    appointments.push({
      id,
      matchId,
      refereeId,
      slot,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  // 改派留痕：记录比赛、槽位、由谁换成谁与原因，引用失效的人物只清空名字字段，不丢记录
  const logSource = Array.isArray(source.logs) ? source.logs : base.logs;
  const logs = [];
  const logIds = new Set();
  logSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `log-restored-${index + 1}`;
    const matchId = matchIds.has(item.matchId) ? item.matchId : '';
    const slot = APPOINT_SLOTS.includes(item.slot) ? item.slot : '';
    if (!id || !matchId || !slot || logIds.has(id)) return;
    logIds.add(id);
    logs.push({
      id,
      matchId,
      slot,
      action: ASSIGN_ACTIONS.includes(item.action) ? item.action : '配齐',
      refereeFromId: refereeIds.has(item.refereeFromId) ? item.refereeFromId : '',
      refereeToId: refereeIds.has(item.refereeToId) ? item.refereeToId : '',
      reason: typeof item.reason === 'string' ? item.reason : '',
      operator: typeof item.operator === 'string' ? item.operator : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    });
  });

  return { meta, teams, venues, matches, referees, appointments, logs };
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
  MAX_REFEREE_NAME,
  MAX_NOTE,
  MAX_TEAMS,
  MAX_REFEREES,
  DEFAULT_REFEREE_LIMIT,
  MATCH_STATUS: ['待赛', '已赛', '延期', '取消'],
  TEAM_STATUS: ['参赛', '退赛'],
  REFEREE_LEVELS,
  REFEREE_STATUS,
  APPOINT_SLOTS,
  ASSIGN_ACTIONS,
  DATA_FILE,
};
