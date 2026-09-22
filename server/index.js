const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();
const PORT = process.env.PORT || 5143;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/api/summary', (_req, res) => {
  res.json(api.summary());
});

app.get('/api/teams', (req, res) => {
  res.json(api.listTeams({
    keyword: api.readQuery(req.query, 'keyword'),
    status: api.readQuery(req.query, 'status'),
  }));
});

app.post('/api/teams', (req, res) => {
  try {
    res.status(201).json(api.createTeam(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/teams/:id', (req, res) => {
  try {
    res.json(api.updateTeam(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/teams/:id', (req, res) => {
  try {
    res.json(api.deleteTeam(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/venues', (req, res) => {
  res.json(api.listVenues({ keyword: api.readQuery(req.query, 'keyword') }));
});

app.post('/api/venues', (req, res) => {
  try {
    res.status(201).json(api.createVenue(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/venues/:id', (req, res) => {
  try {
    res.json(api.updateVenue(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/venues/:id', (req, res) => {
  try {
    res.json(api.deleteVenue(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/matches', (req, res) => {
  res.json(api.listMatches({
    round: api.readQuery(req.query, 'round'),
    status: api.readQuery(req.query, 'status'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

app.post('/api/matches', (req, res) => {
  try {
    res.status(201).json(api.createMatch(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/matches/:id', (req, res) => {
  try {
    res.json(api.updateMatch(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 登记比分：登记完这场自动标成已赛，积分表随之变化
app.post('/api/matches/:id/result', (req, res) => {
  try {
    res.json(api.recordResult(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/matches/:id', (req, res) => {
  try {
    res.json(api.deleteMatch(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/standings', (req, res) => {
  res.json(api.computeTable({ keyword: api.readQuery(req.query, 'keyword') }));
});

// 裁判名单：登记、修改、停派复岗与删除；清单里带每人已派场次与数量
app.get('/api/referees', (req, res) => {
  res.json(api.listReferees({
    keyword: api.readQuery(req.query, 'keyword'),
    status: api.readQuery(req.query, 'status'),
    level: api.readQuery(req.query, 'level'),
  }));
});

app.post('/api/referees', (req, res) => {
  try {
    res.status(201).json(api.createReferee(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/referees/:id', (req, res) => {
  try {
    res.json(api.updateReferee(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 停派/复岗：停派时把名下未吹的场次一并带回，页面逐场改派
app.post('/api/referees/:id/status', (req, res) => {
  try {
    res.json(api.setRefereeStatus(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/referees/:id', (req, res) => {
  try {
    res.json(api.deleteReferee(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 派场：逐场列出主裁与两名助理，未配齐与已开赛缺口单列提醒
app.get('/api/appointments', (req, res) => {
  res.json(api.listAppointments({
    round: api.readQuery(req.query, 'round'),
    status: api.readQuery(req.query, 'status'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

// 配齐抽屉里的候选人：逐槽位标出能否选择、同日撞场、季上限与相邻天提示
app.get('/api/appointments/:id/options', (req, res) => {
  try {
    res.json(api.matchOptions(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 一次性配齐一场的三名裁判
app.post('/api/appointments/:id', (req, res) => {
  try {
    res.json(api.assignMatch(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

// 单槽改派：写清换成谁与原因，原场次与新场次都留痕
app.post('/api/appointments/:id/reassign', (req, res) => {
  try {
    res.json(api.reassignSlot(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

// 配齐与改派的留痕
app.get('/api/logs', (req, res) => {
  res.json(api.listLogs({
    matchId: api.readQuery(req.query, 'matchId'),
    refereeId: api.readQuery(req.query, 'refereeId'),
  }));
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp143] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '提交的内容不是合法的 JSON', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`联赛赛程与积分核算台已启动：http://localhost:${PORT}`);
});
