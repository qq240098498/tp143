// 页面交互：左侧导航切换视图，右侧抽屉负责新增与编辑，所有提示走右上角浮层

const state = {
  view: 'overview',
  teams: [],
  venues: [],
  matches: [],
  rounds: [],
  standings: null,
  summary: null,
  referees: [],
  assignmentBoard: null,
  assignmentLogs: [],
  showLogs: false,
  drawer: { mode: '', entity: '', id: '', title: '', extra: null },
  teamFilter: { status: '', keyword: '' },
  venueFilter: { keyword: '' },
  matchFilter: { round: '', status: '', keyword: '' },
  tableFilter: { keyword: '' },
  refereeFilter: { status: '', keyword: '' },
  assignmentFilter: { round: '' },
};

const OPERATOR_KEY = 'league-board-operator';
const WEEKDAYS = [['0', '周日'], ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六']];
const VIEW_META = {
  overview: { title: '概览', sub: '整季的场次进度与最近赛果', action: '' },
  teams: { title: '球队', sub: '登记参赛球队、简称、主场与档位', action: '新增球队' },
  venues: { title: '场地', sub: '登记比赛场地、容量与可用日', action: '新增场地' },
  matches: { title: '赛程', sub: '按轮次查看对阵，登记比分后积分随之变化', action: '新增赛程' },
  referees: { title: '裁判', sub: '登记主裁与助理人选，按人查看已派场次', action: '新增裁判' },
  assignments: { title: '派场', sub: '给每场比赛派一名主裁与两名助理，同一天一人不吹两场', action: '' },
  table: { title: '积分榜', sub: '按积分、净胜球、进球依次排序', action: '' },
};

const el = (id) => document.getElementById(id);

async function request(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'ok' ? 'ok' : 'bad'}`;
  node.textContent = message;
  el('toasts').appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}

function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const statusPill = (status) => {
  const map = { 已赛: 'done', 待赛: 'wait', 延期: 'late', 取消: 'off' };
  return `<span class="pill ${map[status] || 'wait'}">${escapeHtml(status)}</span>`;
};

async function loadHealth() {
  const node = el('link-state');
  try {
    await request('/api/health');
    node.className = 'link-state ok';
    node.innerHTML = '<span class="dot"></span>服务正常';
  } catch (err) {
    node.className = 'link-state bad';
    node.innerHTML = '<span class="dot"></span>服务连不上';
  }
}

async function loadSummary() {
  state.summary = await request('/api/summary');
  el('season-name').textContent = state.summary.season;
  renderOverview();
}

async function loadStandings() {
  const params = new URLSearchParams();
  if (state.tableFilter.keyword) params.set('keyword', state.tableFilter.keyword);
  state.standings = await request(`/api/standings${params.toString() ? `?${params}` : ''}`);
  renderStandings();
}

async function loadTeams() {
  const params = new URLSearchParams();
  if (state.teamFilter.status) params.set('status', state.teamFilter.status);
  if (state.teamFilter.keyword) params.set('keyword', state.teamFilter.keyword);
  const payload = await request(`/api/teams${params.toString() ? `?${params}` : ''}`);
  state.teams = payload.teams;
  el('nav-teams').textContent = String(payload.total);
  renderTeams();
}

async function loadVenues() {
  const params = new URLSearchParams();
  if (state.venueFilter.keyword) params.set('keyword', state.venueFilter.keyword);
  const payload = await request(`/api/venues${params.toString() ? `?${params}` : ''}`);
  state.venues = payload.venues;
  el('nav-venues').textContent = String(payload.total);
  renderVenues();
}

async function loadMatches() {
  const params = new URLSearchParams();
  if (state.matchFilter.round) params.set('round', state.matchFilter.round);
  if (state.matchFilter.status) params.set('status', state.matchFilter.status);
  if (state.matchFilter.keyword) params.set('keyword', state.matchFilter.keyword);
  const payload = await request(`/api/matches${params.toString() ? `?${params}` : ''}`);
  state.matches = payload.matches;
  state.rounds = payload.rounds;
  el('nav-matches').textContent = String(payload.total);
  renderMatches();
}

function renderOverview() {
  const data = state.summary;
  if (!data) return;
  el('stat-row').innerHTML = [
    ['球队', `${data.activeTeamCount} / ${data.teamCount}`, '参赛中的队数'],
    ['场地', String(data.venueCount), '已登记的比赛场地'],
    ['赛程进度', `${data.playedRounds} / ${data.totalRounds}`, '打完的轮次'],
    ['已赛 / 待赛', `${data.playedMatches} / ${data.pendingMatches}`, `延期 ${data.postponedMatches} 场`],
  ].map(([label, value, note], index) => `<div class="stat ${index === 0 ? 'accent' : ''}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}　${escapeHtml(note)}</span></div>`).join('');

  el('points-hint').textContent = `胜 ${data.points.win} 分 / 平 ${data.points.draw} 分`;
  el('recent-feed').innerHTML = data.recent.length
    ? data.recent.map((item) => `<li>
        <span class="round-tag">第 ${item.round} 轮</span>
        <span>${escapeHtml(item.homeName)}</span>
        <span class="score">${escapeHtml(item.scoreText)}</span>
        <span>${escapeHtml(item.awayName)}</span>
        <span class="muted" style="margin-left:auto">${escapeHtml(item.date)}</span>
      </li>`).join('')
    : '<li class="muted">还没有打完的场次</li>';

  el('podium').innerHTML = data.topThree.length
    ? data.topThree.map((row) => `<li>
        <span class="rank-badge">${row.rank}</span>
        <span>${escapeHtml(row.name)}</span>
        <span class="muted">净胜 ${row.goalDiff}</span>
        <span class="pts">${row.points} 分</span>
      </li>`).join('')
    : '<li class="muted">暂无排名</li>';
}

