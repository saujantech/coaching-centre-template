/**
 * time-picker.js
 *
 * Reusable 12-hour time picker (Hour / Minute / AM-PM selects) that reads
 * and writes a 24-hour "HH:MM" string — the same format already stored in
 * start_time/end_time/preferred_time_of_day. Shared between the public
 * booking page and the admin dashboard via a plain <script> tag (no build
 * step, no module system), the same way tokens.css and centre.config.js
 * are already shared.
 *
 * Usage:
 *   1. Insert timePickerHtml(id, options) HTML wherever a time field is
 *      needed. Pass { allowEmpty: true } for fields where "no time
 *      chosen" is a genuinely valid state (e.g. an optional preference) —
 *      this adds a blank "--" placeholder to the Hour select. Omit it (or
 *      pass false) for fields that always need a real time (e.g. a
 *      class's start/end time), which get a default instead of a blank.
 *   2. Call setTimePickerValue(container, "HH:MM" | null) to set it.
 *      With allowEmpty, null resets to the blank placeholder. Without it,
 *      null resets to a default of 09:00.
 *   3. Call getTimePickerValue(container) to read the current value. With
 *      allowEmpty, this returns null while the Hour select is still on
 *      its blank placeholder, instead of a fabricated time.
 *
 * `container` is the element returned by document.getElementById(id) (or
 * any ancestor of the picker's selects) — the same element you passed
 * the id for in timePickerHtml().
 */

const TIME_PICKER_MINUTES = ["00", "15", "30", "45"];

function timePickerHtml(id, { allowEmpty = false } = {}) {
  const blankOption = allowEmpty ? `<option value="">--</option>` : "";
  const hourOptions =
    blankOption +
    Array.from({ length: 12 }, (_, i) => i + 1)
      .map((h) => `<option value="${h}">${h}</option>`)
      .join("");
  const minuteOptions = TIME_PICKER_MINUTES.map((m) => `<option value="${m}">${m}</option>`).join("");

  return `
    <div class="time-picker" id="${id}">
      <select class="time-picker-hour" aria-label="Hour">${hourOptions}</select>
      <span class="time-picker-colon">:</span>
      <select class="time-picker-minute" aria-label="Minute">${minuteOptions}</select>
      <select class="time-picker-meridiem" aria-label="AM or PM">
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  `;
}

// Returns null (not a fabricated time) when the Hour select is still on
// its blank "--" placeholder — only possible on a picker built with
// { allowEmpty: true }, since that's the only case with a blank option.
function getTimePickerValue(container) {
  const hourValue = container.querySelector(".time-picker-hour").value;
  if (hourValue === "") return null;

  const hour12 = parseInt(hourValue, 10);
  const minute = container.querySelector(".time-picker-minute").value;
  const meridiem = container.querySelector(".time-picker-meridiem").value;

  let hour24 = hour12 % 12;
  if (meridiem === "PM") hour24 += 12;

  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

// value is a 24-hour "HH:MM" string, or null/undefined to reset. Without
// a blank placeholder (allowEmpty wasn't used to build this picker), null
// resets to a sensible default of 09:00. With one, null resets to the
// blank placeholder itself, leaving the picker genuinely empty.
//
// Defensive: an existing stored value that isn't on a 15-minute mark
// (shouldn't happen, but don't crash or leave blank if it does) is
// rounded to the nearest 15-minute mark, carrying over an hour or day
// boundary correctly via total-minutes-of-day math.
function setTimePickerValue(container, value) {
  const hourSelect = container.querySelector(".time-picker-hour");
  const minuteSelect = container.querySelector(".time-picker-minute");
  const meridiemSelect = container.querySelector(".time-picker-meridiem");
  const hasBlankOption = !!hourSelect.querySelector('option[value=""]');

  if (!value && hasBlankOption) {
    hourSelect.value = "";
    minuteSelect.value = "00";
    meridiemSelect.value = "AM";
    return;
  }

  let hour24 = 9;
  let minute = 0;

  if (value) {
    const [hStr, mStr] = value.split(":");
    const parsedHour = parseInt(hStr, 10);
    const parsedMinute = parseInt(mStr, 10);

    if (!isNaN(parsedHour) && !isNaN(parsedMinute)) {
      const totalMinutes = parsedHour * 60 + parsedMinute;
      const rounded = (Math.round(totalMinutes / 15) * 15) % (24 * 60);
      hour24 = Math.floor(rounded / 60);
      minute = rounded % 60;
    }
  }

  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const meridiem = hour24 < 12 ? "AM" : "PM";

  hourSelect.value = String(hour12);
  minuteSelect.value = String(minute).padStart(2, "0");
  meridiemSelect.value = meridiem;
}
