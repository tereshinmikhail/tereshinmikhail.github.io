// ============================================================
// WEATHER ADVISOR — app.js
// UI, запросы к API, оркестрация
// ============================================================

const state = {
  lat: null, lon: null,
  date: null, dateIndex: 0,
  time: null, species: null, watertype: null, method: null,
  hourlyData: null, loading: false,
};

const cityInput     = document.getElementById('city-input');
const cityDropdown  = document.getElementById('city-dropdown');
const coordsInput   = document.getElementById('coords-input');
const coordsError   = document.getElementById('coords-error');
const dateChips     = document.getElementById('date-chips');
const accuracyWarn  = document.getElementById('accuracy-warning');
const submitBtn     = document.getElementById('submit-btn');
const submitLabel   = document.getElementById('submit-label');
const submitLoader  = document.getElementById('submit-loader');
const apiError      = document.getElementById('api-error');
const resultSection = document.getElementById('result-section');

function initDateChips() {
  const today = new Date();
  const days   = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.group = 'date';
    btn.dataset.value = i;
    btn.dataset.iso = d.toISOString().slice(0, 10);
    btn.innerHTML = i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    dateChips.appendChild(btn);
  }
  selectChip(dateChips.querySelector('.chip'), 'date');
  state.date = new Date().toISOString().slice(0, 10);
  state.dateIndex = 0;
}

function selectChip(btn, group) {
  document.querySelectorAll(`.chip[data-group="${group}"]`).forEach(c => c.classList.remove('chip--active'));
  btn.classList.add('chip--active');
}

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-group]');
  if (!chip) return;
  const group = chip.dataset.group;
  selectChip(chip, group);
  if (group === 'date') {
    state.dateIndex = parseInt(chip.dataset.value);
    state.date = chip.dataset.iso;
    accuracyWarn.hidden = state.dateIndex < 3;
  } else if (group === 'time')     state.time = chip.dataset.value;
  else if (group === 'species')    state.species = chip.dataset.value;
  else if (group === 'watertype')  state.watertype = chip.dataset.value;
  else if (group === 'method')     state.method = chip.dataset.value;
  checkReady();
});

let nominatimTimer = null;

cityInput.addEventListener('input', () => {
  clearTimeout(nominatimTimer);
  const q = cityInput.value.trim();
  if (q.length < 2) { cityDropdown.hidden = true; return; }
  nominatimTimer = setTimeout(() => searchCity(q), 500);
});

cityInput.addEventListener('blur', () => {
  setTimeout(() => { cityDropdown.hidden = true; }, 200);
});

async function searchCity(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=ru`;
    const res = await fetch(url, { headers: { 'User-Agent': 'fishing-weather-advisor/1.0 (tereshinmikhail.github.io)' } });
    if (!res.ok) throw new Error();
    const data = await res.json();
    cityDropdown.innerHTML = '';
    if (data.length === 0) {
      const el = document.createElement('div');
      el.className = 'city-option';
      el.textContent = 'Ничего не найдено. Попробуйте другое название или введите координаты вручную.';
      el.style.color = 'var(--muted)';
      cityDropdown.appendChild(el);
      cityDropdown.hidden = false;
      return;
    }
    if (data.length === 1) {
      applyCoords(parseFloat(data[0].lat), parseFloat(data[0].lon));
      cityInput.value = data[0].display_name.split(',').slice(0, 2).join(',');
      cityDropdown.hidden = true;
      return;
    }
    data.forEach(item => {
      const el = document.createElement('div');
      el.className = 'city-option';
      const parts = item.display_name.split(',');
      const main = parts[0].trim();
      const sub  = parts.slice(1, 3).join(',').trim();
      el.innerHTML = `${main}<span class="city-option-sub">${sub}</span>`;
      el.addEventListener('click', () => {
        applyCoords(parseFloat(item.lat), parseFloat(item.lon));
        cityInput.value = main;
        cityDropdown.hidden = true;
      });
      cityDropdown.appendChild(el);
    });
    cityDropdown.hidden = false;
  } catch {
    cityDropdown.hidden = true;
    showCoordsError('Поиск по названию временно недоступен. Введите координаты вручную.');
  }
}

function applyCoords(lat, lon) {
  state.lat = lat; state.lon = lon;
  coordsInput.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  coordsError.hidden = true;
  checkReady();
}

coordsInput.addEventListener('input', () => {
  const raw = coordsInput.value.trim();
  if (!raw) { state.lat = null; state.lon = null; checkReady(); return; }
  const match = raw.match(/^(-?\d+[.,]\d*)\s*[,;\s]\s*(-?\d+[.,]\d*)$/);
  if (!match) { showCoordsError('Неверный формат. Пример: 55.5731, 37.9082'); state.lat = null; state.lon = null; checkReady(); return; }
  const lat = parseFloat(match[1].replace(',', '.'));
  const lon = parseFloat(match[2].replace(',', '.'));
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    showCoordsError('Координаты вне допустимого диапазона. Широта: −90…90, долгота: −180…180');
    state.lat = null; state.lon = null; checkReady(); return;
  }
  coordsError.hidden = true;
  state.lat = lat; state.lon = lon;
  cityInput.value = '';
  checkReady();
});

function showCoordsError(msg) { coordsError.textContent = msg; coordsError.hidden = false; }

function checkReady() {
  submitBtn.disabled = !(state.lat !== null && state.lon !== null && state.date && state.time && state.species && state.watertype && state.method);
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,pressure_msl,precipitation,cloudcover,windspeed_10m,winddirection_10m` +
    `&past_days=2&forecast_days=7&timezone=Europe%2FMoscow`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).hourly;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('timeout');
    throw e;
  }
}

