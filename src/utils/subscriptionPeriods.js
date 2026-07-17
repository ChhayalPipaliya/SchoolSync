const VALID_BILLING_CYCLES = new Set(["monthly", "yearly"]);

function normalizeBillingCycle(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return VALID_BILLING_CYCLES.has(normalized) ? normalized : null;
};

function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error("Invalid subscription date.");
    };
    return date;
};

function addDays(value, days) {
    const date = validDate(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
};

function addCycleToDate(value, billingCycle) {
    const cycle = normalizeBillingCycle(billingCycle);
    if (!cycle) throw new Error("Invalid billing cycle.");

    const next = validDate(value);
    const originalDay = next.getUTCDate();
    next.setUTCDate(1);
    if (cycle === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
    else next.setUTCMonth(next.getUTCMonth() + 1);

    const maxDay = new Date(Date.UTC(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        0
    )).getUTCDate();
    next.setUTCDate(Math.min(originalDay, maxDay));
    return next;
};

function calculateSubscriptionEndDate(startDate, billingCycle, options = {}) {
    return options.isTrial ? addDays(startDate, 7) : addCycleToDate(startDate, billingCycle);
};

function amountForPlan(plan, billingCycle) {
    const cycle = normalizeBillingCycle(billingCycle);
    if (!cycle || !plan) return 0;
    const amount = Number(cycle === "yearly" ? plan.yearly_price : plan.monthly_price);
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
};

function toSqlDate(value) {
    return validDate(value).toISOString().slice(0, 10);
};

module.exports = { VALID_BILLING_CYCLES, addCycleToDate, addDays, amountForPlan, calculateSubscriptionEndDate, normalizeBillingCycle, toSqlDate, validDate };