import type {
  CatalogueBomComponent,
  CatalogueCategory,
  CatalogueCharacteristics,
  CatalogueInterchangeabilityFamily,
  CatalogueItem,
  CatalogueScalarRecord,
  CatalogueStockBalance,
  IndustrialCatalogue,
  IndustrialCatalogueManifest,
} from "@/domain/catalogue";
import { CATALOGUE_CATEGORIES } from "@/domain/catalogue";

const OWNER_USER_ID = "demo-user-001";
const FAMILIES_PER_CATEGORY = 160;
const ASSEMBLIES_PER_CATEGORY = 80;
const MEMBERS_PER_FAMILY = 4;
const COMPONENTS_PER_ASSEMBLY = 6;

export const INDUSTRIAL_CATALOGUE_SEED = 0x4d_54_52_26;
export const INDUSTRIAL_CATALOGUE_SNAPSHOT_AT = "2026-08-11T07:30:00.000Z";

const CATEGORY_CODE: Record<CatalogueCategory, string> = {
  PIPING: "PIP",
  VALVES: "VLV",
  INSTRUMENTATION: "INS",
  ELECTRICAL: "ELC",
  ROTATING: "ROT",
  MRO: "MRO",
};

export const INDUSTRIAL_CATALOGUE_REPRESENTATIVE = {
  familyCode: "IG-DEMO-PIP-0002",
  itemCode: "CAT-DEMO-PIP-0005",
  compatibleItemCodes: [
    "CAT-DEMO-PIP-0006",
    "CAT-DEMO-PIP-0007",
    "CAT-DEMO-PIP-0008",
  ],
  incompatibleDecoyCode: "CAT-DEMO-PIP-0009",
  assemblyCode: "CAT-DEMO-ASM-PIP-0001",
} as const;

export const INDUSTRIAL_CATALOGUE_MANIFEST = Object.freeze({
  fixtureId: "industrial-catalogue-demo-v1",
  datasetVersion: "1.0.0-DEMO",
  ownerUserId: OWNER_USER_ID,
  seed: INDUSTRIAL_CATALOGUE_SEED,
  snapshotAt: INDUSTRIAL_CATALOGUE_SNAPSHOT_AT,
  expectedItemCount: 4_800,
  expectedComponentCount: 4_320,
  expectedAssemblyCount: 480,
  expectedFamilyCount: 960,
  expectedCompatibleMembersPerFamily: 4,
  expectedDecoyCount: 480,
  expectedStockBalanceCount: 7_200,
  expectedMultiWarehouseItemCount: 2_400,
  expectedBomLinkCount: 2_880,
  expectedComponentsPerAssembly: 6,
  representative: INDUSTRIAL_CATALOGUE_REPRESENTATIVE,
} satisfies IndustrialCatalogueManifest);

interface ComponentTemplate {
  key: string;
  equipmentType: string;
  nameRu: string;
  nameEn: string;
  unit: string;
  materialGrade: string;
  synonyms: readonly string[];
}

interface AssemblyTemplate {
  key: string;
  equipmentType: string;
  nameRu: string;
  nameEn: string;
  synonyms: readonly string[];
}

