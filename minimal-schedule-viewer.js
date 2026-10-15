/* Minimal Schedule Viewer 0.2.0 — no dependencies. Install as a JavaScript module.
 * type: custom:minimal-schedule-viewer
 * entity: schedule.zeitplan_thermostate_wohnbereich
 * Reads schedule.get_schedule; never writes schedule data.
 */
(() => {
  "use strict";
  const VERSION = "0.2.0";
  const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const DEFAULT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // Optional source-level typography adjustments.
  const TEXT_STYLES = `
    .day_style { font-size:13px; font-weight:600; }
    .hour_style { font-size:12px; color:var(--primary-text-color); }
    .schedule_name { font-size:12px; font-weight:500; line-height:14px; }
    .schedule_time { visibility:hidden; font-size:12px; font-weight:400; line-height:14px; }
  `;
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const escape = (v) => String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const text = (v) => typeof v === "string" ? v : JSON.stringify(v) ?? String(v);

  function time(value, end = false) {
    if (typeof value !== "string") return NaN;
    // HA serializes the end-of-day sentinel time.max this way.
    if (end && value === "23:59:59.999999") return 1440;
    const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value);
    if (!m) return NaN;
    const h = +m[1], min = +m[2], sec = +(m[3] || 0) + +(m[4] ? `0.${m[4]}` : 0);
    if (min > 59 || sec >= 60 || h > 24 || (h === 24 && (!end || min || sec))) return NaN;
    return h * 60 + min + sec / 60;
  }
  const formatTime = (v) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
  const validColor = (value) => typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  function resolveTimeZone(hass) {
    return hass?.config?.time_zone || hass?.config?.timezone || hass?.locale?.timezone || hass?.locale?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  }
  function getCurrentTimeInZone(date = new Date(), timeZone) {
    const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) {
      const localDate = new Date(date);
      return { today: (localDate.getDay() + 6) % 7, currentMinute: localDate.getHours() * 60 + localDate.getMinutes() };
    }
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(date);
      const fields = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
      const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(fields.weekday);
      const minute = Number(fields.hour || 0) * 60 + Number(fields.minute || 0);
      return { today: weekday >= 0 ? weekday : (new Date(date).getDay() + 6) % 7, currentMinute: minute };
    } catch {
      const localDate = new Date(date);
      return { today: (localDate.getDay() + 6) % 7, currentMinute: localDate.getHours() * 60 + localDate.getMinutes() };
    }
  }
  function getCurrentTimeTop(currentMinute, offset = 30, dayHeight = 288) {
    return offset + (currentMinute / 1440) * dayHeight;
  }
  function normalizeConfig(config) {
    if (!object(config) || typeof config.entity !== "string" || !/^schedule\.[a-z0-9_]+$/.test(config.entity)) {
      throw new Error("Minimal Schedule Viewer: entity must be a schedule entity ID.");
    }
    if (typeof config.data_key !== "string" || !config.data_key.trim()) {
      throw new Error("Minimal Schedule Viewer: data_key must be a non-empty string.");
    }
    const days = config.days === undefined ? DEFAULT_DAYS : config.days;
    if (!Array.isArray(days) || days.length !== 7 || days.some(day => typeof day !== "string" || !day.trim())) {
      throw new Error("Minimal Schedule Viewer: days must contain seven non-empty strings, Monday first.");
    }
    const showToday = config.show_today === undefined ? true : config.show_today;
    const showCurrentTime = config.show_current_time === undefined ? true : config.show_current_time;
    const mergeAdjacentDays = config.merge_adjacent_days === undefined ? true : config.merge_adjacent_days;
    const mergeAdjacentTimes = config.merge_adjacent_times === undefined ? true : config.merge_adjacent_times;
    const labelAlignment = config.label_alignment === undefined ? "left" : config.label_alignment;
    const labelVerticalAlignment = config.label_vertical_alignment === undefined ? "top" : config.label_vertical_alignment;
    if (typeof showToday !== "boolean" || typeof showCurrentTime !== "boolean" || typeof mergeAdjacentDays !== "boolean" || typeof mergeAdjacentTimes !== "boolean") {
      throw new Error("Minimal Schedule Viewer: show_today, show_current_time, merge_adjacent_days, and merge_adjacent_times must be booleans.");
    }
    if (!["left", "center", "right"].includes(labelAlignment)) {
      throw new Error("Minimal Schedule Viewer: label_alignment must be left, center, or right.");
    }
    if (!["top", "center", "bottom"].includes(labelVerticalAlignment)) {
      throw new Error("Minimal Schedule Viewer: label_vertical_alignment must be top, center, or bottom.");
    }
    const todayColor = config.highlight_today_color;
    const currentTimeColor = config["current_time_color"] ?? config["current-time_color"];
    if ((todayColor !== undefined && !validColor(todayColor)) ||
        (currentTimeColor !== undefined && !validColor(currentTimeColor))) {
      throw new Error("Minimal Schedule Viewer: highlight_today_color and current_time_color must be #RGB or #RRGGBB colors.");
    }
    if (!object(config.states)) throw new Error("Minimal Schedule Viewer: states must be a mapping.");
    const states = Object.create(null);
    for (const [value, entry] of Object.entries(config.states)) {
      if (!object(entry) || typeof entry.label !== "string" || !validColor(entry.color)) {
        throw new Error(`Minimal Schedule Viewer: states[${value}] needs a string label and a #RGB or #RRGGBB color.`);
      }
      states[value] = { label: entry.label, color: entry.color };
    }
    return { entity: config.entity, data_key: config.data_key, days: [...days], states, show_today: showToday, show_current_time: showCurrentTime, merge_adjacent_days: mergeAdjacentDays, merge_adjacent_times: mergeAdjacentTimes, label_alignment: labelAlignment, label_vertical_alignment: labelVerticalAlignment, highlight_today_color: todayColor, "current_time_color": currentTimeColor };
  }
  // Choose black or white text using relative luminance for both HA themes.
  function foreground(hex) {
    const full = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join("") : hex.slice(1);
    const channels = full.match(/../g).map(c => parseInt(c, 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return luminance > 0.179 ? "#000000" : "#ffffff";
  }
  const errorBlock = (detail) => ({ kind: "error", label: "Error", color: "#b71c1c", detail });
  function mode(data, config) {
    const value = object(data) && Object.hasOwn(data, config.data_key) ? data[config.data_key] : undefined;
    if (value == null || (typeof value === "string" && !value.trim())) {
      return { kind: "missing", label: "Missing value", color: "#b71c1c", detail: `${config.data_key} is missing or empty.`, mergeKey: "missing" };
    }
    const key = text(value);
    if (["string", "number", "boolean"].includes(typeof value) && Object.hasOwn(config.states, key)) {
      return { kind: "mapped", ...config.states[key], mergeKey: `${typeof value}:${key}` };
    }
    return { kind: "unknown", label: key, color: "#b71c1c", mergeKey: `${typeof value}:${key}` };
  }
  function parseWeek(raw, config) {
    if (!object(raw)) throw new Error("Invalid weekly schedule response.");
    return DAYS.map((key, index) => {
      const name = config.days[index];
      const errors = [], blocks = [];
      if (!Array.isArray(raw[key])) {
        errors.push(`${name}: Missing or invalid day data.`);
      } else raw[key].forEach((entry, index) => {
        const start = time(entry?.from), end = time(entry?.to, true);
        if (!object(entry) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          errors.push(`${name}, Block ${index + 1}: Missing or invalid times (${text(entry?.from)} – ${text(entry?.to)}).`);
          return;
        }
        blocks.push({ start, end, ...mode(entry.data, config) });
      });
      blocks.sort((a, b) => a.start - b.start);
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length && blocks[j].start < blocks[i].end; j++) {
          Object.assign(blocks[i], errorBlock("Overlapping time blocks."));
          Object.assign(blocks[j], errorBlock("Overlapping time blocks."));
          errors.push(`${name}: Overlapping time blocks at ${formatTime(blocks[j].start)}.`);
        }
      }
      return { name, blocks, errors };
    });
  }

  const STYLE = `
    :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif)}
    *{box-sizing:border-box}ha-card{display:block;overflow:hidden;background:var(--ha-card-background,var(--card-background-color,#fff))}
    header{display:flex;align-items:center;gap:8px;padding:8px 12px 4px}
    h2{font-size:18px;font-weight:500;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    button.action{font:inherit;font-size:18px;color:inherit;border:0;background:transparent;padding:4px 8px;cursor:pointer;border-radius:6px;line-height:1.2}
    button:focus-visible{outline:2px solid var(--primary-color,#03a9f4);outline-offset:2px}
    .status,.errors{margin:6px 12px;font-size:12px;overflow-wrap:anywhere}
    .status{color:var(--secondary-text-color)}.errors{background:#b71c1c;color:#ffffff;padding:8px;border-radius:6px}.errors p{margin:3px 0}
    .scroll{overflow-x:auto;overflow-y:visible;padding:0 8px 13px}
    .week{min-width:280px;display:grid;grid-template-columns:44px repeat(7,minmax(0,1fr));padding-top:4px;position:relative;z-index:0;isolation:isolate}
    .heading{text-align:center;font-size:13px;font-weight:600;height:26px;white-space:nowrap}
    .heading.today{color:var(--today-marker-color,var(--primary-color,#03a9f4));background:color-mix(in srgb,var(--today-marker-color,var(--primary-color,#03a9f4)) 18%,transparent)}
    .axis,.day{height:288px;position:relative}
    .axis{position:sticky;left:0;z-index:2;background:var(--ha-card-background,var(--card-background-color,#fff))}
    .tick{position:absolute;right:4px;transform:translateY(-50%);font-size:12px;color:var(--primary-text-color)}
    .day{border-left:1px solid var(--divider-color,#ddd);border-bottom:1px solid var(--divider-color,#ddd);background:repeating-linear-gradient(to bottom,var(--divider-color,#ddd) 0,var(--divider-color,#ddd) 1px,transparent 1px,transparent 36px)}
    .day.today::after{content:"";position:absolute;inset:0;z-index:4;border-left:2px solid var(--today-marker-color,var(--primary-color,#03a9f4));border-right:2px solid var(--today-marker-color,var(--primary-color,#03a9f4));pointer-events:none}
    .current-time{position:absolute;left:44px;right:0;z-index:10;height:2px;background:var(--current-time-color,var(--primary-color,#03a9f4));pointer-events:none}
    .current-time::before{content:"";position:absolute;left:-3px;top:-3px;width:8px;height:8px;border-radius:50%;background:inherit}
    .blocks-layer{position:absolute;left:44px;right:0;top:30px;height:288px;pointer-events:none;z-index:1}
    .block{position:absolute;display:flex;flex-direction:column;justify-content:var(--schedule-label-vertical-alignment,flex-start);border-radius:2px;padding:0 2px;overflow:hidden;text-align:left;font-size:13px;line-height:14px;cursor:default;color:white;pointer-events:auto}
    .today-overlay{position:absolute;top:0;bottom:0;width:calc(100% / 7);background:rgba(255,255,255,0.18);pointer-events:none;z-index:2}
    .schedule_name,.schedule_time{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:var(--schedule-label-alignment,left)}
    ${TEXT_STYLES}
  `;

  function mergeWeekBlocks(week, mergeDays = true, mergeTimes = true) {
    const days = week.map((day) => {
      const blocks = [];
      for (const block of day.blocks) {
        const previous = blocks.at(-1);
        if (mergeTimes && previous && previous.end === block.start &&
            previous.mergeKey === block.mergeKey && previous.kind === block.kind) {
          previous.end = block.end;
        } else {
          blocks.push({ ...block });
        }
      }
      return { ...day, blocks };
    });
    if (!mergeDays) {
      return days.flatMap((day, dayIndex) => day.blocks.map((block) => ({ block, startDay: dayIndex, endDay: dayIndex })));
    }
    const groups = [];
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      const day = days[dayIndex];
      const used = new Set();
      for (const group of groups) {
        if (group.endDay !== dayIndex - 1) continue;
        const matchIndex = day.blocks.findIndex((block, index) => !used.has(index) &&
          block.start === group.block.start && block.end === group.block.end &&
          block.mergeKey === group.block.mergeKey && block.kind === group.block.kind);
        if (matchIndex >= 0) {
          used.add(matchIndex);
          group.endDay = dayIndex;
        }
      }
      day.blocks.forEach((block, index) => {
        if (!used.has(index)) groups.push({ block, startDay: dayIndex, endDay: dayIndex });
      });
    }
    return groups;
  }

  class MinimalScheduleViewer extends HTMLElement {
    static version = VERSION;
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._generation = 0;
      this._refresh = () => { if (!document.hidden) void this._load(); };
      this._dialogClosed = (event) => {
        if (!this._editing || event.detail?.dialog !== "ha-more-info-dialog") return;
        this._editing = false;
        // Reload once when returning from the standard helper dialog.
        this._generation++;
        this._loading = false;
        this._refresh();
      };
      this.shadowRoot.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action='edit']");
        if (!button) return;
        this._editing = true;
        this.dispatchEvent(new CustomEvent("hass-more-info", {
          detail: { entityId: this._config.entity }, bubbles: true, composed: true,
        }));
      });
    }

    setConfig(config) {
      this._config = normalizeConfig(config);
      this._generation++;
      this._loading = false;
      this._week = null;
      this._error = "";
      this._render();
      void this._load();
    }
    set hass(hass) {
      const old = this._hass;
      this._hass = hass;
      const id = this._config?.entity;
      if (!id) return;
      if (old?.states[id] !== hass.states[id] || old?.connected !== hass.connected) {
        this._render();
        if (!old || (!old.states[id] && hass.states[id]) || (old.connected === false && hass.connected !== false)) {
          void this._load();
        }
      }
    }
    connectedCallback() {
      this._resizeObserver = new ResizeObserver(() => this._fitTimes());
      this._observeSizes();
      this._clockTimer = setInterval(() => this._render(), 60000);
      document.addEventListener("visibilitychange", this._refresh);
      window.addEventListener("dialog-closed", this._dialogClosed);
      void this._load();
    }
    disconnectedCallback() {
      this._resizeObserver?.disconnect();
      cancelAnimationFrame(this._fitFrame);
      clearInterval(this._clockTimer);
      document.removeEventListener("visibilitychange", this._refresh);
      window.removeEventListener("dialog-closed", this._dialogClosed);
      this._editing = false;
      this._generation++;
      this._loading = false;
    }
    getCardSize() { return 7; }
    getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }
    static getStubConfig(hass) {
      return { entity: Object.keys(hass.states).find((id) => id.startsWith("schedule.")) || "schedule.example", data_key: "mode", states: { comfort: { label: "Comfort", color: "#2e8540" } } };
    }
    async _load() {
      if (!this.isConnected || !this._hass || !this._config || this._loading || document.hidden) return;
      const entity = this._config.entity;
      if (!this._hass.states[entity] || this._hass.connected === false) { this._render(); return; }
      const generation = this._generation;
      this._loading = true;
      this._render();
      let timeout;
      try {
        const result = await Promise.race([
          this._hass.callService("schedule", "get_schedule", {}, { entity_id: entity }, false, true),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Schedule request timed out.")), 15000); }),
        ]);
        if (generation !== this._generation) return;
        // callService returns a WebSocket service result with a response field.
        const response = result?.response;
        if (!object(response) || !Object.hasOwn(response, entity)) {
          throw new Error("schedule.get_schedule returned no response data for this entity.");
        }
        this._week = parseWeek(response[entity], this._config);
        this._error = "";
      } catch (error) {
        if (generation !== this._generation) return;
        this._error = `Unable to load schedule: ${error?.message || error?.code || String(error)} Check that schedule.get_schedule is available and your user has access.`;
      } finally {
        clearTimeout(timeout);
        if (generation === this._generation) { this._loading = false; this._render(); }
      }
    }
    _observeSizes() {
      if (!this._resizeObserver) return;
      this._resizeObserver.disconnect();
      this._resizeObserver.observe(this);
      for (const node of this.shadowRoot.querySelectorAll(".block, .schedule_name, .schedule_time")) {
        this._resizeObserver.observe(node);
      }
    }
    _fitTimes() {
      // Compare actual rendered rectangles (including fractional pixels).
      // Hidden/unfinished layouts must never count as a successful fit.
      for (const time of this.shadowRoot.querySelectorAll(".schedule_time")) {
        const block = time.parentElement.getBoundingClientRect();
        const line = time.getBoundingClientRect();
        time.style.visibility = block.height > 0 && line.height > 0 &&
          line.top >= block.top && line.bottom <= block.bottom - 1 ? "visible" : "hidden";
      }
    }
    _render() {
      if (!this._config) return;
      const entity = this._hass?.states[this._config.entity];
      const title = entity?.attributes?.friendly_name || this._config.entity;
      const timeZone = resolveTimeZone(this._hass);
      const { today, currentMinute } = getCurrentTimeInZone(new Date(), timeZone);
      const week = this.shadowRoot.querySelector(".week");
      const firstDay = this.shadowRoot.querySelector(".day");
      const offset = week && firstDay ? firstDay.getBoundingClientRect().top - week.getBoundingClientRect().top : 30;
      const dayHeight = firstDay?.getBoundingClientRect().height || 288;
      const currentTop = getCurrentTimeTop(currentMinute, offset, dayHeight);
      const markerColors = [
        `--schedule-label-alignment:${this._config.label_alignment}`,
        `--schedule-label-vertical-alignment:${({ top: "flex-start", center: "center", bottom: "flex-end" })[this._config.label_vertical_alignment]}`,
        this._config.highlight_today_color && `--today-marker-color:${this._config.highlight_today_color}`,
        (this._config["current_time_color"] ?? this._config["current-time_color"]) && `--current-time-color:${this._config["current_time_color"] ?? this._config["current-time_color"]}`,
      ].filter(Boolean).join(";");
      const errors = this._week?.flatMap((day) => day.errors) || [];
      const blocks = this._week ? mergeWeekBlocks(this._week, this._config.merge_adjacent_days, this._config.merge_adjacent_times) : [];
      const issue = !this._hass ? "Waiting for Home Assistant …" : !entity ? `Entity ${this._config.entity} not found.`
        : this._hass.connected === false ? "Disconnected from Home Assistant."
        : this._error || (entity.state === "unavailable" ? "Schedule entity is unavailable." : "");
      const scroll = this.shadowRoot.querySelector(".scroll")?.scrollLeft || 0;
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
        <header><h2 title="${escape(title)}">${escape(title)}</h2>
        <button class="action" data-action="edit" aria-label="Open native schedule editor" title="Open native schedule editor">&gt;</button></header>
        ${issue ? `<div class="errors" role="alert">${escape(issue)}${this._week ? " Showing the last successfully loaded schedule." : ""}</div>` : ""}
        ${!this._week ? `<div class="status" role="status">${this._loading ? "Loading schedule …" : "No schedule loaded yet."}</div>` : ""}
        ${errors.length ? `<div class="errors" role="alert">${errors.map((e) => `<p>${escape(e)}</p>`).join("")}</div>` : ""}
        ${this._week ? `<div class="scroll" tabindex="0" aria-label="Weekly schedule, horizontally scrollable"><div class="week" style="${markerColors}">
          <div></div>${this._config.days.map((name, index) => `<div class="heading day_style${this._config.show_today && index === today ? " today" : ""}">${escape(name)}</div>`).join("")}
          <div class="axis">${Array.from({ length: 9 }, (_, index) => index * 3).map((hour) => `<span class="tick hour_style" style="top:${hour / 24 * 100}%">${String(hour).padStart(2, "0")}:00</span>`).join("")}</div>
          ${this._week.map((day, index) => `<div class="day${this._config.show_today && index === today ? " today" : ""}" aria-label="${escape(day.name)}"></div>`).join("")}
          <div class="blocks-layer">${blocks.map(({ block, startDay, endDay }) => {
            const dayLabel = startDay === endDay ? this._week[startDay].name : `${this._week[startDay].name}–${this._week[endDay].name}`;
            const span = endDay - startDay + 1;
            const label = `${dayLabel}, ${formatTime(block.start)}–${formatTime(block.end)}: ${block.label}${block.detail ? ` (${block.detail})` : ""}`;
            return `<div class="block ${block.kind}" style="left:calc(${startDay / 7 * 100}% + 1px);width:calc(${span / 7 * 100}% - 2px);top:${block.start / 1440 * 100}%;height:calc(${(block.end - block.start) / 1440 * 100}% - 2px);background:${block.color};color:${foreground(block.color)}" title="${escape(label)}" aria-label="${escape(label)}"><strong class="schedule_name">${escape(block.label)}</strong><small class="schedule_time">${formatTime(block.start)}–${formatTime(block.end)}</small></div>`;
          }).join("")}${this._config.show_today ? `<div class="today-overlay" style="left:${today / 7 * 100}%;width:calc(100% / 7)" aria-hidden="true"></div>` : ""}</div>${this._config.show_current_time ? `<div class="current-time" style="top:${currentTop}px" aria-label="Current time ${formatTime(currentMinute)}" title="Current time ${formatTime(currentMinute)}"></div>` : ""}</div></div>` : ""}
      </ha-card>`;
      const scroller = this.shadowRoot.querySelector(".scroll");
      if (scroller) scroller.scrollLeft = scroll;
      this._observeSizes();
      cancelAnimationFrame(this._fitFrame);
      this._fitFrame = requestAnimationFrame(() => this._fitTimes());
    }
  }
  if (!customElements.get("minimal-schedule-viewer")) customElements.define("minimal-schedule-viewer", MinimalScheduleViewer);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === "minimal-schedule-viewer")) {
    window.customCards.push({ type: "minimal-schedule-viewer", name: "Minimal Schedule Viewer", description: "Compact weekly timeline for native schedule helpers", preview: false });
  }
})();
