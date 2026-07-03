const db = require("../config/database");

const ACTIONS = new Set(["promote", "repeat", "skip", "graduate"]);
const RESULT_STATUSES = new Set(["pass", "fail", "pending"]);
const TERMINAL_STUDENT_STATUSES = new Set(["left", "transferred", "tc", "transfer"]);

const CLASS_SEQUENCE = [
  "nursery",
  "jrkg",
  "srkg",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12"
];

const CLASS_ALIASES = {
  nursery: "nursery",
  "pre nursery": "nursery",
  lkg: "jrkg",
  "jr kg": "jrkg",
  jrkg: "jrkg",
  "junior kg": "jrkg",
  ukg: "srkg",
  "sr kg": "srkg",
  srkg: "srkg",
  "senior kg": "srkg",
  one: "1",
  first: "1",
  two: "2",
  second: "2",
  three: "3",
  third: "3",
  four: "4",
  fourth: "4",
  five: "5",
  fifth: "5",
  six: "6",
  sixth: "6",
  seven: "7",
  seventh: "7",
  eight: "8",
  eighth: "8",
  nine: "9",
  ninth: "9",
  ten: "10",
  tenth: "10",
  eleven: "11",
  eleventh: "11",
  twelve: "12",
  twelfth: "12"
};

const normalizeId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function normalizeClassName(className) {
  let value = String(className || "").trim().toLowerCase();
  value = value
    .replace(/\./g, "")
    .replace(/standard/g, "std")
    .replace(/^std\s*/g, "")
    .replace(/^class\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^\d+$/.test(value)) return value;
  return CLASS_ALIASES[value] || value.replace(/\s+/g, "");
}

function formatClassLabel(row = {}) {
  const parts = [];
  const normalized = normalizeClassName(row.class_name || row.name);
  if (["nursery", "jrkg", "srkg"].includes(normalized)) {
    parts.push(row.class_name || row.name);
  } else {
    parts.push(`Std ${row.class_name || row.name || ""}`.trim());
  }
  if (row.section) parts.push(row.section);
  if (row.medium) parts.push(row.medium);
  if (row.stream && row.stream !== "General") parts.push(row.stream);
  if (row.academic_year) parts.push(row.academic_year);
  return parts.filter(Boolean).join(" - ");
}

function getNextClassKey(className) {
  const key = normalizeClassName(className);
  const index = CLASS_SEQUENCE.indexOf(key);
  if (index === -1) return null;
  if (key === "12") return "graduated";
  return CLASS_SEQUENCE[index + 1] || null;
}

async function getAcademicYears(schoolId) {
  return db.queryAsync(
    "SELECT id, code, status FROM academic_years WHERE school_id = ? ORDER BY code DESC",
    [schoolId]
  );
}

async function getClassesForYear(schoolId, academicYearId) {
  return db.queryAsync(
    `SELECT c.id, c.class_name, c.section, c.medium, c.stream, c.academic_year
     FROM classes c
     JOIN academic_years ay ON ay.school_id = c.school_id AND ay.code = c.academic_year
     WHERE c.school_id = ? AND ay.id = ?
     ORDER BY
       CASE
         WHEN LOWER(c.class_name) = 'nursery' THEN 0
         WHEN LOWER(c.class_name) IN ('lkg', 'jr kg', 'jrkg') THEN 1
         WHEN LOWER(c.class_name) IN ('ukg', 'sr kg', 'srkg') THEN 2
         WHEN c.class_name REGEXP '^[0-9]+$' THEN 10 + CAST(c.class_name AS UNSIGNED)
         ELSE 1000
       END,
       c.section ASC, c.medium ASC, c.stream ASC`,
    [schoolId, academicYearId]
  );
}