const COMPONENT_TEMPLATES: Record<CatalogueCategory, readonly ComponentTemplate[]> = {
  PIPING: [
    { key: "PIPE", equipmentType: "PIPE", nameRu: "Труба технологическая", nameEn: "Process pipe", unit: "M", materialGrade: "DEMO-STEEL-P355", synonyms: ["трубопроводная труба", "pipe"] },
    { key: "ELBOW", equipmentType: "ELBOW", nameRu: "Отвод крутоизогнутый", nameEn: "Long-radius elbow", unit: "EA", materialGrade: "DEMO-STEEL-P355", synonyms: ["колено", "отвод 90"] },
    { key: "FLANGE", equipmentType: "FLANGE", nameRu: "Фланец воротниковый", nameEn: "Weld-neck flange", unit: "EA", materialGrade: "DEMO-STEEL-20", synonyms: ["фланец", "weld neck"] },
    { key: "TEE", equipmentType: "TEE", nameRu: "Тройник равнопроходный", nameEn: "Equal tee", unit: "EA", materialGrade: "DEMO-STEEL-P355", synonyms: ["тройник", "tee fitting"] },
    { key: "REDUCER", equipmentType: "REDUCER", nameRu: "Переход концентрический", nameEn: "Concentric reducer", unit: "EA", materialGrade: "DEMO-STEEL-P355", synonyms: ["переход", "редуктор трубный"] },
    { key: "COUPLING", equipmentType: "FITTING", nameRu: "Муфта соединительная", nameEn: "Pipe coupling", unit: "EA", materialGrade: "DEMO-STEEL-316L", synonyms: ["муфта", "соединитель"] },
    { key: "GASKET", equipmentType: "GASKET", nameRu: "Прокладка фланцевая", nameEn: "Flange gasket", unit: "EA", materialGrade: "DEMO-GRAPHITE-SS", synonyms: ["уплотнение", "прокладка"] },
    { key: "SUPPORT", equipmentType: "PIPE_SUPPORT", nameRu: "Опора трубопровода", nameEn: "Pipe support", unit: "EA", materialGrade: "DEMO-STEEL-S355", synonyms: ["подвеска", "опора"] },
  ],
  VALVES: [
    { key: "GATE", equipmentType: "GATE_VALVE", nameRu: "Задвижка клиновая", nameEn: "Wedge gate valve", unit: "EA", materialGrade: "DEMO-STEEL-WCB", synonyms: ["задвижка", "gate valve"] },
    { key: "GLOBE", equipmentType: "GLOBE_VALVE", nameRu: "Клапан запорный", nameEn: "Globe valve", unit: "EA", materialGrade: "DEMO-STEEL-WCB", synonyms: ["вентиль", "globe valve"] },
    { key: "BALL", equipmentType: "BALL_VALVE", nameRu: "Кран шаровой", nameEn: "Ball valve", unit: "EA", materialGrade: "DEMO-STEEL-316", synonyms: ["шаровой кран", "ball valve"] },
    { key: "CHECK", equipmentType: "CHECK_VALVE", nameRu: "Клапан обратный", nameEn: "Check valve", unit: "EA", materialGrade: "DEMO-STEEL-WCB", synonyms: ["обратный клапан", "check valve"] },
    { key: "BUTTERFLY", equipmentType: "BUTTERFLY_VALVE", nameRu: "Затвор дисковый", nameEn: "Butterfly valve", unit: "EA", materialGrade: "DEMO-IRON-GGG40", synonyms: ["дисковый затвор", "butterfly"] },
    { key: "CONTROL", equipmentType: "CONTROL_VALVE", nameRu: "Клапан регулирующий", nameEn: "Control valve", unit: "EA", materialGrade: "DEMO-STEEL-CF8M", synonyms: ["регулирующий клапан", "control valve"] },
    { key: "SAFETY", equipmentType: "SAFETY_VALVE", nameRu: "Клапан предохранительный", nameEn: "Safety relief valve", unit: "EA", materialGrade: "DEMO-STEEL-WCB", synonyms: ["предохранительный клапан", "relief valve"] },
    { key: "STRAINER", equipmentType: "STRAINER", nameRu: "Фильтр сетчатый", nameEn: "Y-strainer", unit: "EA", materialGrade: "DEMO-STEEL-WCB", synonyms: ["грязевик", "сетчатый фильтр"] },
  ],
  INSTRUMENTATION: [
    { key: "PGAUGE", equipmentType: "PRESSURE_GAUGE", nameRu: "Манометр показывающий", nameEn: "Pressure gauge", unit: "EA", materialGrade: "DEMO-SS-316", synonyms: ["манометр", "pressure gauge"] },
    { key: "PTX", equipmentType: "PRESSURE_TRANSMITTER", nameRu: "Преобразователь давления", nameEn: "Pressure transmitter", unit: "EA", materialGrade: "DEMO-SS-316L", synonyms: ["датчик давления", "pressure transmitter"] },
    { key: "TEMP", equipmentType: "TEMPERATURE_SENSOR", nameRu: "Термопреобразователь сопротивления", nameEn: "Resistance temperature detector", unit: "EA", materialGrade: "DEMO-SS-321", synonyms: ["термодатчик", "RTD"] },
    { key: "FLOW", equipmentType: "FLOW_METER", nameRu: "Расходомер вихревой", nameEn: "Vortex flow meter", unit: "EA", materialGrade: "DEMO-SS-316L", synonyms: ["расходомер", "flow meter"] },
    { key: "LEVEL", equipmentType: "LEVEL_TRANSMITTER", nameRu: "Уровнемер радарный", nameEn: "Radar level transmitter", unit: "EA", materialGrade: "DEMO-SS-316L", synonyms: ["датчик уровня", "level transmitter"] },
    { key: "POSITIONER", equipmentType: "VALVE_POSITIONER", nameRu: "Позиционер электропневматический", nameEn: "Electro-pneumatic positioner", unit: "EA", materialGrade: "DEMO-ALLOY-AL", synonyms: ["позиционер", "valve positioner"] },
    { key: "GAS", equipmentType: "GAS_DETECTOR", nameRu: "Газоанализатор стационарный", nameEn: "Fixed gas detector", unit: "EA", materialGrade: "DEMO-SS-316", synonyms: ["газовый детектор", "gas detector"] },
    { key: "MANIFOLD", equipmentType: "INSTRUMENT_MANIFOLD", nameRu: "Манифольд вентильный", nameEn: "Instrument valve manifold", unit: "EA", materialGrade: "DEMO-SS-316", synonyms: ["вентильный блок", "manifold"] },
  ],
  ELECTRICAL: [
    { key: "POWER_CABLE", equipmentType: "POWER_CABLE", nameRu: "Кабель силовой", nameEn: "Power cable", unit: "M", materialGrade: "DEMO-CU-XLPE", synonyms: ["силовой кабель", "power cable"] },
    { key: "CONTROL_CABLE", equipmentType: "CONTROL_CABLE", nameRu: "Кабель контрольный", nameEn: "Control cable", unit: "M", materialGrade: "DEMO-CU-PVC", synonyms: ["контрольный кабель", "control cable"] },
    { key: "BREAKER", equipmentType: "CIRCUIT_BREAKER", nameRu: "Выключатель автоматический", nameEn: "Circuit breaker", unit: "EA", materialGrade: "DEMO-ELECTRO", synonyms: ["автомат", "circuit breaker"] },
    { key: "CONTACTOR", equipmentType: "CONTACTOR", nameRu: "Контактор электромагнитный", nameEn: "Electromagnetic contactor", unit: "EA", materialGrade: "DEMO-ELECTRO", synonyms: ["пускатель", "contactor"] },
    { key: "TERMINAL", equipmentType: "TERMINAL_BLOCK", nameRu: "Клемма проходная", nameEn: "Feed-through terminal block", unit: "EA", materialGrade: "DEMO-PA-CU", synonyms: ["клеммник", "terminal block"] },
    { key: "TRAY", equipmentType: "CABLE_TRAY", nameRu: "Лоток кабельный", nameEn: "Cable tray", unit: "M", materialGrade: "DEMO-STEEL-ZN", synonyms: ["кабельрост", "cable tray"] },
    { key: "JUNCTION", equipmentType: "JUNCTION_BOX", nameRu: "Коробка соединительная", nameEn: "Junction box", unit: "EA", materialGrade: "DEMO-GRP", synonyms: ["клеммная коробка", "junction box"] },
    { key: "LIGHT", equipmentType: "INDUSTRIAL_LIGHT", nameRu: "Светильник промышленный", nameEn: "Industrial luminaire", unit: "EA", materialGrade: "DEMO-ALLOY-AL", synonyms: ["светильник", "luminaire"] },
  ],
  ROTATING: [
    { key: "PUMP", equipmentType: "PUMP", nameRu: "Насос центробежный", nameEn: "Centrifugal pump", unit: "EA", materialGrade: "DEMO-STEEL-CF8M", synonyms: ["насос", "centrifugal pump"] },
    { key: "MOTOR", equipmentType: "ELECTRIC_MOTOR", nameRu: "Электродвигатель асинхронный", nameEn: "Induction motor", unit: "EA", materialGrade: "DEMO-CAST-IRON", synonyms: ["двигатель", "electric motor"] },
    { key: "BEARING", equipmentType: "BEARING", nameRu: "Подшипник качения", nameEn: "Rolling bearing", unit: "EA", materialGrade: "DEMO-BEARING-STEEL", synonyms: ["подшипник", "bearing"] },
    { key: "COUPLING", equipmentType: "SHAFT_COUPLING", nameRu: "Муфта упругая", nameEn: "Flexible shaft coupling", unit: "EA", materialGrade: "DEMO-STEEL-40X", synonyms: ["муфта привода", "shaft coupling"] },
    { key: "SEAL", equipmentType: "MECHANICAL_SEAL", nameRu: "Уплотнение торцевое", nameEn: "Mechanical seal", unit: "EA", materialGrade: "DEMO-SIC-SS", synonyms: ["торцевое уплотнение", "mechanical seal"] },
    { key: "GEARBOX", equipmentType: "GEARBOX", nameRu: "Редуктор цилиндрический", nameEn: "Helical gearbox", unit: "EA", materialGrade: "DEMO-CAST-IRON", synonyms: ["редуктор", "gearbox"] },
    { key: "FAN", equipmentType: "INDUSTRIAL_FAN", nameRu: "Вентилятор радиальный", nameEn: "Centrifugal fan", unit: "EA", materialGrade: "DEMO-STEEL-S355", synonyms: ["дымосос", "industrial fan"] },
    { key: "COMPRESSOR", equipmentType: "COMPRESSOR", nameRu: "Компрессор винтовой", nameEn: "Screw compressor", unit: "EA", materialGrade: "DEMO-STEEL-40X", synonyms: ["компрессор", "screw compressor"] },
  ],
  MRO: [
    { key: "FASTENER", equipmentType: "FASTENER", nameRu: "Комплект крепежа", nameEn: "Fastener set", unit: "SET", materialGrade: "DEMO-STEEL-8.8", synonyms: ["болты и гайки", "fastener kit"] },
    { key: "SHEET", equipmentType: "GASKET_SHEET", nameRu: "Материал прокладочный листовой", nameEn: "Gasket sheet", unit: "KG", materialGrade: "DEMO-PARONITE", synonyms: ["паронит", "gasket sheet"] },
    { key: "LUBRICANT", equipmentType: "LUBRICANT", nameRu: "Смазка пластичная", nameEn: "Industrial grease", unit: "KG", materialGrade: "DEMO-GREASE-EP2", synonyms: ["смазка", "grease"] },
    { key: "FILTER", equipmentType: "FILTER_CARTRIDGE", nameRu: "Элемент фильтрующий", nameEn: "Filter cartridge", unit: "EA", materialGrade: "DEMO-FIBER-SS", synonyms: ["картридж фильтра", "filter element"] },
    { key: "ELECTRODE", equipmentType: "WELDING_ELECTRODE", nameRu: "Электроды сварочные", nameEn: "Welding electrodes", unit: "KG", materialGrade: "DEMO-E7018", synonyms: ["электроды", "welding rod"] },
    { key: "ABRASIVE", equipmentType: "ABRASIVE_DISC", nameRu: "Круг отрезной", nameEn: "Cutting disc", unit: "EA", materialGrade: "DEMO-ALUMINA", synonyms: ["диск отрезной", "abrasive disc"] },
    { key: "HOSE", equipmentType: "INDUSTRIAL_HOSE", nameRu: "Рукав промышленный", nameEn: "Industrial hose", unit: "M", materialGrade: "DEMO-NBR-TEXTILE", synonyms: ["шланг", "industrial hose"] },
    { key: "ORING", equipmentType: "O_RING", nameRu: "Кольцо уплотнительное", nameEn: "O-ring", unit: "EA", materialGrade: "DEMO-FKM", synonyms: ["кольцо резиновое", "o-ring"] },
  ],
};

