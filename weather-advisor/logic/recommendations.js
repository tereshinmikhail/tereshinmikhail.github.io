// ============================================================
// ЛОГИКА РЕКОМЕНДАЦИЙ v3.1
// weather-advisor/logic/recommendations.js
//
// Иерархия инсайтов:
//   1. Температура воды (главный фактор)
//   2. Сценарный инсайт (погодный сценарий × время суток)
//      — заменяет отдельные light/wind/rain инсайты
//   3. Тренд давления (только если нет сценария P5_front)
//   4. Сезонная поправка
//   5. Нерест
//
// v3.1: вся работа со временем — на строках ISO из Open-Meteo
// (время локальное для точки ловли, timezone=auto в запросе).
// Объекты Date для сравнения часов/дат не используются —
// это исключает сдвиги UTC/локального времени браузера.
// ============================================================

// ── Вспомогательные функции работы со временем ──────────────

// 'YYYY-MM-DD' + n дней → 'YYYY-MM-DD' (арифметика в UTC, безопасно)
function dateShift(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Индекс элемента hourly-массива для даты и часа (или -1)
function findHourIndex(hourlyData, dateStr, hour) {
  const target = dateStr + 'T' + String(hour).padStart(2, '0');
  for (let i = 0; i < hourlyData.time.length; i++) {
    if (hourlyData.time[i].startsWith(target)) return i;
  }
  return -1;
}

// ── Температура воды ─────────────────────────────────────────
// Средняя температура воздуха за окно, заканчивающееся
// в полдень ЦЕЛЕВОЙ даты (а не «сейчас»): для рыбалки через
// несколько дней используется уже загруженный прогноз.
function getWaterTemp(hourlyData, waterType, dateStr) {
  const windowHours = (waterType === 'pond' || waterType === 'river_small') ? 72 : 120;
  let end = findHourIndex(hourlyData, dateStr, 12);
  if (end === -1) end = hourlyData.time.length - 1;
  const start = Math.max(0, end - windowHours);
  const temps = hourlyData.temperature_2m.slice(start, end + 1).filter(t => t !== null && t !== undefined);
  if (temps.length === 0) return null;
  return temps.reduce((a, b) => a + b, 0) / temps.length;
}

// ── Тренд давления ───────────────────────────────────────────
// Якорь — середина выбранного периода ловли.
// Массив hourly непрерывен по часам, поэтому −12ч и −48ч —
// это просто сдвиг индекса.
const PERIOD_MID_HOUR = { morning: 7, day: 13, evening: 19, night: 23 };

function getPressureTrend(hourlyData, dateStr, timePeriod) {
  const anchorHour = PERIOD_MID_HOUR[timePeriod] !== undefined ? PERIOD_MID_HOUR[timePeriod] : 12;
  const idx = findHourIndex(hourlyData, dateStr, anchorHour);
  if (idx === -1 || idx - 12 < 0) return 'stable';
  const p = hourlyData.pressure_msl;
  const pNow = p[idx];
  const p12  = p[idx - 12];
  if (pNow === null || pNow === undefined || p12 === null || p12 === undefined) return 'stable';
  const delta12 = pNow - p12;
  let delta48 = null;
  if (idx - 48 >= 0 && p[idx - 48] !== null && p[idx - 48] !== undefined) {
    delta48 = pNow - p[idx - 48];
  }
  const unstable = delta48 !== null && Math.abs(delta48) > 4 && Math.sign(delta12) !== Math.sign(delta48);
  if (unstable) return 'unstable';
  if (delta12 < -3) return 'falling';
  if (delta12 > 3)  return 'rising';
  return 'stable';
}

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

// Определяем погодный сценарий P1–P5
function getWeatherScenario(lightCondition, windCat, rainCat, pressureTrend) {
  // P5: смена погоды — нестабильное давление доминирует над остальным
  if (pressureTrend === 'unstable' || pressureTrend === 'rising') return 'P5_front';
  // P4: осадки
  if (rainCat !== 'none') return 'P4_rain';
  // P3: пасмурно
  if (lightCondition === 'cloudy' || lightCondition === 'overcast') return 'P3_cloudy';
  // P2: ясно + ветер
  if (lightCondition === 'sunny' && (windCat === 'light' || windCat === 'moderate' || windCat === 'strong')) return 'P2_windy_sunny';
  // P1: ясно + штиль
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
// «Ночь» даты X = часы 22–23 даты X + часы 0–4 даты X+1
// (ночь, НАСТУПАЮЩАЯ после выбранного дня, а не прошедшая).
// Остальные периоды — часы внутри выбранной даты.
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
// ИНСАЙТЫ v3
// ─────────────────────────────────────────────────────────────
function buildInsights(species, conditions, spawnStatus, timePeriod, lightCondition, pressureTrend, windCat, rainCat, waterType, month) {
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
  const scenario = getWeatherScenario(lightCondition, windCat, rainCat, pressureTrend);
  const scenarioData = SCENARIO_INSIGHTS[species] && SCENARIO_INSIGHTS[species][scenario];
  if (scenarioData) {
    const timeKey = (timePeriod === 'morning') ? 'morning'
                  : (timePeriod === 'evening') ? 'evening'
                  : (timePeriod === 'night')   ? 'evening'  // ночь → используем вечер как ближайший
                  : 'day';
    const text = scenarioData[timeKey] || scenarioData['default'];
    if (text) insights.push(text);
  }

  // ── 3. ТРЕНД ДАВЛЕНИЯ (только falling — активизация) ─────
  // P5 (rising/unstable) уже покрыт сценарием, falling — нет
  if (pressureTrend === 'falling' && notes.pressure_falling)
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

function scoreToRating(score) {
  if (score >= 3)  return 'good';
  if (score >= 1)  return 'neutral';
  if (score >= -1) return 'hard';
  return 'bad';
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
  const pressureTrend  = getPressureTrend(hourlyData, dateStr, timePeriod);
  const windCat        = getWindCategory(weather.windspeed);
  const lightCondition = getLightCondition(weather.cloudcover);
  const rainCat        = getRainCategory(weather.precipitation, weather.precipHours);
  const month          = parseInt(dateStr.slice(5, 7), 10);
  const spawnStatus    = checkSpawnPeriod(species, waterTemp, month);
  const season         = getSeason(month);

  // ── Скоринг ──────────────────────────────────────────────
  let score = 0;
  if (waterTemp !== null) {
    const [tMin, tMax] = sp.tempRange;
    const [tIdMin, tIdMax] = sp.tempIdeal;
    if (waterTemp >= tIdMin && waterTemp <= tIdMax) score += 2;
    else if (waterTemp >= tMin && waterTemp <= tMax) score += 1;
    else score -= 2;
    if (waterTemp > tMax + 3) score -= 1;
  }
  if (spawnStatus === 'spawning') score -= 3;
  if (spawnStatus === 'pre-spawn' || spawnStatus === 'post-spawn') score += 1;

  const timeScore = sp.timeScore[timePeriod] || 0;
  score += Math.max(-1, Math.min(1, timeScore));
  score += sp.lightBonus[lightCondition] || 0;
  score += sp.pressureTrend[pressureTrend] || 0;
  score += sp.windScore[windCat] || 0;
  score += sp.rainScore[rainCat] || 0;

  const rating = scoreToRating(score);
  const rec    = buildRecommendation(species, method, lightCondition, rainCat, windCat);

  // Тактическая поправка по водоёму
  const waterTacticNote = WATER_TACTIC_NOTES[species] && WATER_TACTIC_NOTES[species][waterType]
    ? WATER_TACTIC_NOTES[species][waterType] : null;

  const insights = buildInsights(
    species, { waterTemp }, spawnStatus,
    timePeriod, lightCondition, pressureTrend, windCat, rainCat,
    waterType, month
  );

  return {
    rating,
    ratingConfig: RATING_CONFIG[rating],
    score,
    spawnStatus,
    spawnWarning: spawnStatus === 'spawning' ? SPAWN_WARNINGS[species] : null,
    weather: {
      temp: weather.temp, cloudcover: weather.cloudcover,
      windspeed: weather.windspeed, winddir: weather.winddir,
      winddirLabel: getWindDirection(weather.winddir),
      precipitation: weather.precipitation, pressure: weather.pressure,
      pressureTrend, lightCondition, windCat, rainCat,
    },
    waterTemp,
    waterLocation: sp.waterType[waterType],
    waterTacticNote,
    recommendation: rec,
    insights,
  };
}
