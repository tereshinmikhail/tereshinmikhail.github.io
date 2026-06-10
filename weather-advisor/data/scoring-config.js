// ============================================================
// КОНФИГ СКОРИНГА v4
// weather-advisor/data/scoring-config.js
// Все настраиваемые константы модели — в одном месте.
// ============================================================

const SCORING_CONFIG = {

  // Масштаб влияния ветра по типу водоёма:
  // на малой реке ветер до воды почти не доходит,
  // на открытой воде прибой — ключевой фактор
  windWaterCoef: { river_small: 0.25, pond: 0.5, river_large: 1, reservoir: 1, lake: 1 },

  // Холодный дождь: при возд. < порога бонусы дождя обнуляются + штраф
  coldRain: { airTempBelow: 12, penalty: -1 },

  // Замутнение: затяжной/сильный дождь на малой реке
  // штрафует визуальных хищников
  turbidity: {
    waterTypes: ['river_small'],
    rainCats: ['heavy', 'prolonged'],
    species: ['chub', 'asp'],
    penalty: -1,
  },

  // Динамика температуры (Δ за 48ч vs предыдущие 48ч)
  tempDynamics: {
    sharpCool: -4, sharpCoolPenalty: -2,
    mildCool:  -2, mildCoolPenalty:  -1,
    warmGain:   2, warmBonus:         1,   // только если вода ниже идеала
    overheatDelta: 3, overheatPenalty: -1, // вода у верхней границы и продолжает греться
  },

  // Порог резкого послефронтового роста давления (гПа/12ч) для сценария P5
  pressureSharpRise: 5,

  // Узлы интерполяции: скорость ветра (м/с) → категория таблицы
  windNodes: [[0.5, 'calm'], [2, 'light'], [4, 'moderate'], [6.5, 'strong']],

  // Узлы интерполяции: облачность (%) → категория таблицы
  cloudNodes: [[15, 'sunny'], [50, 'cloudy'], [85, 'overcast']],

  // Видоспецифичные пороги рейтинга: score >= good | neutral | hard, иначе bad.
  // Калибровка 2026-06-10: взвешенная симуляция по сетке реалистичных условий
  // (апр–окт, Подмосковье), квантили q75 / q40 / q10 распределения score
  // каждого вида. Рейтинг = качество условий ОТНОСИТЕЛЬНО достижимого
  // для выбранного вида. Итоговое распределение: good 23–31%, bad 8–10%.
  ratingThresholds: {
    pike:    { good: 3.5, neutral: 0.5, hard: -3 },
    zander:  { good: 3,   neutral: 0.5, hard: -2 },
    perch:   { good: 4,   neutral: 1,   hard: -2.5 },
    asp:     { good: 2,   neutral: -1,  hard: -4 },
    chub:    { good: 2,   neutral: -1,  hard: -4 },
    catfish: { good: 1,   neutral: -1,  hard: -3.5 },
    default: { good: 3,   neutral: 1,   hard: -1 },
  },
};