const ASSEMBLY_TEMPLATES: Record<CatalogueCategory, readonly AssemblyTemplate[]> = {
  PIPING: [
    { key: "SPOOL", equipmentType: "PIPE_SPOOL_ASSEMBLY", nameRu: "Узел трубопроводный монтажный", nameEn: "Prefabricated pipe spool", synonyms: ["трубный узел", "spool"] },
    { key: "BYPASS", equipmentType: "PIPE_BYPASS_ASSEMBLY", nameRu: "Узел байпасный", nameEn: "Pipe bypass assembly", synonyms: ["байпас", "bypass assembly"] },
    { key: "MANIFOLD", equipmentType: "PIPE_MANIFOLD_ASSEMBLY", nameRu: "Коллектор распределительный", nameEn: "Distribution manifold", synonyms: ["коллектор", "manifold assembly"] },
    { key: "DRAIN", equipmentType: "DRAIN_ASSEMBLY", nameRu: "Узел дренажный", nameEn: "Drain assembly", synonyms: ["дренаж", "drain node"] },
  ],
  VALVES: [
    { key: "ISOLATION", equipmentType: "ISOLATION_VALVE_ASSEMBLY", nameRu: "Узел запорной арматуры", nameEn: "Isolation valve assembly", synonyms: ["запорный узел", "isolation package"] },
    { key: "CONTROL", equipmentType: "CONTROL_VALVE_ASSEMBLY", nameRu: "Узел регулирующего клапана", nameEn: "Control valve assembly", synonyms: ["регулирующий узел", "control valve package"] },
    { key: "SAFETY", equipmentType: "SAFETY_VALVE_ASSEMBLY", nameRu: "Узел предохранительных клапанов", nameEn: "Safety valve assembly", synonyms: ["предохранительный узел", "relief package"] },
    { key: "REDUCTION", equipmentType: "PRESSURE_REDUCTION_ASSEMBLY", nameRu: "Узел редуцирования давления", nameEn: "Pressure reduction assembly", synonyms: ["редукционный узел", "pressure reducing station"] },
  ],
  INSTRUMENTATION: [
    { key: "PRESSURE_LOOP", equipmentType: "PRESSURE_MEASUREMENT_ASSEMBLY", nameRu: "Контур измерения давления", nameEn: "Pressure measurement loop", synonyms: ["контур давления", "pressure loop"] },
    { key: "FLOW_LOOP", equipmentType: "FLOW_METERING_ASSEMBLY", nameRu: "Узел измерения расхода", nameEn: "Flow metering assembly", synonyms: ["узел учета", "metering run"] },
    { key: "LEVEL_LOOP", equipmentType: "LEVEL_MEASUREMENT_ASSEMBLY", nameRu: "Контур измерения уровня", nameEn: "Level measurement loop", synonyms: ["контур уровня", "level loop"] },
    { key: "GAS_SYSTEM", equipmentType: "GAS_DETECTION_ASSEMBLY", nameRu: "Пост газового контроля", nameEn: "Gas detection station", synonyms: ["газовый пост", "gas detection node"] },
  ],
  ELECTRICAL: [
    { key: "MCC", equipmentType: "MOTOR_CONTROL_ASSEMBLY", nameRu: "Шкаф управления электродвигателем", nameEn: "Motor control cabinet", synonyms: ["шкаф управления", "MCC"] },
    { key: "DISTRIBUTION", equipmentType: "DISTRIBUTION_BOARD_ASSEMBLY", nameRu: "Щит распределительный", nameEn: "Distribution board", synonyms: ["электрощит", "distribution panel"] },
    { key: "CABLE_ROUTE", equipmentType: "CABLE_ROUTE_ASSEMBLY", nameRu: "Трасса кабельная комплектная", nameEn: "Complete cable route", synonyms: ["кабельная трасса", "cable route"] },
    { key: "LIGHTING", equipmentType: "LIGHTING_ASSEMBLY", nameRu: "Узел промышленного освещения", nameEn: "Industrial lighting assembly", synonyms: ["осветительный узел", "lighting node"] },
  ],
  ROTATING: [
    { key: "PUMP_UNIT", equipmentType: "PUMP_UNIT_ASSEMBLY", nameRu: "Агрегат насосный", nameEn: "Pump unit", synonyms: ["насосный агрегат", "pump skid"] },
    { key: "FAN_UNIT", equipmentType: "FAN_UNIT_ASSEMBLY", nameRu: "Установка вентиляционная", nameEn: "Fan unit", synonyms: ["вентустановка", "fan package"] },
    { key: "COMPRESSOR_UNIT", equipmentType: "COMPRESSOR_UNIT_ASSEMBLY", nameRu: "Установка компрессорная", nameEn: "Compressor package", synonyms: ["компрессорный агрегат", "compressor skid"] },
    { key: "DRIVE", equipmentType: "DRIVE_ASSEMBLY", nameRu: "Привод комплектный", nameEn: "Complete drive assembly", synonyms: ["привод", "drive train"] },
  ],
  MRO: [
    { key: "PUMP_REPAIR", equipmentType: "PUMP_REPAIR_KIT", nameRu: "Ремкомплект насоса", nameEn: "Pump repair kit", synonyms: ["ЗИП насоса", "pump overhaul kit"] },
    { key: "VALVE_REPAIR", equipmentType: "VALVE_REPAIR_KIT", nameRu: "Ремкомплект арматуры", nameEn: "Valve repair kit", synonyms: ["ЗИП клапана", "valve overhaul kit"] },
    { key: "SEAL_KIT", equipmentType: "SEAL_KIT", nameRu: "Комплект уплотнений", nameEn: "Seal kit", synonyms: ["набор уплотнений", "seal set"] },
    { key: "SERVICE_KIT", equipmentType: "MAINTENANCE_KIT", nameRu: "Комплект регламентного обслуживания", nameEn: "Scheduled maintenance kit", synonyms: ["сервисный комплект", "maintenance set"] },
  ],
};

