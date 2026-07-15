#!/usr/bin/env node
/**
 * garmin_health_sync_feishu.js
 * 从佳明国内区拉取健康数据 → 写入飞书多维表格
 * 
 * 用法:
 *   node garmin_health_sync_feishu.js               # 同步昨天
 *   node garmin_health_sync_feishu.js 2026-06-13    # 同步指定日期
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── 加载 .env ──────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  });
}

// ── 配置 ────────────────────────────────────────────────────
const CN_USER    = process.env.GARMIN_USERNAME;
const CN_PASS    = process.env.GARMIN_PASSWORD;
const BASE_API   = 'https://connectapi.garmin.cn';

// 飞书配置
const FEISHU_APP_ID     = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const HEALTH_APP_TOKEN  = process.env.FEISHU_HEALTH_APP_TOKEN;
const HEALTH_TABLE_ID   = process.env.FEISHU_HEALTH_TABLE_ID;

if (!CN_USER || !CN_PASS) { console.error('❌ 缺少 GARMIN_USERNAME / GARMIN_PASSWORD'); process.exit(1); }

// ── 工具函数 ────────────────────────────────────────────────
function safeGet(obj, ...keys) {
  return keys.reduce((o, k) => (o != null && o[k] !== undefined ? o[k] : null), obj);
}
function toMin(seconds) { return seconds != null ? Math.round(seconds / 60) : null; }
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateStrDaysAgo(n) { const d = new Date(); d.setDate(d.getDate()-n); return fmtDate(d); }
function dateToMs(dateStr) { return new Date(dateStr).getTime(); }

// 飞书 API
let feishuToken = null;
let feishuTokenExpires = 0;

async function feishuAuth() {
  if (feishuToken && Date.now() < feishuTokenExpires - 60000) return feishuToken;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`飞书认证失败: ${data.msg}`);
  feishuToken = data.tenant_access_token;
  feishuTokenExpires = Date.now() + (data.expire || 7200) * 1000;
  return feishuToken;
}

async function feishuApi(method, path, body) {
  const token = await feishuAuth();
  const res = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`飞书 ${method} ${path} → ${res.status}`);
  return res.json();
}

async function findFeishuRecord(dateStr) {
  const ms = dateToMs(dateStr);
  const base = `/bitable/v1/apps/${HEALTH_APP_TOKEN}/tables/${HEALTH_TABLE_ID}/records`;
  let pageToken = null;
  while (true) {
    let url = `${base}?page_size=200`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const resp = await feishuApi('GET', url);
    const items = resp?.data?.items || [];
    for (const item of items) {
      if (item.fields['日期'] === ms) return item.record_id;
    }
    if (!resp?.data?.has_more) break;
    pageToken = resp.data.page_token;
  }
  return null;
}

async function safeClientGet(client, url, label) {
  try { return await client.get(url); }
  catch (e) { console.warn(`⚠️  ${label}：${e.message}`); return null; }
}

// 补剂/饮食解析（同原版）
function parseDeviations(note) {
  if (!note) return { missedSupplements: [], dietDeviations: [] };
  const SUPP_MAP = [
    { names: ['nac'], key: 'NAC' },
    { names: ['鱼油','omega','proomega'], key: 'Omega-3鱼油' },
    { names: ['q10','coq10','辅酶'], key: 'Q10辅酶' },
    { names: ['奶蓟草','水飞蓟','milk thistle'], key: '奶蓟草' },
    { names: ['姜黄素','curcumin'], key: '姜黄素C3' },
    { names: ['氨糖','move free','movefree'], key: 'Move Free氨糖' },
    { names: ['蛋白粉','iso100','whey'], key: '蛋白粉ISO100' },
    { names: ['复维','swisse','ultivite'], key: 'Swisse复维' },
    { names: ['金樽','海王'], key: '海王金樽' },
  ];
  const DIET_MAP = [
    { names: ['暴食','聚餐','大吃','撑了'], key: '暴食/聚餐' },
    { names: ['高糖','高油','甜食','炸鸡','油炸'], key: '高糖高油' },
    { names: ['外卖'], key: '外卖连续' },
    { names: ['酒','喝酒','啤酒','白酒','红酒','饮酒','威士忌','清酒'], key: '饮酒' },
    { names: ['节食','禁食','断食','没吃饭'], key: '节食/禁食' },
    { names: ['深夜吃','夜宵','宵夜','深夜进食'], key: '深夜进食' },
  ];
  const noteLower = note.toLowerCase();
  const missed = [];
  const missPrefix = ['漏服','没吃','忘记','忘了','未服','未吃'];
  if (missPrefix.some(k => note.includes(k))) {
    for (const s of SUPP_MAP) {
      if (s.names.some(n => noteLower.includes(n))) missed.push(s.key);
    }
  }
  const diet = [];
  for (const d of DIET_MAP) {
    if (d.names.some(n => noteLower.includes(n))) {
      if (!diet.includes(d.key)) diet.push(d.key);
    }
  }
  return { missedSupplements: missed, dietDeviations: diet };
}

// ── 主流程 ──────────────────────────────────────────────────
async function main() {
  const targetDate = process.argv[2] || dateStrDaysAgo(1);
  console.log(`\n⌚ 佳明健康数据同步 → 飞书 · 目标日期：${targetDate}\n`);

  // 登录 Garmin
  const { GarminConnect } = require('@gooin/garmin-connect');
  const garmin = new GarminConnect({ username: CN_USER, password: CN_PASS }, 'garmin.cn');
  try {
    await garmin.login(CN_USER, CN_PASS);
    console.log('✅ 佳明国内区登录成功');
  } catch (e) {
    console.error('❌ 登录失败：', e.message); process.exit(1);
  }

  const profile     = await garmin.getUserProfile();
  const displayName = profile?.displayName || profile?.userName;
  const client      = garmin.client;
  console.log(`   用户：${displayName}\n`);

  const d = {};

  // 1. 每日摘要
  {
    const url  = `${BASE_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${targetDate}`;
    const data = await safeClientGet(client, url, '每日摘要');
    if (data) {
      d.steps      = data.totalSteps ?? null;
      d.restingHR  = data.restingHeartRate ?? null;
      d.avgStress  = data.averageStressLevel ?? null;
      d.bbMax      = data.bodyBatteryHighestValue ?? null;
      d.bbMin      = data.bodyBatteryLowestValue ?? null;
      d.bbCharged  = data.bodyBatteryChargedValue ?? null;
      d.bbDrained  = data.bodyBatteryDrainedValue ?? null;
      d.bbAtWake   = data.bodyBatteryAtWakeTime ?? null;
      d.bbChange   = (d.bbMax != null && d.bbMin != null) ? d.bbMax - d.bbMin : null;
      console.log(`✅ 每日摘要  步数:${d.steps}  静息心率:${d.restingHR}`);
    }
  }

  // 2. 睡眠
  {
    const url  = `${BASE_API}/wellness-service/wellness/dailySleepData/${displayName}?date=${targetDate}&nonSleepBufferMinutes=60`;
    const data = await safeClientGet(client, url, '睡眠');
    if (data) {
      const daily = data?.dailySleepDTO || data || {};
      d.sleepDuration = toMin(daily.sleepTimeSeconds);
      d.deepSleep     = toMin(daily.deepSleepSeconds);
      d.lightSleep    = toMin(daily.lightSleepSeconds);
      d.remSleep      = toMin(daily.remSleepSeconds);
      d.awakeSleep    = toMin(daily.awakeSleepSeconds);
      d.restlessness  = daily.awakeCount ?? null;
      d.sleepScore    = safeGet(daily,'sleepScores','overall','value') ?? null;
      d.avgSpO2       = daily.averageSpO2Value ?? null;
      d.lowestSpO2    = daily.lowestSpO2Value ?? null;
      d.avgBreath     = daily.averageRespirationValue ?? null;
      d.userNote      = (daily.userNote && daily.userNote.trim()) ? daily.userNote.trim() : null;
      const { missedSupplements, dietDeviations } = parseDeviations(d.userNote);
      d.missedSupplements = missedSupplements;
      d.dietDeviations    = dietDeviations;
      if      (d.sleepScore >= 80) d.sleepQuality = '优秀';
      else if (d.sleepScore >= 70) d.sleepQuality = '良好';
      else if (d.sleepScore >= 60) d.sleepQuality = '一般';
      else if (d.sleepScore != null) d.sleepQuality = '较差';
      console.log(`✅ 睡眠  分数:${d.sleepScore}  时长:${d.sleepDuration}m`);
    }
  }

  // 3. HRV
  {
    const url  = `${BASE_API}/hrv-service/hrv/${targetDate}`;
    const data = await safeClientGet(client, url, 'HRV');
    if (data) {
      d.hrv = safeGet(data,'hrvSummary','lastNightAvg') ?? safeGet(data,'avgHrv') ?? null;
      console.log(`✅ HRV   ${d.hrv} ms`);
    }
  }

  // 4. 体成分
  {
    const url  = `${BASE_API}/weight-service/weight/daterangesnapshot?startDate=${targetDate}&endDate=${targetDate}`;
    const data = await safeClientGet(client, url, '体成分');
    if (data) {
      const list = data?.dateWeightList;
      const src  = (list && list.length > 0) ? [...list].sort((a,b)=>(a.samplePk??0)-(b.samplePk??0))[0] : (data?.totalAverage ?? data);
      const src2 = (list && list.length > 1) ? [...list].sort((a,b)=>(a.samplePk??0)-(b.samplePk??0))[1] : null;
      d.weight     = src?.weight     ? src.weight / 1000 : null;
      d.bodyFat    = src?.bodyFat    ?? null;
      // 双秤校准：佳明2点BIA vs 阿里健康4点BIA，佳明系统性高估
      // 6/14 user 精确定量：佳明空腹 −3.2% = 阿里健康等效（73-74kg区间误差≤0.2%）
      // 校准公式：校准体脂率 = 佳明体脂率 − 3.2
      d.bodyFatCalibrated = (src?.bodyFat != null) ? Math.round((src.bodyFat - 3.2) * 10) / 10 : null;
      d.weight2    = src2?.weight    ? src2.weight / 1000 : null;
      d.muscleMass = src?.muscleMass ? src.muscleMass / 1000 : null;
      d.boneMass   = src?.boneMass   ? src.boneMass / 1000 : null;
      d.bmi        = src?.bmi        ?? null;
      d.bodyWater  = src?.bodyWater  ?? null;
      d.visceralFat= src?.visceralFat?? null;
      d.metabolicAge=src?.metabolicAge?? null;
      console.log(`✅ 体重  ${d.weight}kg  体脂:${d.bodyFat}%`);
    }
  }

  // 5. VO2Max
  {
    const url  = `${BASE_API}/userprofile-service/userprofile/personal-information/${displayName}`;
    const data = await safeClientGet(client, url, 'VO2Max');
    if (data) {
      d.vo2Max             = safeGet(data,'biometricProfile','vo2Max') ?? null;
      d.lactateThresholdHR = safeGet(data,'biometricProfile','lactateThresholdHeartRate') ?? null;
      console.log(`✅ VO2Max  ${d.vo2Max}`);
    }
  }

  // 6. 算法生理年龄（fitnessage-service）
  {
    const url = `${BASE_API}/fitnessage-service/fitnessage/${targetDate}`;
    const data = await safeClientGet(client, url, '算法生理年龄');
    if (data) {
      d.fitnessAge         = data.fitnessAge ?? null;
      d.achievableFitnessAge = data.achievableFitnessAge ?? null;
      d.previousFitnessAge = data.previousFitnessAge ?? null;
      d.vigorousDaysAvg    = safeGet(data, 'components', 'vigorousDaysAvg', 'value');
      d.vigorousMinutesAvg = safeGet(data, 'components', 'vigorousMinutesAvg', 'value');
      console.log(`✅ 算法生理年龄  ${d.fitnessAge?.toFixed(1)} 岁 (可达${d.achievableFitnessAge?.toFixed(1)})`);
    }
  }

  // ── 组装飞书字段 ──────────────────────────────────────────
  const ms = dateToMs(targetDate);
  const fields = { '日期': ms, '名称': `${targetDate} 健康数据` };

  const numMap = {
    '睡眠时长_分钟': d.sleepDuration, '深度睡眠_分钟': d.deepSleep,
    '浅度睡眠_分钟': d.lightSleep,   'REM睡眠_分钟':  d.remSleep,
    '清醒时间_分钟': d.awakeSleep,   '睡眠分数':      d.sleepScore,
    '平均SpO₂':     d.avgSpO2,      '最低SpO₂':      d.lowestSpO2,
    '平均呼吸频率': d.avgBreath,     'HRV_ms':        d.hrv,
    '静息心率_bpm': d.restingHR,    '身体电量_最高': d.bbMax,
    '身体电量_最低': d.bbMin,       '身体电量变化':  d.bbChange,
    '身体电量_充电': d.bbCharged,   '身体电量_消耗': d.bbDrained,
    '起床时电量':   d.bbAtWake,     '平均压力':      d.avgStress,
    '不安稳指数':   d.restlessness,  '步数':          d.steps,
    '体重_kg':      d.weight,       '体重_kg_2':     d.weight2,
    '体脂率':       d.bodyFat,      '校准体脂率':     d.bodyFatCalibrated,
    '骨骼肌量_kg':   d.muscleMass,
    '骨量_kg':      d.boneMass,     'BMI':           d.bmi,
    '体水分率':     d.bodyWater,    '内脏脂肪等级':  d.visceralFat,
    '代谢年龄':     d.metabolicAge, '最大摄氧量':    d.vo2Max,
    '乳酸阈值心率_bpm': d.lactateThresholdHR,
    '算法生理年龄':  d.fitnessAge,  '可达生理年龄':   d.achievableFitnessAge,
  };

  // 推定身体年龄（基于 VO₂Max，以 6/13 佳明官方值【VO₂Max=48→35岁】为锚点）
  // 每 ±1 VO₂Max ≈ ∓1 岁；同时受 BMI 影响（BMI>24 加 1 岁，BMI>26 加 2 岁）
  if (d.vo2Max != null) {
    let fa = 35 - (d.vo2Max - 48);
    if (d.bmi != null) {
      if (d.bmi > 26) fa += 2;
      else if (d.bmi > 24) fa += 1;
    }
    fields['身体年龄'] = Math.round(fa);
  }

  for (const [k, v] of Object.entries(numMap)) {
    if (v != null) fields[k] = Number(v);
  }
  if (d.sleepQuality) fields['睡眠质量'] = d.sleepQuality;
  if (d.userNote)     fields['睡眠备注'] = d.userNote;
  if (d.missedSupplements?.length) fields['漏服补剂'] = d.missedSupplements;
  if (d.dietDeviations?.length)    fields['饮食偏差'] = d.dietDeviations;

  // ── 写入飞书 ──────────────────────────────────────────────
  console.log('\n📝 写入飞书...');
  const base = `/bitable/v1/apps/${HEALTH_APP_TOKEN}/tables/${HEALTH_TABLE_ID}`;

  try {
    const existingId = await findFeishuRecord(targetDate);
    if (existingId) {
      const update = {};
      for (const [k, v] of Object.entries(fields)) {
        if (k !== '名称') update[k] = v;
      }
      await feishuApi('PUT', `${base}/records/${existingId}`, { fields: update });
      console.log(`✅ 飞书记录已更新（${targetDate}）`);
    } else {
      await feishuApi('POST', `${base}/records`, { fields });
      console.log(`✅ 飞书新记录已创建（${targetDate}）`);
    }
  } catch (e) {
    console.error('❌ 飞书写入失败：', e.message); process.exit(1);
  }

  console.log('\n🎉 B机 佳明→飞书 同步完成！');
}

main().catch(err => { console.error(err); process.exit(1); });
