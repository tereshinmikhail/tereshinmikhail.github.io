// ============================================================
// ЛОГИКА РЕКОМЕНДАЦИЙ
// weather-advisor/logic/recommendations.js
// ============================================================

function getWaterTemp(hourlyData, waterType) {
  const hours = (waterType === 'pond') ? 72 : 120;
  const now = new Date();
  const temps = [];
  for (let i = 0; i < hourlyData.time.length; i++) {
    const t = new Date(hourlyData.time[i]);
    if (t <= now && t >= new Date(now - hours * 3600 * 1000)) temps.push(hourlyData.temperature_2m[i]);
  }
  if (temps.length === 0) return null;
  return temps.reduce((a, b) => a + b, 0) / temps.length;
}

function getPressureTrend(hourlyData, targetTime) {
  const target = new Date(targetTime);
  const prev12 = new Date(target - 12 * 3600 * 1000);
  const prev48 = new Date(target - 48 * 3600 * 1000);
  const getPressureAt = (dt) => {
    let closest = null, minDiff = Infinity;
    for (let i = 0; i < hourlyData.time.length; i++) {
      const diff = Math.abs(new Date(hourlyData.time[i]) - dt);
      if (diff < minDiff) { minDiff = diff; closest = hourlyData.pressure_msl[i]; }
    }
    return closest;
  };
  const pNow = getPressureAt(target);
  const p12  = getPressureAt(prev12);
  const p48  = getPressureAt(prev48);
  if (pNow === null || p12 === null) return 'stable';
  const delta12 = pNow - p12;
  const delta48 = p48 !== null ? pNow - p48 : 0;
  const unstable = p48 !== null && Math.abs(delta48) > 4 && Math.sign(delta12) !== Math.sign(delta48);
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

function getWeatherDataForTime(hourlyData, targetTime, timePeriod) {
  const periodHours = { morning: [5, 10], day: [10, 17], evening: [17, 22], night: [22, 29] };
  const [hStart, hEnd] = periodHours[timePeriod];
  const dateStr = new Date(targetTime).toISOString().slice(0, 10);
  const slices = [];
  for (let i = 0; i < hourlyData.time.length; i++) {
    const t = new Date(hourlyData.time[i]);
    const tHour = t.getHours();
    const inPeriod = timePeriod === 'night' ? (tHour >= 22 || tHour < 5) : (tHour >= hStart && tHour < hEnd);
    if (t.toISOString().slice(0, 10) === dateStr && inPeriod) slices.push(i);
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

function buildInsights(species, conditions, spawnStatus, timeScore, lightCondition, pressureTrend, windCat, rainCat) {
  const sp = SPECIES_DATA[species];
  const insights = [];
  const wt = conditions.waterTemp;

  if (wt !== null) {
    const [tMin, tMax] = sp.tempRange;
    const [tIdMin, tIdMax] = sp.tempIdeal;
    if (wt >= tIdMin && wt <= tIdMax)
      insights.push(`Расчётная температура воды около ${wt.toFixed(1)}°C — в оптимальном диапазоне для ${sp.name.toLowerCase()}ы. Базовые условия благоприятные.`);
    else if (wt < tMin)
      insights.push(`Вода холоднее комфортного диапазона для ${sp.name.toLowerCase()}ы (${wt.toFixed(1)}°C). Замедляйте подачу приманки — рыба малоподвижна.`);
    else if (wt > tMax && wt <= tMax + 3)
      insights.push(`Вода теплее оптимума для ${sp.name.toLowerCase()}ы (${wt.toFixed(1)}°C). Ищите рыбу в прохладных местах, у родниковых выходов и на зорях.`);
    else if (wt > tMax + 3)
      insights.push(`Жара: расчётная температура воды ${wt.toFixed(1)}°C. Большинство хищников угнетены. Ловите только на рассвете и закате.`);
  }

  if (species === 'zander') {
    if (lightCondition === 'sunny' && timeScore < 0)
      insights.push('Судак избегает яркого дневного света (особенность зрения с тапетумом). Ловите в сумерках, ночью или у дна на большой глубине.');
    else if (timeScore >= 2)
      insights.push('Для судака сейчас лучшее время — сумерки и ночь, когда тапетум даёт ему преимущество перед жертвой.');
  } else if (species === 'catfish') {
    if (timeScore < 0)
      insights.push('Сом — ночной хищник. Пик активности 22:00–03:00. Дневная ловля результативна только в пасмурь или при дожде.');
  } else if (lightCondition === 'overcast' || lightCondition === 'cloudy') {
    insights.push('Пасмурное небо снижает освещённость — хищник охотится активнее и не только на зорях.');
  } else if (lightCondition === 'sunny' && timeScore <= 0) {
    insights.push('Яркое дневное освещение снижает активность засадных хищников. Ловите у укрытий и в тени.');
  }

  if (pressureTrend === 'falling')
    insights.push('Давление снижается — вероятно приближение атмосферного фронта. Как правило, активность хищника перед сменой погоды кратковременно возрастает.');
  else if (pressureTrend === 'rising')
    insights.push('Давление быстро растёт — прошёл фронт, устанавливается антициклон. Как правило, клёв ухудшается на 1–2 дня.');
  else if (pressureTrend === 'unstable')
    insights.push('Давление неустойчиво последние 48 часов. Окунь особенно чувствителен к скачкам — возможна сниженная активность ещё 2–3 дня.');

  if ((windCat === 'light' || windCat === 'moderate') && ['pike','perch','asp'].includes(species))
    insights.push('Лёгкий ветер создаёт рябь, маскирующую хищника. Прибойный берег собирает малька — ловите там.');
  else if (windCat === 'strong') {
    if (['asp','chub'].includes(species))
      insights.push('Сильный ветер загоняет жереха и голавля на глубину. Ищите рыбу в тихих местах или переключитесь на другой вид.');
    else
      insights.push('Сильный ветер: прибойный берег перспективен, но ловля некомфортна. Ищите прикрытые позиции.');
  }

  if (rainCat === 'drizzle' && ['pike','catfish'].includes(species))
    insights.push('Мелкий дождь и морось — благоприятная погода для щуки и сома. Пасмурность продлевает активность на весь день.');
  else if (rainCat === 'heavy')
    insights.push('Сильный дождь мутит воду и угнетает клёв. Жерех и голавль практически не берут.');
  else if (rainCat === 'prolonged')
    insights.push('Затяжные осадки подняли уровень воды и замутили её. Виды, ориентирующиеся на зрение (жерех, голавль, судак), клюют хуже.');

  if (spawnStatus === 'pre-spawn')
    insights.push(`Преднерестовый жор ${sp.name.toLowerCase()}ы — один из лучших периодов в году. Используйте это время.`);
  else if (spawnStatus === 'post-spawn')
    insights.push(`Посленерестовый жор ${sp.name.toLowerCase()}ы — рыба активно восстанавливает силы. Отличное время для ловли.`);

  return insights;
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
  const m = { spinning: 'spinning', float: 'float', bottom: 'bottom' }[method] || 'spinning';
  return sp[m][condition] || sp[m]['cloudy'];
}

function analyze(params, hourlyData) {
  const { species, method, waterType, timePeriod, targetDate } = params;
  const sp = SPECIES_DATA[species];
  if (!sp) return null;

  const weather = getWeatherDataForTime(hourlyData, targetDate, timePeriod);
  if (!weather) return null;

  const waterTemp      = getWaterTemp(hourlyData, waterType);
  const pressureTrend  = getPressureTrend(hourlyData, targetDate);
  const windCat        = getWindCategory(weather.windspeed);
  const lightCondition = getLightCondition(weather.cloudcover);
  const rainCat        = getRainCategory(weather.precipitation, weather.precipHours);
  const month          = new Date(targetDate).getMonth() + 1;
  const spawnStatus    = checkSpawnPeriod(species, waterTemp, month);

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

  const rating   = scoreToRating(score);
  const rec      = buildRecommendation(species, method, lightCondition, rainCat, windCat);
  const insights = buildInsights(species, { waterTemp }, spawnStatus, timeScore, lightCondition, pressureTrend, windCat, rainCat);

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
    recommendation: rec,
    insights,
  };
}