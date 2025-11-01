(() => {
const isBrowserEnvironment =
  typeof window !== "undefined" && typeof document !== "undefined";
const check2d = globalThis.check2d;
if (isBrowserEnvironment && (!check2d || !check2d.System)) {
  throw new Error("check2d library not found. Ensure lib/check2d/index.js is loaded before main.js.");
}

const System = check2d?.System ?? null;

const physicsLib = globalThis.RockportPhysics;
if (!physicsLib || !physicsLib.Car) {
  throw new Error(
    "Rockport physics library not found. Ensure carPhysics.js is loaded before main.js."
  );
}
const { Car: PhysicsCar, defaultCarConfig } = physicsLib;
const PIXELS_PER_METER = 16;

const TILE_SIZE = 256;
const RAD2DEG = 180 / Math.PI;

const ZERO_INPUT = Object.freeze({
  forward: false,
  reverse: false,
  left: false,
  right: false,
  brake: false
});

const SAVEGAME_STORAGE_KEY = "rockport.savegame.v1";
const SAVEGAME_SCHEMA_VERSION = 1;

const isNodeEnvironment =
  typeof process !== "undefined" && process.versions && process.versions.node;
let carVerificationManager = null;

function cloneCarConfig(config) {
  if (!config || typeof config !== "object") {
    return {};
  }
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(config);
    } catch (error) {
      // Fallback below if structuredClone fails (e.g., due to functions in object).
    }
  }
  return JSON.parse(JSON.stringify(config));
}

function getSaveStorage() {
  try {
    if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (_error) {
    // Ignore storage access errors (e.g., privacy modes).
  }
  return null;
}

function readSavedGame() {
  const storage = getSaveStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(SAVEGAME_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    if (parsed.version && parsed.version !== SAVEGAME_SCHEMA_VERSION) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to read saved game:", error);
    return null;
  }
}

function writeSavedGame(payload) {
  const storage = getSaveStorage();
  if (!storage) {
    return false;
  }
  try {
    const data = {
      ...payload,
      version: SAVEGAME_SCHEMA_VERSION
    };
    storage.setItem(SAVEGAME_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.warn("Failed to persist saved game:", error);
    return false;
  }
}

function clearSavedGame() {
  const storage = getSaveStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(SAVEGAME_STORAGE_KEY);
    return true;
  } catch (error) {
    console.warn("Failed to clear saved game:", error);
    return false;
  }
}

function formatSaveTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_error) {
    return null;
  }
}

const WORLD_SEED = 0x6ac5d;

const IMAGE_SOURCES = {
  tile_grass: "assets/tile_grass.png",
  tile_road: "assets/tile_road.png",
  tile_road_vertical: "assets/tile_road_vertical.png",
  tile_intersection: "assets/tile_intersection.png",
  tile_water: "assets/tile_water.png",
  building_apartment: "assets/building_apartment.png",
  building_diner: "assets/building_diner.png",
  building_factory: "assets/building_factory.png",
  building_hospital: "assets/building_hospital.png",
  // Car sprites (multiple styles). Use main assets folder under `assets/Car Sprites`.
  car_default: "assets/Car Sprites/Ferrari.png",
  car_Ferrari: "assets/Car Sprites/Ferrari.png",
  car_Porsche: "assets/Car Sprites/Porsche.png",
  car_Lamborghini: "assets/Car Sprites/Lamborgini.png",
  car_F1: "assets/Car Sprites/F1.png",
  car_Exotic: "assets/Car Sprites/Exotic.png",
  car_Classic_Car: "assets/Car Sprites/Classic Car.png",
  car_Classic_Racecar: "assets/Car Sprites/Classic Racecar.png",
  car_Modern_Muscle: "assets/Car Sprites/Modern Muscle.png",
  car_Retro_Muscle: "assets/Car Sprites/Retro Muscle.png",
  car_Sedan: "assets/Car Sprites/Sedan.png",
  car_Truck: "assets/Car Sprites/Truck.png",
  car_Police_Car: "assets/Car Sprites/Police Car.png",
  car_Hatchback: "assets/Car Sprites/Hatchback.png",
  car_Modern_Corvette: "assets/Car Sprites/Modern Corvette.png",
  car_Retro_Mustang: "assets/Car Sprites/Retro Mustang.png",
  player: "assets/player.png"
};

const TILESET = {
  W: { baseSprite: "tile_water", solid: true, color: "#0f172a" },
  G: { baseSprite: "tile_grass", solid: false, color: "#1b5e20" },
  R: { baseSprite: "tile_road", solid: false, color: "#3b3f46" },
  V: { baseSprite: "tile_road_vertical", solid: false, color: "#3b3f46" },
  I: { baseSprite: "tile_intersection", solid: false, color: "#3b3f46" },
  S: {
    baseSprite: "tile_intersection",
    solid: false,
    start: true,
    startAngle: 0
  },
  B: {
    baseSprite: "tile_grass",
    overlaySprite: "building_apartment",
    solid: true,
    collider: { width: 26, height: 52 }
  },
  D: {
    baseSprite: "tile_grass",
    overlaySprite: "building_diner",
    solid: true,
    collider: { width: 49, height: 26 }
  },
  F: {
    baseSprite: "tile_grass",
    overlaySprite: "building_factory",
    solid: true,
    collider: { width: 51, height: 45 }
  },
  H: {
    baseSprite: "tile_grass",
    overlaySprite: "building_hospital",
    solid: true,
    collider: { width: 52, height: 51 }
  }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MIN_ROAD_LENGTH = 5;
const CELL_SIZE = 96;
const BUILDING_CODES = ["B", "D", "F", "H"];
const ZONE_SIZE = 64;
const CITY_THRESHOLD = 64; // out of 256, ~25% city

function mod(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function hashCoordinates(x, y) {
  let hash = x * 374761393 + y * 668265263 + WORLD_SEED * 1597334677;
  hash = (hash ^ (hash >> 13)) >>> 0;
  return hash;
}

function getZone(x, y) {
  const regionX = Math.floor(x / ZONE_SIZE);
  const regionY = Math.floor(y / ZONE_SIZE);
  if (regionX === 0 && regionY === 0) {
    return "country";
  }
  const hash = hashCoordinates(regionX, regionY) & 0xff;
  return hash < CITY_THRESHOLD ? "city" : "country";
}

function clampToRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function chooseBuildingCode(x, y, zone) {
  const hash = hashCoordinates(x, y);
  const chanceMask = zone === "city" ? 0x3 : 0xf;
  const threshold = zone === "city" ? 2 : 1;
  if ((hash & chanceMask) < threshold) {
    return null;
  }
  return BUILDING_CODES[hash % BUILDING_CODES.length];
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (event) => reject(event.error || new Error(`Failed to load ${url}`)));
    img.src = url;
  });
}

async function loadImages(sources) {
  const entries = await Promise.all(
    Object.entries(sources).map(async ([key, path]) => {
      const image = await loadImage(path);
      return [key, image];
    })
  );

  return Object.fromEntries(entries);
}

const CAR_CATALOG = Array.isArray(globalThis.RockportCarCatalog)
  ? [...globalThis.RockportCarCatalog]
  : [];

function ensureGearRatios(ratios) {
  if (!Array.isArray(ratios) || ratios.length === 0) {
    return defaultCarConfig().gearRatios.slice();
  }
  if (ratios[0] !== 0) {
    return [0, ...ratios];
  }
  return ratios.slice();
}

// Heuristic to pick the most fitting car sprite key for a given car spec.
// Returns one of the keys added into IMAGE_SOURCES (e.g. 'car_Ferrari', 'car_Modern_Muscle').
function chooseCarSprite(carSpec) {
  if (!carSpec) return "car_default";
  const make = String(carSpec.make || "").toLowerCase();
  const model = String(carSpec.model || "").toLowerCase();
  const year = Number(carSpec.year) || 0;
  const specs = carSpec.specs || carSpec;
  const hp = Number(specs.horsepower) || 0;
  const downforce = Number(specs.downforceCoefficient) || 0;
  // Brand-specific direct mappings
  if (make.includes("ferrari")) return "car_Ferrari";
  if (make.includes("porsche")) return "car_Porsche";
  if (make.includes("lamborghini") || make.includes("lamborgini")) return "car_Lamborghini";
  if (make.includes("bugatti") || make.includes("pagani") || make.includes("koenigsegg")) return "car_Exotic";

  // Corvettes -> dedicated Corvette sprite when available (catch early so concepts with high downforce don't become F1)
  if (make.includes("chevrolet") && model.includes("corvette")) {
    return year >= 1997 ? "car_Modern_Corvette" : "car_Classic_Car";
  }

  // Formula / open-wheel / very high-downforce race cars -> F1
  if (model.includes("f1") || downforce > 1.8 || /indianapolis|indy|formula/.test(model)) return "car_F1";

  // Corvettes -> dedicated Corvette sprite when available
  if (make.includes("chevrolet") && model.includes("corvette")) {
    // Treat Corvettes from 1997 onward as 'modern' (C5 and later)
    return year >= 1997 ? "car_Modern_Corvette" : "car_Classic_Car";
  }

  // Mustangs -> retro mustang for classics, modern muscle for newer
  if (make.includes("ford") && model.includes("mustang")) {
    return year < 1990 ? "car_Retro_Mustang" : year < 2018 ? "car_Modern_Muscle" : "car_Modern_Muscle";
  }

  // General muscle cars (Camaro, Challenger, Charger, etc.)
  const muscleModelHints = ["camaro", "challenger", "charger", "corvette", "mustang", "gt500", "gt500"];
  if (muscleModelHints.some((h) => model.includes(h)) || ["dodge", "pontiac", "plymouth", "buick"].some((m) => make.includes(m))) {
    return year >= 1990 ? "car_Modern_Muscle" : "car_Retro_Muscle";
  }

  // Hatchbacks and compact cars
  if (model.includes("hatch") || model.includes("golf") || model.includes("focus") || make.includes("volkswagen")) {
    return "car_Hatchback";
  }

  // Sedans / everyday cars
  const sedanMakes = ["acura", "audi", "bmw", "cadillac", "mercedes", "volkswagen", "toyota", "honda"];
  if (sedanMakes.some((m) => make.includes(m)) && !model.includes("gt") && hp < 500) {
    return "car_Sedan";
  }

  // Police / government vehicles (explicit match by model or make)
  if (model.includes("police") || make.includes("police")) return "car_Police_Car";

  // Truck / pickup detection: match common truck/pickup keywords or heavy mass
  const massKg = Number(specs.massKg ?? specs.mass ?? 0) || 0;
  const truckHints = [
    "truck",
    "pickup",
    "pick-up",
    "f150",
    "f-150",
    "silverado",
    "sierra",
    "ram",
    "tundra",
    "hilux",
    "ranger",
    "navara",
    "lorry"
  ];
  if (truckHints.some((h) => model.includes(h) || make.includes(h)) || massKg >= 2200) {
    return "car_Truck";
  }

  // High horsepower or exotic-sounding models -> Exotic
  if (hp >= 800 || /zenvo|rimac|lotus|apollo|venom/.test(make + " " + model)) return "car_Exotic";

  // Fallbacks
  if (hp >= 600) return "car_Exotic";
  return "car_default";
}

function normalizeGripInput(input) {
  if (input == null) {
    return null;
  }
  if (Array.isArray(input)) {
    const values = input
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return values.length > 0 ? values : null;
  }
  if (typeof input === "string") {
    const values = input
      .split(/[,;|]/)
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value));
    return values.length > 0 ? values : null;
  }
  const num = Number(input);
  return Number.isFinite(num) ? [num] : null;
}

function ensureGripArray(values, fallbackArray, fallbackFactor) {
  const normalizedValues = normalizeGripInput(values);
  if (normalizedValues && normalizedValues.length >= 4) {
    return normalizedValues.slice(0, 4);
  }
  if (normalizedValues && normalizedValues.length > 0) {
    return [0, 1, 2, 3].map((index) => normalizedValues[index % normalizedValues.length]);
  }
  const normalizedFallback = normalizeGripInput(fallbackArray);
  if (normalizedFallback && normalizedFallback.length >= 4) {
    return normalizedFallback.slice(0, 4);
  }
  if (normalizedFallback && normalizedFallback.length > 0) {
    return [0, 1, 2, 3].map((index) => normalizedFallback[index % normalizedFallback.length]);
  }
  if (Array.isArray(fallbackArray) && fallbackArray.length === 0) {
    return undefined;
  }
  if (Number.isFinite(fallbackFactor) && fallbackFactor > 0 && normalizedValues && normalizedValues.length > 0) {
    return normalizedValues.map((value) => value * fallbackFactor);
  }
  if (Number.isFinite(fallbackFactor) && fallbackFactor > 0) {
    return undefined;
  }
  return undefined;
}

function computeBrakeHorsepower(horsepower) {
  if (!Number.isFinite(horsepower)) {
    return horsepower;
  }
  return horsepower * 0.82;
}

function computeFallbackBrakeTorque(config) {
  const wheelRadius = config.wheelRadiusM ?? defaultCarConfig().wheelRadiusM ?? 0.3;
  const brakeHp = config.brakeHorsepower ?? computeBrakeHorsepower(config.horsepower ?? defaultCarConfig().horsepower);
  const brakeBiasFront = config.brakeBiasFront ?? 0.6;
  const totalForce = (brakeHp * 745.7) / 30;
  const frontForce = totalForce * brakeBiasFront;
  const rearForce = totalForce - frontForce;
  const frontTorque = (frontForce / 2) * wheelRadius;
  const rearTorque = (rearForce / 2) * wheelRadius;
  return [frontTorque, frontTorque, rearTorque, rearTorque];
}

function createCarConfigFromSpec(spec = {}, context = {}) {
  const base = defaultCarConfig();
  if (!spec) {
    return base;
  }

  const baseLongGrips = Array.isArray(base.tireGrips) ? base.tireGrips : defaultCarConfig().tireGrips;
  const baseLatGrips =
    Array.isArray(base.tireLateralGrips) && base.tireLateralGrips?.length
      ? base.tireLateralGrips
      : null;
  const baseLatFactor = base.tireLateralGripFactor ?? 1.12;

  const tireGrips = ensureGripArray(
    spec.tireGrips ?? spec.tireGripLong ?? spec.tireGripLongitudinal,
    baseLongGrips
  ) ?? baseLongGrips.slice();

  const tireLateralInput =
    spec.tireGripLat ??
    spec.tireGripLateral ??
    spec.tireGripSide ??
    spec.tireGripLatitudinal;
  const tireLateralGrips =
    ensureGripArray(
      tireLateralInput,
      baseLatGrips ?? tireGrips.map((value) => value * baseLatFactor),
      spec.tireLateralGripFactor ?? baseLatFactor
    ) ?? tireGrips.map((value) => value * (spec.tireLateralGripFactor ?? baseLatFactor));

  const config = {
    ...base,
    massKg: spec.massKg ?? base.massKg,
    driveType: spec.driveType ?? base.driveType,
    gearRatios: ensureGearRatios(spec.gearRatios),
    finalDriveRatio: spec.finalDrive ?? base.finalDriveRatio,
    horsepower: spec.horsepower ?? base.horsepower,
    peakTorqueNm: spec.torqueNm ?? base.peakTorqueNm,
    brakeHorsepower: spec.brakeHorsepower ?? computeBrakeHorsepower(spec.horsepower ?? base.horsepower),
    dragCoefficient: spec.dragCoefficient ?? base.dragCoefficient,
    downforceCoefficient: spec.downforceCoefficient ?? base.downforceCoefficient,
    frontalAreaM2: spec.frontalAreaM2 ?? base.frontalAreaM2,
    wheelRadiusM: spec.wheelRadiusM ?? base.wheelRadiusM,
    tireGrips,
    tireLateralGrips,
    tireLateralGripFactor: spec.tireLateralGripFactor ?? baseLatFactor,
    wheelbaseM: spec.wheelbaseM ?? base.wheelbaseM,
    cgHeightM: spec.cgHeightM ?? base.cgHeightM,
    trackWidthM: spec.trackWidthM ?? base.trackWidthM,
    frontWeightDistribution: spec.frontWeightDistribution ?? base.frontWeightDistribution,
    drivetrainEfficiency: spec.drivetrainEfficiency ?? base.drivetrainEfficiency,
    rollingResistanceCoeff: spec.rollingResistanceCoeff ?? base.rollingResistanceCoeff,
    revLimiterRpm: spec.revLimiterRpm ?? base.revLimiterRpm ?? 7000,
    brakeBiasFront: spec.brakeBiasFront ?? base.brakeBiasFront ?? 0.6
  };

  // Apply any per-spec local calibration overrides (hand-tuned values stored in the spec)
  if (spec && typeof spec === "object" && spec.calibrationOverrides && typeof spec.calibrationOverrides === "object") {
    const localKeys = ["dragCoefficient", "rollingResistanceCoeff", "drivetrainEfficiency"];
    for (const key of localKeys) {
      if (Object.prototype.hasOwnProperty.call(spec.calibrationOverrides, key)) {
        const v = spec.calibrationOverrides[key];
        const num = Number(v);
        if (Number.isFinite(num)) {
          config[key] = num;
        }
      }
    }
  }

  config.brakeTorquePerWheelNm =
    ensureGripArray(
      spec.brakeTorquePerWheelNm ??
        spec.brakeTorquePerWheel ??
        spec.brakeTorque ??
        spec.brakeTorqueNm,
      base.brakeTorquePerWheelNm
    ) ?? computeFallbackBrakeTorque(config);

  if (context.applyOverrides !== false && carVerificationManager) {
    const potentialId = context.carId ?? spec?.carId ?? spec?.id ?? context?.carSpec?.id;
    if (potentialId) {
      const overrides = carVerificationManager.getOverrides(potentialId);
      if (overrides && typeof overrides === "object") {
        const overrideKeys = ["dragCoefficient", "rollingResistanceCoeff", "drivetrainEfficiency"];
        for (const key of overrideKeys) {
          if (Object.prototype.hasOwnProperty.call(overrides, key)) {
            const value = overrides[key];
            if (Number.isFinite(value)) {
              config[key] = value;
            }
          }
        }
      }
    }
  }

  return config;
}