function renderTeams() {
  el('team-rows').innerHTML = state.teams.map((item) => `<tr>
      <td class="num">${item.seedRank}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.shortName)}</td>
      <td>${escapeHtml(item.city)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td class="num">${item.matchCount}</td>
      <td>${item.status === '参赛' ? '<span class="pill done">参赛</span>' : '<span class="pill off">退赛</span>'}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        <button type="button" class="mini" data-edit-team="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-team="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('team-empty').classList.toggle('show', state.teams.length === 0);
}

function renderVenues() {
  el('venue-grid').innerHTML = state.venues.map((item) => `<article class="venue-card">
      <h3>${escapeHtml(item.name)}</h3>
      <div class="city">${escapeHtml(item.city)}</div>
      <dl>
        <dt>容量</dt><dd>${item.capacity} 人</dd>
        <dt>可用日</dt><dd>${escapeHtml(item.weekdaysText)}</dd>
        <dt>主场球队</dt><dd>${item.homeTeams.length ? escapeHtml(item.homeTeams.join('、')) : '无'}</dd>
        <dt>已排场次</dt><dd>${item.matchCount} 场</dd>
      </dl>
      <div class="card-actions">
        <button type="button" class="mini" data-edit-venue="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-venue="${escapeHtml(item.id)}">删除</button>
      </div>
    </article>`).join('');
  el('venue-empty').classList.toggle('show', state.venues.length === 0);
}

function renderRounds() {
  const chips = [{ round: '', label: '全部轮次' }].concat(state.rounds.map((item) => ({
    round: String(item.round),
    label: `第 ${item.round} 轮 ${item.played}/${item.total}`,
  })));
  el('round-chips').innerHTML = chips.map((chip) => `<button type="button" class="${String(state.matchFilter.round) === chip.round ? 'is-active' : ''}" data-round="${chip.round}">${escapeHtml(chip.label)}</button>`).join('');
}

function renderMatches() {
  renderRounds();
  el('match-rows').innerHTML = state.matches.map((item) => {
    const crewCount = item.crewComplete ? 3 : (item.crewHeadName ? 1 : 0) + (item.crewAssistantNames ? item.crewAssistantNames.length : 0);
    const crewCell = item.status === '取消'
      ? '<span class="muted">—</span>'
      : (item.crewComplete
        ? `<span class="crew-ok" title="主裁：${escapeHtml(item.crewHeadName)}&#10;助理：${escapeHtml(item.crewAssistantNames.join('、'))}">${escapeHtml(item.crewHeadName)} +2</span>`
        : `<button type="button" class="mini danger crew-gap" data-jump-assign="${escapeHtml(item.id)}">缺 ${3 - crewCount} 人</button>`);
    return `<tr class="${!item.crewComplete && item.status !== '取消' ? 'crew-missing' : ''}">
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}</td>
      <td class="num">${escapeHtml(item.kickoff)}</td>
      <td>${escapeHtml(item.homeName)}</td>
      <td class="num">${item.scoreText ? escapeHtml(item.scoreText) : '—'}</td>
      <td>${escapeHtml(item.awayName)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td>${crewCell}</td>
      <td>${statusPill(item.status)}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        ${item.status === '已赛' ? '' : `<button type="button" class="mini" data-result-match="${escapeHtml(item.id)}">登记比分</button>`}
        <button type="button" class="mini" data-edit-match="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-match="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('match-empty').classList.toggle('show', state.matches.length === 0);
}

function renderStandings() {
  const data = state.standings;
  if (!data) return;
  el('table-hint').textContent = `${data.season}　已打 ${data.playedMatches} 场，待赛 ${data.pendingMatches} 场，延期 ${data.postponedMatches} 场`;
  el('table-rows').innerHTML = data.table.map((row) => `<tr>
      <td class="num">${row.rank}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.played}</td>
      <td>${row.win}</td>
      <td>${row.draw}</td>
      <td>${row.loss}</td>
      <td>${row.goalsFor}</td>
      <td>${row.goalsAgainst}</td>
      <td>${row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
      <td><strong>${row.points}</strong></td>
    </tr>`).join('');
}

/* 裁判名册 */
async function loadReferees() {
  const params = new URLSearchParams();
  if (state.refereeFilter.status) params.set('status', state.refereeFilter.status);
  if (state.refereeFilter.keyword) params.set('keyword', state.refereeFilter.keyword);
  const payload = await request(`/api/referees${params.toString() ? `?${params}` : ''}`);
  state.referees = payload.referees;
  el('nav-referees').textContent = String(payload.total);
  renderReferees(payload.limit);
}

const levelPill = (level) => {
  const map = { 国家级: 'lvl-top', 一级: 'lvl-mid', 二级: 'lvl-low' };
  return `<span class="pill ${map[level] || 'lvl-low'}">${escapeHtml(level)}</span>`;
};

function renderReferees(limit) {
  el('referee-limit-hint').textContent = `每人每季最多派 ${limit} 场，一场里要担任主裁或助理一次`;
  el('referee-rows').innerHTML = state.referees.map((item) => `<tr>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${levelPill(item.level)}</td>
      <td class="num"><span class="${item.assignmentCount >= limit ? 'count-hot' : ''}">${item.assignmentCount} / ${limit}</span></td>
      <td class="num muted">${item.remaining}</td>
      <td>${item.status === '在册' ? '<span class="pill done">在册</span>' : '<span class="pill off">停用</span>'}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        <button type="button" class="mini" data-schedule-ref="${escapeHtml(item.id)}">已派场次</button>
        <button type="button" class="mini" data-edit-referee="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-referee="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('referee-empty').classList.toggle('show', state.referees.length === 0);
}

/* 派场看板：一次取全量，轮次筛选只在页面上做，保证派场候选能看到所有比赛日 */
async function loadAssignments() {
  const payload = await request('/api/assignments');
  state.assignmentBoard = payload;
  el('nav-assignments').textContent = String(payload.stats.openIncomplete);
  renderAssignmentBoard();
}

async function loadAssignmentLogs() {
  state.assignmentLogs = (await request('/api/assignment-logs')).logs;
  renderAssignmentLogs();
}

const refereeCell = (person, kind) => {
  if (!person) return `<span class="crew-empty">未派</span>`;
  return `<span class="crew-person ${kind}">${escapeHtml(person.name)}<em>${escapeHtml(person.level)}</em></span>`;
};

function renderAssignmentRounds() {
  const board = state.assignmentBoard;
  if (!board) return;
  const chips = [{ round: '', label: '全部轮次' }].concat(board.rounds.map((r) => ({ round: String(r), label: `第 ${r} 轮` })));
  el('assign-round-chips').innerHTML = chips.map((chip) =>
    `<button type="button" class="${String(state.assignmentFilter.round) === chip.round ? 'is-active' : ''}" data-assign-round="${chip.round}">${escapeHtml(chip.label)}</button>`).join('');
}

function renderAssignmentBoard() {
  const board = state.assignmentBoard;
  if (!board) return;
  renderAssignmentRounds();
  const { stats } = board;
  const alertNode = el('crew-alert');
  if (stats.openIncomplete > 0) {
    alertNode.innerHTML = `<div class="alert warn"><strong>还有 ${stats.openIncomplete} 场没派齐裁判</strong><span>已派齐 ${stats.complete} / ${stats.total} 场；未派齐的场次排在清单最前面，开赛前必须补齐主裁与两名助理</span></div>`;
  } else {
    alertNode.innerHTML = `<div class="alert ok"><strong>裁判都派齐了</strong><span>${stats.complete} 场全部有主裁与两名助理，可以按赛程开赛</span></div>`;
  }

  // 未派齐的永远排最前；轮次筛选只过滤显示，不改全局数据
  const visibleMatches = state.assignmentFilter.round
    ? board.matches.filter((item) => String(item.round) === String(state.assignmentFilter.round))
    : board.matches;

  el('assign-rows').innerHTML = visibleMatches.map((item) => {
    const flags = item.adjacentFlags && item.adjacentFlags.length
      ? `<div class="flag-line" title="${escapeHtml(item.adjacentFlags.map((f) => f.text).join('；'))}">⚠ 连场 ${item.adjacentFlags.map((f) => escapeHtml(f.name)).join('、')}</div>` : '';
    return `<tr class="${item.complete ? '' : 'crew-missing'}">
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}${flags}</td>
      <td class="num">${escapeHtml(item.kickoff)}</td>
      <td>${escapeHtml(item.homeName)} <span class="muted">vs</span> ${escapeHtml(item.awayName)}</td>
      <td>${statusPill(item.status)}</td>
      <td>${refereeCell(item.head, 'role-head')}</td>
      <td>${refereeCell(item.assistantSlots[0], 'role-asst')}</td>
      <td>${refereeCell(item.assistantSlots[1], 'role-asst')}</td>
      <td>
        ${item.open ? `<button type="button" class="mini" data-assign-match="${escapeHtml(item.id)}">${item.complete ? '调整' : '派场'}</button>` : '<span class="muted">已锁定</span>'}
      </td>
    </tr>`;
  }).join('');
  el('assign-empty').classList.toggle('show', visibleMatches.length === 0);
}

function renderAssignmentLogs() {
  const el2 = el('assign-log-list');
  if (!el2) return;
  const kindPill = { 派场: 'done', 改派: 'late', 撤场: 'off' };
  el2.innerHTML = state.assignmentLogs.length ? state.assignmentLogs.map((log) => {
    const at = log.at.replace('T', ' ').slice(0, 16);
    const change = log.kind === '撤场'
      ? `<strong>${escapeHtml(log.fromName)}</strong> 被撤下`
      : (log.kind === '派场'
        ? `派 <strong>${escapeHtml(log.toName)}</strong> 担任`
        : `<strong>${escapeHtml(log.fromName)}</strong> 换成 <strong>${escapeHtml(log.toName)}</strong>`);
    return `<li>
        <span class="pill ${kindPill[log.kind] || 'wait'}">${escapeHtml(log.kind)}</span>
        <div class="log-body">
          <div>${escapeHtml(log.matchLabel)}　<span class="muted">${escapeHtml(log.role)}</span></div>
          <div>${change}　<span class="muted">${escapeHtml(log.reason || '未填原因')}</span></div>
        </div>
        <span class="muted log-meta">${escapeHtml(log.operator || '未署名')} · ${escapeHtml(at)}</span>
      </li>`;
  }).join('') : '<li class="muted">还没有派场或改派记录</li>';
}

/* 抽屉与表单 */
function fieldHtml(kind, name, label, extra) {
  const attrs = extra || '';
  if (kind === 'select') return `<label class="field"><span>${label}</span><select data-name="${name}" ${attrs}></select></label>`;
  if (kind === 'text') return `<label class="field"><span>${label}</span><input data-name="${name}" ${attrs}></label>`;
  return `<label class="field"><span>${label}</span>${extra || ''}</label>`;
}

function optionsHtml(list, selected) {
  return list.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}

function openTeamDrawer(team) {
  state.drawer = { mode: team ? 'edit' : 'create', entity: 'team', id: team ? team.id : '', title: team ? `编辑球队：${team.name}` : '新增球队' };
  const venueOptions = optionsHtml(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })), team ? team.venueId : (state.venues[0] ? state.venues[0].id : ''));
  el('drawer-form').innerHTML = `
    <label class="field"><span>球队名称</span><input data-name="name" maxlength="24" value="${escapeHtml(team ? team.name : '')}" placeholder="例如 江城铁马"></label>
    <div class="field-row">
      <label class="field"><span>简称（两到四个大写字母）</span><input data-name="shortName" maxlength="4" value="${escapeHtml(team ? team.shortName : '')}" placeholder="JCTM"></label>
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(team ? team.city : '')}" placeholder="江城"></label>
    </div>
    <label class="field"><span>主场场地</span><select data-name="venueId">${venueOptions}</select></label>
    <div class="field-row">
      <label class="field"><span>档位</span><input data-name="seedRank" maxlength="2" value="${escapeHtml(team ? team.seedRank : '')}" placeholder="1"></label>
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml([{ value: '参赛', label: '参赛' }, { value: '退赛', label: '退赛' }], team ? team.status : '参赛')}</select></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(team ? team.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openVenueDrawer(venue) {
  state.drawer = { mode: venue ? 'edit' : 'create', entity: 'venue', id: venue ? venue.id : '', title: venue ? `编辑场地：${venue.name}` : '新增场地' };
  const picked = venue ? venue.weekdays.map(String) : ['6'];
  el('drawer-form').innerHTML = `
    <label class="field"><span>场地名称</span><input data-name="name" maxlength="30" value="${escapeHtml(venue ? venue.name : '')}" placeholder="例如 江城体育中心"></label>
    <div class="field-row">
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(venue ? venue.city : '')}" placeholder="江城"></label>
      <label class="field"><span>容量（人）</span><input data-name="capacity" maxlength="6" value="${escapeHtml(venue ? venue.capacity : '')}" placeholder="32000"></label>
    </div>
    <div class="field"><span>可用日</span><div class="weekday-pick">
      ${WEEKDAYS.map(([value, label]) => `<label><input type="checkbox" data-weekday="${value}" ${picked.includes(value) ? 'checked' : ''}> ${label}</label>`).join('')}
    </div></div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(venue ? venue.note : '')}" placeholder="例如 三家共用"></label>`;
  showDrawer();
}

function openMatchDrawer(match) {
  state.drawer = { mode: match ? 'edit' : 'create', entity: 'match', id: match ? match.id : '', title: match ? `编辑赛程：第 ${match.round} 轮` : '新增赛程' };
  const teamOptions = state.teams.map((item) => ({ value: item.id, label: `${item.name}（${item.shortName}）` }));
  const venueOptions = [{ value: '', label: '留空表示用主队主场' }].concat(state.venues.map((item) => ({ value: item.id, label: item.name })));
  const statusOptions = ['待赛', '已赛', '延期', '取消'].map((value) => ({ value, label: value }));
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>轮次</span><input data-name="round" maxlength="2" value="${escapeHtml(match ? match.round : '1')}" placeholder="1"></label>
      <label class="field"><span>日期</span><input data-name="date" maxlength="10" value="${escapeHtml(match ? match.date : '')}" placeholder="2026-03-14"></label>
      <label class="field"><span>开赛时刻</span><input data-name="kickoff" maxlength="5" value="${escapeHtml(match ? match.kickoff : '15:30')}" placeholder="15:30"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>主队</span><select data-name="homeTeamId">${optionsHtml(teamOptions, match ? match.homeTeamId : '')}</select></label>
      <label class="field"><span>客队</span><select data-name="awayTeamId">${optionsHtml(teamOptions, match ? match.awayTeamId : '')}</select></label>
    </div>
    <label class="field"><span>场地</span><select data-name="venueId">${optionsHtml(venueOptions, match ? match.venueId : '')}</select></label>
    <div class="field-row">
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml(statusOptions, match ? match.status : '待赛')}</select></label>
      <label class="field"><span>主队进球</span><input data-name="homeGoals" maxlength="2" value="${match && match.homeGoals !== null ? match.homeGoals : ''}" placeholder="留空表示未赛"></label>
      <label class="field"><span>客队进球</span><input data-name="awayGoals" maxlength="2" value="${match && match.awayGoals !== null ? match.awayGoals : ''}" placeholder="留空表示未赛"></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(match ? match.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openResultDrawer(match) {
  state.drawer = { mode: 'result', entity: 'match', id: match.id, title: `登记比分：${match.homeName} vs ${match.awayName}`, extra: null };
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>${escapeHtml(match.homeName)} 进球</span><input data-name="homeGoals" maxlength="2" value="" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.awayName)} 进球</span><input data-name="awayGoals" maxlength="2" value="" placeholder="0"></label>
    </div>
    <p class="hint">登记完成后这场标成已赛，积分榜与名次立即重算。</p>`;
  showDrawer();
}

function openRefereeDrawer(referee) {
  state.drawer = { mode: referee ? 'edit' : 'create', entity: 'referee', id: referee ? referee.id : '', title: referee ? `编辑裁判：${referee.name}` : '新增裁判', extra: null };
  const levelOptions = ['国家级', '一级', '二级'].map((value) => ({ value, label: value }));
  el('drawer-form').innerHTML = `
    <label class="field"><span>姓名</span><input data-name="name" maxlength="12" value="${escapeHtml(referee ? referee.name : '')}" placeholder="例如 陈一帆"></label>
    <div class="field-row">
      <label class="field"><span>级别</span><select data-name="level">${optionsHtml(levelOptions, referee ? referee.level : '二级')}</select></label>
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml([{ value: '在册', label: '在册' }, { value: '停用', label: '停用' }], referee ? referee.status : '在册')}</select></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(referee ? referee.note : '')}" placeholder="例如 足协推荐、擅长德比"></label>
    <p class="hint">每人每季最多派 ${state.assignmentBoard ? state.assignmentBoard.limit : 7} 场；停用后不会出现在派场候选里。</p>`;
  showDrawer();
}

// 派场候选：同一天已经在吹别的场的人禁用，相邻两天有派场的加标记，满额或停用的也禁用
function refereeAssignOptions(match, selectedId, crewIds) {
  const busyDates = new Map();
  (state.assignmentBoard ? state.assignmentBoard.matches : []).forEach((m) => {
    if (m.id === match.id) return;
    [m.head, ...m.assistantSlots].forEach((person) => {
      if (!person) return;
      if (!busyDates.has(person.refereeId)) busyDates.set(person.refereeId, []);
      busyDates.get(person.refereeId).push(m.date);
    });
  });
  const limit = state.assignmentBoard ? state.assignmentBoard.limit : 7;
  const head = ['<option value="">暂不派（位置留空）</option>'];
  state.referees.forEach((r) => {
    if (crewIds && crewIds.has(r.id) && r.id !== selectedId) return;
    const dates = busyDates.get(r.id) || [];
    const sameDay = dates.includes(match.date);
    const adjacent = dates.some((d) => Math.abs(new Date(`${d}T00:00:00Z`) - new Date(`${match.date}T00:00:00Z`)) === 86400000);
    const full = r.assignmentCount >= limit;
    const flags = [];
    if (sameDay) flags.push('同日有场');
    if (adjacent) flags.push('相邻一天有场');
    if (full) flags.push('本季已满');
    const disabled = sameDay || (full && r.id !== selectedId) || r.status !== '在册';
    const label = `${r.name}（${r.level}，已派 ${r.assignmentCount} 场${flags.length ? `｜${flags.join('、')}` : ''}）`;
    head.push(`<option value="${escapeHtml(r.id)}" ${disabled ? 'disabled' : ''} ${r.id === selectedId ? 'selected' : ''}>${escapeHtml(label)}</option>`);
  });
  return head.join('');
}

function boardMatchById(id) {
  return state.assignmentBoard ? state.assignmentBoard.matches.find((m) => m.id === id) : null;
}

function openAssignDrawer(match) {
  state.drawer = { mode: 'assign', entity: 'assignment', id: match.id, title: `派场：第 ${match.round} 轮 ${match.homeName} vs ${match.awayName}`, extra: match };
  const headId = match.head ? match.head.refereeId : '';
  const asst1Id = match.assistantSlots[0] ? match.assistantSlots[0].refereeId : '';
  const asst2Id = match.assistantSlots[1] ? match.assistantSlots[1].refereeId : '';
  const crewIds = new Set([headId, asst1Id, asst2Id].filter(Boolean));
  const flags = (match.adjacentFlags || []).map((f) => `<li>⚠ ${escapeHtml(f.text)}</li>`).join('');
  el('drawer-form').innerHTML = `
    <p class="hint">${escapeHtml(match.date)} ${escapeHtml(match.kickoff)} 开赛。同一天一人只能吹一场；同一场主裁与助理不能是同一人。</p>
    ${flags ? `<ul class="warn-list">${flags}</ul>` : ''}
    <label class="field"><span>主裁</span><select data-name="headRefereeId">${refereeAssignOptions(match, headId, crewIds)}</select></label>
    <label class="field"><span>助理一</span><select data-name="assistant1RefereeId">${refereeAssignOptions(match, asst1Id, crewIds)}</select></label>
    <label class="field"><span>助理二</span><select data-name="assistant2RefereeId">${refereeAssignOptions(match, asst2Id, crewIds)}</select></label>
    <label class="field"><span>派场说明（可选）</span><input data-name="reason" maxlength="200" value="" placeholder="例如 德比战安排经验丰富的组合"></label>
    <p class="hint">相邻两天连着吹不会被拦，只会在保存后给出提示；位置可以先留空，但开赛前必须补齐。</p>`;
  showDrawer();
}

async function openScheduleDrawer(refereeId) {
  let data;
  try {
    data = await request(`/api/referees/${encodeURIComponent(refereeId)}/schedule`);
  } catch (err) {
    toast(err.message, 'bad');
    return;
  }
  const archived = data.listedCount - data.total;
  state.drawer = { mode: 'schedule', entity: 'refereeSchedule', id: refereeId, title: `已派场次：${data.referee.name}`, extra: data };
  el('drawer-form').innerHTML = `
    <div class="sched-head">
      <div><b>${escapeHtml(data.referee.name)}</b> ${levelPill(data.referee.level)} ${data.referee.status === '在册' ? '' : '<span class="pill off">停用</span>'}</div>
      <div class="hint">占名额 ${data.total} 场 · 上限 ${data.limit} · 还可派 ${data.remaining} 场${archived ? ` · 另有 ${archived} 场已取消留档，不计名额` : ''}${data.consecutiveCount ? ` · <span class="warn-text">${data.consecutiveCount} 场相邻两天连吹</span>` : ''}</div>
    </div>
    <ul class="sched-list">
      ${data.matches.length ? data.matches.map((m) => `<li class="${m.consecutive ? 'consecutive' : ''}">
          <div class="sched-main">
            <span class="round-tag">第 ${m.round} 轮</span>
            <span class="pill ${m.role === '主裁' ? 'role-head' : 'role-asst'}">${escapeHtml(m.role)}</span>
            <strong>${escapeHtml(m.date)} ${escapeHtml(m.kickoff)}</strong>
            <span>${escapeHtml(m.homeName)} vs ${escapeHtml(m.awayName)}</span>
            ${statusPill(m.status)}
            ${m.countsTowardLimit ? '' : '<span class="muted">不计名额</span>'}
          </div>
          <div class="sched-sub">
            ${m.adjacentBefore ? '<span class="warn-text">⚠ 前一天也有派场</span>' : ''}
            ${m.adjacentAfter ? '<span class="warn-text">⚠ 后一天也有派场</span>' : ''}
            ${m.open ? `<button type="button" class="mini" data-reassign-refmatch="${escapeHtml(refereeId)}|${escapeHtml(m.matchId)}|${escapeHtml(m.assignmentId)}|${escapeHtml(m.role)}">改派这场</button>` : '<span class="muted">已锁定</span>'}
          </div>
        </li>`).join('') : '<li class="muted">还没有派场，临时不能来时也无需改派</li>'}
    </ul>`;
  showDrawer();
}

function openReassignDrawer(options) {
  const { matchId, assignmentId, role, fromName, fromRefereeId } = options;
  const match = boardMatchById(matchId);
  if (!match) { toast('找不到这场比赛', 'bad'); return; }
  state.drawer = { mode: 'reassign', entity: 'assignment', id: matchId, title: `改派：${match.homeName} vs ${match.awayName}`, extra: { assignmentId, role, fromName, fromRefereeId } };
  const crewIds = new Set([match.head && match.head.refereeId, ...match.assistantSlots.map((s) => s && s.refereeId)].filter(Boolean));
  el('drawer-form').innerHTML = `
    <p class="hint">${escapeHtml(match.date)} ${escapeHtml(match.kickoff)}　<span class="pill ${role === '主裁' ? 'role-head' : 'role-asst'}">${escapeHtml(role)}</span> 原裁判 <strong>${escapeHtml(fromName)}</strong> 临时不能来</p>
    <label class="field"><span>改派给</span><select data-name="toRefereeId">${refereeAssignOptions(match, '', crewIds)}</select></label>
    <label class="field"><span>改派原因</span><input data-name="reason" maxlength="200" value="" placeholder="例如 家中急事、交通受阻"></label>
    <p class="hint">保存后原裁判与新裁判都会留在改派记录里；也可以先撤下这个位置，稍后再派人。</p>`;
  showDrawer();
}

function showDrawer() {
  el('drawer-title').textContent = state.drawer.title;
  el('drawer').classList.add('show');
  el('backdrop').classList.add('show');
  // 按人已派场次是只读清单，不需要保存键，按钮文案改成完成
  const readOnly = state.drawer.mode === 'schedule';
  el('drawer-submit').style.display = readOnly ? 'none' : '';
  el('drawer-cancel').textContent = readOnly ? '完成' : '取消';
  const first = el('drawer-form').querySelector('input, select');
  if (first) first.focus();
}

function closeDrawer() {
  el('drawer').classList.remove('show');
  el('backdrop').classList.remove('show');
  el('drawer-form').innerHTML = '';
  el('drawer-submit').style.display = '';
  el('drawer-cancel').textContent = '取消';
  state.drawer = { mode: '', entity: '', id: '', title: '', extra: null };
}

function collectForm() {
  const payload = {};
  el('drawer-form').querySelectorAll('[data-name]').forEach((node) => { payload[node.dataset.name] = node.value; });
  const days = Array.from(el('drawer-form').querySelectorAll('[data-weekday]'))
    .filter((node) => node.checked)
    .map((node) => Number(node.dataset.weekday));
  return { payload, days };
}

function markField(field) {
  let node = el('drawer-form').querySelector(`[data-name="${field}"]`);
  // 后端派场类错误统一报 refereeId，抽屉里按位置命名，兜底标到第一个选择框
  if (!node) node = el('drawer-form').querySelector('select, input');
  if (!node) return;
  const wrap = node.closest('.field');
  if (wrap) wrap.classList.add('invalid');
  node.focus();
}

async function submitDrawer() {
  el('drawer-form').querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
  const { payload, days } = collectForm();
  const { mode, entity, id } = state.drawer;
  try {
    if (entity === 'team') {
      const body = { ...payload, seedRank: Number(payload.seedRank) };
      if (mode === 'edit') await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/teams', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '球队已保存' : '球队已新增', 'ok');
      await Promise.all([loadTeams(), loadSummary()]);
    } else if (entity === 'venue') {
      const body = { ...payload, capacity: Number(payload.capacity), weekdays: days };
      if (mode === 'edit') await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/venues', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '场地已保存' : '场地已新增', 'ok');
      await Promise.all([loadVenues(), loadTeams()]);
    } else if (entity === 'match') {
      if (mode === 'result') {
        await request(`/api/matches/${encodeURIComponent(id)}/result`, {
          method: 'POST',
          body: JSON.stringify({ homeGoals: Number(payload.homeGoals), awayGoals: Number(payload.awayGoals) }),
        });
        toast('比分已登记，积分榜已重算', 'ok');
      } else {
        const body = { ...payload, round: Number(payload.round) };
        if (mode === 'edit') await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await request('/api/matches', { method: 'POST', body: JSON.stringify(body) });
        toast(mode === 'edit' ? '赛程已保存' : '赛程已新增', 'ok');
      }
      await Promise.all([loadMatches(), loadSummary()]);
      if (state.view === 'table') await loadStandings();
      if (state.view === 'assignments') await loadAssignments();
    } else if (entity === 'referee') {
      if (mode === 'edit') await request(`/api/referees/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await request('/api/referees', { method: 'POST', body: JSON.stringify(payload) });
      toast(mode === 'edit' ? '裁判已保存' : '裁判已新增', 'ok');
      await Promise.all([loadReferees(), state.assignmentBoard ? loadAssignments() : Promise.resolve()]);
    } else if (entity === 'assignment') {
      const operator = el('operator').value.trim();
      if (mode === 'assign') {
        const body = {
          headRefereeId: payload.headRefereeId || '',
          assistantRefereeIds: [payload.assistant1RefereeId || '', payload.assistant2RefereeId || ''],
          reason: payload.reason || '',
          operator,
        };
        const r = await request(`/api/matches/${encodeURIComponent(id)}/assignments`, { method: 'PUT', body: JSON.stringify(body) });
        if (r.warnings && r.warnings.length) r.warnings.forEach((w) => toast(w, 'bad'));
        toast('派场已保存', 'ok');
      } else if (mode === 'reassign') {
        const body = {
          assignmentId: state.drawer.extra.assignmentId,
          toRefereeId: payload.toRefereeId || '',
          reason: payload.reason || '',
          operator,
        };
        const r = await request(`/api/matches/${encodeURIComponent(id)}/reassign`, { method: 'POST', body: JSON.stringify(body) });
        if (r.warnings && r.warnings.length) r.warnings.forEach((w) => toast(w, 'bad'));
        toast('改派完成，已留痕', 'ok');
      }
      const returnToReferee = mode === 'reassign' ? state.drawer.extra.fromRefereeId : '';
      await Promise.all([loadAssignments(), loadReferees(), loadAssignmentLogs()]);
      // 从"某人临时不能来"的清单进来改派的，保存完回到这人剩余的场次清单
      if (returnToReferee) {
        closeDrawer();
        await openScheduleDrawer(returnToReferee);
        return;
      }
    }
    closeDrawer();
  } catch (err) {
    toast(err.message, 'bad');
    markField(err.field);
  }
}