const MANUFACTURERS = [
  "DEMO СеверМаш",
  "DEMO ВолгаИнжиниринг",
  "DEMO ПромТех",
  "DEMO Индастриал Саплай",
] as const;

const PLANTS = ["PLANT-DEMO-01", "PLANT-DEMO-02", "PLANT-DEMO-03"] as const;
const WAREHOUSES = ["WH-DEMO-CENTRAL", "WH-DEMO-MRO", "WH-DEMO-PROJECT", "WH-DEMO-RESERVE"] as const;

function pad(value: number, length = 4): string {
  return String(value).padStart(length, "0");
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function standardCode(category: CatalogueCategory, templateIndex: number): string {
  return `DEMO-STD-${CATEGORY_CODE[category]}-${pad(templateIndex + 1, 2)}`;
}

function compatibilitySignature(
  category: CatalogueCategory,
  templateIndex: number,
  seriesIndex: number,
): CatalogueScalarRecord {
  const standard = standardCode(category, templateIndex);
  const nominalSizes = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500];

  switch (category) {
    case "PIPING":
      return {
        nominalDiameterMm: nominalSizes[seriesIndex],
        pressureClassBar: [10, 16, 25, 40][(seriesIndex + templateIndex) % 4],
        connectionCode: ["BW", "SW", "FLANGED", "THREADED"][templateIndex % 4],
        schedule: ["SCH20", "SCH40", "SCH80"][seriesIndex % 3],
        standardCode: standard,
      };
    case "VALVES":
      return {
        nominalDiameterMm: nominalSizes[seriesIndex],
        pressureClassBar: [16, 25, 40, 63][(seriesIndex + templateIndex) % 4],
        connectionCode: ["FLANGED", "BW", "WAFER"][templateIndex % 3],
        actuatorCode: ["MANUAL", "ELECTRIC", "PNEUMATIC"][seriesIndex % 3],
        standardCode: standard,
      };
    case "INSTRUMENTATION":
      return {
        rangeMin: 0,
        rangeMax: (seriesIndex + 1) * [1, 2.5, 10, 25][templateIndex % 4],
        outputSignal: ["4-20MA-HART", "4-20MA", "MODBUS"][seriesIndex % 3],
        processConnection: ["G1/2", "M20X1.5", "1/2NPT"][templateIndex % 3],
        accuracyClass: [0.1, 0.25, 0.5][seriesIndex % 3],
        standardCode: standard,
      };
    case "ELECTRICAL":
      return {
        ratedVoltageV: [24, 220, 380, 660, 6_000, 10_000][seriesIndex % 6],
        ratedCurrentA: (seriesIndex + 1) * [2, 4, 6, 10][templateIndex % 4],
        conductorOrPoleCount: [1, 2, 3, 4, 5, 7, 12, 19][templateIndex],
        ingressProtection: ["IP44", "IP54", "IP65", "IP66"][seriesIndex % 4],
        standardCode: standard,
      };
    case "ROTATING":
      return {
        shaftDiameterMm: 20 + seriesIndex * 5,
        ratedPowerKw: [1.5, 2.2, 4, 7.5, 11, 18.5, 30, 45, 75, 110][seriesIndex % 10],
        speedRpm: [750, 1_000, 1_500, 3_000][(seriesIndex + templateIndex) % 4],
        frameOrSealCode: `DEMO-F${pad(seriesIndex + 1, 3)}`,
        standardCode: standard,
      };
    case "MRO":
      return {
        nominalSizeMm: 5 + seriesIndex * 5,
        serviceClass: ["GENERAL", "HIGH-TEMP", "CHEMICAL", "FOOD-GRADE"][templateIndex % 4],
        packagingCode: ["EA", "BOX", "DRUM", "COIL"][seriesIndex % 4],
        temperatureMaxC: [80, 120, 180, 250, 400][seriesIndex % 5],
        standardCode: standard,
      };
  }
}

