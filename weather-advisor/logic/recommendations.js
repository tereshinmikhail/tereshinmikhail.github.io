// ============================================================
// ЛОГИКА РЕКОМЕНДАЦИЙ v4
// weather-advisor/logic/recommendations.js
//
// v4 — контекстный скоринг:
//   • свет гасится ночью (×0), ветер масштабируется типом водоёма
//   • холодный дождь (<12°C) — без бонусов + общий штраф
//   • муть: затяжной дождь на малой реке — штраф визуальным хищникам
//   • новый фактор: динамика температуры за 48ч vs предыдущие 48ч
//   • давление учитывается ТОЛЬКО как опережающий сигнал
//     (если погода уже отражает фронт — вклад 0, без двойного счёта)
//   • температура воды, ветер, облачность — кусочно-линейные
//     функции вместо полос (нет эффекта обрыва на границах)
//   • зажим timeScore убран — таблицы ±2 действуют как есть
//   • пороги рейтинга видоспецифичны (SCORING_CONFIG, калибровка
//     по симуляции, см. комментарий там)
//   • в результат добавлена разбивка score по факторам (breakdown)
//
// Константы вынесены в data/scoring-config.js (SCORING_CONFIG).
// ============================================================

// ── Вспомогательные функции работы со временем ──────────────

