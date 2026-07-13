const CLASS_ORDER = {
    nursery: 0,
    lkg: 1,
    ukg: 2
};

function normalizeClassName(className) {
    return String(className || '')
        .trim()
        .replace(/^std\.?\s*/i, '')
        .replace(/^class\s*/i, '');
};

function classSortValue(className) {
    const normalized = normalizeClassName(className);
    const key = normalized.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CLASS_ORDER, key)) {
        return CLASS_ORDER[key];
    };

    const numberValue = Number.parseInt(normalized, 10);
    if (!Number.isNaN(numberValue)) {
        return 10 + numberValue;
    };
    return 1000;
};

function classOrderSql(alias = 'c') {
    return `CASE
        WHEN LOWER(${alias}.class_name) = 'nursery' THEN 0
        WHEN LOWER(${alias}.class_name) = 'lkg' THEN 1
        WHEN LOWER(${alias}.class_name) = 'ukg' THEN 2
        WHEN ${alias}.class_name REGEXP '^[0-9]+$' THEN 10 + CAST(${alias}.class_name AS UNSIGNED)
        ELSE 1000
    END`;
};

function formatClassLabel(row = {}) {
    const className = normalizeClassName(row.class_name || row.name);
    const base = Number.isNaN(Number.parseInt(className, 10)) && !/^\d+$/.test(className)
        ? className
        : `Class ${className}`;

    const parts = [base];
    if (row.section) parts.push(row.section);
    if (row.medium) parts.push(row.medium);
    if (row.stream && row.stream !== 'General') parts.push(row.stream);
    return parts.filter(Boolean).join(' - ');
};

function sortClasses(classes = []) {
    return [...classes].sort((a, b) => {
        const orderDiff = classSortValue(a.class_name || a.name) - classSortValue(b.class_name || b.name);
        if (orderDiff !== 0) return orderDiff;
        return String(a.section || '').localeCompare(String(b.section || ''))
            || String(a.medium || '').localeCompare(String(b.medium || ''))
            || String(a.stream || '').localeCompare(String(b.stream || ''));
    });
};

module.exports = { classOrderSql, classSortValue, formatClassLabel, normalizeClassName, sortClasses};