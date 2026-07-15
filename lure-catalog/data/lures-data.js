// ============================================================
// LURE CATALOG — тестовые данные
// Эти записи помечены test:true и предназначены только для проверки
// интерфейса и скоринга. Удалить/заменить реальным списком приманок.
// ============================================================

const LURES_DATA = [
  {
    id: "test-jig-shad-1",
    test: true,
    name: "Kutomi Shad 3\" (тест)",
    type: "jig_silicone",
    rig: "jig",
    weight_g: 4,
    length_mm: 75,
    jighead_weight_g: 8,
    sink_rate_sec_per_m: 2.5,
    weedless: false,
    bottom_types: ["sand"],
    species: ["perch", "zander", "pike"],
    clarity: "any",
    notes: "Тестовая запись для проверки интерфейса — не настоящая приманка из твоего арсенала."
  },
  {
    id: "test-jig-worm-texas",
    test: true,
    name: "Kutomi Worm 4\" Texas (тест)",
    type: "jig_silicone",
    rig: "texas",
    weight_g: 6,
    length_mm: 100,
    jighead_weight_g: 10,
    sink_rate_sec_per_m: 2.0,
    weedless: true,
    bottom_types: ["sand", "grass", "snag"],
    species: ["pike", "zander"],
    clarity: "any",
    notes: "Тестовая незацепляйка на офсете — проверяет фильтр по типу дна (трава/коряги)."
  },
  {
    id: "test-crank-dr50",
    test: true,
    name: "TestCrank DR 50 (тест)",
    type: "wobbler",
    dive_class: "DR",
    buoyancy: "F",
    max_depth_m: 2.0,
    weight_g: 8,
    length_mm: 50,
    weedless: false,
    bottom_types: ["sand"],
    species: ["pike", "perch", "zander"],
    clarity: "clear",
    notes: "Тестовый воблер с лопастью, потолок заглубления 2 м — проверяет «потолочный» тип расчёта горизонта."
  },
  {
    id: "test-spin-aglia2",
    test: true,
    name: "TestSpin Aglia №2 (тест)",
    type: "spinner",
    blade_type: "aglia",
    size: 2,
    approx_depth_m: 0.6,
    weight_g: 6,
    length_mm: 45,
    weedless: false,
    bottom_types: ["sand"],
    species: ["pike", "perch"],
    clarity: "clear",
    notes: "Тестовая вертушка с широким лепестком — для тихой воды у поверхности."
  },
  {
    id: "test-cicada-10",
    test: true,
    name: "TestBlade Cicada 10г (тест)",
    type: "cicada",
    weight_g: 10,
    length_mm: 55,
    sink_rate_sec_per_m: 1.0,
    tie_point: "mid",
    weedless: false,
    bottom_types: ["sand"],
    species: ["perch", "zander", "pike"],
    clarity: "murky",
    notes: "Тестовая цикада — та самая логика из истории на отмели: точный счётный расчёт горизонта."
  },
  {
    id: "test-spoon-weedless14",
    test: true,
    name: "TestSpoon Weedless 14г (тест)",
    type: "spoon",
    weight_g: 14,
    length_mm: 70,
    sink_rate_sec_per_m: 1.5,
    weedless: true,
    bottom_types: ["sand", "grass", "snag"],
    species: ["pike"],
    clarity: "any",
    notes: "Тестовая колебалка-незацепляйка с проволочными усами — проверяет проходимость по траве/корягам."
  }
];
