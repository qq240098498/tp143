// 页面交互：左侧导航切换视图，右侧抽屉负责新增与编辑，所有提示走右上角浮层

const state = {
  view: 'overview',
  teams: [],
  venues: [],
  referees: [],
  matches: [],
  rounds: [],
  appoint: null,
  appointOptions: null,
  standings: null,
  summary: null,
  drawer: { mode: '', entity: '', id: '', title: '' },
  teamFilter: { status: '', keyword: '' },
  venueFilter: { keyword: '' },
  refereeFilter: { status: '', level: '', keyword: '' },
  matchFilter: { round: '', status: '', keyword: '' },
  appointFilter: { round: '', status: '', keyword: '' },
  tableFilter: { keyword: '' },
  expandedReferees: new Set(),
};

const OPERATOR_KEY = 'league-board-operator';
const WEEKDAYS = [['0', '周日'], ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六']];
const SLOT_ORDER = ['主裁', '助理一', '助理二'];
const VIEW_META = {
  overview: { title: '概览', sub: '整季的场次进度、派场缺口与最近赛果', action: '' },
  teams: { title: '球队', sub: '登记参赛球队、简称、主场与档位', action: '新增球队' },
  venues: { title: '场地', sub: '登记比赛场地、容量与可用日', action: '新增场地' },
  referees: { title: '裁判', sub: '按人查看已派场次与数量，临时不能来就停派并逐场改派', action: '新增裁判' },
  matches: { title: '赛程', sub: '按轮次查看对阵，登记比分前必须配齐裁判', action: '新增赛程' },
  appointments: { title: '派场', sub: '为每场配齐一名主裁与两名助理；同日撞场、超上限当场拒绝', action: '' },
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
  window.setTimeout(() => node.remove(), 4200);
}

function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const statusPill = (status) => {
  const map = { 已赛: 'done', 待赛: 'wait', 延期: 'late', 取消: 'off' };
  return `<span class="pill ${map[status] || 'wait'}">${escapeHtml(status)}</span>`;
};

const operatorName = () => el('operator').value.trim();

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

async function loadReferees() {
  const params = new URLSearchParams();
  if (state.refereeFilter.status) params.set('status', state.refereeFilter.status);
  if (state.refereeFilter.level) params.set('level', state.refereeFilter.level);
  if (state.refereeFilter.keyword) params.set('keyword', state.refereeFilter.keyword);
  const payload = await request(`/api/referees${params.toString() ? `?${params}` : ''}`);
  state.referees = payload.referees;
  el('nav-referees').textContent = String(payload.total);
  renderReferees();
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

async function loadAppointments() {
  const params = new URLSearchParams();
  if (state.appointFilter.round) params.set('round', state.appointFilter.round);
  if (state.appointFilter.status) params.set('status', state.appointFilter.status === 'all' ? '' : state.appointFilter.status);
  if (state.appointFilter.keyword) params.set('keyword', state.appointFilter.keyword);
  const payload = await request(`/api/appointments${params.toString() ? `?${params}` : ''}`);
  state.appoint = payload;
  el('nav-appointments').textContent = payload.gapCount > 0 ? `缺${payload.gapCount}` : '齐';
  el('nav-appointments').className = payload.urgentGapCount > 0 ? 'urgent' : '';
  renderAppointments();
}

function renderOverview() {
  const data = state.summary;
  if (!data) return;
  el('stat-row').innerHTML = [
    ['球队', `${data.activeTeamCount} / ${data.teamCount}`, '参赛中的队数'],
    ['场地', String(data.venueCount), '已登记的比赛场地'],
    ['裁判', `${data.activeRefereeCount} / ${data.refereeCount}`, '在岗裁判人数'],
    ['赛程进度', `${data.playedRounds} / ${data.totalRounds}`, '打完的轮次'],
    ['派场进度', `${data.appointComplete} / ${data.appointTotal}`, `未配齐 ${data.appointGap} 场`],
  ].map(([label, value, note], index) => `<div class="stat ${index === 0 ? 'accent' : ''}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}　${escapeHtml(note)}</span></div>`).join('');

  const banner = el('gap-banner');
  if (data.appointUrgentGap > 0) {
    banner.hidden = false;
    banner.className = 'gap-banner danger';
    banner.innerHTML = `⚠ 已经到了开赛时刻，仍有 <strong>${data.appointUrgentGap}</strong> 场比赛没配齐裁判，请立即到「派场」处理，不能让比赛无裁判开赛。`;
  } else if (data.appointGap > 0) {
    banner.hidden = false;
    banner.className = 'gap-banner warn';
    banner.innerHTML = `还有 <strong>${data.appointGap}</strong> 场比赛没配齐主裁或助理，开赛前去「派场」配齐。`;
  } else {
    banner.hidden = true;
    banner.textContent = '';
  }

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

function renderReferees() {
  el('referee-rows').innerHTML = state.referees.map((item) => {
    const expanded = state.expandedReferees.has(item.id);
    const countCls = item.overLimit ? 'num over' : 'num';
    const statusPillHtml = item.status === '在岗'
      ? '<span class="pill done">在岗</span>'
      : '<span class="pill off">停派</span>';
    const rows = [
      `<tr>
        <td><button type="button" class="link-btn" data-toggle-referee="${escapeHtml(item.id)}">${expanded ? '▾' : '▸'} ${escapeHtml(item.name)}</button></td>
        <td>${item.level === '主裁' ? '<span class="pill chief">主裁</span>' : '<span class="pill wait">助理</span>'}</td>
        <td class="${countCls}">${item.assignedCount} / ${item.seasonLimit}${item.overLimit ? ' ⚠超上限' : ''}</td>
        <td class="num">${item.remaining}</td>
        <td class="num">${item.upcomingCount > 0 ? `<strong class="${item.status === '停派' ? 'over' : ''}">${item.upcomingCount} 场待吹</strong>` : '0'}</td>
        <td>${statusPillHtml}</td>
        <td class="muted">${escapeHtml(item.note)}</td>
        <td class="nowrap">
          <button type="button" class="mini" data-edit-referee="${escapeHtml(item.id)}">编辑</button>
          <button type="button" class="mini ${item.status === '停派' ? '' : 'danger'}" data-toggle-status-referee="${escapeHtml(item.id)}">${item.status === '停派' ? '复岗' : '停派'}</button>
          <button type="button" class="mini danger" data-del-referee="${escapeHtml(item.id)}">删除</button>
        </td>
      </tr>`];
    if (expanded) {
      rows.push(`<tr class="detail-row"><td colspan="8">
        <div class="referee-detail">
          <div class="detail-head">${escapeHtml(item.name)} 本季已派 <strong>${item.assignedCount}</strong> 场${item.upcomingCount ? `，其中 <strong class="${item.status === '停派' ? 'over' : ''}">${item.upcomingCount} 场还没吹</strong>，临时不能来时逐场点“改派”` : '，没有待吹场次'}</div>
          <table class="grid inner">
            <thead><tr><th>轮次</th><th>日期</th><th>时刻</th><th>对阵</th><th>槽位</th><th>状态</th><th></th></tr></thead>
            <tbody>
              ${item.matches.length ? item.matches.map((m) => `<tr class="${m.status === '取消' ? 'cancelled' : ''}">
                <td class="num">${m.round}</td>
                <td class="num">${escapeHtml(m.date)}</td>
                <td class="num">${escapeHtml(m.kickoff)}</td>
                <td>${escapeHtml(m.homeName)} vs ${escapeHtml(m.awayName)}</td>
                <td>${escapeHtml(m.slot)}</td>
                <td>${statusPill(m.status)}${m.started ? ' <span class="pill off">已开赛</span>' : ''}</td>
                <td>${(m.status === '待赛' || m.status === '延期') ? `<button type="button" class="mini" data-reassign-match="${escapeHtml(m.matchId)}" data-reassign-slot="${escapeHtml(m.slot)}">改派</button>` : '<span class="muted">已锁定</span>'}</td>
              </tr>`).join('') : '<tr><td colspan="7" class="muted">还没有派场记录</td></tr>'}
            </tbody>
          </table>
        </div>
      </td></tr>`);
    }
    return rows.join('');
  }).join('');
  el('referee-empty').classList.toggle('show', state.referees.length === 0);
}

function slotCellHtml(row) {
  if (!row.refereeId) {
    return `<div class="slot-cell empty"><span class="slot-name">${escapeHtml(row.slot)}</span><span class="slot-empty">空缺</span></div>`;
  }
  const stopped = row.refereeStatus === '停派';
  return `<div class="slot-cell">
    <span class="slot-name">${escapeHtml(row.slot)}</span>
    <span class="slot-ref">${escapeHtml(row.refereeName)}</span>
    <span class="slot-level">${escapeHtml(row.refereeLevel)}${stopped ? ' · 已停派' : ''}</span>
  </div>`;
}

function renderAppointments() {
  const data = state.appoint;
  if (!data) return;

  // 缺口卡片：派不满的比赛单独列出，已到开赛时刻的顶到最前并标红
  const gaps = data.gaps.slice().sort((a, b) => Number(b.started) - Number(a.started) || a.date.localeCompare(b.date));
  el('appoint-gap-hint').textContent = `共 ${data.gapCount} 场没配齐${data.urgentGapCount ? `，其中 ${data.urgentGapCount} 场已经到开赛时刻` : ''}`;
  el('appoint-gaps').innerHTML = gaps.length ? gaps.map((item) => {
    const missing = item.slots.filter((s) => !s.refereeId).map((s) => s.slot).join('、');
    return `<li class="${item.started ? 'is-urgent' : ''}">
      <span class="round-tag">第 ${item.round} 轮</span>
      <span>${escapeHtml(item.date)} ${escapeHtml(item.kickoff)}</span>
      <span>${escapeHtml(item.homeName)} vs ${escapeHtml(item.awayName)}</span>
      <span class="muted">缺：${escapeHtml(missing)}</span>
      ${item.started ? '<span class="pill off">已开赛仍缺裁判</span>' : statusPill(item.status)}
      <button type="button" class="mini" data-assign-match="${escapeHtml(item.matchId)}" style="margin-left:auto">去配齐</button>
    </li>`;
  }).join('') : '<li class="muted">所有未赛场次都配齐了裁判。</li>';

  const urgent = el('appoint-urgent');
  if (data.urgentGapCount > 0) {
    urgent.hidden = false;
    urgent.textContent = `⚠ ${data.urgentGapCount} 场比赛已经到开赛时刻却还没配齐裁判，立即处理上方标红的场次。`;
  } else {
    urgent.hidden = true;
    urgent.textContent = '';
  }

  const chips = [{ round: '', label: '全部轮次' }].concat(data.rounds.map((item) => ({ round: String(item.round), label: `第 ${item.round} 轮` })));
  el('appoint-round-chips').innerHTML = chips.map((chip) =>
    `<button type="button" class="${String(state.appointFilter.round) === chip.round ? 'is-active' : ''}" data-appoint-round="${chip.round}">${escapeHtml(chip.label)}</button>`).join('');

  el('appoint-rows').innerHTML = data.matches.map((item) => {
    const locked = item.status === '已赛' || item.status === '取消';
    const warnText = item.warnings.length
      ? [...new Set(item.warnings.map((w) => w.text))].map((t) => `<div class="slot-warn">⚠ ${escapeHtml(t)}</div>`).join('')
      : (item.complete ? '<span class="muted">—</span>' : '');
    return `<tr class="${item.started && !item.complete ? 'row-urgent' : ''}">
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}<br><span class="muted">${escapeHtml(item.kickoff)}</span>${item.started && !item.complete ? '<br><span class="pill off">已开赛</span>' : ''}</td>
      <td>${escapeHtml(item.homeName)}<br><span class="muted">vs ${escapeHtml(item.awayName)}</span><br>${statusPill(item.status)}</td>
      ${item.slots.map((row) => `<td>${slotCellHtml(row, !locked)}
        ${!locked && row.refereeId ? `<button type="button" class="mini" data-reassign-match="${escapeHtml(item.matchId)}" data-reassign-slot="${escapeHtml(row.slot)}">改派</button>` : ''}
      </td>`).join('')}
      <td class="warn-cell">${warnText}</td>
      <td class="nowrap">
        ${locked ? '<span class="muted">已锁定</span>' : `<button type="button" class="mini" data-assign-match="${escapeHtml(item.matchId)}">${item.complete ? '调整配齐' : '配齐'}</button>`}
      </td>
    </tr>`;
  }).join('');
  el('appoint-empty').classList.toggle('show', data.matches.length === 0);
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
  el('match-rows').innerHTML = state.matches.map((item) => `<tr>
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}</td>
      <td class="num">${escapeHtml(item.kickoff)}</td>
      <td>${escapeHtml(item.homeName)}</td>
      <td class="num">${item.scoreText ? escapeHtml(item.scoreText) : '—'}</td>
      <td>${escapeHtml(item.awayName)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td>${statusPill(item.status)}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        ${item.status === '已赛' ? '' : `<button type="button" class="mini" data-result-match="${escapeHtml(item.id)}">登记比分</button>`}
        <button type="button" class="mini" data-edit-match="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-match="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
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

function openRefereeDrawer(referee) {
  state.drawer = { mode: referee ? 'edit' : 'create', entity: 'referee', id: referee ? referee.id : '', title: referee ? `编辑裁判：${referee.name}` : '新增裁判' };
  el('drawer-form').innerHTML = `
    <label class="field"><span>姓名</span><input data-name="name" maxlength="24" value="${escapeHtml(referee ? referee.name : '')}" placeholder="例如 铁面"></label>
    <div class="field-row">
      <label class="field"><span>级别</span><select data-name="level">${optionsHtml([{ value: '主裁', label: '主裁（可任主裁与助理）' }, { value: '助理', label: '助理（只能任助理）' }], referee ? referee.level : '助理')}</select></label>
      <label class="field"><span>一季派场上限</span><input data-name="seasonLimit" maxlength="3" value="${escapeHtml(referee ? referee.seasonLimit : 12)}" placeholder="12"></label>
    </div>
    <label class="field"><span>状态</span><select data-name="status">${optionsHtml([{ value: '在岗', label: '在岗' }, { value: '停派', label: '停派（临时不能来）' }], referee ? referee.status : '在岗')}</select></label>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(referee ? referee.note : '')}" placeholder="需要留意的地方"></label>
    ${referee ? `<p class="hint">本季已派 ${referee.assignedCount} 场，上限还剩 ${referee.remaining} 场；名下有未吹场次时请用停派并改派。</p>` : ''}`;
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
  state.drawer = { mode: 'result', entity: 'match', id: match.id, title: `登记比分：${match.homeName} vs ${match.awayName}` };
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>${escapeHtml(match.homeName)} 进球</span><input data-name="homeGoals" maxlength="2" value="" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.awayName)} 进球</span><input data-name="awayGoals" maxlength="2" value="" placeholder="0"></label>
    </div>
    <p class="hint">登记完成后这场标成已赛；若还没配齐主裁与两名助理，登记会被拒绝。</p>`;
  showDrawer();
}

// 候选人下拉：不可选的人（同日撞场、超上限、停派、级别不符、已在另一个槽位）直接禁用
function candidateOptions(slotData, selectedId) {
  const placeholder = selectedId
    ? ''
    : '<option value="" disabled selected>请选择裁判…</option>';
  return placeholder + slotData.candidates.map((c) => {
    const parts = [`${c.name}（${c.level}）`, `已派 ${c.count}/${c.seasonLimit}`, `剩 ${c.remaining}`];
    if (c.adjacent.length) parts.push(`${[...new Set(c.adjacent.map((a) => a.side))].join('/')}有一场`);
    const label = parts.join(' · ');
    return `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''} ${c.available ? '' : 'disabled'}>${escapeHtml(label)}${c.available ? '' : '（不可选）'}</option>`;
  }).join('');
}

// 下拉下方实时说明当前选中的人能不能派、差几场超上限、相邻天有没有场
function candidateNote(c) {
  if (!c) return '';
  if (!c.available) {
    return `<p class="slot-note bad">${escapeHtml(c.reasons.join('；'))}</p>`;
  }
  const bits = [];
  if (c.sameMatchSlot) bits.push(`这人当前是这场的${c.sameMatchSlot}，确认后相当于两个槽位对调`);
  if (c.count + 1 > c.seasonLimit) {
    bits.push(`再派将超上限 ${c.count + 1 - c.seasonLimit} 场`);
  } else {
    bits.push(`可派，派完本季还剩 ${Math.max(0, c.seasonLimit - c.count - 1)} 场额度`);
  }
  if (c.adjacent.length) {
    bits.push(`该裁判${[...new Set(c.adjacent.map((a) => `${a.side}（${a.date}）还有一场`))].join('、')}，连着吹会给出提示`);
  }
  return `<p class="slot-note ${c.adjacent.length ? 'warn' : 'ok'}">${escapeHtml(bits.join('；'))}</p>`;
}

async function openAssignDrawer(matchId) {
  try {
    state.appointOptions = await request(`/api/appointments/${encodeURIComponent(matchId)}/options`);
  } catch (err) {
    toast(err.message, 'bad');
    return;
  }
  const { match, locked, slots } = state.appointOptions;
  if (locked) {
    toast('这场已经打完或取消，裁判名单锁定', 'bad');
    return;
  }
  state.drawer = { mode: 'assign', entity: 'appointment', id: matchId, title: `配齐裁判：第 ${match.round} 轮 ${match.homeName} vs ${match.awayName}` };
  el('drawer-form').innerHTML = `
    <p class="hint">${escapeHtml(match.date)} ${escapeHtml(match.kickoff)}　同一场的主裁与助理不能是同一人；同日已吹另一场或本季超上限的人不可选。</p>
    ${slots.map((slotData) => `
      <label class="field"><span>${escapeHtml(slotData.slot)}</span>
        <select data-slot="${escapeHtml(slotData.slot)}">${candidateOptions(slotData, slotData.refereeId)}</select>
      </label>
      <div data-slot-note="${escapeHtml(slotData.slot)}"></div>`).join('')}
    <label class="field"><span>说明（可选）</span><input data-name="reason" maxlength="200" placeholder="例如 常规派场 / 某人伤愈复出"></label>
    <label class="field"><span>操作者</span><input data-name="operator" maxlength="40" value="${escapeHtml(operatorName())}"></label>`;
  showDrawer();
  refreshSlotNotes();
  el('drawer-form').querySelectorAll('select[data-slot]').forEach((node) => {
    node.addEventListener('change', refreshSlotNotes);
  });
}

async function openReassignDrawer(matchId, slot) {
  try {
    state.appointOptions = await request(`/api/appointments/${encodeURIComponent(matchId)}/options`);
  } catch (err) {
    toast(err.message, 'bad');
    return;
  }
  const { match, locked, slots } = state.appointOptions;
  if (locked) {
    toast('这场已经打完或取消，裁判名单锁定', 'bad');
    return;
  }
  const slotData = slots.find((item) => item.slot === slot);
  const incumbent = slotData.candidates.find((c) => c.incumbent);
  state.drawer = { mode: 'reassign', entity: 'appointment', id: matchId, reassignSlot: slot, title: `改派${slot}：第 ${match.round} 轮` };
  // 改派下拉默认不选原裁判，原裁判放在最上面并禁用，强制明确"换成谁"
  const others = slotData.candidates.filter((c) => !c.incumbent);
  el('drawer-form').innerHTML = `
    <p class="hint">${escapeHtml(match.date)} ${escapeHtml(match.kickoff)}　${escapeHtml(match.homeName)} vs ${escapeHtml(match.awayName)}</p>
    <div class="reassign-line"><span>原${escapeHtml(slot)}</span><strong>${incumbent ? escapeHtml(incumbent.name) : '空缺'}</strong><span class="muted">改派后原场次与新场次都会留痕</span></div>
    <label class="field"><span>换成</span>
      <select data-slot="${escapeHtml(slot)}">
        <option value="">请选择接替的裁判…</option>
        ${incumbent ? `<option value="${escapeHtml(incumbent.id)}" disabled>${escapeHtml(incumbent.name)}（原裁判，不可选）</option>` : ''}
        ${others.map((c) => {
          const parts = [`${c.name}（${c.level}）`, `已派 ${c.count}/${c.seasonLimit}`, `剩 ${c.remaining}`];
          if (c.adjacent.length) parts.push(`${[...new Set(c.adjacent.map((a) => a.side))].join('/')}有一场`);
          return `<option value="${escapeHtml(c.id)}" ${c.available ? '' : 'disabled'}>${escapeHtml(parts.join(' · '))}${c.available ? '' : '（不可选）'}</option>`;
        }).join('')}
      </select>
    </label>
    <div data-slot-note="${escapeHtml(slot)}"></div>
    <label class="field"><span>改派原因</span><input data-name="reason" maxlength="200" value="" placeholder="例如 本人临时不能来（必填）"></label>
    <label class="field"><span>操作者</span><input data-name="operator" maxlength="40" value="${escapeHtml(operatorName())}"></label>`;
  showDrawer();
  refreshSlotNotes();
  el('drawer-form').querySelectorAll('select[data-slot]').forEach((node) => {
    node.addEventListener('change', refreshSlotNotes);
  });
}

function refreshSlotNotes() {
  const { slots } = state.appointOptions || { slots: [] };
  // 本次三个下拉各选了谁，用来实时判同场重复
  const chosen = new Map();
  slots.forEach((slotData) => {
    const select = el('drawer-form').querySelector(`select[data-slot="${slotData.slot}"]`);
    if (select && select.value) chosen.set(slotData.slot, select.value);
  });
  const pickedIds = [...chosen.values()];
  el('drawer-form').querySelectorAll('[data-slot-note]').forEach((box) => {
    const slot = box.dataset.slotNote;
    const select = el('drawer-form').querySelector(`select[data-slot="${slot}"]`);
    const slotData = slots.find((item) => item.slot === slot);
    const candidate = slotData && select ? slotData.candidates.find((c) => c.id === select.value) : null;
    if (!candidate) { box.innerHTML = ''; return; }
    const duplicatedHere = pickedIds.filter((id) => id === candidate.id).length > 1;
    const html = [];
    if (duplicatedHere) html.push('<p class="slot-note bad">这个人同时占了两个槽位，同一场的主裁与助理不能是同一人</p>');
    html.push(candidateNote(candidate));
    box.innerHTML = html.join('');
  });
}

async function openLogsDrawer() {
  state.drawer = { mode: 'logs', entity: '', id: '', title: '配齐与改派记录' };
  el('drawer-form').innerHTML = '<p class="hint">载入中…</p>';
  showDrawer(true);
  try {
    const payload = await request('/api/logs');
    el('drawer-form').innerHTML = payload.logs.length ? payload.logs.map((item) => `
      <div class="log-item ${item.action === '改派' ? 'reassign' : 'assign'}">
        <div class="log-top">
          <span class="pill ${item.action === '改派' ? 'late' : 'done'}">${escapeHtml(item.action)}</span>
          <span>${escapeHtml(item.slot)}</span>
          <span class="muted">${escapeHtml(item.date)}　第 ${item.round} 轮</span>
        </div>
        <div class="log-match">${escapeHtml(item.matchText)}</div>
        <div class="log-flow">
          ${item.refereeFromName ? `<span class="from">${escapeHtml(item.refereeFromName)}</span><span class="arrow">换成</span>` : '<span class="muted">初次派给</span>'}
          <span class="to">${escapeHtml(item.refereeToName)}</span>
        </div>
        <div class="muted small">原因：${escapeHtml(item.reason || '—')}　操作者：${escapeHtml(item.operator || '—')}　${escapeHtml(item.createdAt.replace('T', ' ').slice(0, 16))}</div>
      </div>`).join('') : '<p class="hint">还没有任何配齐或改派记录。</p>';
  } catch (err) {
    el('drawer-form').innerHTML = `<p class="slot-note bad">${escapeHtml(err.message)}</p>`;
  }
}

function showDrawer(readOnly) {
  el('drawer-title').textContent = state.drawer.title;
  el('drawer').classList.add('show');
  el('backdrop').classList.add('show');
  el('drawer-foot').style.display = readOnly ? 'none' : '';
  const first = el('drawer-form').querySelector('input, select');
  if (first && !readOnly) first.focus();
}

function closeDrawer() {
  el('drawer').classList.remove('show');
  el('backdrop').classList.remove('show');
  el('drawer-form').innerHTML = '';
  el('drawer-foot').style.display = '';
  state.drawer = { mode: '', entity: '', id: '', title: '' };
  state.appointOptions = null;
}

function collectForm() {
  const payload = {};
  el('drawer-form').querySelectorAll('[data-name]').forEach((node) => { payload[node.dataset.name] = node.value; });
  const slotPicks = {};
  el('drawer-form').querySelectorAll('select[data-slot]').forEach((node) => { slotPicks[node.dataset.slot] = node.value; });
  const days = Array.from(el('drawer-form').querySelectorAll('[data-weekday]'))
    .filter((node) => node.checked)
    .map((node) => Number(node.dataset.weekday));
  return { payload, days, slotPicks };
}

function markField(field) {
  const node = el('drawer-form').querySelector(`[data-name="${field}"], [data-slot="${field}"]`);
  if (!node) return;
  const wrap = node.closest('.field');
  if (wrap) wrap.classList.add('invalid');
  node.focus();
}

async function submitDrawer() {
  el('drawer-form').querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
  const { payload, days, slotPicks } = collectForm();
  const { mode, entity, id, reassignSlot } = state.drawer;
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
    } else if (entity === 'referee') {
      const body = { ...payload, seasonLimit: Number(payload.seasonLimit) };
      if (mode === 'edit') await request(`/api/referees/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/referees', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '裁判已保存' : '裁判已新增', 'ok');
      await Promise.all([loadReferees(), loadSummary()]);
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
    } else if (entity === 'appointment') {
      if (mode === 'assign') {
        const result = await request(`/api/appointments/${encodeURIComponent(id)}`, {
          method: 'POST',
          body: JSON.stringify({ slots: slotPicks, reason: payload.reason || '', operator: payload.operator || operatorName() }),
        });
        toast(`第 ${result.match.round} 轮已配齐三名裁判`, 'ok');
        (result.warnings || []).forEach((w) => toast(w.text, 'bad'));
      } else if (mode === 'reassign') {
        if (!slotPicks[reassignSlot]) {
          toast('请选择接替的裁判', 'bad');
          return;
        }
        const result = await request(`/api/appointments/${encodeURIComponent(id)}/reassign`, {
          method: 'POST',
          body: JSON.stringify({
            slot: reassignSlot,
            refereeId: slotPicks[reassignSlot],
            reason: payload.reason || '',
            operator: payload.operator || operatorName(),
          }),
        });
        toast(`${result.from.name} 的 ${reassignSlot} 已改派给 ${result.to.name}，留痕已记录`, 'ok');
        (result.warnings || []).forEach((w) => toast(w.text, 'bad'));
      }
      await Promise.all([loadAppointments(), loadReferees(), loadSummary()]);
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
    if (view === 'referees') await loadReferees();
    if (view === 'matches') { await Promise.all([loadTeams(), loadMatches()]); }
    if (view === 'appointments') await loadAppointments();
    if (view === 'table') await loadStandings();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function openDrawerFor(view, id) {
  if (view === 'teams') openTeamDrawer(id ? state.teams.find((item) => item.id === id) : null);
  if (view === 'venues') openVenueDrawer(id ? state.venues.find((item) => item.id === id) : null);
  if (view === 'referees') openRefereeDrawer(id ? state.referees.find((item) => item.id === id) : null);
  if (view === 'matches') openMatchDrawer(id ? state.matches.find((item) => item.id === id) : null);
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
el('referee-search').addEventListener('click', () => {
  state.refereeFilter.keyword = el('referee-keyword').value.trim();
  loadReferees().catch((err) => toast(err.message, 'bad'));
});
el('referee-status-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.refereeFilter.status = node.dataset.value;
  el('referee-status-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadReferees().catch((err) => toast(err.message, 'bad'));
});
el('referee-level-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.refereeFilter.level = node.dataset.value;
  el('referee-level-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadReferees().catch((err) => toast(err.message, 'bad'));
});
el('match-search').addEventListener('click', () => {
  state.matchFilter.keyword = el('match-keyword').value.trim();
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('match-status').addEventListener('change', () => {
  state.matchFilter.status = el('match-status').value;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('appoint-search').addEventListener('click', () => {
  state.appointFilter.keyword = el('appoint-keyword').value.trim();
  loadAppointments().catch((err) => toast(err.message, 'bad'));
});
el('appoint-status').addEventListener('change', () => {
  state.appointFilter.status = el('appoint-status').value;
  loadAppointments().catch((err) => toast(err.message, 'bad'));
});
el('appoint-logs').addEventListener('click', () => openLogsDrawer());
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
el('appoint-round-chips').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.appointFilter.round = node.dataset.appointRound;
  loadAppointments().catch((err) => toast(err.message, 'bad'));
});

document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.editTeam) return openDrawerFor('teams', node.dataset.editTeam);
  if (node.dataset.editVenue) return openDrawerFor('venues', node.dataset.editVenue);
  if (node.dataset.editReferee) return openDrawerFor('referees', node.dataset.editReferee);
  if (node.dataset.editMatch) return openDrawerFor('matches', node.dataset.editMatch);
  if (node.dataset.resultMatch) {
    return openResultDrawer(state.matches.find((item) => item.id === node.dataset.resultMatch));
  }
  if (node.dataset.toggleReferee) {
    const id = node.dataset.toggleReferee;
    if (state.expandedReferees.has(id)) state.expandedReferees.delete(id);
    else state.expandedReferees.add(id);
    renderReferees();
    return;
  }
  if (node.dataset.assignMatch) return openAssignDrawer(node.dataset.assignMatch);
  if (node.dataset.reassignMatch) return openReassignDrawer(node.dataset.reassignMatch, node.dataset.reassignSlot);
  if (node.dataset.toggleStatusReferee) {
    const referee = state.referees.find((item) => item.id === node.dataset.toggleStatusReferee);
    if (!referee) return;
    const next = referee.status === '停派' ? '在岗' : '停派';
    const tip = next === '停派'
      ? `确定让 ${referee.name} 停派吗？名下 ${referee.upcomingCount} 场没吹的比赛需要逐场改派。`
      : `确定恢复 ${referee.name} 在岗吗？`;
    if (!window.confirm(tip)) return;
    try {
      const result = await request(`/api/referees/${encodeURIComponent(referee.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next }),
      });
      toast(result.message, 'ok');
      if (next === '停派') state.expandedReferees.add(referee.id);
      await Promise.all([loadReferees(), loadAppointments().catch(() => {}), loadSummary()]);
    } catch (err) {
      toast(err.message, 'bad');
    }
    return;
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
        await Promise.all([loadReferees(), loadSummary()]);
      }
      else { await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadMatches(), loadSummary()]); }
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
