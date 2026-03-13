const fs = require("fs");

// ============================================================
// Business Policy Constants
// ============================================================
const DELIVERY_START_SECONDS = 8 * 3600;   // 8:00:00 am
const DELIVERY_END_SECONDS = 22 * 3600;    // 10:00:00 pm

const NORMAL_QUOTA_SECONDS = 8 * 3600 + 24 * 60; // 8:24:00
const EID_QUOTA_SECONDS = 6 * 3600;              // 6:00:00

const TIER_ALLOWANCE_HOURS = {
    1: 50,
    2: 20,
    3: 10,
    4: 3
};

// ============================================================
// Time Helpers
// ============================================================
function parseTime12(timeStr) {
    const trimmed = timeStr.trim().toLowerCase();
    const parts = trimmed.split(" ");
    const timePart = parts[0];
    const period = parts[1];

    let [h, m, s] = timePart.split(":").map(Number);

    if (period === "pm" && h !== 12) h += 12;
    if (period === "am" && h === 12) h = 0;

    return h * 3600 + m * 60 + s;
}

function parseDuration(durationStr) {
    const [h, m, s] = durationStr.trim().split(":").map(Number);
    return h * 3600 + m * 60 + s;
}

function formatDuration(totalSeconds) {
    if (totalSeconds < 0) totalSeconds = 0;

    const h = Math.floor(totalSeconds / 3600);
    const remainingAfterHours = totalSeconds % 3600;
    const m = Math.floor(remainingAfterHours / 60);
    const s = remainingAfterHours % 60;

    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isEidDate(dateStr) {
    const date = dateStr.trim();
    return date >= "2025-04-10" && date <= "2025-04-30";
}

function getMonthNumberFromDate(dateStr) {
    return Number(dateStr.trim().split("-")[1]);
}

function getWeekdayName(dateStr) {
    const date = new Date(`${dateStr.trim()}T12:00:00Z`);
    return date.toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: "UTC"
    });
}

function parseCSVLines(fileContent) {
    const trimmed = fileContent.trim();
    if (trimmed === "") return [];
    return trimmed.split(/\r?\n/);
}

// ============================================================
// Function 1: getShiftDuration
// ============================================================
function getShiftDuration(startTime, endTime) {
    const startSeconds = parseTime12(startTime);
    const endSeconds = parseTime12(endTime);
    const diff = endSeconds - startSeconds;

    return formatDuration(diff);
}

// ============================================================
// Function 2: getIdleTime
// ============================================================
function getIdleTime(startTime, endTime) {
    const startSeconds = parseTime12(startTime);
    const endSeconds = parseTime12(endTime);

    let idleSeconds = 0;

    if (startSeconds < DELIVERY_START_SECONDS) {
        idleSeconds += Math.min(endSeconds, DELIVERY_START_SECONDS) - startSeconds;
    }

    if (endSeconds > DELIVERY_END_SECONDS) {
        idleSeconds += endSeconds - Math.max(startSeconds, DELIVERY_END_SECONDS);
    }

    return formatDuration(idleSeconds);
}

// ============================================================
// Function 3: getActiveTime
// ============================================================
function getActiveTime(shiftDuration, idleTime) {
    const shiftSeconds = parseDuration(shiftDuration);
    const idleSeconds = parseDuration(idleTime);
    const activeSeconds = shiftSeconds - idleSeconds;

    return formatDuration(activeSeconds);
}

// ============================================================
// Function 4: metQuota
// ============================================================
function metQuota(date, activeTime) {
    const activeSeconds = parseDuration(activeTime);
    const requiredSeconds = isEidDate(date)
        ? EID_QUOTA_SECONDS
        : NORMAL_QUOTA_SECONDS;

    return activeSeconds >= requiredSeconds;
}

// ============================================================
// Function 5: addShiftRecord
// ============================================================
function addShiftRecord(textFile, shiftObj) {
    const lines = parseCSVLines(fs.readFileSync(textFile, "utf8"));

    if (lines.length === 0) {
        return {};
    }

    const header = lines[0];
    const rows = lines.slice(1).map(line => line.split(","));

    for (const row of rows) {
        const rowDriverID = row[0];
        const rowDate = row[2];

        if (rowDriverID === shiftObj.driverID && rowDate === shiftObj.date) {
            return {};
        }
    }

    const shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    const idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    const activeTime = getActiveTime(shiftDuration, idleTime);
    const quotaMet = metQuota(shiftObj.date, activeTime);

    const newRow = [
        shiftObj.driverID,
        shiftObj.driverName,
        shiftObj.date,
        shiftObj.startTime,
        shiftObj.endTime,
        shiftDuration,
        idleTime,
        activeTime,
        String(quotaMet),
        "false"
    ];

    let lastIndexForDriver = -1;

    for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === shiftObj.driverID) {
            lastIndexForDriver = i;
        }
    }

    if (lastIndexForDriver === -1) {
        rows.push(newRow);
    } else {
        rows.splice(lastIndexForDriver + 1, 0, newRow);
    }

    const newContent =
        header + "\n" + rows.map(row => row.join(",")).join("\n");

    fs.writeFileSync(textFile, newContent);

    return {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration: shiftDuration,
        idleTime: idleTime,
        activeTime: activeTime,
        metQuota: quotaMet,
        hasBonus: false
    };
}

