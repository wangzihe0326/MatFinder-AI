const fs = require("node:fs");
const path = require("node:path");

const PILOT_STATUSES = [
  "planned",
  "entered",
  "validation_failed",
  "awaiting_review",
  "Medium",
  "High",
  "imported"
];

function readPilotStatus(planPath = path.join(__dirname, "data", "pilot", "pilot-plan.json")) {
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const counts = Object.fromEntries(PILOT_STATUSES.map((status) => [status, 0]));
  (plan.slots || []).forEach((slot) => {
    const status = PILOT_STATUSES.includes(slot.status) ? slot.status : "validation_failed";
    counts[status] += 1;
  });
  return {
    target: plan.target,
    families: plan.families,
    counts,
    slots: plan.slots,
    note: plan.note
  };
}

module.exports = { PILOT_STATUSES, readPilotStatus };