async function getNextClass(schoolId, currentClassId, toAcademicYearId, preferences = {}) {
  const currentRows = await db.queryAsync(
    "SELECT id, class_name, section, medium, stream FROM classes WHERE id = ? AND school_id = ? LIMIT 1",
    [currentClassId, schoolId]
  );
  const currentClass = currentRows[0];
  if (!currentClass) return { nextClass: null, options: [], isGraduation: false, warning: "Current class not found." };

  const nextKey = getNextClassKey(currentClass.class_name);
  if (nextKey === "graduated") {
    return { nextClass: null, options: [], isGraduation: true, warning: null };
  }
  if (!nextKey) {
    return { nextClass: null, options: [], isGraduation: false, warning: "Class sequence could not be detected." };
  }

  const classes = await getClassesForYear(schoolId, toAcademicYearId);
  let options = classes.filter((row) => normalizeClassName(row.class_name) === nextKey);

  const preferredMedium = preferences.medium || currentClass.medium;
  const preferredSection = preferences.section || currentClass.section;
  const preferredStream = preferences.stream || currentClass.stream;

  const exact = options.find((row) =>
    (!preferredMedium || row.medium === preferredMedium) &&
    (!preferredSection || row.section === preferredSection) &&
    (!preferredStream || row.stream === preferredStream || row.stream === "General")
  );

  const mediumMatch = options.find((row) => !preferredMedium || row.medium === preferredMedium);
  const nextClass = exact || mediumMatch || options[0] || null;

  let warning = null;
  if (normalizeClassName(currentClass.class_name) === "10") {
    warning = "Std 10 to 11 needs stream review. Select the correct Science / Commerce / Arts class before confirmation.";
  } else if (!nextClass) {
    warning = "Next class was not found in the target academic year.";
  }

  return { nextClass, options, isGraduation: false, warning };
}

async function detectResultStatus(student, existingResultData = null) {
  if (existingResultData && RESULT_STATUSES.has(existingResultData)) return existingResultData;
  if (student.result_status && student.result_status !== "pending") return student.result_status;

  const rows = await db.queryAsync(
    `SELECT
       SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) AS fail_count,
       SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) AS pass_count,
       COUNT(*) AS mark_count
     FROM marks
     WHERE school_id = ? AND student_id = ?`,
    [student.school_id, student.student_id || student.id]
  );
  const summary = rows[0] || {};
  if (Number(summary.fail_count || 0) > 0) return "fail";
  if (Number(summary.pass_count || 0) > 0) return "pass";
  return "pending";
}

async function ensureAcademicRecords(schoolId, academicYearId) {
  await db.executeAsync(
    `INSERT IGNORE INTO student_academic_records
      (school_id, student_id, academic_year_id, class_id, roll_number, enrollment_status, result_status)
     SELECT s.school_id, s.id, ay.id, s.class_id, s.roll_no, 'active', 'pending'
     FROM students s
     JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
     JOIN academic_years ay ON ay.school_id = s.school_id AND ay.code = c.academic_year
     WHERE s.school_id = ?
       AND ay.id = ?
       AND s.class_id IS NOT NULL
       AND s.deleted_at IS NULL
       AND s.status = 'active'`,
    [schoolId, academicYearId]
  );
}