function signatureLabel(signature: CatalogueScalarRecord): string {
  return Object.entries(signature)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function incompatibleSignature(
  signature: CatalogueScalarRecord,
  familyOrdinal: number,
): CatalogueScalarRecord {
  const keys = Object.keys(signature);
  const key = keys[familyOrdinal % keys.length];
  const original = signature[key];
  let incompatible: string | number | boolean | null;
  if (typeof original === "number") incompatible = original + (Number.isInteger(original) ? 1 : 0.1);
  else if (typeof original === "boolean") incompatible = !original;
  else if (original === null) incompatible = "DEMO-NOT-NULL";
  else incompatible = `${original}-NEAR`;
  return { ...signature, [key]: incompatible };
}

function componentCode(category: CatalogueCategory, sequence: number): string {
  return `CAT-DEMO-${CATEGORY_CODE[category]}-${pad(sequence)}`;
}

function familyCode(category: CatalogueCategory, ordinal: number): string {
  return `IG-DEMO-${CATEGORY_CODE[category]}-${pad(ordinal)}`;
}

function assemblyCode(category: CatalogueCategory, ordinal: number): string {
  return `CAT-DEMO-ASM-${CATEGORY_CODE[category]}-${pad(ordinal)}`;
}

function componentItem(
  category: CatalogueCategory,
  componentSequence: number,
  family: CatalogueInterchangeabilityFamily,
  template: ComponentTemplate,
  standard: string,
  variantIndex: number,
): CatalogueItem {
  const itemCode = componentCode(category, componentSequence);
  const characteristics: CatalogueCharacteristics = {
    ...family.compatibilitySignature,
    category,
    compatibilityStatus: "VALID_MEMBER",
    familyCode: family.code,
    variantIndex: variantIndex + 1,
  };

  return {
    id: `catalog-item-${CATEGORY_CODE[category].toLowerCase()}-${pad(componentSequence)}`,
    userId: OWNER_USER_ID,
    itemCode,
    legacyCode: `LEG-DEMO-${CATEGORY_CODE[category]}-${pad(componentSequence, 6)}`,
    manufacturerPartNumber: `D-${template.key}-${pad(Number(family.code.slice(-4)))}-V${variantIndex + 1}`,
    nameRu: `${family.nameRu}, исполнение ${variantIndex + 1}`,
    nameEn: `${family.nameEn}, variant ${variantIndex + 1}`,
    synonyms: [...template.synonyms, family.code],
    equipmentType: template.equipmentType,
    itemKind: "COMPONENT",
    familyId: family.id,
    manufacturer: MANUFACTURERS[variantIndex],
    standard,
    materialGrade: template.materialGrade,
    characteristics,
    unit: template.unit,
    cardUrl: `/catalogue/${itemCode}`,
    fixtureTags: [
      "catalog:industrial",
      "catalog:family-member",
      `category:${category}`,
      `family:${family.code}`,
    ],
    isSyntheticDemo: true,
    createdBy: OWNER_USER_ID,
  };
}

function decoyItem(
  category: CatalogueCategory,
  componentSequence: number,
  family: CatalogueInterchangeabilityFamily,
  template: ComponentTemplate,
  standard: string,
  familyOrdinal: number,
): CatalogueItem {
  const itemCode = componentCode(category, componentSequence);
  const characteristics: CatalogueCharacteristics = {
    ...incompatibleSignature(family.compatibilitySignature, familyOrdinal),
    category,
    compatibilityStatus: "INCOMPATIBLE_DECOY",
    decoyForFamilyId: family.id,
    decoyForFamilyCode: family.code,
  };

  return {
    id: `catalog-item-${CATEGORY_CODE[category].toLowerCase()}-${pad(componentSequence)}`,
    userId: OWNER_USER_ID,
    itemCode,
    legacyCode: `LEG-DEMO-${CATEGORY_CODE[category]}-${pad(componentSequence, 6)}`,
    manufacturerPartNumber: `D-${template.key}-${pad(familyOrdinal)}-NEAR`,
    nameRu: `${family.nameRu}, исполнение D`,
    nameEn: `${family.nameEn}, variant D`,
    synonyms: [...template.synonyms, family.code, "визуально похожая позиция"],
    equipmentType: template.equipmentType,
    itemKind: "COMPONENT",
    familyId: null,
    manufacturer: "DEMO АльтерПром",
    standard: `${standard}-NEAR`,
    materialGrade: template.materialGrade,
    characteristics,
    unit: template.unit,
    cardUrl: `/catalogue/${itemCode}`,
    fixtureTags: [
      "catalog:industrial",
      "catalog:incompatible-decoy",
      "catalog:visually-similar",
      `category:${category}`,
      `decoy-for:${family.code}`,
    ],
    isSyntheticDemo: true,
    createdBy: OWNER_USER_ID,
  };
}

function assemblyItem(
  category: CatalogueCategory,
  ordinal: number,
  template: AssemblyTemplate,
): CatalogueItem {
  const itemCode = assemblyCode(category, ordinal);
  const standard = `DEMO-STD-ASM-${CATEGORY_CODE[category]}-${pad((ordinal - 1) % 4 + 1, 2)}`;
  return {
    id: `catalog-item-asm-${CATEGORY_CODE[category].toLowerCase()}-${pad(ordinal)}`,
    userId: OWNER_USER_ID,
    itemCode,
    legacyCode: `LEG-DEMO-ASM-${CATEGORY_CODE[category]}-${pad(ordinal, 6)}`,
    manufacturerPartNumber: `D-ASM-${template.key}-${pad(ordinal)}`,
    nameRu: `${template.nameRu} № ${pad(ordinal)}`,
    nameEn: `${template.nameEn} no. ${pad(ordinal)}`,
    synonyms: [...template.synonyms, `узел ${pad(ordinal)}`],
    equipmentType: template.equipmentType,
    itemKind: "ASSEMBLY",
    familyId: null,
    manufacturer: MANUFACTURERS[(ordinal - 1) % MANUFACTURERS.length],
    standard,
    materialGrade: "DEMO-ASSEMBLY-MIXED",
    characteristics: {
      category,
      compatibilityStatus: "NOT_APPLICABLE",
      assemblyType: template.key,
      designRevision: `DEMO-R${(ordinal - 1) % 5 + 1}`,
      componentCount: COMPONENTS_PER_ASSEMBLY,
      standardCode: standard,
    },
    unit: "EA",
    cardUrl: `/catalogue/${itemCode}`,
    fixtureTags: [
      "catalog:industrial",
      "catalog:assembly",
      "bom:6-components",
      `category:${category}`,
    ],
    isSyntheticDemo: true,
    createdBy: OWNER_USER_ID,
  };
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function stockQuantity(item: CatalogueItem, randomValue: number, secondary: boolean): number {
  if (item.itemKind === "ASSEMBLY") {
    return (Math.floor(randomValue * 9) + (secondary ? 0 : 1)) % 10;
  }

  const multiplier = item.unit === "M" ? 250 : item.unit === "KG" ? 80 : item.unit === "SET" ? 24 : 120;
  const quantity = randomValue * multiplier * (secondary ? 0.45 : 1);
  return Math.max(0, Math.round(quantity));
}

function stockBalance(
  item: CatalogueItem,
  itemIndex: number,
  locationIndex: 0 | 1,
  random: () => number,
): CatalogueStockBalance {
  const plantIndex = (itemIndex + locationIndex) % PLANTS.length;
  const warehouseIndex = (itemIndex * 3 + locationIndex) % WAREHOUSES.length;
  return {
    id: `catalog-stock-${item.id}-${locationIndex + 1}`,
    userId: OWNER_USER_ID,
    itemId: item.id,
    plant: PLANTS[plantIndex],
    storageLocation: WAREHOUSES[warehouseIndex],
    batch: item.itemKind === "COMPONENT" && itemIndex % 3 === 0
      ? `BATCH-DEMO-${pad(itemIndex + 1, 6)}`
      : null,
    availableQuantity: stockQuantity(item, random(), locationIndex === 1),
    unit: item.unit,
    snapshotAt: INDUSTRIAL_CATALOGUE_SNAPSHOT_AT,
    createdBy: OWNER_USER_ID,
  };
}

function bomQuantity(unit: string, assemblyIndex: number, componentIndex: number): number {
  if (unit === "M") return round3(1.5 + ((assemblyIndex + componentIndex) % 12) * 0.5);
  if (unit === "KG") return round3(0.5 + ((assemblyIndex + componentIndex) % 8) * 0.25);
  return componentIndex === 5 ? 2 : 1;
}

export function generateIndustrialCatalogue(): IndustrialCatalogue {
  const random = createRandom(INDUSTRIAL_CATALOGUE_SEED);
  const families: CatalogueInterchangeabilityFamily[] = [];
  const components: CatalogueItem[] = [];
  const assemblies: CatalogueItem[] = [];
  const familiesByCategory = new Map<CatalogueCategory, CatalogueInterchangeabilityFamily[]>();
  const validItemsByFamilyId = new Map<string, CatalogueItem[]>();
  const assembliesByCategory = new Map<CatalogueCategory, CatalogueItem[]>();

  for (const category of CATALOGUE_CATEGORIES) {
    const categoryFamilies: CatalogueInterchangeabilityFamily[] = [];
    const templates = COMPONENT_TEMPLATES[category];
    let componentSequence = 0;

    for (let familyOrdinal = 1; familyOrdinal <= FAMILIES_PER_CATEGORY; familyOrdinal += 1) {
      const templateIndex = (familyOrdinal - 1) % templates.length;
      const seriesIndex = Math.floor((familyOrdinal - 1) / templates.length);
      const template = templates[templateIndex];
      const signature = compatibilitySignature(category, templateIndex, seriesIndex);
      const code = familyCode(category, familyOrdinal);
      const family: CatalogueInterchangeabilityFamily = {
        id: `catalog-family-${CATEGORY_CODE[category].toLowerCase()}-${pad(familyOrdinal)}`,
        userId: OWNER_USER_ID,
        code,
        nameRu: `${template.nameRu}: ${signatureLabel(signature)}`,
        nameEn: `${template.nameEn}: ${signatureLabel(signature)}`,
        equipmentType: template.equipmentType,
        itemKind: "COMPONENT",
        unit: template.unit,
        compatibilitySignature: signature,
        active: true,
        isSyntheticDemo: true,
        createdBy: OWNER_USER_ID,
      };
      const familyItems: CatalogueItem[] = [];

      families.push(family);
      categoryFamilies.push(family);
      for (let variantIndex = 0; variantIndex < MEMBERS_PER_FAMILY; variantIndex += 1) {
        componentSequence += 1;
        const item = componentItem(
          category,
          componentSequence,
          family,
          template,
          standardCode(category, templateIndex),
          variantIndex,
        );
        components.push(item);
        familyItems.push(item);
      }
      validItemsByFamilyId.set(family.id, familyItems);

      if (familyOrdinal % 2 === 0) {
        componentSequence += 1;
        components.push(
          decoyItem(
            category,
            componentSequence,
            family,
            template,
            standardCode(category, templateIndex),
            familyOrdinal,
          ),
        );
      }
    }
    familiesByCategory.set(category, categoryFamilies);

    const categoryAssemblies: CatalogueItem[] = [];
    const assemblyTemplates = ASSEMBLY_TEMPLATES[category];
    for (let ordinal = 1; ordinal <= ASSEMBLIES_PER_CATEGORY; ordinal += 1) {
      const item = assemblyItem(category, ordinal, assemblyTemplates[(ordinal - 1) % assemblyTemplates.length]);
      assemblies.push(item);
      categoryAssemblies.push(item);
    }
    assembliesByCategory.set(category, categoryAssemblies);
  }

  const items = [...components, ...assemblies];
  const stockBalances: CatalogueStockBalance[] = [];
  for (const [itemIndex, item] of items.entries()) {
    stockBalances.push(stockBalance(item, itemIndex, 0, random));
    if (itemIndex % 2 === 0) stockBalances.push(stockBalance(item, itemIndex, 1, random));
  }

  const bomLinks: CatalogueBomComponent[] = [];
  for (const category of CATALOGUE_CATEGORIES) {
    const categoryFamilies = familiesByCategory.get(category) ?? [];
    const categoryAssemblies = assembliesByCategory.get(category) ?? [];
    for (const [assemblyIndex, assembly] of categoryAssemblies.entries()) {
      for (let componentIndex = 0; componentIndex < COMPONENTS_PER_ASSEMBLY; componentIndex += 1) {
        const family = categoryFamilies[(assemblyIndex * COMPONENTS_PER_ASSEMBLY + componentIndex) % categoryFamilies.length];
        const candidates = validItemsByFamilyId.get(family.id) ?? [];
        const component = candidates[(assemblyIndex + componentIndex) % candidates.length];
        const positionNumber = pad((componentIndex + 1) * 10, 4);
        bomLinks.push({
          id: `catalog-bom-${assembly.id}-${positionNumber}`,
          userId: OWNER_USER_ID,
          assemblyItemId: assembly.id,
          componentItemId: component.id,
          positionNumber,
          quantity: bomQuantity(component.unit, assemblyIndex, componentIndex),
          unit: component.unit,
          isCritical: componentIndex === 0 || componentIndex === 3,
          alternativeFamilyId: family.id,
          createdBy: OWNER_USER_ID,
        });
      }
    }
  }

  return {
    manifest: INDUSTRIAL_CATALOGUE_MANIFEST,
    families,
    items,
    stockBalances,
    bomLinks,
  };
}
