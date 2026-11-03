const TRACKING_AREAS = ["health", "finance", "study", "fun"];
const TRACKING_RESPONSE_TYPES = ["boolean", "quantity", "duration", "money"];
const TRACKING_FREQUENCIES = ["manual", "daily", "weekly", "on-entry"];
const TRACKING_AGGREGATIONS = ["sum", "average", "count", "latest"];

function createTrackingId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `kagami-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTrackingState() {
  return {
    version: 1,
    questions: [],
    records: [],
    goals: [],
    preferences: {
      scheduledQuestionsEnabled: false,
      scheduledTimes: [],
      areas: [...TRACKING_AREAS],
      organizationMode: "balanced",
      askOnEntryEnabled: true,
      manualEntryEnabled: true,
    },
  };
}

function createHabitGoal(title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new Error("El objetivo necesita un nombre.");
  return {
    id: createTrackingId(),
    type: "habit",
    title: cleanTitle,
    status: "active",
    createdAt: new Date().toISOString(),
    questionId: null,
    target: null,
    period: null,
  };
}

function createTrackingQuestion(config) {
  if (!config || typeof config !== "object") throw new Error("La pregunta no es válida.");
  const question = {
    id: config.id || createTrackingId(),
    text: String(config.text || "").trim(),
    area: config.area,
    responseType: config.responseType,
    unit: config.unit || null,
    frequency: config.frequency || { kind: "manual", times: [] },
    enabled: config.enabled !== false,
    aggregation: config.aggregation || "sum",
  };
  if (!question.text) throw new Error("La pregunta necesita un texto.");
  if (!TRACKING_AREAS.includes(question.area)) throw new Error("El área de la pregunta no es válida.");
  if (!TRACKING_RESPONSE_TYPES.includes(question.responseType)) throw new Error("El tipo de respuesta no es válido.");
  if (!TRACKING_FREQUENCIES.includes(question.frequency.kind)) throw new Error("La frecuencia de la pregunta no es válida.");
  if (!TRACKING_AGGREGATIONS.includes(question.aggregation)) throw new Error("La forma de calcular la estadística no es válida.");
  if (!Array.isArray(question.frequency.times) || question.frequency.times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error("Los horarios deben usar el formato HH:MM.");
  }
  if (["quantity", "duration"].includes(question.responseType) && !question.unit) {
    throw new Error("Esta pregunta necesita una unidad de medida.");
  }
  return question;
}

function normalizeTrackingValue(question, value) {
  if (question.responseType === "boolean") {
    if (typeof value !== "boolean") throw new Error("La respuesta debe ser Sí o No.");
    return value;
  }
  if (question.responseType === "quantity") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error("La cantidad debe ser un número igual o mayor que cero.");
    }
    return value;
  }
  if (question.responseType === "duration") {
    if (!value || typeof value !== "object" || typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0 || value.unit !== question.unit) {
      throw new Error("La duración debe incluir un valor no negativo y la unidad configurada.");
    }
    return { value: value.value, unit: question.unit };
  }
  if (question.responseType === "money") {
    if (!value || typeof value !== "object" || typeof value.amount !== "number" || !Number.isFinite(value.amount) || value.amount < 0 || !/^[A-Z]{3}$/.test(value.currency || "")) {
      throw new Error("El importe debe ser no negativo e incluir una moneda ISO de tres letras.");
    }
    return { amount: value.amount, currency: value.currency };
  }
  throw new Error("No se reconoce el tipo de respuesta.");
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recordTrackingAnswer(state, questionId, value, options = {}) {
  const question = state.questions.find((item) => item.id === questionId);
  if (!question) throw new Error("No se encontró la pregunta asociada al registro.");
  const normalizedValue = normalizeTrackingValue(question, value);
  const existing = options.recordId ? state.records.find((record) => record.id === options.recordId) : null;
  if (options.recordId && (!existing || existing.questionId !== questionId)) {
    throw new Error("No se encontró el registro que quieres corregir.");
  }
  const record = {
    id: existing ? existing.id : createTrackingId(),
    questionId,
    value: normalizedValue,
    recordedAt: new Date().toISOString(),
    periodStart: options.periodStart || (existing && existing.periodStart) || getLocalDateKey(new Date()),
    validationStatus: "validated",
  };
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(record.periodStart)
    ? new Date(`${record.periodStart}T12:00:00`)
    : null;
  if (!parsedDate || getLocalDateKey(parsedDate) !== record.periodStart) {
    throw new Error("El período del registro debe ser una fecha válida con formato AAAA-MM-DD.");
  }
  if (existing) {
    state.records[state.records.indexOf(existing)] = record;
  } else {
    state.records.push(record);
  }
  return record;
}

function getIsoWeekKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() + 4 - weekday);
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function calculateQuestionStatistics(state, questionId, options = {}) {
  const question = state.questions.find((item) => item.id === questionId);
  if (!question) throw new Error("No se encontró la pregunta para calcular sus estadísticas.");
  const records = state.records.filter((record) =>
    record.questionId === questionId &&
    record.validationStatus === "validated" &&
    (!options.from || record.periodStart >= options.from) &&
    (!options.to || record.periodStart <= options.to)
  );
  const numericValues = records.map((record) => {
    if (question.responseType === "boolean") return record.value ? 1 : 0;
    if (question.responseType === "duration") return record.value.value;
    if (question.responseType === "money") return record.value.amount;
    return record.value;
  });
  const sum = numericValues.reduce((total, value) => total + value, 0);
  const grouped = { daily: new Map(), weekly: new Map() };
  records.forEach((record, index) => {
    const keys = { daily: record.periodStart, weekly: getIsoWeekKey(record.periodStart) };
    Object.entries(keys).forEach(([period, key]) => {
      const current = grouped[period].get(key) || { count: 0, total: 0, byCurrency: {} };
      current.count += 1;
      if (question.responseType === "money") {
        const currency = record.value.currency;
        current.byCurrency[currency] = (current.byCurrency[currency] || 0) + numericValues[index];
      } else {
        current.total += numericValues[index];
      }
      grouped[period].set(key, current);
    });
  });
  const series = Object.fromEntries(Object.entries(grouped).map(([period, entries]) => [
    period,
    [...entries.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([key, result]) => ({
      period: key,
      count: result.count,
      total: question.responseType === "money" ? null : result.total,
      byCurrency: result.byCurrency,
    })),
  ]));
  const byCurrency = {};
  if (question.responseType === "money") {
    records.forEach((record) => {
      const { amount, currency } = record.value;
      const current = byCurrency[currency] || { count: 0, total: 0 };
      current.count += 1;
      current.total += amount;
      byCurrency[currency] = current;
    });
    Object.values(byCurrency).forEach((currencyStats) => {
      currencyStats.average = currencyStats.total / currencyStats.count;
    });
  }
  const latestRecord = records.reduce((latest, record) =>
    !latest || record.recordedAt > latest.recordedAt ? record : latest, null
  );
  let primaryValue = null;
  if (records.length && question.responseType === "money" && question.aggregation === "latest") {
    primaryValue = latestRecord.value;
  } else if (records.length && question.responseType === "money") {
    primaryValue = Object.fromEntries(Object.entries(byCurrency).map(([currency, values]) => [
      currency,
      question.aggregation === "average"
        ? values.average
        : question.aggregation === "count"
          ? values.count
          : values.total,
    ]));
  } else if (records.length && question.aggregation === "count") {
    primaryValue = records.length;
  } else if (records.length && question.aggregation === "latest") {
    primaryValue = question.responseType === "duration" ? latestRecord.value.value : latestRecord.value;
  } else if (records.length && question.aggregation === "average") {
    primaryValue = sum / records.length;
  } else if (records.length) {
    primaryValue = sum;
  }
  const yesCount = question.responseType === "boolean" ? numericValues.filter(Boolean).length : null;
  const statistics = {
    count: records.length,
    total: question.responseType === "money" || !records.length ? null : sum,
    average: records.length && question.responseType !== "money" ? sum / records.length : null,
    frequency: records.length,
    booleanFrequency: question.responseType === "boolean" ? { yes: yesCount, no: records.length - yesCount } : null,
    byCurrency,
    series,
    aggregation: question.aggregation,
    primaryValue,
  };
  if (options.compareFrom && options.compareTo) {
    const previous = calculateQuestionStatistics(state, questionId, {
      from: options.compareFrom,
      to: options.compareTo,
    });
    statistics.comparison = {
      from: options.compareFrom,
      to: options.compareTo,
      count: previous.count,
      total: previous.total,
      average: previous.average,
      byCurrency: previous.byCurrency,
    };
  }
  return statistics;
}

function getPendingQuestions(state, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const today = getLocalDateKey(now);
  const weekday = now.getDay() || 7;
  const weekStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1);
  const weekStart = getLocalDateKey(weekStartDate);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = getLocalDateKey(weekEndDate);
  const preferences = state.preferences || {};
  const selectedAreas = new Set(preferences.areas || TRACKING_AREAS);
  return state.questions.filter((question) => {
    if (!question.enabled || !selectedAreas.has(question.area)) return false;
    const kind = question.frequency.kind;
    if (kind === "manual") return false;
    if (kind === "on-entry" && (!options.onEntry || preferences.askOnEntryEnabled === false)) return false;
    if (["daily", "weekly"].includes(kind) && !preferences.scheduledQuestionsEnabled) return false;
    const start = kind === "weekly" ? weekStart : today;
    const end = kind === "weekly" ? weekEnd : today;
    return !state.records.some((record) =>
      record.questionId === question.id &&
      record.validationStatus === "validated" &&
      record.periodStart >= start &&
      record.periodStart <= end
    );
  });
}

function calculateGoalProgress(state, goalId, date = new Date()) {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error("No se encontró el objetivo.");
  if (!goal.questionId || !goal.target || !["day", "week"].includes(goal.period)) {
    return { goalId, actual: null, percentage: null, recordCount: 0, periodStart: null, periodEnd: null };
  }
  const question = state.questions.find((item) => item.id === goal.questionId);
  if (!question) throw new Error("No se encontró la pregunta asociada al objetivo.");
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (goal.period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  if (goal.period === "week") end.setDate(end.getDate() + 6);
  const periodStart = getLocalDateKey(start);
  const periodEnd = getLocalDateKey(end);
  const records = state.records.filter((record) =>
    record.questionId === goal.questionId &&
    record.validationStatus === "validated" &&
    record.periodStart >= periodStart &&
    record.periodStart <= periodEnd &&
    (question.responseType !== "money" || record.value.currency === goal.target.currency)
  );
  const actual = records.reduce((total, record) => {
    if (question.responseType === "duration") return total + record.value.value;
    if (question.responseType === "money") return total + record.value.amount;
    if (question.responseType === "boolean") return total + (record.value ? 1 : 0);
    return total + record.value;
  }, 0);
  const targetValue = typeof goal.target === "number" ? goal.target : goal.target.value;
  if (!(targetValue > 0)) throw new Error("La meta debe ser mayor que cero.");
  return {
    goalId,
    actual: records.length ? actual : null,
    percentage: records.length ? (actual / targetValue) * 100 : null,
    recordCount: records.length,
    periodStart,
    periodEnd,
    unit: goal.target.unit || question.unit,
    currency: goal.target.currency || null,
  };
}
