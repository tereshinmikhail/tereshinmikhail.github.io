// ============================================================
// LURE CATALOG — app.js (DOM-логика)
// ============================================================

(function () {
  const TYPE_LABELS = {
    jig_silicone: "Силикон / джиг",
    wobbler: "Воблер",
    spinner: "Вертушка",
    cicada: "Цикада",
    spoon: "Колебалка"
  };
  const SPECIES_LABELS = { pike: "Щука", zander: "Судак", perch: "Окунь", asp: "Жерех", chub: "Голавль" };

  const state = { bottom: null, current: null, clarity: null, species: null };

  const depthInput = document.getElementById("depth-input");
  const offsetInput = document.getElementById("offset-input");
  const submitBtn = document.getElementById("submit-btn");

  function initChipGroup(stateKey) {
    document.querySelectorAll(`.chip[data-group="${stateKey}"]`).forEach((chip) => {
      chip.addEventListener("click", () => {
        const wasActive = chip.classList.contains("chip--active");
        document.querySelectorAll(`.chip[data-group="${stateKey}"]`).forEach((c) => c.classList.remove("chip--active"));
        if (wasActive) {
          state[stateKey] = null;
        } else {
          chip.classList.add("chip--active");
          state[stateKey] = chip.dataset.value;
        }
        checkFormValid();
      });
    });
  }
  ["bottom", "current", "clarity", "species"].forEach(initChipGroup);

  function checkFormValid() {
    const ok = !!(depthInput.value && offsetInput.value && state.bottom && state.current && state.clarity);
    submitBtn.disabled = !ok;
  }
  depthInput.addEventListener("input", checkFormValid);
  offsetInput.addEventListener("input", checkFormValid);

  submitBtn.addEventListener("click", () => {
    const cond = {
      waterDepth: parseFloat(depthInput.value),
      offsetFromBottom: parseFloat(offsetInput.value),
      bottom: state.bottom,
      current: state.current,
      clarity: state.clarity,
      species: state.species
    };
    runAdvisor(cond);
  });

  function runAdvisor(cond) {
    const results = LURES_DATA.map((l) => LureScoring.scoreLure(l, cond));
    const ranked = results.filter((r) => !r.excluded).sort((a, b) => b.total - a.total);
    const excluded = results.filter((r) => r.excluded);
    renderResults(cond, ranked, excluded);
  }

  function lureCardBadges(lure) {
    let badges = `<span class="lure-tag">${TYPE_LABELS[lure.type] || lure.type}</span>`;
    if (lure.test) badges += `<span class="test-badge">тестовая запись</span>`;
    return badges;
  }

  function lureResultCard(r) {
    const rating = LureScoring.ratingLabel(r.total);
    const colorVar = rating.cls === "good" ? "var(--good)" : rating.cls === "warn" ? "var(--warn)" : "var(--bad)";
    return `
      <div class="result-block lure-result">
        <div class="lure-card-top">
          <div>
            <div class="lure-name">${r.lure.name}</div>
            ${lureCardBadges(r.lure)}
          </div>
          <div class="rating-badge" style="border-color:${colorVar};color:${colorVar}">${r.total} · ${rating.label}</div>
        </div>
        <details class="score-breakdown">
          <summary>Как посчитана оценка</summary>
          <div class="breakdown-rows">
            ${r.breakdown
              .map(
                (b) =>
                  `<div class="bd-row"><span class="bd-label">${b.label}${b.note ? " — " + b.note : ""}</span><span class="bd-val">${b.value}</span></div>`
              )
              .join("")}
            <div class="bd-row bd-total"><span class="bd-label">Итого</span><span class="bd-val">${r.total}</span></div>
          </div>
        </details>
      </div>`;
  }

  function renderResults(cond, ranked, excluded) {
    const section = document.getElementById("result-section");
    section.hidden = false;

    const target = LureScoring.computeTargetDepth(cond.waterDepth, cond.offsetFromBottom);
    document.getElementById("target-depth-summary").textContent =
      `Глубина места ${cond.waterDepth} м, желаемый горизонт ${cond.offsetFromBottom} м от дна → целевая глубина ≈ ${target.toFixed(1)} м`;

    const list = document.getElementById("ranked-list");
    list.innerHTML =
      ranked.map(lureResultCard).join("") ||
      '<p class="hint">Ничего не подошло под условия — в тестовом наборе всего 6 приманок, это ожидаемо.</p>';

    const excludedBlock = document.getElementById("excluded-block");
    const excludedList = document.getElementById("excluded-list");
    if (excluded.length) {
      excludedBlock.hidden = false;
      excludedList.innerHTML = excluded
        .map((r) => `<li><strong>${r.lure.name}</strong> — ${r.reason}</li>`)
        .join("");
    } else {
      excludedBlock.hidden = true;
    }

    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderCatalog() {
    const grid = document.getElementById("catalog-grid");
    grid.innerHTML = LURES_DATA.map(
      (l) => `
      <div class="lure-card">
        <div class="lure-card-top">
          <div class="lure-name">${l.name}</div>
        </div>
        ${lureCardBadges(l)}
        <div class="lure-meta">${l.weight_g ? l.weight_g + " г" : ""}${l.length_mm ? " · " + l.length_mm + " мм" : ""}</div>
        ${l.species ? `<div class="lure-meta">${l.species.map((s) => SPECIES_LABELS[s] || s).join(", ")}</div>` : ""}
        <div class="lure-notes">${l.notes || ""}</div>
      </div>`
    ).join("");
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("chip--active"));
      btn.classList.add("chip--active");
      const tab = btn.dataset.tab;
      document.getElementById("advisor-tab").hidden = tab !== "advisor";
      document.getElementById("catalog-tab").hidden = tab !== "catalog";
    });
  });

  renderCatalog();
})();