function formatCarLabel(car) {
  if (!car) {
    return "-";
  }
  const parts = [
    car.year ? String(car.year) : null,
    car.make,
    car.model,
    car.variant ? `(${car.variant})` : null
  ].filter(Boolean);
  return parts.join(" ");
}

function buildCarSummary(car) {
  if (!car || !car.specs) {
    return "Select a car to view performance details.";
  }
  const spec = car.specs;
  const hp = spec.horsepower ?? "—";
  const torque = spec.torqueNm ?? "—";
  const mass = spec.massKg ?? "—";
  const drive = spec.driveType ?? "—";
  return `${formatCarLabel(car)} — ${drive}, ${hp} hp, ${torque} Nm, ${mass} kg.`;
}

CAR_CATALOG.sort((a, b) => formatCarLabel(a).localeCompare(formatCarLabel(b)));

const CAR_VERIFICATION_VERSION = 1;

class CarVerificationManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey ?? "rockport.verification.v1";
    this.version = options.version ?? CAR_VERIFICATION_VERSION;
    this.records = new Map();
    this.overrides = new Map();
    this.initialized = false;
    this.logger = options.logger ?? console;
    this.fs = null;
    this.path = null;
    this.specFilePath = null;
    if (isNodeEnvironment && typeof require === "function") {
      try {
        // eslint-disable-next-line global-require
        this.fs = require("fs");
        // eslint-disable-next-line global-require
        this.path = require("path");
        const baseDir = typeof __dirname === "string" ? __dirname : process.cwd();
        this.specFilePath = this.path.resolve(baseDir, "carSpecs.js");
      } catch (error) {
        this.fs = null;
        this.path = null;
        this.specFilePath = null;
      }
    }
  }

  applyRecordToSpec(car, record) {
    const spec = car?.specs;
    if (!spec || typeof spec !== "object") {
      return false;
    }
    const verified = Boolean(record && record.verified === true);
    const previous = spec.performanceVerified === true;
    if (previous !== verified) {
      spec.performanceVerified = verified;
      return true;
    }
    return false;
  }

  isSpecMarkedVerified(car) {
    const spec = car?.specs;
    if (!spec || typeof spec !== "object") {
      return false;
    }
    return spec.performanceVerified === true;
  }

  markSpecVerified(car, flag) {
    const spec = car?.specs;
    if (!spec || typeof spec !== "object") {
      return;
    }
    spec.performanceVerified = !!flag;
  }


  persistSpecFlag(car, flag) {
    if (!isNodeEnvironment || !this.fs || !this.specFilePath || !car || !car.id) {
      return;
    }
    try {
      const content = this.fs.readFileSync(this.specFilePath, "utf8");
      const pattern = `(id: "${escapeRegex(car.id)}"[\\s\\S]*?performanceVerified:\\s*)(true|false)(,?)`;
      const regex = new RegExp(pattern, "m");
      if (!regex.test(content)) {
        return;
      }
      const updated = content.replace(regex, `$1${flag ? "true" : "false"}$3`);
      if (updated !== content) {
        this.fs.writeFileSync(this.specFilePath, updated, "utf8");
        this.logger?.info?.(`[CarVerification] Updated carSpecs entry for ${car.id} (${flag ? "verified" : "pending"})`);
      }
    } catch (_error) {
      // ignore write failures
    }
  }


  supportsStorage() {
    try {
      return typeof globalThis.localStorage !== "undefined";
    } catch (_error) {
      return false;
    }
  }

  ensureInitializedSync() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    if (!this.supportsStorage()) {
      return;
    }
    try {
      const raw = globalThis.localStorage.getItem(this.storageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      for (const [carId, record] of Object.entries(parsed)) {
        if (!record || typeof record !== "object") {
          continue;
        }
        this.records.set(carId, record);
        if (this.isRecordCurrent(record) && record.overrides) {
          this.overrides.set(carId, record.overrides);
        }
      }
    } catch (error) {
      this.logger?.warn?.("Failed to read car verification data:", error);
      this.records.clear();
      this.overrides.clear();
    }
  }

  async ensureInitialized() {
    this.ensureInitializedSync();
  }

  isRecordCurrent(record) {
    return Boolean(record && record.version === this.version && record.verified === true);
  }

  getOverrides(carId) {
    if (!carId) {
      return null;
    }
    this.ensureInitializedSync();
    return this.overrides.get(carId) ?? null;
  }

  async verifyAllCars(cars = [], options = {}) {
    this.ensureInitializedSync();
    if (!Array.isArray(cars) || cars.length === 0) {
      return;
    }

    const visualizer = options?.visualizer ?? null;
    const limit = Number.isFinite(options?.limit)
      ? Math.max(0, Math.floor(options.limit))
      : null;
    // Per-car calibration timeout (ms) and max iterations for more-aggressive tuning
    const perCarTimeoutMs = Number.isFinite(options?.perCarTimeoutMs)
      ? Math.max(0, Math.floor(options.perCarTimeoutMs))
      : 120000; // default 2 minutes
    const maxIterations = Number.isFinite(options?.maxIterations)
      ? Math.max(1, Math.floor(options.maxIterations))
      : 12; // increase default iteration budget from 5 to 12

    if (limit !== null) {
      this.logger?.info?.(`[CarVerification] Limiting calibration to ${limit} vehicles for this run.`);
    }

    const pending = [];
    let changed = false;
    for (const car of cars) {
      if (!car || !car.id) {
        continue;
      }
      const existing = this.records.get(car.id);
      const specIsVerified = this.isSpecMarkedVerified(car);
      const specUpdatedFromRecord = existing ? this.applyRecordToSpec(car, existing) : false;

      if (this.isRecordCurrent(existing) && specIsVerified) {
        if (specUpdatedFromRecord) {
          changed = true;
        }
        if (existing.overrides) {
          this.overrides.set(car.id, existing.overrides);
        } else {
          this.overrides.delete(car.id);
        }
        continue;
      }

      if (specIsVerified) {
        const spec = car?.specs ?? {};
        const targets = this.extractTargets(spec);
        const record = {
          version: this.version,
          verified: true,
          overrides: existing?.overrides ?? null,
          measured: existing?.measured ?? null,
          target: existing?.target ?? targets,
          iterations: existing?.iterations ?? 0,
          updatedAt: Date.now(),
          note: "Marked verified via CarSpecs performance flag."
        };
        this.records.set(car.id, record);
        if (record.overrides) {
          this.overrides.set(car.id, record.overrides);
        } else {
          this.overrides.delete(car.id);
        }
        this.markSpecVerified(car, true);
        this.persistSpecFlag(car, true);
        changed = true;
        continue;
      }

      pending.push(car);
      if (limit !== null && pending.length >= limit) {
        break;
      }
    }

    if (pending.length === 0) {
      if (changed) {
        this.persist();
      }
      return;
    }

    this.logger?.info?.(
      `[CarVerification] Calibrating ${pending.length} unverified car${pending.length === 1 ? "" : "s"} on the blank test track...`
    );

    let processed = 0;
    const total = pending.length;
    for (const car of pending) {
      processed += 1;
      const label = formatCarLabel(car) || car.id || "unknown";
      this.logger?.info?.(
        `[CarVerification] (${processed}/${total}) verifying ${label}...`
      );
      try {
        const record = this.runCalibration(car, {
          timeoutMs: perCarTimeoutMs,
          maxIterations: maxIterations
        });

        // If calibration timed out or failed to converge, record.verified will be false.
        if (!record || record.verified !== true) {
          this.records.set(car.id, record || {
            version: this.version,
            verified: false,
            error: "Calibration failed or timed out"
          });
          this.markSpecVerified(car, false);
          this.persistSpecFlag(car, false);
          this.logger?.warn?.(`[CarVerification] ${label} left unverified: ${record?.note ?? "timeout/failure"}`);
          changed = true;
          continue;
        }

        const playbackSamples = record.samples ?? null;
        const calibratedConfig =
          visualizer && record.calibratedConfig
            ? cloneCarConfig(record.calibratedConfig)
            : null;
        if (visualizer && playbackSamples) {
          try {
            await visualizer.play({
              car,
              record,
              calibratedConfig
            });
          } catch (visualError) {
            this.logger?.warn?.(
              `[CarVerification] Visualization failed for ${label}: ${visualError}`
            );
          }
        }
        if (record.samples) {
          delete record.samples;
        }
        if (record.calibratedConfig) {
          delete record.calibratedConfig;
        }
        this.records.set(car.id, record);
        if (record.overrides) {
          this.overrides.set(car.id, record.overrides);
        } else {
          this.overrides.delete(car.id);
        }
        this.markSpecVerified(car, true);
        this.persistSpecFlag(car, true);
        const zeroDiff =
          Number.isFinite(record?.measured?.zeroToHundredSec) &&
          Number.isFinite(record?.target?.zeroToHundredSec)
            ? Math.abs(record.measured.zeroToHundredSec - record.target.zeroToHundredSec).toFixed(2)
            : "n/a";
        const topDiff =
          Number.isFinite(record?.measured?.topSpeedKph) &&
          Number.isFinite(record?.target?.topSpeedKph)
            ? Math.abs(record.measured.topSpeedKph - record.target.topSpeedKph).toFixed(1)
            : "n/a";
        this.logger?.info?.(
          `[CarVerification] ${label} verified (Δ0-100: ${zeroDiff}s, ΔVmax: ${topDiff} km/h).`
        );
        changed = true;
      } catch (error) {
        this.logger?.error?.(`Car verification failed for ${car?.id ?? "unknown"}.`, error);
        this.records.set(car?.id ?? `error-${Date.now()}`, {
          version: this.version,
          verified: false,
          error: String(error)
        });
        this.logger?.warn?.(
          `[CarVerification] ${label} left unverified due to error: ${error}`
        );
        this.markSpecVerified(car, false);
        this.persistSpecFlag(car, false);
        changed = true;
      }

      if (limit !== null && processed >= limit) {
        break;
      }
    }

    this.persist();
  }

  runCalibration(car, options = {}) {
    const spec = car?.specs || {};
    const targets = this.extractTargets(spec);
    if (!targets) {
      this.markSpecVerified(car, true);
      return {
        version: this.version,
        verified: true,
        overrides: null,
        measured: {
          zeroToHundredSec: null,
          zeroToHundredReached: false,
          topSpeedKph: null,
          topSpeedDurationSec: 0
        },
        target: null,
        iterations: 0,
        updatedAt: Date.now(),
        note: "No performance targets provided; skipped calibration."
      };
    }
    const baseConfig = createCarConfigFromSpec(spec, {
      carId: car?.id,
      applyOverrides: false
    });
    const workingConfig = cloneCarConfig(baseConfig);

    const hasZeroToHundred = Number.isFinite(targets.zeroToHundredSec);
    const hasTopSpeed = Number.isFinite(targets.topSpeedKph);

    let measuredZero = { timeSec: null, reached: false };
    let measuredTop = { maxSpeedKph: null, durationSec: 0 };
    const zeroSamples = [];
    const topSamples = [];

    const timeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(0, Number(options.timeoutMs)) : 120000;
    const deadline = Date.now() + timeoutMs;
    const maxIterations = Number.isFinite(options?.maxIterations) ? Math.max(1, Math.floor(options.maxIterations)) : 12;

    let actualIterations = 0;
    let timedOut = false;
    for (let index = 0; index < maxIterations; index += 1) {
      actualIterations = index + 1;

      // Abort if we've exceeded wall-clock deadline
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }

      let accelClose = true;
      if (hasZeroToHundred) {
        measuredZero = this.measureZeroToHundred(workingConfig, { deadlineMs: deadline });
        accelClose = this.isWithinTolerance(
          measuredZero.timeSec,
          targets.zeroToHundredSec,
          0.04
        );
        if (!accelClose) {
          this.adjustAcceleration(workingConfig, measuredZero.timeSec, targets.zeroToHundredSec);
        }
      }
      let topClose = true;
      if (hasTopSpeed) {
        measuredTop = this.measureTopSpeed(workingConfig, { deadlineMs: deadline });
        topClose = this.isWithinTolerance(measuredTop.maxSpeedKph, targets.topSpeedKph, 0.03);
        if (!topClose) {
          this.adjustTopSpeed(workingConfig, measuredTop.maxSpeedKph, targets.topSpeedKph);
        }
      }
      if (accelClose && topClose) {
        break;
      }
    }

    // Final, more-detailed measurements (collect samples) but respect deadline
    if (hasZeroToHundred) {
      measuredZero = this.measureZeroToHundred(workingConfig, {
        collectSamples: zeroSamples,
        deadlineMs: deadline
      });
    }
    if (hasTopSpeed) {
      measuredTop = this.measureTopSpeed(workingConfig, {
        collectSamples: topSamples,
        deadlineMs: deadline
      });
    }

    const overrides = this.computeOverrides(workingConfig, baseConfig);

    return {
      version: this.version,
      verified: timedOut ? false : true,
      overrides,
      calibratedConfig: cloneCarConfig(workingConfig),
      samples: {
        zeroToHundred: zeroSamples,
        topSpeed: topSamples
      },
      measured: {
        zeroToHundredSec: measuredZero.timeSec,
        zeroToHundredReached: measuredZero.reached,
        topSpeedKph: measuredTop.maxSpeedKph,
        topSpeedDurationSec: measuredTop.durationSec
      },
      target: targets,
      iterations: actualIterations,
      updatedAt: Date.now(),
      note: timedOut ? `Calibration timed out after ${timeoutMs} ms` : undefined
    };
  }

  extractTargets(spec = {}) {
    const topSpeedKph =
      this.findNumeric(spec, ["topSpeedKph", "topSpeedKmH", "topSpeed", "vMaxKph", "vMaxKmH"]) ??
      (() => {
        const mph = this.findNumeric(spec, ["topSpeedMph", "topSpeedMPH"]);
        return Number.isFinite(mph) ? mph * 1.60934 : null;
      })();

    const zeroToHundred =
      this.findNumeric(spec, [
        "zeroToHundredSec",
        "zeroTo100Sec",
        "zeroToHundred",
        "zeroTo100",
        "zeroToHundredKmH"
      ]) ??
      (() => {
        const sixty = this.findNumeric(spec, [
          "zeroToSixtySec",
          "zeroToSixty",
          "zeroTo60Sec",
          "zeroTo60",
          "zeroToSixtyMph"
        ]);
        return Number.isFinite(sixty) ? sixty * 1.05 : null;
      })();

    if (!Number.isFinite(topSpeedKph) && !Number.isFinite(zeroToHundred)) {
      return null;
    }

    return {
      topSpeedKph: Number.isFinite(topSpeedKph) ? topSpeedKph : null,
      zeroToHundredSec: Number.isFinite(zeroToHundred) ? zeroToHundred : null
    };
  }

  findNumeric(spec, keys) {
    if (!spec || typeof spec !== "object") {
      return null;
    }
    const containers = [spec, spec.performance, spec.realWorld, spec.stats];
    for (const key of keys) {
      for (const container of containers) {
        if (!container || typeof container !== "object") {
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(container, key)) {
          continue;
        }
        const value = container[key];
        const num = Number(value);
        if (Number.isFinite(num) && num > 0) {
          return num;
        }
      }
    }
    return null;
  }

  measureZeroToHundred(config, options = {}) {
    const samples = Array.isArray(options.collectSamples) ? options.collectSamples : null;
    const sampleInterval = Number.isFinite(options.sampleInterval) ? options.sampleInterval : 0.02;
    const car = this.createTestCar(config);
    car.resetState({ position: { x: 0, y: 0 }, heading: 0 });
    if (samples) {
      samples.length = 0;
      samples.push({
        timeSec: 0,
        speedKph: 0,
        distanceM: 0,
        phase: "zeroToHundred"
      });
    }
    const dt = 1 / 200;
    const maxTime = 15;
    const deadlineMs = Number.isFinite(options.deadlineMs) ? Number(options.deadlineMs) : null;
    let time = 0;
    let previousSpeed = 0;
    let sampleTimer = 0;
    while (time < maxTime) {
      if (deadlineMs !== null && Date.now() > deadlineMs) {
        // Abort measurement early due to deadline
        if (samples) {
          const position = car.getWorldPosition();
          samples.push({
            timeSec: time,
            speedKph: car.getSpeedMetersPerSecond() * 3.6,
            distanceM: position.x / PIXELS_PER_METER,
            phase: "zeroToHundred",
            aborted: true
          });
        }
        return {
          timeSec: null,
          reached: false
        };
      }
      car.update(1, 0, 0, dt);
      time += dt;
      sampleTimer += dt;
      const speed = car.getSpeedMetersPerSecond() * 3.6;
      if (samples && sampleTimer >= sampleInterval) {
        sampleTimer = 0;
        const position = car.getWorldPosition();
        samples.push({
          timeSec: time,
          speedKph: speed,
          distanceM: position.x / PIXELS_PER_METER,
          phase: "zeroToHundred"
        });
      }
      if (speed >= 100) {
        const deltaSpeed = speed - previousSpeed;
        let crossingTime = time;
        if (deltaSpeed > 1e-6) {
          const ratio = clampToRange((100 - previousSpeed) / deltaSpeed, 0, 1);
          crossingTime = time - dt + ratio * dt;
        }
        if (samples) {
          const position = car.getWorldPosition();
          samples.push({
            timeSec: crossingTime,
            speedKph: speed,
            distanceM: position.x / PIXELS_PER_METER,
            phase: "zeroToHundred"
          });
        }
        return {
          timeSec: crossingTime,
          reached: true
        };
      }
      previousSpeed = speed;
    }
    if (samples) {
      const position = car.getWorldPosition();
      samples.push({
        timeSec: time,
        speedKph: car.getSpeedMetersPerSecond() * 3.6,
        distanceM: position.x / PIXELS_PER_METER,
        phase: "zeroToHundred"
      });
    }
    return {
      timeSec: maxTime,
      reached: false
    };
  }

  measureTopSpeed(config, options = {}) {
    const samples = Array.isArray(options.collectSamples) ? options.collectSamples : null;
    const sampleInterval = Number.isFinite(options.sampleInterval) ? options.sampleInterval : 0.04;
    const car = this.createTestCar(config);
    car.resetState({ position: { x: 0, y: 0 }, heading: 0 });
    if (samples) {
      samples.length = 0;
      samples.push({
        timeSec: 0,
        speedKph: 0,
        distanceM: 0,
        phase: "topSpeed"
      });
    }
    const dt = 1 / 200;
    const maxDuration = 160;
    const settleThreshold = 7;
    const deadlineMs = Number.isFinite(options.deadlineMs) ? Number(options.deadlineMs) : null;
    let time = 0;
    let maxSpeed = 0;
    let stableTime = 0;
    let sampleTimer = 0;
    while (time < maxDuration) {
      if (deadlineMs !== null && Date.now() > deadlineMs) {
        // Abort measurement early due to deadline
        if (samples) {
          const position = car.getWorldPosition();
          samples.push({
            timeSec: time,
            speedKph: car.getSpeedMetersPerSecond() * 3.6,
            distanceM: position.x / PIXELS_PER_METER,
            phase: "topSpeed",
            aborted: true
          });
        }
        return {
          maxSpeedKph: maxSpeed,
          durationSec: time
        };
      }
      car.update(1, 0, 0, dt);
      time += dt;
      sampleTimer += dt;
      const speed = car.getSpeedMetersPerSecond() * 3.6;
      if (samples && sampleTimer >= sampleInterval) {
        sampleTimer = 0;
        const position = car.getWorldPosition();
        samples.push({
          timeSec: time,
          speedKph: speed,
          distanceM: position.x / PIXELS_PER_METER,
          phase: "topSpeed"
        });
      }
      if (speed > maxSpeed + 0.05) {
        maxSpeed = speed;
        stableTime = 0;
      } else if (Math.abs(speed - maxSpeed) < 0.1) {
        stableTime += dt;
      } else {
        stableTime += dt * 0.25;
      }
      if (time > 5 && stableTime >= settleThreshold) {
        break;
      }
    }
    if (samples) {
      const position = car.getWorldPosition();
      samples.push({
        timeSec: time,
        speedKph: car.getSpeedMetersPerSecond() * 3.6,
        distanceM: position.x / PIXELS_PER_METER,
        phase: "topSpeed"
      });
    }
    return {
      maxSpeedKph: maxSpeed,
      durationSec: time
    };
  }

  adjustAcceleration(config, measuredSec, targetSec) {
    if (
      !Number.isFinite(measuredSec) ||
      !Number.isFinite(targetSec) ||
      measuredSec <= 0 ||
      targetSec <= 0
    ) {
      return;
    }
    const ratio = clampToRange(measuredSec / targetSec, 0.25, 4);
    const desiredEfficiency = clampToRange(
      (config.drivetrainEfficiency ?? defaultCarConfig().drivetrainEfficiency) /
        Math.pow(ratio, 0.92),
      0.6,
      1
    );
    config.drivetrainEfficiency = this.mix(
      config.drivetrainEfficiency ?? desiredEfficiency,
      desiredEfficiency,
      0.55
    );

    const desiredRolling = clampToRange(
      (config.rollingResistanceCoeff ?? defaultCarConfig().rollingResistanceCoeff) *
        (1 + (ratio - 1) * 0.45),
      0.0045,
      0.03
    );
    config.rollingResistanceCoeff = this.mix(
      config.rollingResistanceCoeff ?? desiredRolling,
      desiredRolling,
      0.35
    );
  }

  adjustTopSpeed(config, measuredKph, targetKph) {
    if (
      !Number.isFinite(measuredKph) ||
      !Number.isFinite(targetKph) ||
      measuredKph <= 0 ||
      targetKph <= 0
    ) {
      return;
    }
    const ratio = clampToRange(measuredKph / targetKph, 0.5, 1.6);
    const desiredDrag = clampToRange(
      (config.dragCoefficient ?? defaultCarConfig().dragCoefficient) * ratio * ratio,
      0.16,
      0.9
    );
    config.dragCoefficient = this.mix(
      config.dragCoefficient ?? desiredDrag,
      desiredDrag,
      0.6
    );

    const desiredEfficiency = clampToRange(
      (config.drivetrainEfficiency ?? defaultCarConfig().drivetrainEfficiency) /
        Math.pow(ratio, 0.35),
      0.6,
      1
    );
    config.drivetrainEfficiency = this.mix(
      config.drivetrainEfficiency ?? desiredEfficiency,
      desiredEfficiency,
      0.25
    );

    const desiredRolling = clampToRange(
      (config.rollingResistanceCoeff ?? defaultCarConfig().rollingResistanceCoeff) *
        (1 + (ratio - 1) * 0.25),
      0.0045,
      0.03
    );
    config.rollingResistanceCoeff = this.mix(
      config.rollingResistanceCoeff ?? desiredRolling,
      desiredRolling,
      0.2
    );
  }

  isWithinTolerance(current, target, toleranceFraction) {
    if (
      !Number.isFinite(current) ||
      !Number.isFinite(target) ||
      !Number.isFinite(toleranceFraction) ||
      target === 0
    ) {
      return false;
    }
    const normalized = Math.abs(current - target) / Math.abs(target);
    return normalized <= Math.abs(toleranceFraction);
  }

  mix(current, target, factor) {
    const alpha = clampToRange(Number.isFinite(factor) ? factor : 0.5, 0, 1);
    const currentValue = Number.isFinite(current) ? current : target;
    return currentValue * (1 - alpha) + target * alpha;
  }

  computeOverrides(config, baseConfig) {
    const keys = ["dragCoefficient", "rollingResistanceCoeff", "drivetrainEfficiency"];
    const overrides = {};
    let changed = false;
    for (const key of keys) {
      const nextValue = config[key];
      if (!Number.isFinite(nextValue)) {
        continue;
      }
      const baseValue = baseConfig[key];
      if (Number.isFinite(baseValue) && Math.abs(nextValue - baseValue) <= 1e-4) {
        continue;
      }
      overrides[key] = Number(nextValue.toFixed(5));
      config[key] = overrides[key];
      changed = true;
    }
    return changed ? overrides : null;
  }

  persist() {
    if (!this.supportsStorage()) {
      return;
    }
    const payload = {};
    for (const [carId, record] of this.records.entries()) {
      payload[carId] = record;
    }
    try {
      globalThis.localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch (error) {
      this.logger?.warn?.("Failed to persist car verification data:", error);
    }
  }

  createTestCar(config) {
    // Verification runs inside a blank environment with no obstacles to ensure
    // consistent measurements of straight-line performance.
    return new PhysicsCar(config, {
      pixelsPerMeter: PIXELS_PER_METER,
      position: { x: 0, y: 0 },
      heading: 0
    });
  }
}