async function getPromotionPreview(schoolId, fromAcademicYearId, toAcademicYearId, filters = {}) {
  await ensureAcademicRecords(schoolId, fromAcademicYearId);

  const fromClassId = normalizeId(filters.fromClassId || filters.class_id);
  const medium = String(filters.medium || "").trim();

  let sql = `
    SELECT sar.*, s.admission_no, s.roll_no, s.status AS student_status,
           u.first_name, u.last_name, u.email,
           c.class_name, c.section, c.medium, c.stream
    FROM student_academic_records sar
    JOIN students s ON s.id = sar.student_id AND s.school_id = sar.school_id
    JOIN users u ON u.id = s.user_id AND u.school_id = s.school_id
    JOIN classes c ON c.id = sar.class_id AND c.school_id = sar.school_id
    WHERE sar.school_id = ?
      AND sar.academic_year_id = ?
      AND sar.enrollment_status = 'active'
      AND s.deleted_at IS NULL`;
  const params = [schoolId, fromAcademicYearId];

  if (fromClassId) {
    sql += " AND sar.class_id = ?";
    params.push(fromClassId);
  }
  if (medium) {
    sql += " AND c.medium = ?";
    params.push(medium);
  }

  sql += " ORDER BY c.class_name ASC, c.section ASC, CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC, u.first_name ASC";

  const rows = await db.queryAsync(sql, params);
  const targetClasses = await getClassesForYear(schoolId, toAcademicYearId);

  const preview = [];
  for (const row of rows) {
    const resultStatus = await detectResultStatus(row);
    const terminalStatus = TERMINAL_STUDENT_STATUSES.has(String(row.student_status || "").toLowerCase());
    const nextInfo = await getNextClass(schoolId, row.class_id, toAcademicYearId, row);

    let action = "promote";
    let suggestedClass = nextInfo.nextClass;
    let warning = nextInfo.warning;
    let reason = null;

    if (terminalStatus) {
      action = "skip";
      suggestedClass = null;
      reason = "Transferred/TC student";
    } else if (nextInfo.isGraduation && resultStatus === "pass") {
      action = "graduate";
      suggestedClass = null;
    } else if (resultStatus === "fail") {
      action = "repeat";
      suggestedClass = targetClasses.find((c) =>
        normalizeClassName(c.class_name) === normalizeClassName(row.class_name) &&
        (!row.medium || c.medium === row.medium) &&
        (!row.section || c.section === row.section) &&
        (!row.stream || c.stream === row.stream)
      ) || targetClasses.find((c) => normalizeClassName(c.class_name) === normalizeClassName(row.class_name)) || null;
    } else if (resultStatus === "pending") {
      action = "skip";
      warning = warning || "Result pending. Review before promotion.";
    } else if (!suggestedClass && !nextInfo.isGraduation) {
      action = "skip";
    }

    preview.push({
      student_id: row.student_id,
      from_academic_record_id: row.id,
      name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
      admission_no: row.admission_no,
      roll_number: row.roll_number || row.roll_no,
      current_class_label: formatClassLabel(row),
      from_class_id: row.class_id,
      from_section: row.section,
      result_status: resultStatus,
      promotion_action: action,
      to_class_id: suggestedClass?.id || null,
      suggested_class_label: suggestedClass ? formatClassLabel(suggestedClass) : (action === "graduate" ? "Graduated / Alumni" : "No class selected"),
      next_options: nextInfo.options.length ? nextInfo.options : targetClasses,
      warning,
      reason
    });
  }

  return { rows: preview, targetClasses };
}

async function createPromotionBatch({ schoolId, fromAcademicYearId, toAcademicYearId, filters = {}, createdBy }) {
  const preview = await getPromotionPreview(schoolId, fromAcademicYearId, toAcademicYearId, filters);
  const counts = preview.rows.reduce((acc, row) => {
    if (row.promotion_action === "promote") acc.promoted += 1;
    else if (row.promotion_action === "repeat") acc.repeated += 1;
    else if (row.promotion_action === "graduate") acc.graduated += 1;
    else acc.skipped += 1;
    return acc;
  }, { promoted: 0, repeated: 0, skipped: 0, graduated: 0 });

  const fromClassId = normalizeId(filters.fromClassId || filters.class_id);

  return db.withTransaction(async ({ execute, query }) => {
    const result = await execute(
      `INSERT INTO student_promotion_batches
       (school_id, from_academic_year_id, to_academic_year_id, from_class_id, status,
        total_students, promoted_count, repeated_count, skipped_count, graduated_count, created_by)
       VALUES (?, ?, ?, ?, 'previewed', ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        fromAcademicYearId,
        toAcademicYearId,
        fromClassId,
        preview.rows.length,
        counts.promoted,
        counts.repeated,
        counts.skipped,
        counts.graduated,
        createdBy || null
      ]
    );
    const batchId = result.insertId;

    for (const row of preview.rows) {
      await execute(
        `INSERT INTO student_promotion_items
         (batch_id, student_id, from_academic_record_id, from_class_id, to_class_id,
          result_status, promotion_action, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          batchId,
          row.student_id,
          row.from_academic_record_id,
          row.from_class_id,
          row.to_class_id,
          row.result_status,
          row.promotion_action,
          row.reason
        ]
      );
    }

    const batchRows = await query("SELECT * FROM student_promotion_batches WHERE id = ? AND school_id = ?", [batchId, schoolId]);
    return { batch: batchRows[0], preview };
  });
}

