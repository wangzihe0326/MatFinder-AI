const path = require("node:path");
const { readPilotStatus, PILOT_STATUSES } = require("../pilot-status");

const report = readPilotStatus(path.resolve(__dirname, "..", "data", "pilot", "pilot-plan.json"));
process.stdout.write(`Pilot target: ${report.target}\n`);
PILOT_STATUSES.forEach((status) => {
  process.stdout.write(`${status}: ${report.counts[status]}\n`);
});
process.stdout.write(`Families: ${report.families.join(", ")}\n`);