carVerificationManager = new CarVerificationManager();

class CalibrationVisualizer {
  constructor(canvas, context, assets) {
    this.canvas = canvas;
    this.ctx = context;
    this.assets = assets;
    this.active = false;
    this.padding = 96;
    this.backgroundColor = "#050914";
    this.trackColor = "#1e293b";
    this.progressTrackColor = "rgba(148, 163, 184, 0.35)";
    this.progressFillColor = "#38bdf8";
    this.textColor = "#e2e8f0";
    this.secondaryTextColor = "#94a3b8";
    this.spriteScale = 96;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  async play({ car, record, calibratedConfig }) {
    if (!car || !record) {
      return;
    }
    const samples = record.samples ?? {};
    const zeroSamples = Array.isArray(samples.zeroToHundred) ? samples.zeroToHundred : [];
    const topSamples = Array.isArray(samples.topSpeed) ? samples.topSpeed : [];
    const carLabel = formatCarLabel(car) || "Unknown vehicle";
    const spriteKey = chooseCarSprite(car);
    const sprite =
      this.assets[spriteKey] ||
      this.assets.car_default ||
      this.assets.player ||
      null;

    this.active = true;

    const zeroTarget = Number.isFinite(record.target?.zeroToHundredSec)
      ? record.target.zeroToHundredSec
      : null;
    const zeroActual = Number.isFinite(record.measured?.zeroToHundredSec)
      ? record.measured.zeroToHundredSec
      : null;
    const topTarget = Number.isFinite(record.target?.topSpeedKph)
      ? record.target.topSpeedKph
      : null;
    const topActual = Number.isFinite(record.measured?.topSpeedKph)
      ? record.measured.topSpeedKph
      : null;

    if (zeroSamples.length > 0) {
      const zeroSubtitleParts = [];
      if (zeroTarget != null) zeroSubtitleParts.push(`Target ${zeroTarget.toFixed(2)}s`);
      if (zeroActual != null) zeroSubtitleParts.push(`Result ${zeroActual.toFixed(2)}s`);
      await this.playPhase(zeroSamples, {
        title: `${carLabel} · 0-100 km/h`,
        subtitle: zeroSubtitleParts.join("  •  "),
        sprite,
        highlightSpeed: true
      });
      await this.wait(350);
    }

    if (topSamples.length > 0) {
      const topSubtitleParts = [];
      if (topTarget != null) topSubtitleParts.push(`Target ${topTarget.toFixed(1)} km/h`);
      if (topActual != null) topSubtitleParts.push(`Result ${topActual.toFixed(1)} km/h`);
      await this.playPhase(topSamples, {
        title: `${carLabel} · Top Speed`,
        subtitle: topSubtitleParts.join("  •  "),
        sprite,
        highlightSpeed: true
      });
      await this.wait(350);
    }

    await this.showSummary(carLabel, record, calibratedConfig);
    this.clear();
    this.active = false;
  }

  async playPhase(samples, options = {}) {
    if (!samples || samples.length === 0) {
      return;
    }
    const totalTime = samples[samples.length - 1].timeSec || 1;
    const playbackMs = Math.max(1600, Math.min(6000, totalTime * 1000 * 0.45));
    const maxDistance = samples.reduce(
      (max, sample) => Math.max(max, Number.isFinite(sample.distanceM) ? sample.distanceM : max),
      0
    );
    const usableWidth = Math.max(120, this.canvas.width - this.padding * 2);
    const distanceScale = maxDistance > 0 ? usableWidth / maxDistance : 1;
    const sprite = options.sprite ?? null;
    const title = options.title ?? "";
    const subtitle = options.subtitle ?? "";
    const start = await this.nextFrame();

    return new Promise((resolve) => {
      const step = (timestamp) => {
        if (!this.active) {
          resolve();
          return;
        }
        const elapsed = timestamp - start;
        const progress = clampToRange(elapsed / playbackMs, 0, 1);
        const targetTime = progress * totalTime;
        const sample = this.sampleAtTime(samples, targetTime);
        this.drawFrame({
          sample,
          samples,
          sprite,
          progress,
          title,
          subtitle,
          distanceScale,
          maxDistance
        });
        if (progress >= 1) {
          setTimeout(resolve, 200);
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }

  drawFrame({
    sample,
    sprite,
    progress,
    title,
    subtitle,
    distanceScale,
    maxDistance
  }) {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.save();
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    const trackY = height * 0.6;
    const trackStart = this.padding;
    const trackEnd = width - this.padding;

    ctx.strokeStyle = this.trackColor;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackStart, trackY);
    ctx.lineTo(trackEnd, trackY);
    ctx.stroke();

    let distanceM = Number.isFinite(sample?.distanceM) ? sample.distanceM : 0;
    distanceM = clampToRange(distanceM, 0, Math.max(maxDistance, 1));
    const carX = trackStart + distanceM * distanceScale;
    const carY = trackY;

    if (sprite instanceof HTMLImageElement) {
      const renderWidth = this.spriteScale;
      const aspect = sprite.width > 0 ? sprite.height / sprite.width : 0.5;
      const renderHeight = renderWidth * aspect;
      ctx.drawImage(
        sprite,
        carX - renderWidth / 2,
        carY - renderHeight / 2,
        renderWidth,
        renderHeight
      );
    } else {
      ctx.fillStyle = "#f97316";
      ctx.fillRect(carX - 20, carY - 10, 40, 20);
    }

    ctx.fillStyle = this.textColor;
    ctx.font = "700 28px 'Segoe UI', sans-serif";
    ctx.fillText(title, this.padding, 64);
    ctx.font = "400 18px 'Segoe UI', sans-serif";
    ctx.fillStyle = this.secondaryTextColor;
    if (subtitle) {
      ctx.fillText(subtitle, this.padding, 96);
    }

    const speedText =
      sample && Number.isFinite(sample.speedKph) ? `${sample.speedKph.toFixed(1)} km/h` : "– km/h";
    ctx.font = "600 34px 'Segoe UI', sans-serif";
    ctx.fillStyle = this.textColor;
    ctx.fillText(speedText, this.padding, height * 0.42);

    const timeText =
      sample && Number.isFinite(sample.timeSec) ? `${sample.timeSec.toFixed(2)} s` : "– s";
    ctx.font = "500 20px 'Segoe UI', sans-serif";
    ctx.fillStyle = this.secondaryTextColor;
    ctx.fillText(timeText, this.padding, height * 0.47);

    const barWidth = width - this.padding * 2;
    const barHeight = 10;
    const barY = height - 80;
    ctx.fillStyle = this.progressTrackColor;
    ctx.fillRect(this.padding, barY, barWidth, barHeight);
    ctx.fillStyle = this.progressFillColor;
    ctx.fillRect(this.padding, barY, barWidth * clampToRange(progress, 0, 1), barHeight);

    ctx.restore();
  }

  async showSummary(carLabel, record, calibratedConfig) {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    const zeroActual = Number.isFinite(record.measured?.zeroToHundredSec)
      ? record.measured.zeroToHundredSec.toFixed(2)
      : "–";
    const zeroTarget = Number.isFinite(record.target?.zeroToHundredSec)
      ? record.target.zeroToHundredSec.toFixed(2)
      : "–";
    const topActual = Number.isFinite(record.measured?.topSpeedKph)
      ? record.measured.topSpeedKph.toFixed(1)
      : "–";
    const topTarget = Number.isFinite(record.target?.topSpeedKph)
      ? record.target.topSpeedKph.toFixed(1)
      : "–";

    const drivetrain = Number.isFinite(calibratedConfig?.drivetrainEfficiency)
      ? (calibratedConfig.drivetrainEfficiency * 100).toFixed(1)
      : "–";
    const drag = Number.isFinite(calibratedConfig?.dragCoefficient)
      ? calibratedConfig.dragCoefficient.toFixed(3)
      : "–";
    const rolling = Number.isFinite(calibratedConfig?.rollingResistanceCoeff)
      ? calibratedConfig.rollingResistanceCoeff.toFixed(3)
      : "–";

    ctx.save();
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = this.textColor;
    ctx.font = "700 30px 'Segoe UI', sans-serif";
    ctx.fillText(`${carLabel} calibrated`, this.padding, 120);

    ctx.font = "500 20px 'Segoe UI', sans-serif";
    ctx.fillStyle = this.secondaryTextColor;
    ctx.fillText(`0-100 km/h  Target ${zeroTarget} s   Result ${zeroActual} s`, this.padding, 170);
    ctx.fillText(`Top Speed   Target ${topTarget} km/h   Result ${topActual} km/h`, this.padding, 202);

    ctx.fillStyle = this.textColor;
    ctx.font = "600 22px 'Segoe UI', sans-serif";
    ctx.fillText("Applied tuning", this.padding, 260);
    ctx.font = "500 20px 'Segoe UI', sans-serif";
    ctx.fillStyle = this.secondaryTextColor;
    ctx.fillText(`Drag Coefficient  ${drag}`, this.padding, 298);
    ctx.fillText(`Drivetrain Efficiency  ${drivetrain}%`, this.padding, 330);
    ctx.fillText(`Rolling Resistance  ${rolling}`, this.padding, 362);

    ctx.restore();
    await this.wait(900);
  }

  sampleAtTime(samples, targetTime) {
    if (!samples || samples.length === 0) {
      return null;
    }
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (!sample || !Number.isFinite(sample.timeSec)) {
        continue;
      }
      if (sample.timeSec >= targetTime) {
        return sample;
      }
    }
    return samples[samples.length - 1];
  }

  wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  nextFrame() {
    return new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function formatNumber(value, decimals = 0) {
  return Number.isFinite(value) ? value.toFixed(decimals) : "-";
}

function formatWithUnit(value, unit, decimals = 0) {
  return Number.isFinite(value) ? `${value.toFixed(decimals)} ${unit}` : "-";
}

function formatPercent(value, decimals = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(decimals)}%` : "-";
}

function formatGearRatios(ratios) {
  if (!Array.isArray(ratios) || ratios.length <= 1) {
    return "-";
  }
  return ratios
    .slice(1)
    .map((ratio, index) => `${index + 1}: ${ratio.toFixed(2)}`)
    .join("\n");
}

function formatSourcesList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return "-";
  }
  return list.join("\n");
}

function formatGripPair(longitudinal, lateral) {
  const longText = Number.isFinite(longitudinal) ? longitudinal.toFixed(2) : "-";
  const latText = Number.isFinite(lateral) ? lateral.toFixed(2) : "-";
  if (!Number.isFinite(longitudinal) && !Number.isFinite(lateral)) {
    return "-";
  }
  return `${longText} / ${latText}`;
}

function buildSpecDisplay(config, carSpec) {
  if (!config) {
    return {};
  }
  const gearRatios = Array.isArray(config.gearRatios) ? config.gearRatios.slice() : null;
  const tireGripsLong = Array.isArray(config.tireGrips) ? config.tireGrips.slice() : [];
  const tireGripsLat =
    Array.isArray(config.tireLateralGrips) && config.tireLateralGrips.length >= 4
      ? config.tireLateralGrips.slice(0, 4)
      : tireGripsLong.map((value) => {
          const factor = Number.isFinite(config.tireLateralGripFactor)
            ? config.tireLateralGripFactor
            : 1.12;
          return value * factor;
        });
  const brakeTorquePerWheel = Array.isArray(config.brakeTorquePerWheelNm)
    ? config.brakeTorquePerWheelNm.slice(0, 4)
    : null;
  const frontBrakeTorque = brakeTorquePerWheel
    ? average(brakeTorquePerWheel.slice(0, 2))
    : null;
  const rearBrakeTorque = brakeTorquePerWheel
    ? average(brakeTorquePerWheel.slice(2, 4))
    : null;
  const frontGripsLong = tireGripsLong.slice(0, 2);
  const rearGripsLong = tireGripsLong.slice(2);
  const frontGripsLat = tireGripsLat.slice(0, 2);
  const rearGripsLat = tireGripsLat.slice(2);
  return {
    carLabel: formatCarLabel(carSpec),
    powerHp: config.horsepower ?? null,
    torqueNm: config.peakTorqueNm ?? null,
    driveType: config.driveType ?? null,
    massKg: config.massKg ?? null,
    revLimiterRpm: config.revLimiterRpm ?? null,
    brakeHorsepower: config.brakeHorsepower ?? null,
    finalDrive: config.finalDriveRatio ?? null,
    gearRatios,
    gearCount: Array.isArray(gearRatios) ? Math.max(gearRatios.length - 1, 0) : null,
    dragCoefficient: config.dragCoefficient ?? null,
    downforceCoefficient: config.downforceCoefficient ?? null,
    frontalAreaM2: config.frontalAreaM2 ?? null,
    wheelbaseM: config.wheelbaseM ?? null,
    trackWidthM: config.trackWidthM ?? null,
    cgHeightM: config.cgHeightM ?? null,
    frontWeightDistribution: config.frontWeightDistribution ?? null,
    wheelRadiusM: config.wheelRadiusM ?? null,
    tireGripFrontLong: average(frontGripsLong),
    tireGripRearLong: average(rearGripsLong),
    tireGripFrontLat: average(frontGripsLat),
    tireGripRearLat: average(rearGripsLat),
    brakeTorqueFrontNm: frontBrakeTorque,
    brakeTorqueRearNm: rearBrakeTorque,
    brakeTorquePerWheelNm: brakeTorquePerWheel,
    brakeBiasFront: config.brakeBiasFront ?? null,
    tireGripLongArray: tireGripsLong,
    tireGripLatArray: tireGripsLat,
    drivetrainEfficiency: config.drivetrainEfficiency ?? null,
    rollingResistanceCoeff: config.rollingResistanceCoeff ?? null,
    sources: Array.isArray(carSpec?.sources) ? carSpec.sources.slice() : null,
    year: carSpec?.year ?? null,
    country: carSpec?.country ?? null
  };
}

class InputManager {
  constructor() {
    this.state = {
      forward: false,
      reverse: false,
      left: false,
      right: false,
      brake: false
    };
    this.resetRequested = false;
    this.interactRequested = false;
    this.shiftUpRequested = false;
    this.shiftDownRequested = false;
    this.toggleTransmissionRequested = false;
    this.pauseToggleRequested = false;
    this.handleKey = this.handleKey.bind(this);
    window.addEventListener("keydown", this.handleKey, { passive: false });
    window.addEventListener("keyup", this.handleKey, { passive: false });
  }

  handleKey(event) {
    const pressed = event.type === "keydown";
    const handled = this.updateState(event.code, pressed);
    if (handled) {
      event.preventDefault();
    }
  }

  updateState(code, pressed) {
    switch (code) {
      case "ArrowUp":
      case "KeyW":
        this.state.forward = pressed;
        return true;
      case "ArrowDown":
      case "KeyS":
        this.state.reverse = pressed;
        return true;
      case "ArrowLeft":
      case "KeyA":
        this.state.left = pressed;
        return true;
      case "ArrowRight":
      case "KeyD":
        this.state.right = pressed;
        return true;
      case "Space":
        this.state.brake = pressed;
        return true;
      case "KeyX":
        if (pressed) {
          this.shiftUpRequested = true;
        }
        return true;
      case "KeyZ":
        if (pressed) {
          this.shiftDownRequested = true;
        }
        return true;
      case "KeyM":
        if (pressed) {
          this.toggleTransmissionRequested = true;
        }
        return true;
      case "KeyE":
        if (pressed) {
          this.interactRequested = true;
        }
        return true;
      case "KeyR":
        if (pressed) {
          this.resetRequested = true;
        }
        return true;
      case "Escape":
        if (pressed) {
          this.pauseToggleRequested = true;
        }
        return true;
      default:
        return false;
    }
  }

  consumeReset() {
    if (!this.resetRequested) {
      return false;
    }

    this.resetRequested = false;
    return true;
  }

  consumeInteract() {
    if (!this.interactRequested) {
      return false;
    }

    this.interactRequested = false;
    return true;
  }

  consumeShiftUp() {
    if (!this.shiftUpRequested) {
      return false;
    }
    this.shiftUpRequested = false;
    return true;
  }

  consumeShiftDown() {
    if (!this.shiftDownRequested) {
      return false;
    }
    this.shiftDownRequested = false;
    return true;
  }

  consumeToggleTransmission() {
    if (!this.toggleTransmissionRequested) {
      return false;
    }
    this.toggleTransmissionRequested = false;
    return true;
  }

  consumePauseToggle() {
    if (!this.pauseToggleRequested) {
      return false;
    }
    this.pauseToggleRequested = false;
    return true;
  }

  clearMovementState() {
    this.state.forward = false;
    this.state.reverse = false;
    this.state.left = false;
    this.state.right = false;
    this.state.brake = false;
  }
}

class Level {
  constructor(tileset, system) {
    this.tileset = tileset;
    this.system = system;
    this.tileCache = new Map();
    this.solidBodies = new Map();
    this.roadTiles = new Map();
    this.buildingTiles = new Set();
    this.horizontalRows = new Set();
    this.verticalColumns = new Set();
    this.roadBuildingCounts = new Map();
    this.nodes = new Map();
    this.cellNodes = new Map();
    this.generatedCells = new Set();
    this.generatedChunks = new Set();
    this.generatedEdges = new Set();
    this.pixelWidth = Infinity;
    this.pixelHeight = Infinity;
    this.bounds = {
      minX: -Infinity,
      minY: -Infinity,
      maxX: Infinity,
      maxY: Infinity
    };
    this.startPose = {
      x: TILE_SIZE / 2,
      y: TILE_SIZE / 2,
      angle: 0
    };
    this.createRootNode();
    this.initializeStarterRoads();
    this.removeBuildingsOnRoadTiles();
  }

  tileKey(x, y) {
    return `${x},${y}`;
  }

  cellKey(cx, cy) {
    return `${cx},${cy}`;
  }

  createRootNode() {
    const node = {
      key: "0,0,root",
      cx: 0,
      cy: 0,
      index: 0,
      x: 0,
      y: 0,
      priority: 0,
      zone: getZone(0, 0),
      parentKey: null
    };
    this.nodes.set(node.key, node);
    this.addNodeToCell(node);
    this.markRoadTile(node.x, node.y, null);
    return node;
  }

  initializeStarterRoads() {
    const starterLength = 16;
    this.tracePath(0, 0, starterLength, 0);
    this.tracePath(0, 0, -starterLength, 0);
    this.tracePath(0, 0, 0, starterLength);
    this.tracePath(0, 0, 0, -starterLength);

  }


  addNodeToCell(node) {
    const key = this.cellKey(node.cx, node.cy);
    const nodes = this.cellNodes.get(key) || [];
    nodes.push(node);
    this.cellNodes.set(key, nodes);
  }

  ensureInfrastructure(x, y) {
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        this.ensureCell(cx + dx, cy + dy);
      }
    }
  }

  ensureCell(cx, cy) {
    const key = this.cellKey(cx, cy);
    if (this.generatedCells.has(key)) {
      return;
    }
    this.generatedCells.add(key);

    const zone = getZone(cx * CELL_SIZE, cy * CELL_SIZE);
    const baseHash = hashCoordinates(cx * 374761393, cy * 668265263);
    const desiredNodes =
      zone === "city"
        ? 3 + (baseHash & 0x3)
        : (baseHash & 0x7) === 0
          ? 1
          : 0;

    for (let slot = 0; slot < desiredNodes; slot += 1) {
      this.ensureNode(cx, cy, slot, zone);
    }
  }

  ensureNode(cx, cy, slot, zone) {
    const nodeKey = `${cx},${cy},${slot}`;
    if (this.nodes.has(nodeKey)) {
      return this.nodes.get(nodeKey);
    }

    const seedX = cx * 91815541 + slot * 811;
    const seedY = cy * 137 + slot * 131;
    const baseHash = hashCoordinates(seedX, seedY);
    const offsetRange = zone === "city" ? CELL_SIZE / 4 : CELL_SIZE / 3;
    const ox = ((baseHash & 0xff) / 255 - 0.5) * 2 * offsetRange;
    const oy = (((baseHash >> 8) & 0xff) / 255 - 0.5) * 2 * offsetRange;
    let x = Math.round(cx * CELL_SIZE + CELL_SIZE / 2 + ox);
    let y = Math.round(cy * CELL_SIZE + CELL_SIZE / 2 + oy);

    const nearbyRow = this.findNearbyCoordinate(this.horizontalRows, y);
    if (nearbyRow !== null) {
      y = nearbyRow;
    } else {
      y = this.findClearCoordinate(this.horizontalRows, y);
    }
    const nearbyColumn = this.findNearbyCoordinate(this.verticalColumns, x);
    if (nearbyColumn !== null) {
      x = nearbyColumn;
    } else {
      x = this.findClearCoordinate(this.verticalColumns, x);
    }

    const node = {
      key: nodeKey,
      cx,
      cy,
      index: slot,
      x,
      y,
      priority: baseHash >>> 9,
      zone,
      parentKey: null
    };

    this.nodes.set(nodeKey, node);
    this.addNodeToCell(node);

    const root = this.nodes.get("0,0,root");
    if (node.key === root.key) {
      return node;
    }

    const candidateCells = [
      [cx - 1, cy],
      [cx, cy - 1],
      [cx - 1, cy - 1],
      [cx + 1, cy - 1],
      [cx - 1, cy + 1]
    ];

    const candidates = [];
    for (const [ncx, ncy] of candidateCells) {
      this.ensureCell(ncx, ncy);
      const list = this.cellNodes.get(this.cellKey(ncx, ncy));
      if (list) {
        candidates.push(...list);
      }
    }

    let parent = root;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (candidate.key === node.key) {
        continue;
      }
      if (candidate.priority > node.priority && candidate.key !== root.key) {
        continue;
      }
      const distance = Math.abs(candidate.x - node.x) + Math.abs(candidate.y - node.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        parent = candidate;
      }
    }

    node.parentKey = parent.key;
    this.connectNodes(node, parent);

    return node;
  }

  connectNodes(node, parent) {
    if (!parent) {
      return;
    }

    const edgeId = node.key < parent.key ? `${node.key}|${parent.key}` : `${parent.key}|${node.key}`;
    if (this.generatedEdges.has(edgeId)) {
      return;
    }
    this.generatedEdges.add(edgeId);

    const horizontalFirst = (hashCoordinates(node.x, parent.y) & 1) === 0;
    if (horizontalFirst) {
      if (!this.tracePath(node.x, node.y, parent.x, node.y)) {
        return;
      }
      if (!this.tracePath(parent.x, node.y, parent.x, parent.y)) {
        return;
      }
    } else {
      if (!this.tracePath(node.x, node.y, node.x, parent.y)) {
        return;
      }
      if (!this.tracePath(node.x, parent.y, parent.x, parent.y)) {
        return;
      }
    }
  }

  tracePath(fromX, fromY, toX, toY) {
    if (!this.previewPath(fromX, fromY, toX, toY)) {
      return false;
    }

    let x = fromX;
    let y = fromY;

    if (x === toX && y === toY) {
      this.markRoadTile(x, y, null);
      return true;
    }

    while (x !== toX) {
      const nextX = x + Math.sign(toX - x);
      if (!this.markRoadStep(x, y, nextX, y)) {
        return false;
      }
      x = nextX;
    }

    while (y !== toY) {
      const nextY = y + Math.sign(toY - y);
      if (!this.markRoadStep(x, y, x, nextY)) {
        return false;
      }
      y = nextY;
    }
    return true;
  }


  markRoadTile(x, y, direction) {
    const key = this.tileKey(x, y);
    this.removeBuildingAt(x, y);
    let entry = this.roadTiles.get(key);
    if (!entry) {
      entry = { connections: new Set() };
      this.roadTiles.set(key, entry);
    }
    if (direction) {
      entry.connections.add(direction);
    }
    this.tileCache.delete(key);
    this.updateOrientationSets(x, y, entry);
  }

  markRoadStep(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (dx === 0 && dy === 0) {
      this.markRoadTile(fromX, fromY, null);
      return true;
    }

    const direction = this.directionFromDelta(dx, dy);
    const opposite = this.oppositeDirection(direction);
    if (!this.canPlaceSegment(fromX, fromY, toX, toY)) {
      return false;
    }
    this.markRoadTile(fromX, fromY, direction);
    this.markRoadTile(toX, toY, opposite);
    return true;
  }

  updateOrientationSets(x, y, entry) {
    const hasHorizontal = entry.connections.has("E") || entry.connections.has("W");
    const hasVertical = entry.connections.has("N") || entry.connections.has("S");
    if (hasHorizontal) {
      this.horizontalRows.add(y);
    }
    if (hasVertical) {
      this.verticalColumns.add(x);
    }
  }

  findNearbyCoordinate(set, value) {
    if (!set || set.size === 0) {
      return null;
    }
    let nearest = null;
    let bestDistance = Infinity;
    for (const coord of set) {
      const dist = Math.abs(coord - value);
      if (dist <= 1 && dist < bestDistance) {
        bestDistance = dist;
        nearest = coord;
      }
    }
    return nearest;
  }

  findClearCoordinate(set, value) {
    let candidate = Math.round(value);
    let attempt = 0;
    while (true) {
      let tooClose = false;
      for (const coord of set) {
        if (Math.abs(coord - candidate) <= 1) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        return candidate;
      }
      const direction = attempt % 2 === 0 ? 1 : -1;
      const step = ((attempt >> 1) + 1) * 2;
      candidate = Math.round(value + direction * step);
      attempt += 1;
      if (attempt > 16) {
        return candidate;
      }
    }
  }

  hasHorizontalRoadAt(x, y) {
    const entry = this.roadTiles.get(this.tileKey(x, y));
    if (!entry) {
      return false;
    }
    return entry.connections.has("E") || entry.connections.has("W");
  }

  hasVerticalRoadAt(x, y) {
    const entry = this.roadTiles.get(this.tileKey(x, y));
    if (!entry) {
      return false;
    }
    return entry.connections.has("N") || entry.connections.has("S");
  }

  canPlaceSegment(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (dx !== 0 && dy !== 0) {
      return false;
    }

    if (dy === 0) {
      const y = fromY;
      const above = y + 1;
      const below = y - 1;
      const xPositions = [fromX, toX];
      for (const x of xPositions) {
        if (this.hasHorizontalRoadAt(x, above) || this.hasHorizontalRoadAt(x, below)) {
          return false;
        }
      }
    } else {
      const x = fromX;
      const left = x - 1;
      const right = x + 1;
      const yPositions = [fromY, toY];
      for (const y of yPositions) {
        if (this.hasVerticalRoadAt(left, y) || this.hasVerticalRoadAt(right, y)) {
          return false;
        }
      }
    }

    return true;
  }

  previewPath(fromX, fromY, toX, toY) {
    let x = fromX;
    let y = fromY;
    if (x === toX && y === toY) {
      return true;
    }

    while (x !== toX) {
      const nextX = x + Math.sign(toX - x);
      if (!this.canPlaceSegment(x, y, nextX, y)) {
        return false;
      }
      x = nextX;
    }

    while (y !== toY) {
      const nextY = y + Math.sign(toY - y);
      if (!this.canPlaceSegment(x, y, x, nextY)) {
        return false;
      }
      y = nextY;
    }

    return true;
  }

  determineRoadTileCode(x, y, entry) {
    const hasVertical = entry.connections.has("N") || entry.connections.has("S");
    const hasHorizontal = entry.connections.has("E") || entry.connections.has("W");
    if (x === 0 && y === 0) {
      return "S";
    }
    if (hasVertical && hasHorizontal) {
      return "I";
    }
    if (hasVertical) {
      return "V";
    }
    return "R";
  }

  getAdjacentRoadKeys(x, y) {
    const keys = new Set();
    const neighbors = [
      { dx: 1, dy: 0, axis: "vertical" },
      { dx: -1, dy: 0, axis: "vertical" },
      { dx: 0, dy: 1, axis: "horizontal" },
      { dx: 0, dy: -1, axis: "horizontal" }
    ];

    for (const { dx, dy, axis } of neighbors) {
      const rx = x + dx;
      const ry = y + dy;
      const entry = this.roadTiles.get(this.tileKey(rx, ry));
      if (!entry) {
        continue;
      }

      const hasHorizontal = entry.connections.has("E") || entry.connections.has("W");
      const hasVertical = entry.connections.has("N") || entry.connections.has("S");

      if (axis === "horizontal" && hasHorizontal) {
        keys.add(`H:${ry}`);
      } else if (axis === "vertical" && hasVertical) {
        keys.add(`V:${rx}`);
      }
    }

    return Array.from(keys);
  }

  removeBuildingAt(x, y) {
    const key = this.tileKey(x, y);
    let hadBuilding = this.buildingTiles.has(key);
    if (!hadBuilding) {
      const cached = this.tileCache.get(key);
      if (cached && BUILDING_CODES.includes(cached.code)) {
        hadBuilding = true;
      }
    }
    if (!hadBuilding) {
      return;
    }

    this.buildingTiles.delete(key);

    const roadKeys = this.getAdjacentRoadKeys(x, y);
    for (const roadKey of roadKeys) {
      const current = this.roadBuildingCounts.get(roadKey) || 0;
      if (current <= 1) {
        this.roadBuildingCounts.delete(roadKey);
      } else {
        this.roadBuildingCounts.set(roadKey, current - 1);
      }
    }

    const body = this.solidBodies.get(key);
    if (body) {
      this.system.remove(body);
      this.solidBodies.delete(key);
    }

    if (this.tileCache.has(key)) {
      this.tileCache.delete(key);
    }
  }

  removeBuildingsOnRoadTiles() {
    for (const key of this.roadTiles.keys()) {
      const [xStr, yStr] = key.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        this.removeBuildingAt(x, y);
      }
    }
  }

  selectBuildingCode(x, y, zone) {
    const code = chooseBuildingCode(x, y, zone);
    if (!code) {
      return null;
    }

    if (Math.abs(x) <= 2 && Math.abs(y) <= 2) {
      return null;
    }

    const roadKeys = this.getAdjacentRoadKeys(x, y);
    if (!roadKeys.length) {
      return null;
    }

    if (zone !== "city") {
      for (const key of roadKeys) {
        if ((this.roadBuildingCounts.get(key) || 0) >= 5) {
          return null;
        }
      }
    }

    for (const key of roadKeys) {
      this.roadBuildingCounts.set(key, (this.roadBuildingCounts.get(key) || 0) + 1);
    }

    return code;
  }

  findNearestRoad(x, y, minDistance = 0) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let fallback = null;
    let fallbackDistance = Number.POSITIVE_INFINITY;

    for (const key of this.roadTiles.keys()) {
      const [txStr, tyStr] = key.split(",");
      const tx = Number(txStr);
      const ty = Number(tyStr);
      const distance = Math.abs(tx - x) + Math.abs(ty - y);

      if (distance > minDistance && distance < bestDistance) {
        bestDistance = distance;
        best = { x: tx, y: ty };
      }

      if (distance < fallbackDistance) {
        fallbackDistance = distance;
        fallback = { x: tx, y: ty };
      }
    }

    if (best) {
      return best;
    }

    if (fallback) {
      return fallback;
    }

    return { x: 0, y: 0 };
  }

  hasRoadInBounds(startX, endX, startY, endY) {
    for (const key of this.roadTiles.keys()) {
      const [txStr, tyStr] = key.split(",");
      const tx = Number(txStr);
      const ty = Number(tyStr);
      if (tx >= startX && tx < endX && ty >= startY && ty < endY) {
        return true;
      }
    }
    return false;
  }

  countRoadTilesInBounds(startX, endX, startY, endY) {
    let count = 0;
    for (const key of this.roadTiles.keys()) {
      const [txStr, tyStr] = key.split(",");
      const tx = Number(txStr);
      const ty = Number(tyStr);
      if (tx >= startX && tx < endX && ty >= startY && ty < endY) {
        count += 1;
      }
    }
    return count;
  }

  ensureChunkRoad(chunkX, chunkY) {
    const key = `${chunkX},${chunkY}`;
    if (this.generatedChunks.has(key)) {
      return;
    }
    this.generatedChunks.add(key);

    const startX = chunkX * ZONE_SIZE;
    const startY = chunkY * ZONE_SIZE;
    const endX = startX + ZONE_SIZE;
    const endY = startY + ZONE_SIZE;

    const grid = this.generateChunkGrid(chunkX, chunkY, startX, startY, endX, endY);

    const rowExtend = Math.max(grid.rowSpacing, MIN_ROAD_LENGTH);
    for (const row of grid.rows) {
      this.tracePath(startX - rowExtend, row, endX + rowExtend, row);
    }

    const columnExtend = Math.max(grid.columnSpacing, MIN_ROAD_LENGTH);
    for (const column of grid.columns) {
      this.tracePath(column, startY - columnExtend, column, endY + columnExtend);
    }
  }

  generateChunkGrid(chunkX, chunkY, startX, startY, endX, endY) {
    const centerX = Math.round((startX + endX) / 2);
    const centerY = Math.round((startY + endY) / 2);
    const zone = getZone(centerX, centerY);
    const chunkSeed = hashCoordinates(chunkX, chunkY ^ WORLD_SEED);

    let rowSpacing;
    let columnSpacing;
    let rowJitter;
    let columnJitter;

    if (zone === "city") {
      rowSpacing = 8;
      columnSpacing = 8;
      rowJitter = 1;
      columnJitter = 1;
    } else {
      rowSpacing = 30;
      columnSpacing = 30;
      rowJitter = 4;
      columnJitter = 4;
    }

    const rows = this.generateGridLines(
      startY,
      endY,
      rowSpacing,
      rowJitter,
      chunkSeed ^ 0x9e3779b9
    );

    const columns = this.generateGridLines(
      startX,
      endX,
      columnSpacing,
      columnJitter,
      chunkSeed ^ 0x7f4a7c15
    );

    if (rows.length === 0) {
      rows.push(Math.round((startY + endY) / 2));
    }
    if (columns.length === 0) {
      columns.push(Math.round((startX + endX) / 2));
    }

    return {
      rows,
      columns,
      rowSpacing,
      columnSpacing
    };
  }

  generateGridLines(start, end, spacing, jitterRange, seed) {
    const lines = new Set();
    const margin = spacing * 2;
    const firstIndex = Math.floor((start - margin) / spacing);
    const lastIndex = Math.ceil((end + margin) / spacing);

    for (let idx = firstIndex; idx <= lastIndex; idx += 1) {
      const base = idx * spacing;
      let jitter = 0;
      if (jitterRange > 0) {
        const hash = hashCoordinates(idx, seed);
        jitter = (hash % (jitterRange * 2 + 1)) - jitterRange;
      }
      const coord = Math.round(base + jitter);
      if (coord >= start && coord <= end) {
        lines.add(coord);
      }
    }

    return Array.from(lines).sort((a, b) => a - b);
  }


  directionFromDelta(dx, dy) {
    if (dx === 0 && dy < 0) {
      return "N";
    }
    if (dx === 0 && dy > 0) {
      return "S";
    }
    if (dx > 0 && dy === 0) {
      return "E";
    }
    if (dx < 0 && dy === 0) {
      return "W";
    }
    throw new Error(`Unsupported direction delta (${dx}, ${dy})`);
  }

  oppositeDirection(dir) {
    switch (dir) {
      case "N":
        return "S";
      case "S":
        return "N";
      case "E":
        return "W";
      case "W":
        return "E";
      default:
        return null;
    }
  }

  getTile(x, y) {
    this.ensureChunkRoad(Math.floor(x / ZONE_SIZE), Math.floor(y / ZONE_SIZE));
    this.ensureInfrastructure(x, y);
    const key = this.tileKey(x, y);
    if (this.tileCache.has(key)) {
      return this.tileCache.get(key);
    }

    let tile;
    const road = this.roadTiles.get(key);

    if (road) {
      const code = this.determineRoadTileCode(x, y, road);
      const definition = this.tileset[code];
      tile = {
        code,
        baseSprite: definition.baseSprite || null,
        overlaySprite: definition.overlaySprite || null,
        solid: Boolean(definition.solid),
        color: definition.color || null,
        collider: null
      };
      this.buildingTiles.delete(key);
    } else {
      const zone = getZone(x, y);
      const adjacentRoad =
        this.roadTiles.has(this.tileKey(x + 1, y)) ||
        this.roadTiles.has(this.tileKey(x - 1, y)) ||
        this.roadTiles.has(this.tileKey(x, y + 1)) ||
        this.roadTiles.has(this.tileKey(x, y - 1));

      let code = "G";
      if (adjacentRoad) {
        const buildingCode = this.selectBuildingCode(x, y, zone);
        if (buildingCode) {
          code = buildingCode;
        }
      }

      const definition = this.tileset[code] || this.tileset.G;
      tile = {
        code,
        baseSprite: definition.baseSprite || null,
        overlaySprite: definition.overlaySprite || null,
        solid: Boolean(definition.solid),
        color: definition.color || null,
        collider: null
      };

      if (BUILDING_CODES.includes(code)) {
        this.buildingTiles.add(key);
      } else {
        this.buildingTiles.delete(key);
      }

      if (tile.solid && definition.collider) {
        const { width: sourceWidth, height: sourceHeight } = definition.collider;
      const maxDimension = TILE_SIZE * 0.92;
      const scale = Math.min(maxDimension / sourceWidth, maxDimension / sourceHeight);
        const width = sourceWidth * scale;
        const height = sourceHeight * scale;
        tile.collider = {
          width,
          height,
          offsetX: (TILE_SIZE - width) / 2,
          offsetY: TILE_SIZE - height
        };
        this.ensureCollider(x, y, tile);
      }
    }

    this.tileCache.set(key, tile);
    return tile;
  }

  ensureCollider(x, y, tile) {
    const key = this.tileKey(x, y);
    if (this.solidBodies.has(key)) {
      return;
    }

    const offsetX = tile.collider ? tile.collider.offsetX : 0;
    const offsetY = tile.collider ? tile.collider.offsetY : 0;
    const width = tile.collider ? tile.collider.width : TILE_SIZE;
    const height = tile.collider ? tile.collider.height : TILE_SIZE;

    const body = this.system.createBox(
      { x: x * TILE_SIZE + offsetX, y: y * TILE_SIZE + offsetY },
      width,
      height,
      { isStatic: true }
    );

    this.solidBodies.set(key, body);
  }

  draw(ctx, camera, assets) {
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    const startCol = Math.floor(camera.x / TILE_SIZE) - 1;
    const endCol = Math.ceil((camera.x + canvasWidth) / TILE_SIZE) + 1;
    const startRow = Math.floor(camera.y / TILE_SIZE) - 1;
    const endRow = Math.ceil((camera.y + canvasHeight) / TILE_SIZE) + 1;

    for (let row = startRow; row < endRow; row += 1) {
      for (let col = startCol; col < endCol; col += 1) {
        const tile = this.getTile(col, row);
        const screenX = col * TILE_SIZE - camera.x;
        const screenY = row * TILE_SIZE - camera.y;

        if (tile.baseSprite) {
          const sprite = assets[tile.baseSprite];
          if (sprite) {
            ctx.drawImage(sprite, screenX, screenY, TILE_SIZE, TILE_SIZE);
          } else {
            ctx.fillStyle = tile.color || "#1f2937";
            ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          }
        } else {
          ctx.fillStyle = tile.color || "#1f2937";
          ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        }

        if (tile.overlaySprite) {
          const overlay = assets[tile.overlaySprite];
          if (overlay) {
            const maxDimension = TILE_SIZE * 0.92;
            const scale = Math.min(
              maxDimension / overlay.width,
              maxDimension / overlay.height
            );
            const overlayWidth = overlay.width * scale;
            const overlayHeight = overlay.height * scale;
            const overlayX = screenX + (TILE_SIZE - overlayWidth) / 2;
            const overlayY = screenY + TILE_SIZE - overlayHeight;
            ctx.drawImage(overlay, overlayX, overlayY, overlayWidth, overlayHeight);
          }
        }
      }
    }
  }
}

class MiniMap {
  constructor(canvas) {
    this.canvas = canvas instanceof HTMLCanvasElement ? canvas : null;
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.chunkSize = ZONE_SIZE;
    this.scale =
      this.canvas && this.canvas.width
        ? this.canvas.width / this.chunkSize
        : 4;
    this.baseCanvas = null;
    this.baseCtx = null;
    this.prevChunkKey = null;
    this.originTileX = 0;
    this.originTileY = 0;
    if (this.canvas) {
      this.baseCanvas = document.createElement("canvas");
      this.baseCanvas.width = this.canvas.width;
      this.baseCanvas.height = this.canvas.height;
      this.baseCtx = this.baseCanvas.getContext("2d");
    }
    this.visible = true;
  }

  setVisible(visible) {
    this.visible = !!visible;
    if (this.canvas) {
      this.canvas.classList.toggle("is-hidden", !visible);
    }
  }

  update(level, worldPosition, headingRad = 0) {
    if (!this.visible || !this.ctx || !level || !worldPosition) {
      return;
    }

    const tileX = worldPosition.x / TILE_SIZE;
    const tileY = worldPosition.y / TILE_SIZE;
    const chunkX = Math.floor(tileX / this.chunkSize);
    const chunkY = Math.floor(tileY / this.chunkSize);
    const chunkKey = `${chunkX},${chunkY}`;

    if (chunkKey !== this.prevChunkKey) {
      this.drawChunk(level, chunkX, chunkY);
      this.prevChunkKey = chunkKey;
    }

    if (this.baseCanvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.baseCanvas, 0, 0);
    }

    const localTileX = tileX - this.originTileX;
    const localTileY = tileY - this.originTileY;
    const px = localTileX * this.scale;
    const py = localTileY * this.scale;
    const baseSize = Math.max(4, this.scale * 1.8);

    this.ctx.save();
    this.ctx.translate(px, py);
    this.ctx.rotate(headingRad);
    this.ctx.fillStyle = "#38bdf8";
    this.ctx.beginPath();
    this.ctx.moveTo(baseSize, 0);
    this.ctx.lineTo(-baseSize * 0.6, baseSize * 0.7);
    this.ctx.lineTo(-baseSize * 0.6, -baseSize * 0.7);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  drawChunk(level, chunkX, chunkY) {
    if (!this.baseCtx) {
      return;
    }
    this.baseCtx.clearRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    this.baseCtx.fillStyle = "rgba(15, 23, 42, 0.45)";
    this.baseCtx.fillRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);

    const originTileX = chunkX * this.chunkSize;
    const originTileY = chunkY * this.chunkSize;
    this.originTileX = originTileX;
    this.originTileY = originTileY;

    for (let ty = 0; ty < this.chunkSize; ty += 1) {
      for (let tx = 0; tx < this.chunkSize; tx += 1) {
        const tile = level.getTile(originTileX + tx, originTileY + ty);
        this.baseCtx.fillStyle = this.colorForTile(tile);
        this.baseCtx.fillRect(
          tx * this.scale,
          ty * this.scale,
          this.scale,
          this.scale
        );
      }
    }

    this.baseCtx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    this.baseCtx.lineWidth = 1;
    this.baseCtx.strokeRect(
      0.5,
      0.5,
      this.baseCanvas.width - 1,
      this.baseCanvas.height - 1
    );
  }

  colorForTile(tile) {
    if (!tile) {
      return "rgba(30, 41, 59, 0.4)";
    }
    switch (tile.code) {
      case "W":
        return "rgba(14, 165, 233, 0.75)";
      case "S":
        return "rgba(249, 115, 22, 0.9)";
      case "R":
      case "V":
      case "I":
        return "rgba(148, 163, 184, 0.85)";
      case "B":
      case "D":
      case "F":
      case "H":
        return "rgba(248, 250, 252, 0.82)";
      case "G":
      default:
        return "rgba(30, 64, 175, 0.18)";
    }
  }
}

class Camera {
  constructor(canvas, level) {
    this.canvas = canvas;
    this.level = level;
    this.x = 0;
    this.y = 0;
    this.smoothing = 6;
    this.updateViewport();

    window.addEventListener("resize", () => this.updateViewport());
  }

  updateViewport() {
    const rect = this.canvas.getBoundingClientRect();
    this.viewportWidth = rect.width || this.canvas.width;
    this.viewportHeight = rect.height || this.canvas.height;
  }

  update(target, dt) {
    const desiredX = target.body.x - this.viewportWidth / 2;
    const desiredY = target.body.y - this.viewportHeight / 2;
    const smoothing = 1 - Math.exp(-this.smoothing * dt);

    this.x += (desiredX - this.x) * smoothing;
    this.y += (desiredY - this.y) * smoothing;

    if (Number.isFinite(this.level.pixelWidth)) {
      const maxX = Math.max(0, this.level.pixelWidth - this.viewportWidth);
      this.x = clamp(this.x, 0, maxX);
    }

    if (Number.isFinite(this.level.pixelHeight)) {
      const maxY = Math.max(0, this.level.pixelHeight - this.viewportHeight);
      this.y = clamp(this.y, 0, maxY);
    }
  }
}

class Vehicle {
  constructor(system, startPose, carConfig, carSpec, options = {}) {
    this.system = system;
    this.startPose = { ...startPose };
    this.bodyWidth = 46;
    this.bodyHeight = 24;
    this.body = system.createBox(
      { x: startPose.x, y: startPose.y },
      this.bodyWidth,
      this.bodyHeight,
      { isStatic: false, isCentered: true }
    );
    this.body.setAngle(startPose.angle);

    this.renderWidth = 48;
    this.collisions = 0;
    const carId = carSpec?.id ?? carConfig?.id;
    const useProvidedConfig = options?.precomputedConfig === true;
    this.carConfig = useProvidedConfig
      ? cloneCarConfig(carConfig)
      : createCarConfigFromSpec(carConfig, { carId });
    this.physics = new PhysicsCar(this.carConfig, {
      pixelsPerMeter: PIXELS_PER_METER,
      position: { x: startPose.x, y: startPose.y },
      heading: startPose.angle
    });
    this.transmissionMode = "auto";
    this.physics.setManualMode(false);
    // Choose sprite key for this vehicle instance based on the carSpec (best-fit)
    this.carSpec = carSpec || null;
    this.spriteKey = chooseCarSprite(this.carSpec);
  }

  reset({ preserveCollisions = true } = {}) {
    this.body.setAngle(this.startPose.angle);
    this.body.setPosition(this.startPose.x, this.startPose.y);
    this.physics.resetState({
      position: { x: this.startPose.x, y: this.startPose.y },
      heading: this.startPose.angle
    });
    if (!preserveCollisions) {
      this.collisions = 0;
    }
  }

  update(inputState, dt, bounds) {
    const { forward, reverse, left, right, brake } = inputState;
    const isManual = this.isManualTransmission();
    let throttleInput = 0;
    let brakeInput = brake ? 1 : 0;
    const steerInput = (right ? 1 : 0) - (left ? 1 : 0);

    const longitudinalSpeed = this.physics.getLongitudinalSpeed();
    const absLongitudinal = Math.abs(longitudinalSpeed);
    const forwardPressed = forward && !reverse;
    const reversePressed = reverse && !forward;
    const movingBackward = longitudinalSpeed < -0.5;

    if (forwardPressed) {
      throttleInput = 1;
    }

    if (reversePressed) {
      if (absLongitudinal < 0.6) {
        throttleInput = -1;
      } else if (longitudinalSpeed > 0) {
        throttleInput = 0;
        brakeInput = Math.max(brakeInput, 0.6);
      } else {
        throttleInput = -1;
      }
    }

    if (!isManual && movingBackward && forwardPressed) {
      throttleInput = 0;
      brakeInput = Math.max(brakeInput, 1);
    }

    const inManualReverse = isManual && this.physics.reverseMode;
    if (inManualReverse && forwardPressed) {
      throttleInput = 0;
      brakeInput = Math.max(brakeInput, 1);
    }

    if (forward && reverse) {
      throttleInput = 0;
    }

    this.physics.update(throttleInput, brakeInput, steerInput, dt);

    const worldPos = this.physics.getWorldPosition();
    this.body.setAngle(this.physics.heading);
    this.body.setPosition(worldPos.x, worldPos.y);

    const beforeX = this.body.x;
    const beforeY = this.body.y;
    let collided = false;

    this.system.separateBody(this.body, () => {
      collided = true;
      return true;
    });

    if (collided) {
      const dx = this.body.x - beforeX;
      const dy = this.body.y - beforeY;
      if (dx !== 0 || dy !== 0) {
        this.physics.applyWorldDisplacement(dx, dy);
      }
    }

    const halfWidth = this.bodyWidth / 2;
    const halfHeight = this.bodyHeight / 2;
    const clampedX = clamp(this.body.x, bounds.minX + halfWidth, bounds.maxX - halfWidth);
    const clampedY = clamp(this.body.y, bounds.minY + halfHeight, bounds.maxY - halfHeight);

    if (clampedX !== this.body.x || clampedY !== this.body.y) {
      const dx = clampedX - this.body.x;
      const dy = clampedY - this.body.y;
      this.body.setPosition(clampedX, clampedY);
      this.physics.applyWorldDisplacement(dx, dy);
      collided = true;
    }

    if (collided) {
      this.physics.dampVelocity(0.25);
      if (this.physics.getSpeedMetersPerSecond() < 0.3) {
        this.physics.stop();
      }
      this.collisions += 1;
    }

    this.physics.setWorldPosition(this.body.x, this.body.y);
  }

  getSpeed() {
    return this.physics.getSpeedPixelsPerSecond();
  }

  getHeadingDegrees() {
    return ((this.physics.heading * RAD2DEG) % 360 + 360) % 360;
  }

  getPosition() {
    return this.physics.getWorldPosition();
  }

  isManualTransmission() {
    return this.transmissionMode === "manual";
  }

  toggleTransmissionMode() {
    const nextMode = this.isManualTransmission() ? "auto" : "manual";
    this.setTransmissionMode(nextMode);
  }

  setTransmissionMode(mode) {
    const normalized = mode === "manual" ? "manual" : "auto";
    this.transmissionMode = normalized;
    this.physics.setManualMode(normalized === "manual");
    if (normalized === "auto") {
      if (this.physics.gearIndex <= 0) {
        this.physics.gearIndex = Math.min(1, this.physics.config.gearRatios.length - 1);
      }
      this.physics.reverseMode = false;
    }
  }

  shiftUp() {
    if (!this.isManualTransmission()) {
      return false;
    }
    return this.physics.shiftUp();
  }

  shiftDown() {
    if (!this.isManualTransmission()) {
      return false;
    }
    return this.physics.shiftDown();
  }

  getTransmissionLabel() {
    return this.isManualTransmission() ? "Manual" : "Automatic";
  }

  getDisplayGear() {
    if (this.physics.reverseMode || this.physics.gearIndex === -1) {
      return "R";
    }
    if (this.physics.gearIndex === 0) {
      return "N";
    }
    return String(this.physics.gearIndex);
  }

  serializeState() {
    return {
      body: {
        x: this.body.x,
        y: this.body.y,
        angle: this.body.angle
      },
      physics:
        typeof this.physics.serializeState === "function"
          ? this.physics.serializeState()
          : null,
      transmissionMode: this.transmissionMode,
      collisions: this.collisions
    };
  }

  restoreState(state = {}) {
    if (!state || typeof state !== "object") {
      return;
    }

    if (state.physics && typeof this.physics.restoreState === "function") {
      this.physics.restoreState(state.physics);
    }

    const bodyState = state.body || {};
    const physicsPosition = this.physics.getWorldPosition();
    const posX = Number.isFinite(bodyState.x) ? bodyState.x : physicsPosition.x;
    const posY = Number.isFinite(bodyState.y) ? bodyState.y : physicsPosition.y;
    const candidateAngle = Number.isFinite(bodyState.angle)
      ? bodyState.angle
      : Number.isFinite(state.physics?.heading)
        ? state.physics.heading
        : this.physics.heading;

    this.body.setPosition(posX, posY);
    if (Number.isFinite(candidateAngle)) {
      this.body.setAngle(candidateAngle);
      this.physics.heading = candidateAngle;
    } else {
      this.body.setAngle(this.physics.heading);
    }
    this.body.updateBody(true);
    this.physics.setWorldPosition(this.body.x, this.body.y);

    const manualMode = this.physics.manualMode === true;
    if (typeof state.transmissionMode === "string") {
      this.transmissionMode = state.transmissionMode === "manual" ? "manual" : "auto";
      this.physics.manualMode = this.transmissionMode === "manual";
    } else {
      this.transmissionMode = manualMode ? "manual" : "auto";
      this.physics.manualMode = manualMode;
    }

    if (Number.isFinite(state.collisions)) {
      this.collisions = Math.max(0, Math.trunc(state.collisions));
    }
  }

  draw(ctx, camera, assets) {
    const sprite = assets[this.spriteKey] || assets.car_default || assets.car;
    if (!sprite) {
      return;
    }

    const position = this.physics.getWorldPosition();
    const drawX = position.x - camera.x;
    const drawY = position.y - camera.y;
    const renderWidth = this.renderWidth;
    const aspectRatio = sprite.height && sprite.width ? sprite.height / sprite.width : 0.5;
    const renderHeight = renderWidth * aspectRatio;

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(this.physics.heading);
    ctx.drawImage(
      sprite,
      -renderWidth / 2,
      -renderHeight / 2,
      renderWidth,
      renderHeight
    );
    ctx.restore();
  }
}

// Simple traffic manager: spawns NPC vehicles that drive on roads. Traffic only
// uses sedan, hatchback and truck-looking sprites (heuristic via chooseCarSprite).
// Vehicles choose random turns at intersection tiles and participate in collisions
// with the player and building colliders (using the existing physics `system`).
class TrafficManager {
  constructor(system, level, assets, player, playerVehicle) {
    this.system = system;
    this.level = level;
    this.assets = assets;
    this.player = player;
    this.playerVehicle = playerVehicle;
    this.vehicles = [];
    this.enabled = true;
    this.spawnCount = 6;
    this.allowedSpriteKeys = new Set(["car_Sedan", "car_Hatchback", "car_Truck"]);
    this.prevTileKey = new Map();
  }

  start() {
    this.enabled = true;
    this.spawnTraffic(this.spawnCount);
  }

  stop() {
    this.enabled = false;
    // remove bodies
    for (const v of this.vehicles) {
      try {
        if (v && v.body && typeof this.system.removeBody === 'function') {
          this.system.removeBody(v.body);
        }
      } catch (_e) {}
    }
    this.vehicles.length = 0;
  }

  spawnTraffic(count) {
    const candidates = CAR_CATALOG.filter((c) => {
      try {
        const key = chooseCarSprite(c);
        return this.allowedSpriteKeys.has(key);
      } catch (_e) {
        return false;
      }
    });
    if (candidates.length === 0) return;

    const origin = this.level.startPose || { x: TILE_SIZE * 4, y: TILE_SIZE * 4, angle: 0 };
    for (let i = 0; i < count; i += 1) {
      const carSpec = candidates[Math.floor(Math.random() * candidates.length)];
      const offsetX = (Math.random() - 0.5) * TILE_SIZE * 6;
      const offsetY = (Math.random() - 0.5) * TILE_SIZE * 6;
      const spawnPose = { x: origin.x + offsetX, y: origin.y + offsetY, angle: (Math.random() * Math.PI * 2) };
      const config = createCarConfigFromSpec(carSpec?.specs ?? {}, { carId: carSpec?.id });
      const veh = new Vehicle(this.system, spawnPose, config, carSpec, { precomputedConfig: true });
      // small randomize transmission
      if (Math.random() < 0.1) {
        veh.setTransmissionMode('manual');
      }
      this.vehicles.push({ veh, state: { turnChoice: null } });
    }
  }

  update(dt) {
    if (!this.enabled) return;
    const bounds = this.level.bounds;
    for (const entry of this.vehicles) {
      const veh = entry.veh;
      // Determine tile under vehicle
      const pos = veh.getPosition();
      const tileX = Math.floor(pos.x / TILE_SIZE);
      const tileY = Math.floor(pos.y / TILE_SIZE);
      const tile = this.level.getTile(tileX, tileY) || {};
      const tileKey = `${tileX},${tileY}`;

      // if we just arrived at a new intersection, pick a random turn
      const prev = this.prevTileKey.get(veh) || null;
      if (prev !== tileKey) {
        this.prevTileKey.set(veh, tileKey);
        if (tile.code === 'I') {
          // choose left / straight / right with weights
          const r = Math.random();
          if (r < 0.33) entry.state.turnChoice = 'left';
          else if (r < 0.66) entry.state.turnChoice = 'straight';
          else entry.state.turnChoice = 'right';
        } else {
          entry.state.turnChoice = 'straight';
        }
      }

      // Simple steering: try to maintain heading aligned with tile grid directions.
      // Compute desired heading based on turn choice.
      let desiredHeading = veh.physics.heading;
      // if on road tiles, bias to cardinal directions
      if (['R', 'V', 'I'].includes(tile.code)) {
        const rounded = Math.round(veh.physics.heading / (Math.PI / 2)) * (Math.PI / 2);
        desiredHeading = rounded;
        if (entry.state.turnChoice === 'left') desiredHeading -= Math.PI / 2;
        if (entry.state.turnChoice === 'right') desiredHeading += Math.PI / 2;
      }

      // normalize
      while (desiredHeading <= -Math.PI) desiredHeading += Math.PI * 2;
      while (desiredHeading > Math.PI) desiredHeading -= Math.PI * 2;

      const angleDiff = desiredHeading - veh.physics.heading;
      const steerLeft = angleDiff < -0.08;
      const steerRight = angleDiff > 0.08;

      // simple input: always forward, steer towards desired heading
      const input = {
        forward: true,
        reverse: false,
        left: steerLeft,
        right: steerRight,
        brake: false
      };

      // slow down near player to avoid instant collisions
      const playerPos = this.player.getPosition();
      const dx = playerPos.x - pos.x;
      const dy = playerPos.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < TILE_SIZE * 1.2) {
        input.forward = false;
        input.brake = true;
      }

      veh.update(input, dt, bounds);
    }
  }

  draw(ctx, camera, assets) {
    for (const entry of this.vehicles) {
      entry.veh.draw(ctx, camera, assets);
    }
  }
}

class Player {
  constructor(system, startPose) {
    this.system = system;
    this.walkSpeed = 160;
    this.bodyWidth = 12;
    this.bodyHeight = 15;
    this.body = system.createBox(
      { x: startPose.x - TILE_SIZE * 0.75, y: startPose.y },
      this.bodyWidth,
      this.bodyHeight,
      { isStatic: false, isCentered: true }
    );
    this.defaultGroup = this.body.group;
    this.currentSpeed = 0;
    this.facingAngle = -Math.PI / 2;
    this.active = true;
    this.attachedVehicle = null;
  }

  attachToVehicle(vehicle) {
    this.active = false;
    this.attachedVehicle = vehicle;
    this.body.isTrigger = true;
    this.body.group = 0;
    this.currentSpeed = 0;
    this.facingAngle = vehicle.body.angle;
    this.syncWithVehicle();
  }

  detachFromVehicle(vehicle, offset) {
    this.active = true;
    const vehicleAngle = vehicle.body.angle;
    this.attachedVehicle = null;
    this.body.isTrigger = false;
    this.body.group = this.defaultGroup;
    this.body.setPosition(vehicle.body.x + offset.x, vehicle.body.y + offset.y);
    this.body.updateBody(true);
    this.currentSpeed = 0;
    this.facingAngle = vehicleAngle;
  }

  syncWithVehicle() {
    if (!this.attachedVehicle) {
      return;
    }
    const targetX = this.attachedVehicle.body.x;
    const targetY = this.attachedVehicle.body.y;
    if (this.body.x !== targetX || this.body.y !== targetY) {
      this.body.setPosition(targetX, targetY);
      this.body.updateBody(true);
    }
  }

  getPosition() {
    return { x: this.body.x, y: this.body.y };
  }

  getSpeed() {
    return this.currentSpeed;
  }

  getHeadingDegrees() {
    return ((this.facingAngle * RAD2DEG) % 360 + 360) % 360;
  }

  reset(startPose) {
    this.active = true;
    this.attachedVehicle = null;
    this.body.isTrigger = false;
    this.body.group = this.defaultGroup;
    this.body.setPosition(startPose.x - TILE_SIZE * 0.75, startPose.y);
    this.body.setAngle(0);
    this.body.updateBody(true);
    this.currentSpeed = 0;
    this.facingAngle = -Math.PI / 2;
  }

  update(inputState, dt, bounds) {
    if (!this.active) {
      this.syncWithVehicle();
      return;
    }

    const dirX = (inputState?.right ? 1 : 0) - (inputState?.left ? 1 : 0);
    const dirY = (inputState?.reverse ? 1 : 0) - (inputState?.forward ? 1 : 0);

    if (dirX === 0 && dirY === 0) {
      this.currentSpeed = 0;
      return;
    }

    const length = Math.hypot(dirX, dirY) || 1;
    const step = this.walkSpeed * dt;
    const velocityX = (dirX / length) * step;
    const velocityY = (dirY / length) * step;
    const startX = this.body.x;
    const startY = this.body.y;
    const nextX = startX + velocityX;
    const nextY = startY + velocityY;

    this.body.setPosition(nextX, nextY);

    this.system.separateBody(this.body, () => true);
    const halfWidth = this.bodyWidth / 2;
    const halfHeight = this.bodyHeight / 2;
    const clampedX = clamp(this.body.x, bounds.minX + halfWidth, bounds.maxX - halfWidth);
    const clampedY = clamp(this.body.y, bounds.minY + halfHeight, bounds.maxY - halfHeight);
    if (clampedX !== this.body.x || clampedY !== this.body.y) {
      this.body.setPosition(clampedX, clampedY);
    }

    const traveledX = this.body.x - startX;
    const traveledY = this.body.y - startY;
    const distance = Math.hypot(traveledX, traveledY);
    this.body.updateBody(distance > 0.001);
    this.currentSpeed = dt > 0 ? distance / dt : 0;
    if (distance > 0.001) {
      this.facingAngle = Math.atan2(traveledY, traveledX);
    } else {
      this.facingAngle = Math.atan2(dirY, dirX);
    }
  }

  draw(ctx, camera, assets) {
    if (!this.active) {
      return;
    }

    const sprite = assets.player;
    if (!sprite) {
      return;
    }

    const drawX = this.body.x - camera.x;
    const drawY = this.body.y - camera.y;
    const renderHeight = 27;
    const aspectRatio = sprite.width ? sprite.height / sprite.width : 1;
    const renderWidth = renderHeight / aspectRatio;

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.drawImage(
      sprite,
      -renderWidth / 2,
      -renderHeight / 2,
      renderWidth,
      renderHeight
    );
    ctx.restore();
  }

  serializeState() {
    return {
      active: this.active,
      position: { x: this.body.x, y: this.body.y },
      facingAngle: this.facingAngle
    };
  }

  restoreState(state = {}) {
    if (!state || typeof state !== "object") {
      return;
    }
    const active = state.active !== false;
    this.active = active;
    this.attachedVehicle = null;
    if (active) {
      this.body.isTrigger = false;
      this.body.group = this.defaultGroup;
    } else {
      this.body.isTrigger = true;
      this.body.group = 0;
    }
    const position = state.position;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      this.body.setPosition(position.x, position.y);
    }
    if (Number.isFinite(state.facingAngle)) {
      this.facingAngle = state.facingAngle;
    }
    this.body.updateBody(true);
    this.currentSpeed = 0;
  }
}

class HUD {
  constructor() {
    this.root = document.querySelector(".panel");
    this.carEl = document.getElementById("stat-car");
    this.yearEl = document.getElementById("stat-year");
    this.originEl = document.getElementById("stat-origin");
    this.speedEl = document.getElementById("stat-speed");
    this.headingEl = document.getElementById("stat-heading");
    this.positionEl = document.getElementById("stat-position");
    this.zoneEl = document.getElementById("stat-zone");
    this.collisionsEl = document.getElementById("stat-collisions");
    this.transmissionEl = document.getElementById("stat-transmission");
    this.gearEl = document.getElementById("stat-gear");
    this.rpmEl = document.getElementById("stat-rpm");
    this.throttleEl = document.getElementById("stat-throttle");
    this.brakeEl = document.getElementById("stat-brake");
    this.longitudinalEl = document.getElementById("stat-longitudinal");
    this.lateralEl = document.getElementById("stat-lateral");
    this.powerEl = document.getElementById("stat-power");
    this.massEl = document.getElementById("stat-mass");
    this.torqueEl = document.getElementById("stat-torque");
    this.driveTypeEl = document.getElementById("stat-drive");
    this.revLimitEl = document.getElementById("stat-revlimit");
    this.brakeHpEl = document.getElementById("stat-brakehp");
    this.finalDriveEl = document.getElementById("stat-finaldrive");
    this.gearCountEl = document.getElementById("stat-gearcount");
    this.gearRatiosEl = document.getElementById("stat-gearratios");
    this.dragEl = document.getElementById("stat-drag");
    this.downforceEl = document.getElementById("stat-downforce");
    this.frontalEl = document.getElementById("stat-frontal");
    this.wheelbaseEl = document.getElementById("stat-wheelbase");
    this.trackEl = document.getElementById("stat-track");
    this.cgEl = document.getElementById("stat-cg");
    this.weightFrontEl = document.getElementById("stat-weightfront");
    this.wheelRadiusEl = document.getElementById("stat-wheelradius");
    this.frontGripEl = document.getElementById("stat-frontgrip");
    this.rearGripEl = document.getElementById("stat-reargrip");
    this.brakeTorqueFrontEl = document.getElementById("stat-brake-front");
    this.brakeTorqueRearEl = document.getElementById("stat-brake-rear");
    this.brakeBiasEl = document.getElementById("stat-brakebias");
    this.drivetrainEffEl = document.getElementById("stat-drivetrain");
    this.rollingEl = document.getElementById("stat-rolling");
    this.sourcesEl = document.getElementById("stat-sources");
    this.dashEl = document.getElementById("dash-cluster");
    this.dashSpeedEl = document.getElementById("dash-speed-value");
    this.dashRpmEl = document.getElementById("dash-rpm-value");
    this.dashGearEl = document.getElementById("dash-gear-value");
  }

  setVisible(visible) {
    if (this.root) {
      this.root.classList.toggle("is-hidden", !visible);
    }
  }

  setDashboardVisible(visible) {
    if (this.dashEl) {
      this.dashEl.classList.toggle("is-hidden", !visible);
    }
  }

  applyStaticSpec(spec = {}) {
    if (!spec) {
      return;
    }
    const {
      carLabel,
      year,
      country,
      powerHp,
      massKg,
      torqueNm,
      driveType,
      revLimiterRpm,
      brakeHorsepower,
      finalDrive,
      gearCount,
      gearRatios,
      dragCoefficient,
      downforceCoefficient,
      frontalAreaM2,
      wheelbaseM,
      trackWidthM,
      cgHeightM,
      frontWeightDistribution,
      wheelRadiusM,
      tireGripFrontLong,
      tireGripRearLong,
      tireGripFrontLat,
      tireGripRearLat,
      brakeTorqueFrontNm,
      brakeTorqueRearNm,
      brakeBiasFront,
      drivetrainEfficiency,
      rollingResistanceCoeff,
      sources
    } = spec;

    if (this.carEl) {
      this.carEl.textContent = carLabel ? carLabel : "-";
    }
    if (this.yearEl) {
      this.yearEl.textContent = year != null ? String(year) : "-";
    }
    if (this.originEl) {
      this.originEl.textContent = country ?? "-";
    }
    if (this.powerEl) {
      this.powerEl.textContent = formatNumber(powerHp, 0);
    }
    if (this.massEl) {
      this.massEl.textContent = formatNumber(massKg, 0);
    }
    if (this.torqueEl) {
      this.torqueEl.textContent = Number.isFinite(torqueNm) ? `${torqueNm.toFixed(0)} Nm` : "-";
    }
    if (this.driveTypeEl) {
      this.driveTypeEl.textContent = driveType ? driveType.toUpperCase() : "-";
    }
    if (this.revLimitEl) {
      this.revLimitEl.textContent = Number.isFinite(revLimiterRpm) ? `${revLimiterRpm.toFixed(0)} rpm` : "-";
    }
    if (this.brakeHpEl) {
      this.brakeHpEl.textContent = Number.isFinite(brakeHorsepower) ? `${brakeHorsepower.toFixed(0)} hp` : "-";
    }
    if (this.finalDriveEl) {
      this.finalDriveEl.textContent = Number.isFinite(finalDrive) ? finalDrive.toFixed(2) : "-";
    }
    if (this.gearCountEl) {
      this.gearCountEl.textContent = Number.isFinite(gearCount) ? gearCount.toString() : "-";
    }
    if (this.gearRatiosEl) {
      this.gearRatiosEl.textContent = formatGearRatios(gearRatios);
    }
    if (this.dragEl) {
      this.dragEl.textContent = formatNumber(dragCoefficient, 2);
    }
    if (this.downforceEl) {
      this.downforceEl.textContent = formatNumber(downforceCoefficient, 2);
    }
    if (this.frontalEl) {
      this.frontalEl.textContent = formatWithUnit(frontalAreaM2, "m²", 2);
    }
    if (this.wheelbaseEl) {
      this.wheelbaseEl.textContent = formatWithUnit(wheelbaseM, "m", 3);
    }
    if (this.trackEl) {
      this.trackEl.textContent = formatWithUnit(trackWidthM, "m", 3);
    }
    if (this.cgEl) {
      this.cgEl.textContent = formatWithUnit(cgHeightM, "m", 3);
    }
    if (this.weightFrontEl) {
      this.weightFrontEl.textContent = formatPercent(frontWeightDistribution);
    }
    if (this.wheelRadiusEl) {
      this.wheelRadiusEl.textContent = formatWithUnit(wheelRadiusM, "m", 3);
    }
    if (this.frontGripEl) {
      this.frontGripEl.textContent = formatGripPair(tireGripFrontLong, tireGripFrontLat);
    }
    if (this.rearGripEl) {
      this.rearGripEl.textContent = formatGripPair(tireGripRearLong, tireGripRearLat);
    }
    if (this.brakeTorqueFrontEl) {
      this.brakeTorqueFrontEl.textContent = Number.isFinite(brakeTorqueFrontNm)
        ? brakeTorqueFrontNm.toFixed(0)
        : "-";
    }
    if (this.brakeTorqueRearEl) {
      this.brakeTorqueRearEl.textContent = Number.isFinite(brakeTorqueRearNm)
        ? brakeTorqueRearNm.toFixed(0)
        : "-";
    }
    if (this.brakeBiasEl) {
      this.brakeBiasEl.textContent = formatPercent(brakeBiasFront, 1);
    }
    if (this.drivetrainEffEl) {
      this.drivetrainEffEl.textContent = formatPercent(drivetrainEfficiency);
    }
    if (this.rollingEl) {
      this.rollingEl.textContent = formatNumber(rollingResistanceCoeff, 3);
    }
    if (this.sourcesEl) {
      this.sourcesEl.textContent = formatSourcesList(sources);
    }
  }

  update({
    carLabel,
    speed,
    heading,
    position,
    zone,
    collisions,
    transmission,
    gear,
    rpm,
    throttle,
    brake,
    longG,
    latG,
    powerHp,
    massKg,
    torqueNm,
    driveType,
    revLimiterRpm,
    brakeHorsepower,
    finalDrive,
    gearRatios,
    gearCount,
    dragCoefficient,
    downforceCoefficient,
    frontalAreaM2,
    wheelbaseM,
    trackWidthM,
    cgHeightM,
    frontWeightDistribution,
    wheelRadiusM,
    tireGripFrontLong,
    tireGripRearLong,
    tireGripFrontLat,
    tireGripRearLat,
    tireGripLongArray,
    tireGripLatArray,
    drivetrainEfficiency,
    rollingResistanceCoeff,
    sources,
    year,
    country,
    brakeTorqueFrontNm,
    brakeTorqueRearNm,
    brakeBiasFront
  }) {
    this.applyStaticSpec({
      carLabel,
      powerHp,
      massKg,
      torqueNm,
      driveType,
      revLimiterRpm,
      brakeHorsepower,
      finalDrive,
      gearRatios,
      gearCount,
      dragCoefficient,
      downforceCoefficient,
      frontalAreaM2,
      wheelbaseM,
      trackWidthM,
      cgHeightM,
      frontWeightDistribution,
      wheelRadiusM,
      tireGripFrontLong,
      tireGripRearLong,
      tireGripFrontLat,
      tireGripRearLat,
      tireGripLongArray,
      tireGripLatArray,
      brakeTorqueFrontNm,
      brakeTorqueRearNm,
      brakeBiasFront,
      drivetrainEfficiency,
      rollingResistanceCoeff,
      sources,
      year,
      country
    });
    const speedKph = speed / PIXELS_PER_METER * 3.6;
    if (this.speedEl) {
      this.speedEl.textContent = speedKph.toFixed(0);
    }
    if (this.headingEl) {
      this.headingEl.textContent = heading.toFixed(0);
    }
    if (this.positionEl) {
      const { x, y } = position;
      this.positionEl.textContent = `${x.toFixed(0)}, ${y.toFixed(0)}`;
    }
    if (this.zoneEl) {
      this.zoneEl.textContent = zone;
    }
    if (this.collisionsEl) {
      this.collisionsEl.textContent = String(collisions);
    }
    if (this.transmissionEl) {
      this.transmissionEl.textContent = transmission ?? "Automatic";
    }
    if (this.gearEl) {
      this.gearEl.textContent = gear ?? "-";
    }
    if (this.rpmEl) {
      this.rpmEl.textContent = rpm != null ? rpm.toFixed(0) : "0";
    }
    if (this.throttleEl) {
      const pct = throttle != null ? Math.round(clamp(Math.abs(throttle), 0, 1) * 100) : 0;
      this.throttleEl.textContent = String(pct);
    }
    if (this.brakeEl) {
      const pct = brake != null ? Math.round(clamp(brake, 0, 1) * 100) : 0;
      this.brakeEl.textContent = String(pct);
    }
    if (this.longitudinalEl) {
      const value = longG != null ? longG : 0;
      this.longitudinalEl.textContent = value.toFixed(2);
    }
    if (this.lateralEl) {
      const value = latG != null ? latG : 0;
      this.lateralEl.textContent = value.toFixed(2);
    }
    if (this.powerEl) {
      this.powerEl.textContent = powerHp != null ? powerHp.toFixed(0) : "-";
    }
    if (this.massEl) {
      this.massEl.textContent = massKg != null ? massKg.toFixed(0) : "-";
    }
    if (this.dashSpeedEl) {
      const speedMph = speedKph * 0.621371;
      this.dashSpeedEl.textContent = Number.isFinite(speedMph) ? speedMph.toFixed(0) : "0";
    }
    if (this.dashRpmEl) {
      this.dashRpmEl.textContent = rpm != null ? rpm.toFixed(0) : "0";
    }
    if (this.dashGearEl) {
      this.dashGearEl.textContent = gear != null ? String(gear) : "-";
    }
  }
}

class Game {
  constructor(canvas, context, assets, options = {}) {
    this.canvas = canvas;
    this.ctx = context;
    this.assets = assets;
    // Prefer requesting fullscreen on the wrapper that contains the canvas and overlays
    // so HUD/minimap remain visible in fullscreen. Fall back to the canvas if wrapper
    // is not present in the DOM (e.g., embedding environments).
    this.fullscreenRoot = (this.canvas && this.canvas.closest)
      ? this.canvas.closest(".viewport-wrapper") || this.canvas.parentElement || this.canvas
      : this.canvas;
    (this.fullscreenRoot || this.canvas).addEventListener("dblclick", () => this.toggleFullscreen());
    this.system = new System();
    this.level = new Level(TILESET, this.system);
    this.carSpec = options.carSpec ?? null;
    const carId = this.carSpec?.id ?? options.carId ?? null;
    if (options.carConfig) {
      this.carConfig = cloneCarConfig(options.carConfig);
    } else if (this.carSpec?.specs) {
      this.carConfig = createCarConfigFromSpec(this.carSpec.specs, { carId });
    } else {
      this.carConfig = createCarConfigFromSpec({}, { carId, applyOverrides: false });
    }
    this.vehicle = new Vehicle(
      this.system,
      this.level.startPose,
      this.carConfig,
      this.carSpec,
      { precomputedConfig: true }
    );
    this.player = new Player(this.system, this.level.startPose);
  this.traffic = new TrafficManager(this.system, this.level, this.assets, this.player, this.vehicle);
    this.camera = new Camera(canvas, this.level);
    this.input = new InputManager();
    this.hud = options.hud || new HUD();
    this.debug = false;
    this.lastTimestamp = null;
    this.mode = "driving";
    this.specDisplay = options.specDisplay ?? buildSpecDisplay(this.carConfig, this.carSpec);
    this.hud.applyStaticSpec(this.specDisplay);
    this.carLabel = this.specDisplay?.carLabel ?? formatCarLabel(this.carSpec);
    this.player.attachToVehicle(this.vehicle);
    this.loop = this.loop.bind(this);

    this.minimap = new MiniMap(document.getElementById("minimap"));
    this.pauseOverlay = document.getElementById("pause-overlay");
    this.resumeButton = document.getElementById("resume-button");
    this.exitButton = document.getElementById("exit-button");
    this.saveButton = document.getElementById("save-button");
    this.saveStatusEl = document.getElementById("save-status");
    this.saveStatusTimeout = null;
    this.canPersistSave = Boolean(getSaveStorage());
    this.handleResume = () => this.togglePause(false);
    this.handleExit = () => this.exitToMenu();
    this.handleSave = () => this.saveGame();
    if (this.resumeButton) {
      this.resumeButton.addEventListener("click", this.handleResume);
    }
    if (this.exitButton) {
      this.exitButton.addEventListener("click", this.handleExit);
    }
    if (this.saveButton) {
      if (this.canPersistSave) {
        this.saveButton.disabled = false;
        this.saveButton.addEventListener("click", this.handleSave);
      } else {
        this.saveButton.disabled = true;
        this.saveButton.title = "Saving is unavailable in this environment.";
      }
    }

    this.onExit = typeof options.onExit === "function" ? options.onExit : null;
    this.onSaved = typeof options.onSaved === "function" ? options.onSaved : null;
    this.paused = false;
    this.hud.setVisible(false);
    this.hud.setDashboardVisible(true);
    if (this.minimap) {
      this.minimap.setVisible(true);
    }
    // start traffic after initialization
    try {
      this.traffic.start();
    } catch (_e) {}
    this.showPauseOverlay(false);
    this.updateSaveStatus(null);
  }

  start() {
    if (this.tickHandle) {
      return;
    }
    this.paused = false;
    this.lastTimestamp = null;
    this.input.clearMovementState();
    this.hud.setVisible(false);
    this.hud.setDashboardVisible(true);
    if (this.minimap) {
      this.minimap.setVisible(true);
    }
    this.showPauseOverlay(false);
    this.tickHandle = setInterval(() => this.loop(performance.now()), 1000 / 60);
  }

  stop() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    if (this.resumeButton) {
      this.resumeButton.removeEventListener("click", this.handleResume);
    }
    if (this.exitButton) {
      this.exitButton.removeEventListener("click", this.handleExit);
    }
    if (this.saveButton) {
      this.saveButton.removeEventListener("click", this.handleSave);
    }
    if (this.saveStatusTimeout) {
      clearTimeout(this.saveStatusTimeout);
      this.saveStatusTimeout = null;
    }
    if (this.minimap) {
      this.minimap.setVisible(false);
    }
    this.showPauseOverlay(false);
    this.hud.setDashboardVisible(false);
    this.paused = false;
    this.input.clearMovementState();
  }

  togglePause(force) {
    const nextState = typeof force === "boolean" ? force : !this.paused;
    if (nextState === this.paused) {
      return;
    }
    this.paused = nextState;
    if (this.paused) {
      this.input.clearMovementState();
      this.hud.setVisible(true);
      this.hud.setDashboardVisible(false);
      if (this.minimap) {
        this.minimap.setVisible(false);
      }
      this.showPauseOverlay(true);
    } else {
      this.hud.setVisible(false);
      this.hud.setDashboardVisible(true);
      if (this.minimap) {
        this.minimap.setVisible(true);
      }
      this.showPauseOverlay(false);
      this.lastTimestamp = null;
      this.updateSaveStatus(null);
    }
  }

  showPauseOverlay(show) {
    if (!this.pauseOverlay) {
      return;
    }
    if (show) {
      this.pauseOverlay.classList.remove("is-hidden");
      this.pauseOverlay.setAttribute("aria-hidden", "false");
      if (this.resumeButton) {
        setTimeout(() => this.resumeButton.focus(), 0);
      }
    } else {
      this.pauseOverlay.classList.add("is-hidden");
      this.pauseOverlay.setAttribute("aria-hidden", "true");
      this.updateSaveStatus(null);
    }
  }

  exitToMenu() {
    this.paused = false;
    this.showPauseOverlay(false);
    if (this.minimap) {
      this.minimap.setVisible(false);
    }
    this.hud.setDashboardVisible(false);
    this.hud.setVisible(false);
    this.stop();
    if (this.onExit) {
      this.onExit();
    }
  }

  updateSaveStatus(message, isError = false) {
    if (!this.saveStatusEl) {
      return;
    }
    if (this.saveStatusTimeout) {
      clearTimeout(this.saveStatusTimeout);
      this.saveStatusTimeout = null;
    }
    if (!message) {
      this.saveStatusEl.textContent = "";
      this.saveStatusEl.classList.add("is-hidden");
      this.saveStatusEl.classList.remove("is-error");
      return;
    }
    this.saveStatusEl.textContent = message;
    this.saveStatusEl.classList.remove("is-hidden");
    if (isError) {
      this.saveStatusEl.classList.add("is-error");
    } else {
      this.saveStatusEl.classList.remove("is-error");
      this.saveStatusTimeout = setTimeout(() => {
        this.saveStatusTimeout = null;
        this.updateSaveStatus(null);
      }, 4000);
    }
  }

  buildSavePayload() {
    return {
      savedAt: Date.now(),
      carId: this.carSpec?.id ?? null,
      carLabel: this.carLabel ?? formatCarLabel(this.carSpec),
      carConfig: cloneCarConfig(this.carConfig),
      mode: this.mode,
      vehicle:
        typeof this.vehicle.serializeState === "function"
          ? this.vehicle.serializeState()
          : null,
      player:
        typeof this.player.serializeState === "function"
          ? this.player.serializeState()
          : null
    };
  }

  saveGame() {
    if (!this.canPersistSave) {
      this.updateSaveStatus("Saving is unavailable in this environment.", true);
      return false;
    }
    const payload = this.buildSavePayload();
    const stored = writeSavedGame(payload);
    if (stored) {
      const timestamp = formatSaveTimestamp(payload.savedAt);
      const message = timestamp ? `Saved ${timestamp}` : "Game saved.";
      this.updateSaveStatus(message, false);
      if (typeof this.onSaved === "function") {
        this.onSaved(payload);
      }
    } else {
      this.updateSaveStatus(
        "Unable to save. Check browser storage permissions.",
        true
      );
    }
    return stored;
  }

  applySaveState(save) {
    if (!save || typeof save !== "object") {
      return false;
    }
    if (save.vehicle && typeof this.vehicle.restoreState === "function") {
      this.vehicle.restoreState(save.vehicle);
    }
    const desiredMode = save.mode === "onFoot" ? "onFoot" : "driving";
    this.mode = desiredMode;
    if (desiredMode === "driving") {
      this.player.attachToVehicle(this.vehicle);
    } else {
      const playerState = { ...(save.player ?? {}), active: true };
      this.player.restoreState(playerState);
    }
    if (this.minimap) {
      this.minimap.prevChunkKey = null;
      const activeEntity = this.mode === "driving" ? this.vehicle : this.player;
      const position =
        typeof activeEntity.getPosition === "function"
          ? activeEntity.getPosition()
          : this.vehicle.getPosition();
      this.minimap.update(this.level, position, this.vehicle.physics.heading);
    }
    this.camera.update(this.mode === "driving" ? this.vehicle : this.player, 0);
    return true;
  }

  loop(timestamp) {
    if (this.tickHandle == null) {
      return;
    }
    if (this.lastTimestamp == null) {
      this.lastTimestamp = timestamp;
      return;
    }
    let delta = (timestamp - this.lastTimestamp) / 1000;
    if (delta < 0.0005) {
      delta = 1 / 60;
    }
    delta = Math.min(Math.max(delta, 0), 0.1);

    if (this.input.consumePauseToggle()) {
      this.togglePause();
    }

    if (!this.paused) {
      if (this.input.consumeReset()) {
        this.resetVehicle({ preserveCollisions: true });
      }

      if (this.input.consumeInteract()) {
        this.handleInteract();
      }

      if (this.input.consumeToggleTransmission()) {
        this.vehicle.toggleTransmissionMode();
      }
      if (this.input.consumeShiftUp()) {
        this.vehicle.shiftUp();
      }
      if (this.input.consumeShiftDown()) {
        this.vehicle.shiftDown();
      }

      const vehicleInput = this.mode === "driving" ? this.input.state : ZERO_INPUT;
      const playerInput = this.mode === "driving" ? ZERO_INPUT : this.input.state;

      this.vehicle.update(vehicleInput, delta, this.level.bounds);
      this.player.update(playerInput, delta, this.level.bounds);
      // update traffic NPCs
      if (this.traffic) {
        try {
          this.traffic.update(delta);
        } catch (_e) {}
      }
      this.camera.update(this.mode === "driving" ? this.vehicle : this.player, delta);
    } else {
      this.camera.update(this.mode === "driving" ? this.vehicle : this.player, 0);
    }

    const activeEntity = this.mode === "driving" ? this.vehicle : this.player;
    const activePosition = activeEntity.getPosition();
    const zoneType = getZone(
      Math.floor(activePosition.x / TILE_SIZE),
      Math.floor(activePosition.y / TILE_SIZE)
    );
    const zoneLabel = zoneType === "city" ? "City" : "Country";
    const carPhysics = this.vehicle.physics;
    const baseSpec = this.specDisplay || {};
    let hudExtras = {
      ...baseSpec,
      carLabel: this.carLabel,
      transmission: this.vehicle.getTransmissionLabel(),
      gear: this.vehicle.getDisplayGear(),
      rpm: null,
      throttle: null,
      brake: null,
      longG: null,
      latG: null
    };

    if (this.mode === "driving") {
      hudExtras = {
        ...hudExtras,
        rpm: carPhysics.engineRpm,
        throttle: carPhysics.throttle,
        brake: carPhysics.brake,
        longG: carPhysics.lastLongitudinalAccel / physicsLib.G,
        latG: carPhysics.lastLateralAccel / physicsLib.G
      };
    }

    this.hud.update({
      speed: activeEntity.getSpeed(),
      heading: activeEntity.getHeadingDegrees(),
      position: activePosition,
      zone: zoneLabel,
      collisions: this.vehicle.collisions,
      ...hudExtras
    });

    if (this.minimap) {
      this.minimap.update(this.level, activePosition, carPhysics.heading);
    }

    this.draw();
    this.lastTimestamp = timestamp;
  }

  toggleFullscreen() {
    const root = this.fullscreenRoot || this.canvas;
    if (!document.fullscreenElement) {
      if (root && typeof root.requestFullscreen === "function") {
        root.requestFullscreen().catch(() => {});
      } else if (this.canvas && typeof this.canvas.requestFullscreen === "function") {
        this.canvas.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    this.level.draw(ctx, this.camera, this.assets);
    if (this.traffic) {
      try {
        this.traffic.draw(ctx, this.camera, this.assets);
      } catch (_e) {}
    }
    this.vehicle.draw(ctx, this.camera, this.assets);
    this.player.draw(ctx, this.camera, this.assets);

    if (this.debug) {
      this.drawDebugColliders();
    }
  }

  drawDebugColliders() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    this.system.draw(ctx);
    ctx.stroke();
    ctx.restore();
  }

  resetVehicle({ preserveCollisions = false } = {}) {
    this.vehicle.reset({ preserveCollisions });
    this.mode = "driving";
    this.player.attachToVehicle(this.vehicle);
  }

  handleInteract() {
    if (this.mode === "driving") {
      if (this.vehicle.getSpeed() < 10) {
        this.exitVehicle();
      }
      return;
    }

    const dx = this.vehicle.body.x - this.player.body.x;
    const dy = this.vehicle.body.y - this.player.body.y;
    const distance = Math.hypot(dx, dy);
    if (distance < TILE_SIZE * 0.9 && this.vehicle.getSpeed() < 10) {
      this.enterVehicle();
    }
  }

  enterVehicle() {
    this.mode = "driving";
    this.vehicle.physics.stop();
    this.player.attachToVehicle(this.vehicle);
  }

  exitVehicle() {
    this.mode = "onFoot";
    this.vehicle.physics.stop();
    const angle = this.vehicle.body.angle;
    const offsetDistance = this.vehicle.bodyWidth * 0.9;
    const offset = {
      x: -Math.sin(angle) * offsetDistance,
      y: Math.cos(angle) * offsetDistance
    };
    this.player.detachFromVehicle(this.vehicle, offset);
    this.system.separateBody(this.player.body, () => true);
  }
}
async function bootstrap() {
  const canvas = document.getElementById("viewport");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Canvas element with id 'viewport' is missing.");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to acquire 2D rendering context.");
  }

  const resizeCanvasToDisplaySize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    } else {
      if (statCar) {
        statCar.textContent = "-";
      }
      if (statPower) {
        statPower.textContent = "-";
      }
      if (statMass) {
        statMass.textContent = "-";
      }
    }
  };

  resizeCanvasToDisplaySize();
  window.addEventListener("resize", resizeCanvasToDisplaySize);

  const assets = await loadImages(IMAGE_SOURCES);
  const hud = new HUD();
  hud.setDashboardVisible(false);
  let game = null;
  const resetButton = document.getElementById("reset-button");
  const debugToggle = document.getElementById("debug-toggle");
  const carSelect = document.getElementById("car-select");
  const startButton = document.getElementById("start-button");
  const carSummary = document.getElementById("car-summary");
  const minimapCanvas = document.getElementById("minimap");
  const dashCluster = document.getElementById("dash-cluster");
  const pauseOverlay = document.getElementById("pause-overlay");
  const resumeSaveButton = document.getElementById("resume-save-button");
  const savegameHint = document.getElementById("savegame-hint");
  const saveFeatureAvailable = Boolean(getSaveStorage());

  let selectedCar = CAR_CATALOG.length > 0 ? CAR_CATALOG[0] : null;
  let selectedSpecDisplay = null;

  if (carSummary) {
    carSummary.textContent = "Checking vehicle performance, please wait...";
  }
  if (startButton) {
    startButton.disabled = true;
  }
  if (carSelect) {
    carSelect.disabled = true;
  }

  const visualizer =
    carVerificationManager && assets ? new CalibrationVisualizer(canvas, ctx, assets) : null;
  const calibrationOptions = { visualizer };
  let overrides = globalThis.ROCKPORT_CALIBRATION_OPTIONS;
  if (!overrides) {
    try {
      const stored = globalThis.localStorage?.getItem?.("rockport.calibration.options");
      if (stored) {
        overrides = JSON.parse(stored);
      }
    } catch (_error) {
      overrides = null;
    }
  }
  if (overrides && typeof overrides === "object") {
    Object.assign(calibrationOptions, overrides);
  }

  if (carVerificationManager) {
    try {
      await carVerificationManager.verifyAllCars(CAR_CATALOG, calibrationOptions);
    } catch (error) {
      console.error("Vehicle verification encountered an unexpected error.", error);
    }
  }

  try {
    if (visualizer) {
      visualizer.clear();
    }
  } catch (visualError) {
    console.warn("Unable to finalize calibration visualization.", visualError);
  }

  const updateCarSummary = () => {
    if (carSummary) {
      carSummary.textContent = buildCarSummary(selectedCar);
    }
    if (selectedCar && selectedCar.specs) {
      const previewConfig = createCarConfigFromSpec(selectedCar.specs, { carId: selectedCar.id });
      selectedSpecDisplay = buildSpecDisplay(previewConfig, selectedCar);
      hud.applyStaticSpec(selectedSpecDisplay);
    } else {
      selectedSpecDisplay = null;
      hud.applyStaticSpec({});
    }
  };

  if (carSelect) {
    carSelect.innerHTML = "";
    CAR_CATALOG.forEach((car) => {
      const option = document.createElement("option");
      option.value = car.id;
      option.textContent = formatCarLabel(car);
      carSelect.appendChild(option);
    });
    carSelect.addEventListener("change", (event) => {
      const target = event.target;
      const value = target.value;
      selectedCar = CAR_CATALOG.find((car) => car.id === value) ?? null;
      updateCarSummary();
      if (startButton) {
        startButton.disabled = !selectedCar;
      }
    });
    if (CAR_CATALOG.length > 0) {
      carSelect.value = CAR_CATALOG[0].id;
    }
    carSelect.disabled = false;
  }

  updateCarSummary();
  if (startButton) {
    startButton.disabled = !selectedCar;
    startButton.addEventListener("click", () => {
      if (!selectedCar) {
        return;
      }
      if (game) {
        game.stop();
        game = null;
      }
      const config = createCarConfigFromSpec(selectedCar.specs, { carId: selectedCar.id });
      const specDisplay = selectedSpecDisplay ?? buildSpecDisplay(config, selectedCar);
      const handleExitToMenu = () => {
        if (pauseOverlay) {
          pauseOverlay.classList.add("is-hidden");
        }
        if (minimapCanvas) {
          minimapCanvas.classList.add("is-hidden");
        }
        if (dashCluster) {
          dashCluster.classList.add("is-hidden");
        }
        hud.setVisible(true);
        hud.setDashboardVisible(false);
        updateCarSummary();
        if (startButton) {
          startButton.disabled = !selectedCar;
          startButton.textContent = "Load Vehicle";
        }
        if (carSelect) {
          carSelect.disabled = false;
        }
        game = null;
      };
      game = new Game(canvas, ctx, assets, {
        carSpec: selectedCar,
        carConfig: config,
        hud,
        specDisplay,
        onExit: handleExitToMenu
      });
      if (debugToggle) {
        game.debug = debugToggle.checked;
      }
      game.start();
      if (startButton) {
        startButton.disabled = true;
      }
      if (carSelect) {
        carSelect.disabled = true;
      }
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (game) {
        game.resetVehicle({ preserveCollisions: false });
      }
    });
  }

  if (debugToggle) {
    debugToggle.addEventListener("change", (event) => {
      if (game) {
        game.debug = event.target.checked;
      }
    });
  }
}

if (typeof document !== "undefined") {
  bootstrap().catch((error) => {
    console.error(error);
  });
} else {
  globalThis.RockportCalibration = {
    manager: carVerificationManager,
    verifyAllCars(cars = globalThis.RockportCarCatalog, options = {}) {
      return carVerificationManager.verifyAllCars(cars, options);
    },
    createCarConfigFromSpec,
    CarVerificationManager
  };
}
})();
