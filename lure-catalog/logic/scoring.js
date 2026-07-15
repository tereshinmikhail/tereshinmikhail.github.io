// ============================================================
// LURE CATALOG — логика скоринга
// Приоритет: горизонт (основной) → дно (жёсткий фильтр) →
// течение/вес (модификатор) → мутность/цвет (мягкий бонус) → вид (мягкий бонус)
// См. lure-catalog/RESEARCH.md за обоснованием.
// ============================================================

(function () {

  function computeTargetDepth(waterDepth, offsetFromBottom) {
    const d = waterDepth - offsetFromBottom;
    return Math.max(0, Math.min(waterDepth, d));
  }

  // Ориентировочный вес джиг-головки/тонущей приманки под глубину+течение
  function recommendedWeightRange(depth, current) {
    let base;
    if (depth <= 2) base = [2, 4];
    else if (depth <= 4) base = [6, 12];
    else if (depth <= 6) base = [10, 14];
    else if (depth <= 10) base = [14, 20];
    else base = [18, 30];

    if (current === "strong") return [base[0] * 2, base[1] * 2];
    const add = current === "medium" ? 5 : current === "weak" ? 2.5 : 0;
    return [base[0] + add, base[1] + add];
  }

  function currentFitByWeight(weight, depth, current) {
    if (!weight) return 6;
    const [lo, hi] = recommendedWeightRange(depth, current);
    if (weight >= lo && weight <= hi) return 15;
    const mid = (lo + hi) / 2;
    const dev = Math.abs(weight - mid) / mid;
    return dev <= 0.5 ? 8 : 2;
  }

  const SPINNER_CURRENT_TABLE = {
    none:   { aglia: 15, comet: 10, long: 3 },
    weak:   { aglia: 15, comet: 10, long: 3 },
    medium: { aglia: 8,  comet: 15, long: 8 },
    strong: { aglia: 2,  comet: 8,  long: 15 }
  };

  function currentFitSpinner(bladeType, current) {
    const row = SPINNER_CURRENT_TABLE[current] || SPINNER_CURRENT_TABLE.none;
    return row[bladeType] ?? 6;
  }

  function depthFitScore(lure, targetDepth) {
    if (lure.sink_rate_sec_per_m) {
      // Счётный тип: джиг-головка, цикада, тонущая колебалка —
      // глубина = скорость погружения × время, попадание в горизонт точное.
      const fallTime = (targetDepth * lure.sink_rate_sec_per_m).toFixed(1);
      return {
        score: 60,
        excluded: false,
        note: `счётный тип — падение до ${targetDepth.toFixed(1)} м займёт ≈${fallTime} сек`
      };
    }
    if (lure.type === "wobbler") {
      if (targetDepth > (lure.max_depth_m || 0) + 0.05) {
        return { score: 0, excluded: true, note: `не достаёт: потолок ${lure.max_depth_m} м, нужно ${targetDepth.toFixed(1)} м` };
      }
      const ratio = lure.max_depth_m > 0 ? targetDepth / lure.max_depth_m : 0;
      return {
        score: 30 + 30 * ratio,
        excluded: false,
        note: `потолочный тип — цель ${targetDepth.toFixed(1)} из макс. ${lure.max_depth_m} м, точность средняя`
      };
    }
    if (lure.type === "spinner") {
      const diff = Math.abs(targetDepth - (lure.approx_depth_m || 0));
      let score;
      if (diff <= 0.4) score = 60 - diff * 50;
      else if (diff <= 1.0) score = 20;
      else score = 5;
      return {
        score,
        excluded: false,
        note: `ориентировочный горизонт ~${lure.approx_depth_m} м, регулируется скоростью подмотки`
      };
    }
    return { score: 20, excluded: false, note: "горизонт для этого типа не формализован" };
  }

  function bottomCompatible(lure, bottom) {
    if (bottom === "sand") return true;
    return !!lure.weedless || (lure.bottom_types && lure.bottom_types.includes(bottom));
  }

  function clarityScore(lure, clarity) {
    if (!lure.clarity || lure.clarity === "any") return 8;
    return lure.clarity === clarity ? 15 : 2;
  }

  function speciesScore(lure, species) {
    if (!species) return 6;
    if (lure.species && lure.species.includes(species)) return 10;
    return 2;
  }

  const BOTTOM_LABELS = { sand: "песок/ил", grass: "трава", snag: "коряги", rock: "камни" };

  function scoreLure(lure, cond) {
    const targetDepth = computeTargetDepth(cond.waterDepth, cond.offsetFromBottom);
    const compatible = bottomCompatible(lure, cond.bottom);
    const df = depthFitScore(lure, targetDepth);

    if (!compatible || df.excluded) {
      return {
        lure,
        targetDepth,
        excluded: true,
        reason: !compatible
          ? `риск зацепа: дно «${BOTTOM_LABELS[cond.bottom] || cond.bottom}», у приманки нет защиты крючка`
          : df.note
      };
    }

    let cf;
    if (lure.type === "spinner") cf = currentFitSpinner(lure.blade_type, cond.current);
    else if (lure.type === "jig_silicone") cf = currentFitByWeight(lure.jighead_weight_g || lure.weight_g, cond.waterDepth, cond.current);
    else if (lure.type === "cicada" || lure.type === "spoon") cf = currentFitByWeight(lure.weight_g, cond.waterDepth, cond.current);
    else cf = 8;

    const cs = clarityScore(lure, cond.clarity);
    const ss = speciesScore(lure, cond.species);
    const total = Math.round(df.score + cf + cs + ss);

    return {
      lure,
      targetDepth,
      excluded: false,
      total,
      breakdown: [
        { label: "Горизонт", note: df.note, value: Math.round(df.score) },
        { label: "Течение / вес", value: cf },
        { label: "Мутность / цвет", value: cs },
        { label: "Целевой вид", value: ss }
      ]
    };
  }

  function ratingLabel(total) {
    if (total >= 80) return { label: "Отлично", cls: "good" };
    if (total >= 60) return { label: "Хорошо", cls: "good" };
    if (total >= 40) return { label: "Средне", cls: "warn" };
    return { label: "Слабо", cls: "bad" };
  }

  window.LureScoring = { scoreLure, computeTargetDepth, ratingLabel, BOTTOM_LABELS };
})();