// ============================================================
// Function 6: setBonus
// ============================================================
function setBonus(textFile, driverID, date, newValue) {
    const lines = parseCSVLines(fs.readFileSync(textFile, "utf8"));

    if (lines.length === 0) return;

    const header = lines[0];
    const rows = lines.slice(1).map(line => line.split(","));

    for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === driverID && rows[i][2] === date) {
            rows[i][9] = String(newValue);
            break;
        }
    }

    const newContent =
        header + "\n" + rows.map(row => row.join(",")).join("\n");

    fs.writeFileSync(textFile, newContent);
}

// ============================================================
// Function 7: countBonusPerMonth
// ============================================================
function countBonusPerMonth(textFile, driverID, month) {
    const lines = parseCSVLines(fs.readFileSync(textFile, "utf8"));

    if (lines.length <= 1) return -1;

    const targetMonth = Number(month);
    const rows = lines.slice(1).map(line => line.split(","));

    let driverExists = false;
    let count = 0;

    for (const row of rows) {
        const rowDriverID = row[0];
        const rowDate = row[2];
        const rowHasBonus = row[9];

        if (rowDriverID === driverID) {
            driverExists = true;

            const rowMonth = getMonthNumberFromDate(rowDate);

            if (rowMonth === targetMonth && rowHasBonus === "true") {
                count++;
            }
        }
    }

    if (!driverExists) return -1;

    return count;
}

// ============================================================
// Function 8: getTotalActiveHoursPerMonth
// ============================================================
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const lines = parseCSVLines(fs.readFileSync(textFile, "utf8"));

    if (lines.length <= 1) return "0:00:00";

    const targetMonth = Number(month);
    const rows = lines.slice(1).map(line => line.split(","));

    let totalSeconds = 0;

    for (const row of rows) {
        const rowDriverID = row[0];
        const rowDate = row[2];
        const rowActiveTime = row[7];

        if (rowDriverID !== driverID) continue;

        const rowMonth = getMonthNumberFromDate(rowDate);

        if (rowMonth === targetMonth) {
            totalSeconds += parseDuration(rowActiveTime);
        }
    }

    return formatDuration(totalSeconds);
}

// ============================================================
// Function 9: getRequiredHoursPerMonth
// ============================================================
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const shiftLines = parseCSVLines(fs.readFileSync(textFile, "utf8"));
    const rateLines = parseCSVLines(fs.readFileSync(rateFile, "utf8"));

    const targetMonth = Number(month);

    let dayOff = null;
    for (let i = 1; i < rateLines.length; i++) {
        const parts = rateLines[i].split(",");
        if (parts[0] === driverID) {
            dayOff = parts[1];
            break;
        }
    }

    if (dayOff === null) {
        return "0:00:00";
    }

    const rows = shiftLines.slice(1).map(line => line.split(","));
    let totalRequiredSeconds = 0;

    for (const row of rows) {
        const rowDriverID = row[0];
        const rowDate = row[2];

        if (rowDriverID !== driverID) continue;

        const rowMonth = getMonthNumberFromDate(rowDate);
        if (rowMonth !== targetMonth) continue;

        const weekdayName = getWeekdayName(rowDate);
        if (weekdayName === dayOff) continue;

        totalRequiredSeconds += isEidDate(rowDate)
            ? EID_QUOTA_SECONDS
            : NORMAL_QUOTA_SECONDS;
    }

    totalRequiredSeconds -= bonusCount * 2 * 3600;

    if (totalRequiredSeconds < 0) {
        totalRequiredSeconds = 0;
    }

    return formatDuration(totalRequiredSeconds);
}

// ============================================================
// Function 10: getNetPay
// ============================================================
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rateLines = parseCSVLines(fs.readFileSync(rateFile, "utf8"));

    let basePay = 0;
    let tier = 0;

    for (let i = 1; i < rateLines.length; i++) {
        const parts = rateLines[i].split(",");

        if (parts[0] === driverID) {
            basePay = Number(parts[2]);
            tier = Number(parts[3]);
            break;
        }
    }

    const actualSeconds = parseDuration(actualHours);
    const requiredSeconds = parseDuration(requiredHours);

    if (actualSeconds >= requiredSeconds) {
        return basePay;
    }

    const missingSeconds = requiredSeconds - actualSeconds;
    const allowanceSeconds = (TIER_ALLOWANCE_HOURS[tier] || 0) * 3600;

    let billableMissingSeconds = missingSeconds - allowanceSeconds;
    if (billableMissingSeconds < 0) {
        billableMissingSeconds = 0;
    }

    const missingFullHours = Math.floor(billableMissingSeconds / 3600);
    const deductionRatePerHour = Math.floor(basePay / 185);
    const salaryDeduction = missingFullHours * deductionRatePerHour;

    return basePay - salaryDeduction;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