function renderResult(result) {
  resultSection.hidden = false;
  const w = result.weather;
  const trendLabel = { falling: '↓', rising: '↑', stable: '→', unstable: '≈' };
  const trendClass = { falling: 'trend-falling', rising: 'trend-rising', stable: 'trend-stable', unstable: 'trend-unstable' };
  const trendText  = { falling: 'снижается', rising: 'растёт', stable: 'стабильное', unstable: 'нестабильное' };
  const cloudText  = w.cloudcover < 30 ? 'Ясно' : w.cloudcover < 70 ? 'Переменная' : 'Пасмурно';
  const rainText   = w.precipitation < 0.1 ? 'Нет' : `${w.precipitation.toFixed(1)} мм`;

  const items = [
    { icon: '🌡', value: `${w.temp.toFixed(1)}°C`, label: 'Температура' },
    { icon: '📊', value: `${Math.round(w.pressure)} <span class="trend-arrow ${trendClass[w.pressureTrend]}">${trendLabel[w.pressureTrend]}</span>`, label: `Давление мм рт.ст., ${trendText[w.pressureTrend]}` },
    { icon: '💨', value: `${w.windspeed.toFixed(1)} м/с`, label: `Ветер, ${w.winddirLabel}` },
    { icon: '☁', value: cloudText, label: 'Облачность' },
    { icon: '🌧', value: rainText, label: 'Осадки' },
    result.waterTemp !== null ? { icon: '🌊', value: `~${result.waterTemp.toFixed(1)}°C`, label: 'Темп. воды (расч.)' } : null,
  ].filter(Boolean);

  document.getElementById('weather-grid').innerHTML = items.map(it =>
    `<div class="weather-item"><div class="weather-icon">${it.icon}</div><div class="weather-value">${it.value}</div><div class="weather-label">${it.label}</div></div>`
  ).join('');

  const insightsList = document.getElementById('insights-list');
  insightsList.innerHTML = result.insights.length > 0
    ? result.insights.map(t => `<li>${t}</li>`).join('')
    : '<li>Условия типичные, выраженных отклонений нет.</li>';

  const badge = document.getElementById('rating-badge');
  const cfg = result.ratingConfig;
  badge.textContent = `${cfg.icon} ${cfg.label}`;
  badge.style.color = cfg.color;
  badge.style.borderColor = cfg.color;
  badge.style.background = `${cfg.color}18`;

  const spawnWarn = document.getElementById('spawn-warning');
  if (result.spawnWarning) { spawnWarn.textContent = '⚠ ' + result.spawnWarning; spawnWarn.hidden = false; }
  else spawnWarn.hidden = true;

  const rec = result.recommendation;
  if (rec) {
    document.getElementById('rec-details').innerHTML = [
      rec.lure   ? { key: 'Приманка', val: rec.lure }   : null,
      rec.color  ? { key: 'Цвет',     val: rec.color }   : null,
      rec.tactic ? { key: 'Тактика',  val: rec.tactic }  : null,
      rec.depth  ? { key: 'Горизонт', val: rec.depth }   : null,
    ].filter(Boolean).map(r =>
      `<div class="rec-row"><div class="rec-key">${r.key}</div><div class="rec-val">${r.val}</div></div>`
    ).join('');
  }

  document.getElementById('water-location').textContent = result.waterLocation;
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

submitBtn.addEventListener('click', async () => {
  if (state.loading) return;
  state.loading = true;
  submitLabel.hidden = true; submitLoader.hidden = false;
  submitBtn.disabled = true; apiError.hidden = true;
  try {
    const hourlyData = await fetchWeather(state.lat, state.lon);
    state.hourlyData = hourlyData;
    const result = analyze({ species: state.species, method: state.method, waterType: state.watertype, timePeriod: state.time, targetDate: state.date + 'T12:00:00' }, hourlyData);
    if (!result) throw new Error('no_data');
    renderResult(result);
  } catch (e) {
    let msg = 'Не удалось получить прогноз погоды. Проверьте соединение и попробуйте снова.';
    if (e.message === 'timeout') msg = 'Сервер погоды не отвечает. Попробуйте через несколько минут.';
    if (e.message === 'no_data') msg = 'Нет данных для выбранного времени. Попробуйте другую дату.';
    apiError.textContent = msg; apiError.hidden = false;
  } finally {
    state.loading = false;
    submitLabel.hidden = false; submitLoader.hidden = true;
    submitBtn.disabled = false;
  }
});

initDateChips();