/* 视图切换 */
async function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view));
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('is-active', node.id === `view-${view}`));
  const meta = VIEW_META[view];
  el('view-title').textContent = meta.title;
  el('view-sub').textContent = meta.sub;
  el('head-actions').innerHTML = meta.action ? `<button type="button" class="primary" id="head-add">${meta.action}</button>` : '';
  if (meta.action) el('head-add').addEventListener('click', () => openDrawerFor(view, null));

  try {
    if (view === 'overview') await loadSummary();
    if (view === 'teams') { await Promise.all([loadVenues(), loadTeams()]); }
    if (view === 'venues') await loadVenues();
    if (view === 'matches') { await Promise.all([loadTeams(), loadMatches()]); }
    if (view === 'referees') await loadReferees();
    if (view === 'assignments') {
      await Promise.all([loadReferees(), loadAssignments()]);
      if (state.showLogs) await loadAssignmentLogs();
    }
    if (view === 'table') await loadStandings();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function openDrawerFor(view, id) {
  if (view === 'teams') openTeamDrawer(id ? state.teams.find((item) => item.id === id) : null);
  if (view === 'venues') openVenueDrawer(id ? state.venues.find((item) => item.id === id) : null);
  if (view === 'matches') openMatchDrawer(id ? state.matches.find((item) => item.id === id) : null);
  if (view === 'referees') openRefereeDrawer(id ? state.referees.find((item) => item.id === id) : null);
}

/* 事件绑定 */
el('nav').addEventListener('click', (event) => {
  const node = event.target.closest('.nav-item');
  if (node) switchView(node.dataset.view);
});

el('team-status-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.teamFilter.status = node.dataset.value;
  el('team-status-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('team-search').addEventListener('click', () => {
  state.teamFilter.keyword = el('team-keyword').value.trim();
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('venue-search').addEventListener('click', () => {
  state.venueFilter.keyword = el('venue-keyword').value.trim();
  loadVenues().catch((err) => toast(err.message, 'bad'));
});
el('match-search').addEventListener('click', () => {
  state.matchFilter.keyword = el('match-keyword').value.trim();
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('match-status').addEventListener('change', () => {
  state.matchFilter.status = el('match-status').value;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('table-search').addEventListener('click', () => {
  state.tableFilter.keyword = el('table-keyword').value.trim();
  loadStandings().catch((err) => toast(err.message, 'bad'));
});
el('round-chips').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.matchFilter.round = node.dataset.round;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});

el('referee-status-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.refereeFilter.status = node.dataset.value;
  el('referee-status-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadReferees().catch((err) => toast(err.message, 'bad'));
});
el('referee-search').addEventListener('click', () => {
  state.refereeFilter.keyword = el('referee-keyword').value.trim();
  loadReferees().catch((err) => toast(err.message, 'bad'));
});

el('assign-round-chips').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.assignmentFilter.round = node.dataset.assignRound;
  renderAssignmentBoard();
});

el('assign-log-toggle').addEventListener('click', async () => {
  state.showLogs = !state.showLogs;
  el('assign-log-card').hidden = !state.showLogs;
  el('assign-log-toggle').classList.toggle('is-active', state.showLogs);
  if (state.showLogs) {
    try { await loadAssignmentLogs(); } catch (err) { toast(err.message, 'bad'); }
  }
});

document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.editTeam) return openDrawerFor('teams', node.dataset.editTeam);
  if (node.dataset.editVenue) return openDrawerFor('venues', node.dataset.editVenue);
  if (node.dataset.editMatch) return openDrawerFor('matches', node.dataset.editMatch);
  if (node.dataset.editReferee) return openDrawerFor('referees', node.dataset.editReferee);
  if (node.dataset.assignMatch) {
    const match = boardMatchById(node.dataset.assignMatch);
    if (match) openAssignDrawer(match);
    return;
  }
  if (node.dataset.jumpAssign) {
    // 从赛程视图的"缺 N 人"按钮直接跳到派场视图并打开这场
    const matchId = node.dataset.jumpAssign;
    switchView('assignments').then(() => {
      const match = boardMatchById(matchId);
      if (match) openAssignDrawer(match);
    });
    return;
  }
  if (node.dataset.scheduleRef) {
    await openScheduleDrawer(node.dataset.scheduleRef);
    return;
  }
  if (node.dataset.reassignRefmatch) {
    const [refereeId, matchId, assignmentId, role] = node.dataset.reassignRefmatch.split('|');
    const schedule = state.drawer.entity === 'refereeSchedule' ? state.drawer.extra : null;
    const fromName = schedule ? schedule.referee.name : '';
    // 从裁判视图直接进来时看板可能还没加载，先取一次再打开改派抽屉
    if (!state.assignmentBoard) {
      try { await loadAssignments(); } catch (err) { toast(err.message, 'bad'); return; }
    }
    openReassignDrawer({ matchId, assignmentId, role, fromName, fromRefereeId: refereeId });
    return;
  }
  if (node.dataset.resultMatch) {
    return openResultDrawer(state.matches.find((item) => item.id === node.dataset.resultMatch));
  }
  if (node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch || node.dataset.delReferee) {
    const isTeam = Boolean(node.dataset.delTeam);
    const isVenue = Boolean(node.dataset.delVenue);
    const isReferee = Boolean(node.dataset.delReferee);
    const id = node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch || node.dataset.delReferee;
    const what = isTeam ? '球队' : (isVenue ? '场地' : (isReferee ? '裁判' : '这场赛程'));
    if (!window.confirm(`确定删除这个${what}吗？`)) return;
    try {
      if (isTeam) { await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadTeams(), loadSummary()]); }
      else if (isVenue) { await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadVenues(); }
      else if (isReferee) {
        await request(`/api/referees/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await Promise.all([loadReferees(), state.assignmentBoard ? loadAssignments() : Promise.resolve()]);
      }
      else {
        await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await Promise.all([loadMatches(), loadSummary(), state.assignmentBoard ? loadAssignments() : Promise.resolve()]);
      }
      toast('已删除', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
});

el('drawer-submit').addEventListener('click', submitDrawer);
el('drawer-cancel').addEventListener('click', closeDrawer);
el('drawer-close').addEventListener('click', closeDrawer);
el('backdrop').addEventListener('click', closeDrawer);
el('drawer-form').addEventListener('submit', (event) => { event.preventDefault(); submitDrawer(); });
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, el('operator').value.trim());
});

async function boot() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
  await loadHealth();
  await switchView('overview');
}

boot();