function getEnrollmentStatusForAction(action) {
  if (action === "repeat") return "repeated";
  if (action === "graduate") return "graduated";
  return "promoted";
}

async function confirmPromotionBatch(batchId, schoolId, adminUserId, overrides = {}) {
  return db.withTransaction(async ({ query, execute }) => {
    const batchRows = await query(
      "SELECT * FROM student_promotion_batches WHERE id = ? AND school_id = ? FOR UPDATE",
      [batchId, schoolId]
    );
    const batch = batchRows[0];
    if (!batch) throw new Error("Promotion batch not found.");
    if (batch.status === "completed") throw new Error("This promotion batch has already been completed.");

    const items = await query(
      `SELECT pi.*, sar.academic_year_id, s.status AS student_status
       FROM student_promotion_items pi
       JOIN student_academic_records sar ON sar.id = pi.from_academic_record_id AND sar.school_id = ?
       JOIN students s ON s.id = pi.student_id AND s.school_id = sar.school_id
       WHERE pi.batch_id = ?
       ORDER BY pi.id ASC`,
      [schoolId, batch.id]
    );

    const summary = {
      promoted: 0,
      repeated: 0,
      skipped: 0,
      graduated: 0,
      duplicateSkipped: 0
    };

    for (const item of items) {
      const override = overrides[item.id] || {};
      const action = ACTIONS.has(override.action) ? override.action : item.promotion_action;
      const toClassId = normalizeId(override.to_class_id) || item.to_class_id;
      const reason = String(override.reason || item.reason || "").trim() || null;

      await execute(
        "UPDATE student_promotion_items SET promotion_action = ?, to_class_id = ?, reason = ?, updated_at = NOW() WHERE id = ?",
        [action, toClassId || null, reason, item.id]
      );

      if (action === "skip") {
        const oldStatus = TERMINAL_STUDENT_STATUSES.has(String(item.student_status || "").toLowerCase())
          ? "transferred"
          : "inactive";
        await execute(
          "UPDATE student_academic_records SET enrollment_status = ?, updated_by = ?, updated_at = NOW() WHERE id = ? AND school_id = ?",
          [oldStatus, adminUserId || null, item.from_academic_record_id, schoolId]
        );
        summary.skipped += 1;
        continue;
      }

      if (action === "graduate") {
        await execute(
          "UPDATE student_academic_records SET enrollment_status = 'graduated', updated_by = ?, updated_at = NOW() WHERE id = ? AND school_id = ?",
          [adminUserId || null, item.from_academic_record_id, schoolId]
        );
        await execute(
          "UPDATE students SET status = 'graduated', updated_at = NOW() WHERE id = ? AND school_id = ?",
          [item.student_id, schoolId]
        );
        summary.graduated += 1;
        continue;
      }

      if (!toClassId) {
        summary.skipped += 1;
        continue;
      }

      const targetClassRows = await query(
        `SELECT c.id
         FROM classes c
         JOIN academic_years ay ON ay.school_id = c.school_id AND ay.code = c.academic_year
         WHERE c.id = ? AND c.school_id = ? AND ay.id = ?
         LIMIT 1`,
        [toClassId, schoolId, batch.to_academic_year_id]
      );
      if (!targetClassRows.length) {
        summary.skipped += 1;
        continue;
      }

      const existingRows = await query(
        `SELECT id FROM student_academic_records
         WHERE school_id = ? AND student_id = ? AND academic_year_id = ?
         LIMIT 1`,
        [schoolId, item.student_id, batch.to_academic_year_id]
      );

      if (existingRows.length) {
        summary.duplicateSkipped += 1;
        continue;
      }

      await execute(
        `INSERT INTO student_academic_records
         (school_id, student_id, academic_year_id, class_id, roll_number, enrollment_status,
          result_status, promoted_from_record_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, NULL, 'active', 'pending', ?, ?, ?)`,
        [
          schoolId,
          item.student_id,
          batch.to_academic_year_id,
          toClassId,
          item.from_academic_record_id,
          adminUserId || null,
          adminUserId || null
        ]
      );

      await execute(
        "UPDATE student_academic_records SET enrollment_status = ?, result_status = ?, updated_by = ?, updated_at = NOW() WHERE id = ? AND school_id = ?",
        [getEnrollmentStatusForAction(action), item.result_status, adminUserId || null, item.from_academic_record_id, schoolId]
      );

      await execute(
        "UPDATE students SET class_id = ?, status = 'active', updated_at = NOW() WHERE id = ? AND school_id = ?",
        [toClassId, item.student_id, schoolId]
      );

      if (action === "repeat") summary.repeated += 1;
      else summary.promoted += 1;
    }

    await execute(
      `UPDATE student_promotion_batches
       SET status = 'completed', promoted_count = ?, repeated_count = ?, skipped_count = ?,
           graduated_count = ?, updated_at = NOW()
       WHERE id = ? AND school_id = ?`,
      [summary.promoted, summary.repeated, summary.skipped + summary.duplicateSkipped, summary.graduated, batch.id, schoolId]
    );

    return summary;
  });
}

