const db = require("../config/database");
const { getSubscriptionState, isUnlimitedLimit } = require("../services/subscriptionService");

const checkStudentQuota = async (req, res, next) => {
  try {
    const schoolId = req.user
      ? req.user.school_id
      : req.session.user
        ? req.session.user.school_id
        : null;
    if (!schoolId) {
      return next();
    }

    const subscriptionState = req.subscriptionState || await getSubscriptionState(schoolId);
    if (subscriptionState.isFullDemoAccess) return next();

    const planData = subscriptionState.currentPlan;
    const studentLimit = planData?.max_students ?? planData?.student_limit;
    if (!planData || isUnlimitedLimit(studentLimit)) return next();

    const [rows] = await db.query(
      "SELECT COUNT(*) as count FROM students WHERE school_id = ? AND deleted_at IS NULL",
      [schoolId],
    );
    const count = rows[0] ? rows[0].count : 0;

    if (count >= Number(studentLimit)) {
      const errMsg = "Your current plan student limit is reached. Please upgrade your plan.";
      if (req.accepts("json") && !req.accepts("html")) {
        return res
          .status(403)
          .json({ success: false, message: errMsg, code: "QUOTA_EXCEEDED" });
      }
      req.flash("error", errMsg);
      return res.redirect("back");
    }

    return next();
  } catch (error) {
    console.error("checkStudentQuota Error:", error);
    return next();
  }
};

const checkTeacherQuota = async (req, res, next) => {
  try {
    const schoolId = req.user
      ? req.user.school_id
      : req.session.user
        ? req.session.user.school_id
        : null;
    if (!schoolId) {
      return next();
    }

    const subscriptionState = req.subscriptionState || await getSubscriptionState(schoolId);
    if (subscriptionState.isFullDemoAccess) return next();

    const planData = subscriptionState.currentPlan;
    const staffLimit = planData?.max_teachers ?? planData?.teacher_limit;
    if (!planData || isUnlimitedLimit(staffLimit)) return next();

    const [rows] = await db.query(
      `SELECT COUNT(*) as count FROM teachers t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.school_id = ? AND u.deleted_at IS NULL`,
      [schoolId],
    );
    const count = rows[0] ? rows[0].count : 0;

    if (count >= Number(staffLimit)) {
      const errMsg = "Your current plan staff limit is reached. Please upgrade your plan.";
      if (req.accepts("json") && !req.accepts("html")) {
        return res
          .status(403)
          .json({ success: false, message: errMsg, code: "QUOTA_EXCEEDED" });
      }
      req.flash("error", errMsg);
      return res.redirect("back");
    }

    return next();
  } catch (error) {
    console.error("checkTeacherQuota Error:", error);
    return next();
  }
};

const checkClassQuota = async (req, res, next) => {
  try {
    const schoolId = req.user
      ? req.user.school_id
      : req.session.user
        ? req.session.user.school_id
        : null;
    if (!schoolId) {
      return next();
    }

    const subscriptionState = req.subscriptionState || await getSubscriptionState(schoolId);
    if (subscriptionState.isFullDemoAccess) return next();

    const planData = subscriptionState.currentPlan;
    if (!planData || isUnlimitedLimit(planData.max_classes)) return next();

    const [rows] = await db.query(
      "SELECT COUNT(*) as count FROM classes WHERE school_id = ?",
      [schoolId],
    );
    const count = rows[0] ? rows[0].count : 0;

    if (count >= planData.max_classes) {
      const errMsg = "Your plan limit has been reached. Please upgrade.";
      if (req.accepts("json") && !req.accepts("html")) {
        return res
          .status(403)
          .json({ success: false, message: errMsg, code: "QUOTA_EXCEEDED" });
      }
      req.flash("error", errMsg);
      return res.redirect("back");
    }

    return next();
  } catch (error) {
    console.error("checkClassQuota Error:", error);
    return next();
  }
};

module.exports = {
  checkStudentQuota,
  checkTeacherQuota,
  checkClassQuota,
};