function dateShift(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function findHourIndex(hourlyData, dateStr, hour) {
  const target = dateStr + 'T' + String(hour).padStart(2, '0');
  for (let i = 0; i < hourlyData.time.length; i++) {
    if (hourlyData.time[i].startsWith(target)) return i;
  }
  return -1;
}

// ── Температура воды ─────────────────────────────────────────
function getWaterTemp(hourlyData, waterType, dateStr) {
  const windowHours = (waterType === 'pond' || waterType === 'river_small') ? 72 : 120;
  let end = findHourIndex(hourlyData, dateStr, 12);
  if (end === -1) end = hourlyData.time.length - 1;
  const start = Math.max(0, end - windowHours);
  const temps = hourlyData.temperature_2m.slice(start, end + 1).filter(t => t !== null && t !== undefined);
  if (temps.length === 0) return null;
  return temps.reduce((a, b) => a + b, 0) / temps.length;
}

// ── Динамика температуры ─────────────────────────────────────
// Δ = среднее за 48ч до целевого полудня − среднее за −96…−48ч.
// Резкое похолодание — один из немногих эффектов с прямым
// научным подтверждением подавления активности.
function getTempDynamics(hourlyData, dateStr) {
  let end = findHourIndex(hourlyData, dateStr, 12);
  if (end === -1) end = hourlyData.time.length - 1;
  const seg = (from, to) => {
    const a = hourlyData.temperature_2m.slice(Math.max(0, from), Math.max(0, to)).filter(t => t !== null && t !== undefined);
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  };
  const recent = seg(end - 48, end);
  const prior  = seg(end - 96, end - 48);
  if (recent === null || prior === null) return null;
  return recent - prior;
}

// ── Тренд давления ───────────────────────────────────────────
const PERIOD_MID_HOUR = { morning: 7, day: 13, evening: 19, night: 23 };

// Возвращает объект {trend, delta12, delta48}
function getPressureTrend(hourlyData, dateStr, timePeriod) {
  const anchorHour = PERIOD_MID_HOUR[timePeriod] !== undefined ? PERIOD_MID_HOUR[timePeriod] : 12;
  const idx = findHourIndex(hourlyData, dateStr, anchorHour);
  const none = { trend: 'stable', delta12: 0, delta48: null };
  if (idx === -1 || idx - 12 < 0) return none;
  const p = hourlyData.pressure_msl;
  const pNow = p[idx];
  const p12  = p[idx - 12];
  if (pNow === null || pNow === undefined || p12 === null || p12 === undefined) return none;
  const delta12 = pNow - p12;
  let delta48 = null;
  if (idx - 48 >= 0 && p[idx - 48] !== null && p[idx - 48] !== undefined) {
    delta48 = pNow - p[idx - 48];
  }
  const unstable = delta48 !== null && Math.abs(delta48) > 4 && Math.sign(delta12) !== Math.sign(delta48);
  let trend = 'stable';
  if (unstable) trend = 'unstable';
  else if (delta12 < -3) trend = 'falling';
  else if (delta12 > 3)  trend = 'rising';
  return { trend, delta12, delta48 };
}

// ── Категории (для текстов и сценариев) ──────────────────────
function getWindCategory(speed) {
  if (speed < 1)  return 'calm';
  if (speed <= 3) return 'light';
  if (speed <= 5) return 'moderate';
  return 'strong';
}

function getLightCondition(cloudcover) {
  if (cloudcover < 30)  return 'sunny';
  if (cloudcover < 70)  return 'cloudy';
  return 'overcast';
}

function getRainCategory(precipitation, precipHours) {
  if (precipitation < 0.1) return 'none';
  if (precipitation < 1)   return 'drizzle';
  if (precipHours > 6)     return 'prolonged';
  if (precipitation > 5)   return 'heavy';
  return 'rain';
}

function getSeason(month) {
  if (month >= 3 && month <= 5)  return 'spring';
  if (month >= 6 && month <= 8)  return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return null; // декабрь–февраль — зима, не ловим
}

// Погодный сценарий P1–P5 (для инсайтов).
// v4: P5 — это нестабильность ЛИБО резкий послефронтовой рост
// (Δ12 > порога). Ровный рост в антициклоне фронтом не считается.
function getWeatherScenario(lightCondition, windCat, rainCat, trendObj) {
  const sharpRise = trendObj.trend === 'rising' && trendObj.delta12 > SCORING_CONFIG.pressureSharpRise;
  if (trendObj.trend === 'unstable' || sharpRise) return 'P5_front';
  if (rainCat !== 'none') return 'P4_rain';
  if (lightCondition === 'cloudy' || lightCondition === 'overcast') return 'P3_cloudy';
  if (lightCondition === 'sunny' && (windCat === 'light' || windCat === 'moderate' || windCat === 'strong')) return 'P2_windy_sunny';
  return 'P1_calm_sunny';
}

function checkSpawnPeriod(species, waterTemp, month) {
  const sp = SPECIES_DATA[species];
  if (!sp || waterTemp === null) return null;
  const [tMin, tMax] = sp.spawnTemp;
  const [mMin, mMax] = sp.spawnMonths;
  const inTempRange  = waterTemp >= tMin - 1 && waterTemp <= tMax + 2;
  const inMonthRange = month >= mMin && month <= mMax;
  if (inTempRange && inMonthRange) return 'spawning';
  if (waterTemp >= tMin - 4 && waterTemp < tMin && inMonthRange) return 'pre-spawn';
  if (waterTemp > tMax && waterTemp <= tMax + 4 && month <= mMax + 1) return 'post-spawn';
  return null;
}

// ── Погода за выбранный период ───────────────────────────────
function getWeatherDataForTime(hourlyData, dateStr, timePeriod) {
  const periodHours = { morning: [5, 10], day: [10, 17], evening: [17, 22] };
  const slices = [];
  const collect = (ds, hStart, hEnd) => {
    for (let h = hStart; h < hEnd; h++) {
      const idx = findHourIndex(hourlyData, ds, h);
      if (idx !== -1) slices.push(idx);
    }
  };
  if (timePeriod === 'night') {
    collect(dateStr, 22, 24);
    collect(dateShift(dateStr, 1), 0, 5);
  } else {
    const range = periodHours[timePeriod];
    if (!range) return null;
    collect(dateStr, range[0], range[1]);
  }
  if (slices.length === 0) return null;
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const totalPrecip = slices.map(i => hourlyData.precipitation[i]).reduce((a, b) => a + b, 0);
  const precipHours = slices.map(i => hourlyData.precipitation[i]).filter(p => p > 0.1).length;
  return {
    temp:          avg(slices.map(i => hourlyData.temperature_2m[i])),
    cloudcover:    avg(slices.map(i => hourlyData.cloudcover[i])),
    windspeed:     avg(slices.map(i => hourlyData.windspeed_10m[i])),
    winddir:       avg(slices.map(i => hourlyData.winddirection_10m[i])),
    pressure:      avg(slices.map(i => hourlyData.pressure_msl[i])),
    precipitation: totalPrecip,
    precipHours,
  };
}

function getWindDirection(deg) {
  const dirs = ['С','СВ','В','ЮВ','Ю','ЮЗ','З','СЗ'];
  return dirs[Math.round(deg / 45) % 8];
}

// ─────────────────────────────────────────────────────────────
// СКОРИНГ v4 — кусочно-линейные функции и контекст
// ─────────────────────────────────────────────────────────────

// Температура воды: гладкая кривая.
// +2 в идеале → 0 на краях диапазона → −2 за 3° от края → −3 при +6° перегрева
function tempScoreSmooth(wt, sp) {
  const [tMin, tMax] = sp.tempRange;
  const [iMin, iMax] = sp.tempIdeal;
  if (wt >= iMin && wt <= iMax) return 2;
  if (wt < iMin) {
    if (wt >= tMin) return 2 * (wt - tMin) / (iMin - tMin);
    return Math.max(-2, 2 * (wt - tMin) / 3);
  }
  // wt > iMax
  if (wt <= tMax) return 2 * (tMax - wt) / (tMax - iMax);
  if (wt <= tMax + 3) return -2 * (wt - tMax) / 3;
  return Math.max(-3, -2 - (wt - tMax - 3) / 3);
}

// Линейная интерполяция табличного значения по узлам [x, категория]
function interpTable(x, nodes, table) {
  if (x <= nodes[0][0]) return table[nodes[0][1]] || 0;
  for (let i = 1; i < nodes.length; i++) {
    if (x <= nodes[i][0]) {
      const [x0, k0] = nodes[i - 1], [x1, k1] = nodes[i];
      const v0 = table[k0] || 0, v1 = table[k1] || 0;
      return v0 + (v1 - v0) * (x - x0) / (x1 - x0);
    }
  }
  return table[nodes[nodes.length - 1][1]] || 0;
}

// Ядро скоринга. ctx:
// { waterTemp, tempDelta, month, timePeriod, cloudcover, windspeed,
//   rainCat, trend: {trend, delta12}, waterType, airTemp }
// Возвращает { score, breakdown[], spawnStatus }
function computeScore(species, ctx) {
  const sp  = SPECIES_DATA[species];
  const cfg = SCORING_CONFIG;
  const breakdown = [];
  const add = (label, value) => {
    if (Math.abs(value) >= 0.05) breakdown.push({ label, value: Math.round(value * 10) / 10 });
    return value;
  };
  let score = 0;

  // 1. Температура воды
  if (ctx.waterTemp !== null) {
    score += add('Температура воды', tempScoreSmooth(ctx.waterTemp, sp));
  }

  // 2. Динамика температуры
  if (ctx.tempDelta !== null && ctx.tempDelta !== undefined) {
    const d = ctx.tempDelta, td = cfg.tempDynamics;
    let v = 0;
    if (d <= td.sharpCool) v = td.sharpCoolPenalty;
    else if (d <= td.mildCool) v = td.mildCoolPenalty;
    else if (d >= td.warmGain && ctx.waterTemp !== null && ctx.waterTemp < sp.tempIdeal[0]) v = td.warmBonus;
    if (ctx.waterTemp !== null && ctx.waterTemp >= sp.tempRange[1] && d >= td.overheatDelta) v += td.overheatPenalty;
    score += add('Динамика температуры', v);
  }

  // 3. Нерест
  const spawnStatus = checkSpawnPeriod(species, ctx.waterTemp, ctx.month);
  if (spawnStatus === 'spawning') score += add('Нерест', -3);
  else if (spawnStatus === 'pre-spawn') score += add('Преднерестовый жор', 1);
  else if (spawnStatus === 'post-spawn') score += add('Посленерестовый жор', 1);

  // 4. Время суток (без зажима — таблицы ±2 действуют как есть)
  score += add('Время суток', sp.timeScore[ctx.timePeriod] || 0);

  // 5. Свет: интерполяция по облачности, ночью гасится
  if (ctx.timePeriod !== 'night') {
    score += add('Освещённость', interpTable(ctx.cloudcover, cfg.cloudNodes, sp.lightBonus));
  }

  // 6. Давление — только опережающий сигнал.
  // Если фронт уже в погоде (осадки, либо пасмурно + сильный ветер) —
  // он учтён погодными факторами, вклад давления 0.
  const frontAlreadyHere = ctx.rainCat !== 'none' || (ctx.cloudcover >= 70 && ctx.windspeed > 5);
  if (!frontAlreadyHere) {
    score += add('Тренд давления', sp.pressureTrend[ctx.trend.trend] || 0);
  }

  // 7. Ветер: интерполяция по скорости × коэффициент водоёма
  const windCoef = cfg.windWaterCoef[ctx.waterType] !== undefined ? cfg.windWaterCoef[ctx.waterType] : 1;
  score += add('Ветер', interpTable(ctx.windspeed, cfg.windNodes, sp.windScore) * windCoef);

  // 8. Дождь: холодный дождь — без бонусов + общий штраф
  let rainVal = sp.rainScore[ctx.rainCat] || 0;
  if (ctx.rainCat !== 'none' && ctx.airTemp !== null && ctx.airTemp < cfg.coldRain.airTempBelow) {
    rainVal = Math.min(rainVal, 0) + cfg.coldRain.penalty;
    score += add('Холодный дождь', rainVal);
  } else {
    score += add('Осадки', rainVal);
  }

  // 9. Муть: затяжной/сильный дождь на малой реке — визуальные хищники
  if (cfg.turbidity.waterTypes.includes(ctx.waterType)
      && cfg.turbidity.rainCats.includes(ctx.rainCat)
      && cfg.turbidity.species.includes(species)) {
    score += add('Замутнение воды', cfg.turbidity.penalty);
  }

  return { score, breakdown, spawnStatus };
}

// Видоспецифичные пороги (калибровка по симуляции)
function scoreToRating(score, species) {
  const th = (SCORING_CONFIG.ratingThresholds[species]) || SCORING_CONFIG.ratingThresholds.default;
  if (score >= th.good)    return 'good';
  if (score >= th.neutral) return 'neutral';
  if (score >= th.hard)    return 'hard';
  return 'bad';
}

// ─────────────────────────────────────────────────────────────
// ИНСАЙТЫ
// ─────────────────────────────────────────────────────────────
function buildInsights(species, conditions, spawnStatus, timePeriod, lightCondition, trendObj, windCat, rainCat, waterType, month) {
  const notes  = BEHAVIOR_NOTES[species];
  const sp     = SPECIES_DATA[species];
  if (!notes || !sp) return [];

  const insights = [];
  const wt = conditions.waterTemp;

  // ── 1. ТЕМПЕРАТУРА ВОДЫ ───────────────────────────────────
  if (wt !== null) {
    const [tMin, tMax] = sp.tempRange;
    const [tIdMin, tIdMax] = sp.tempIdeal;
    if (wt > tMax + 3 && notes.temp_hot)
      insights.push(notes.temp_hot);
    else if (wt > tMax && notes.temp_warm)
      insights.push(notes.temp_warm);
    else if (wt >= tIdMin && wt <= tIdMax && notes.temp_optimal)
      insights.push(notes.temp_optimal);
    else if (wt < tMin && notes.temp_cold)
      insights.push(notes.temp_cold);
  }

  // ── 2. СЦЕНАРНЫЙ ИНСАЙТ (погода × время суток) ──────────
  const scenario = getWeatherScenario(lightCondition, windCat, rainCat, trendObj);
  const scenarioData = SCENARIO_INSIGHTS[species] && SCENARIO_INSIGHTS[species][scenario];
  if (scenarioData) {
    const timeKey = (timePeriod === 'morning') ? 'morning'
                  : (timePeriod === 'evening') ? 'evening'
                  : (timePeriod === 'night')   ? 'evening'
                  : 'day';
    const text = scenarioData[timeKey] || scenarioData['default'];
    if (text) insights.push(text);
  }

  // ── 3. ТРЕНД ДАВЛЕНИЯ (только falling — активизация) ─────
  if (trendObj.trend === 'falling' && notes.pressure_falling)
    insights.push(notes.pressure_falling);

  // ── 4. СЕЗОННАЯ ПОПРАВКА ─────────────────────────────────
  const season = getSeason(month);
  if (season && SEASON_NOTES[species] && SEASON_NOTES[species][season])
    insights.push(SEASON_NOTES[species][season]);

  // ── 5. НЕРЕСТ ────────────────────────────────────────────
  if (spawnStatus === 'pre-spawn' && notes.spawn_pre)
    insights.push(notes.spawn_pre);
  else if (spawnStatus === 'post-spawn' && notes.spawn_post)
    insights.push(notes.spawn_post);

  return insights.slice(0, 5);
}

function buildRecommendation(species, method, lightCondition, rainCat, windCat) {
  const sp = SPECIES_DATA[species];
  if (!sp) return null;
  let condition = lightCondition === 'sunny' ? 'sunny' : 'cloudy';
  if (['rain','heavy','prolonged'].includes(rainCat)) condition = 'rain';
  if (windCat === 'strong') condition = 'wind';
  const m = (method === 'bottom') ? 'bottom' : 'spinning';
  return sp[m][condition] || sp[m]['cloudy'];
}

// analyze(params, hourlyData)
// params.targetDate — строка 'YYYY-MM-DD' (дата ловли)
function analyze(params, hourlyData) {
  const { species, method, waterType, timePeriod, targetDate } = params;
  const sp = SPECIES_DATA[species];
  if (!sp) return null;

  const dateStr = targetDate.slice(0, 10);

  const weather = getWeatherDataForTime(hourlyData, dateStr, timePeriod);
  if (!weather) return null;

  const waterTemp      = getWaterTemp(hourlyData, waterType, dateStr);
  const tempDelta      = getTempDynamics(hourlyData, dateStr);
  const trendObj       = getPressureTrend(hourlyData, dateStr, timePeriod);
  const windCat        = getWindCategory(weather.windspeed);
  const lightCondition = getLightCondition(weather.cloudcover);
  const rainCat        = getRainCategory(weather.precipitation, weather.precipHours);
  const month          = parseInt(dateStr.slice(5, 7), 10);

  const { score, breakdown, spawnStatus } = computeScore(species, {
    waterTemp, tempDelta, month, timePeriod,
    cloudcover: weather.cloudcover, windspeed: weather.windspeed,
    rainCat, trend: trendObj, waterType, airTemp: weather.temp,
  });

  const rating = scoreToRating(score, species);
  const rec    = buildRecommendation(species, method, lightCondition, rainCat, windCat);

  const waterTacticNote = WATER_TACTIC_NOTES[species] && WATER_TACTIC_NOTES[species][waterType]
    ? WATER_TACTIC_NOTES[species][waterType] : null;

  const insights = buildInsights(
    species, { waterTemp }, spawnStatus,
    timePeriod, lightCondition, trendObj, windCat, rainCat,
    waterType, month
  );

  return {
    rating,
    ratingConfig: RATING_CONFIG[rating],
    score: Math.round(score * 10) / 10,
    breakdown,
    tempDelta: tempDelta !== null ? Math.round(tempDelta * 10) / 10 : null,
    spawnStatus,
    spawnWarning: spawnStatus === 'spawning' ? SPAWN_WARNINGS[species] : null,
    weather: {
      temp: weather.temp, cloudcover: weather.cloudcover,
      windspeed: weather.windspeed, winddir: weather.winddir,
      winddirLabel: getWindDirection(weather.winddir),
      precipitation: weather.precipitation, pressure: weather.pressure,
      pressureTrend: trendObj.trend, lightCondition, windCat, rainCat,
    },
    waterTemp,
    waterLocation: sp.waterType[waterType],
    waterTacticNote,
    recommendation: rec,
    insights,
  };
}