async function getPromotionHistory(schoolId) {
  return db.queryAsync(
    `SELECT b.*, fay.code AS from_year, tay.code AS to_year,
            c.class_name, c.section, c.medium, c.stream
     FROM student_promotion_batches b
     JOIN academic_years fay ON fay.id = b.from_academic_year_id AND fay.school_id = b.school_id
     JOIN academic_years tay ON tay.id = b.to_academic_year_id AND tay.school_id = b.school_id
     LEFT JOIN classes c ON c.id = b.from_class_id AND c.school_id = b.school_id
     WHERE b.school_id = ?
     ORDER BY b.created_at DESC`,
    [schoolId]
  );
}

async function getPromotionBatch(schoolId, batchId) {
  const batchRows = await db.queryAsync(
    `SELECT b.*, fay.code AS from_year, tay.code AS to_year,
            c.class_name, c.section, c.medium, c.stream
     FROM student_promotion_batches b
     JOIN academic_years fay ON fay.id = b.from_academic_year_id AND fay.school_id = b.school_id
     JOIN academic_years tay ON tay.id = b.to_academic_year_id AND tay.school_id = b.school_id
     LEFT JOIN classes c ON c.id = b.from_class_id AND c.school_id = b.school_id
     WHERE b.school_id = ? AND b.id = ?
     LIMIT 1`,
    [schoolId, batchId]
  );
  const batch = batchRows[0] || null;
  if (!batch) return null;

  const items = await db.queryAsync(
    `SELECT pi.*, u.first_name, u.last_name, s.admission_no,
            fc.class_name AS from_class_name, fc.section AS from_section, fc.medium AS from_medium, fc.stream AS from_stream,
            tc.class_name AS to_class_name, tc.section AS to_section, tc.medium AS to_medium, tc.stream AS to_stream
     FROM student_promotion_items pi
     JOIN students s ON s.id = pi.student_id AND s.school_id = ?
     JOIN users u ON u.id = s.user_id AND u.school_id = s.school_id
     LEFT JOIN classes fc ON fc.id = pi.from_class_id AND fc.school_id = s.school_id
     LEFT JOIN classes tc ON tc.id = pi.to_class_id AND tc.school_id = s.school_id
     WHERE pi.batch_id = ?
     ORDER BY pi.id ASC`,
    [schoolId, batch.id]
  );

  return { batch, items };
}

module.exports = {
  getAcademicYears,
  getClassesForYear,
  getPromotionPreview,
  createPromotionBatch,
  confirmPromotionBatch,
  getPromotionHistory,
  getPromotionBatch,
  getNextClass,
  normalizeClassName,
  detectResultStatus,
  formatClassLabel
};
