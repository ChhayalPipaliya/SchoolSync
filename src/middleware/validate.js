const { isValidEmail, isValidPhone, isAcceptablePassword, isValidDate, isValidAge, isNotFutureDate, isValidAadhaar, isValidPAN, isValidPincode, isValidGST, isValidURL, isAlphaName, hasMinLength, hasMaxLength, isInRange, isPositiveInt, isNonNegative, isValidEnum, isSafeId} = require("../utils/validators");
const { sendValidationError } = require("../utils/errorFormatter");

const buildValidation = (rules) => (req, res, next) => {
    const body = req.body || {};
    const errors = [];

    const camelToSnake = (str) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const snakeToCamel = (str) => str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

    for (const rule of rules) {
        const altField = rule.field.includes('_') ? snakeToCamel(rule.field) : camelToSnake(rule.field);
        const raw = body[rule.field] !== undefined ? body[rule.field] : body[altField];
        const value = typeof raw === "string" ? raw.trim() : raw;

        const isOptional = rule.optional;

        for (const { test, message, optional } of rule.checks) {
            const checkOptional = optional !== undefined ? optional : isOptional;
            if (checkOptional && (value === undefined || value === null || value === "")) {
                continue;
            };
            if (!test(value, body)) {
                errors.push({ field: rule.field, message });
                break;
            };
        };
    };

    if (errors.length > 0) {
        return sendValidationError(req, res, errors);
    };

    return next();
};

const validateLogin = buildValidation([
    {
        field: "email",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Email is required." },
            { test: (v) => isValidEmail(v), message: "Please enter a valid email address." },
        ],
    },
    {
        field: "password",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Password is required." },
            { test: (v) => hasMaxLength(v, 128), message: "Password is too long." },
        ],
    },
]);

const validateRegister = buildValidation([
    {
        field: "firstName",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "First name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 50), message: "First name is too long." },
            { test: (v) => isAlphaName(v), message: "First name must contain only letters." },
        ],
    },
    {
        field: "lastName",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Last name is required." },
            { test: (v) => hasMaxLength(v, 50), message: "Last name is too long." },
        ],
    },
    {
        field: "email",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Email is required." },
            { test: (v) => isValidEmail(v), message: "Please enter a valid email address." },
        ],
    },
    {
        field: "password",
        checks: [
            { test: (v) => hasMinLength(v, 8), message: "Password must be at least 8 characters." },
            { test: (v) => isAcceptablePassword(v), message: "Password must contain at least one letter and one number." },
        ],
    },
    {
        field: "phone",
        checks: [
            { test: (v) => isValidPhone(v), message: "Please enter a valid 10-digit mobile number." },
        ],
        optional: true,
    },
]);

const validatePasswordReset = buildValidation([
    {
        field: "email",
        checks: [
            { test: (v) => isValidEmail(v), message: "Please enter a valid email address." },
        ],
    },
    {
        field: "password",
        checks: [
            { test: (v) => hasMinLength(v, 8), message: "Password must be at least 8 characters." },
            { test: (v) => isAcceptablePassword(v), message: "Password must contain letters and numbers." },
        ],
    },
    {
        field: "confirmPassword",
        checks: [
            { test: (v, body) => v === body.password, message: "Passwords do not match." },
        ],
    },
]);

const validateStudentAdd = buildValidation([
    {
        field: "firstName",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "First name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 50), message: "First name too long." },
        ],
    },
    {
        field: "lastName",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Last name is required." },
            { test: (v) => hasMaxLength(v, 50), message: "Last name too long." },
        ],
    },
    {
        field: "email",
        checks: [
            { test: (v) => !v || isValidEmail(v), message: "Please enter a valid email address." },
        ],
        optional: true,
    },
    {
        field: "class_id",
        checks: [
            { test: (v) => isSafeId(v), message: "Please select a valid class." },
        ],
    },
    {
        field: "dob",
        checks: [
            { test: (v) => isValidDate(v), message: "Please enter a valid date of birth." },
            { test: (v) => isNotFutureDate(v), message: "Date of birth cannot be in the future." },
            { test: (v) => isValidAge(v, 3, 30), message: "Student age must be between 3 and 30 years." },
        ],
        optional: true,
    },
    {
        field: "phone",
        checks: [
            { test: (v) => isValidPhone(v), message: "Please enter a valid 10-digit phone number." },
        ],
        optional: true,
    },
    {
        field: "aadhaar_no",
        checks: [
            { test: (v) => isValidAadhaar(v), message: "Aadhaar must be exactly 12 digits." },
        ],
        optional: true,
    },
    {
        field: "permanent_pincode",
        checks: [
            { test: (v) => isValidPincode(v), message: "Please enter a valid 6-digit pincode." },
        ],
        optional: true,
    },
    {
        field: "current_pincode",
        checks: [
            { test: (v) => isValidPincode(v), message: "Please enter a valid 6-digit pincode." },
        ],
        optional: true,
    },
    {
        field: "gender",
        checks: [
            { test: (v) => isValidEnum(v, ["male", "female", "other"]), message: "Please select a valid gender." },
        ],
        optional: true,
    },
]);

const validateTeacherAdd = buildValidation([
    {
        field: "firstName",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "First name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 50), message: "First name too long." },
        ],
    },
    {
        field: "email",
        checks: [
            { test: (v) => isValidEmail(v), message: "Please enter a valid email address." },
        ],
    },
    {
        field: "phone",
        checks: [
            { test: (v) => isValidPhone(v), message: "Please enter a valid 10-digit phone number." },
        ],
    },
    {
        field: "password",
        checks: [
            { test: (v) => hasMinLength(v, 8), message: "Password must be at least 8 characters." },
            { test: (v) => isAcceptablePassword(v), message: "Password must contain letters and numbers." },
        ],
    },
    {
        field: "qualification",
        checks: [
            { test: (v) => hasMaxLength(v, 200), message: "Qualification text is too long." },
        ],
        optional: true,
    },
    {
        field: "aadhaar",
        checks: [
            { test: (v) => isValidAadhaar(v), message: "Aadhaar must be exactly 12 digits." },
        ],
        optional: true,
    },
]);

const validateClassAdd = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Class name is required." },
            { test: (v) => hasMaxLength(v, 100), message: "Class name is too long." },
        ],
    },
    {
        field: "section",
        checks: [
            { test: (v) => hasMaxLength(v, 10), message: "Section name is too long." },
        ],
        optional: true,
    },
]);

const validateSubjectAdd = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Subject name is required." },
            { test: (v) => hasMaxLength(v, 150), message: "Subject name is too long." },
        ],
    },
    {
        field: "class_id",
        checks: [
            { test: (v) => isSafeId(v), message: "Please select a valid class." },
        ],
    },
    {
        field: "subject_type",
        checks: [
            { test: (v) => isValidEnum(v, ["theory", "practical", "language", "elective", "other"]), message: "Invalid subject type." },
        ],
        optional: true,
    },
]);

const validateFeeCollection = buildValidation([
    {
        field: "amount_paid",
        checks: [
            { test: (v) => isPositiveInt(v) || (!isNaN(parseFloat(v)) && parseFloat(v) > 0), message: "Please enter a valid payment amount." },
            { test: (v) => isInRange(v, 1, 9999999), message: "Amount must be between ₹1 and ₹99,99,999." },
        ],
    },
    {
        field: "payment_mode",
        checks: [
            { test: (v) => isValidEnum(v, ["cash", "online", "cheque", "dd", "neft", "upi"]), message: "Please select a valid payment mode." },
        ],
    },
    {
        field: "payment_date",
        checks: [
            { test: (v) => isValidDate(v), message: "Please enter a valid payment date." },
            { test: (v) => isNotFutureDate(v), message: "Payment date cannot be in the future." },
        ],
        optional: true,
    },
]);

const validateDriverAdd = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "Driver name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 100), message: "Driver name is too long." },
        ],
    },
    {
        field: "phone",
        checks: [
            { test: (v) => isValidPhone(v), message: "Please enter a valid 10-digit phone number." },
        ],
    },
    {
        field: "license_number",
        checks: [
            { test: (v) => hasMinLength(v, 5), message: "License number is required." },
        ],
        optional: true,
    },
]);

const validateBookAdd = buildValidation([
    {
        field: "title",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Book title is required." },
            { test: (v) => hasMaxLength(v, 255), message: "Book title is too long." },
        ],
    },
    {
        field: "isbn",
        checks: [
            { test: (v) => /^[\d-]{10,17}$/.test(v), message: "Please enter a valid ISBN (10 or 13 digits)." },
        ],
        optional: true,
    },
    {
        field: "total_copies",
        checks: [
            { test: (v) => isPositiveInt(v), message: "Total copies must be a positive number." },
            { test: (v) => isInRange(v, 1, 9999), message: "Total copies must be between 1 and 9999." },
        ],
    },
    {
        field: "category_id",
        checks: [
            { test: (v) => isSafeId(v), message: "Please select a valid category." },
        ],
        optional: true,
    },
]);

const validateNoticeAdd = buildValidation([
    {
        field: "title",
        checks: [
            { test: (v) => hasMinLength(v, 3), message: "Notice title must be at least 3 characters." },
            { test: (v) => hasMaxLength(v, 255), message: "Notice title is too long." },
        ],
    },
    {
        field: "message",
        checks: [
            { test: (v) => hasMinLength(v, 10), message: "Notice message must be at least 10 characters." },
            { test: (v) => hasMaxLength(v, 5000), message: "Notice message is too long (max 5000 chars)." },
        ],
    },
    {
        field: "audience",
        checks: [
            { test: (v) => isValidEnum(v, ["all", "students", "teachers", "parents", "staff"]), message: "Invalid target audience." },
        ],
        optional: true,
    },
]);

const validateExamAdd = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "Exam name is required." },
            { test: (v) => hasMaxLength(v, 200), message: "Exam name is too long." },
        ],
    },
    {
        field: "class_id",
        checks: [
            { test: (v) => isSafeId(v), message: "Please select a valid class." },
        ],
    },
    {
        field: "exam_date",
        checks: [
            { test: (v) => isValidDate(v), message: "Please enter a valid exam date." },
        ],
        optional: true,
    },
    {
        field: "max_marks",
        checks: [
            { test: (v) => isPositiveInt(v), message: "Max marks must be a positive number." },
            { test: (v) => isInRange(v, 1, 1000), message: "Max marks must be between 1 and 1000." },
        ],
        optional: true,
    },
]);

const validateSchoolSettings = buildValidation([
    {
        field: "school_name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "School name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 200), message: "School name is too long." },
        ],
        optional: true,
    },
    {
        field: "email",
        checks: [
            { test: (v) => isValidEmail(v), message: "Please enter a valid school email address." },
        ],
        optional: true,
    },
    {
        field: "phone",
        checks: [
            { test: (v) => isValidPhone(v), message: "Please enter a valid phone number." },
        ],
        optional: true,
    },
    {
        field: "website",
        checks: [
            { test: (v) => isValidURL(v), message: "Please enter a valid website URL." },
        ],
        optional: true,
    },
    {
        field: "pincode",
        checks: [
            { test: (v) => isValidPincode(v), message: "Please enter a valid 6-digit pincode." },
        ],
        optional: true,
    },
]);

const validateLibrarianAdd = buildValidation([
    {
        field: "firstName",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "First name must be at least 2 characters." },
        ],
    },
    {
        field: "email",
        checks: [
            { test: (v) => isValidEmail(v), message: "Please enter a valid email address." },
        ],
    },
    {
        field: "password",
        checks: [
            { test: (v) => hasMinLength(v, 8), message: "Password must be at least 8 characters." },
            { test: (v) => isAcceptablePassword(v), message: "Password must contain letters and numbers." },
        ],
    },
    {
        field: "phone",
        checks: [
            { test: (v) => isValidPhone(v), message: "Please enter a valid 10-digit phone number." },
        ],
        optional: true,
    },
]);

const validateTimetableEntry = buildValidation([
    {
        field: "class_id",
        checks: [{ test: (v) => isSafeId(v), message: "Please select a valid class." }],
    },
    {
        field: "subject_id",
        checks: [{ test: (v) => isSafeId(v), message: "Please select a valid subject." }],
    },
    {
        field: "day",
        checks: [
            {
                test: (v) => isValidEnum(v, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
                message: "Please select a valid day.",
            },
        ],
    },
]);

const validatePeriodSlot = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Period name is required." },
            { test: (v) => hasMaxLength(v, 100), message: "Period name is too long." },
        ],
    },
    {
        field: "start_time",
        checks: [
            { test: (v) => /^\d{2}:\d{2}$/.test(v ?? ""), message: "Please enter a valid start time (HH:MM)." },
        ],
    },
    {
        field: "end_time",
        checks: [
            { test: (v) => /^\d{2}:\d{2}$/.test(v ?? ""), message: "Please enter a valid end time (HH:MM)." },
        ],
    },
]);

const validateSchoolAdd = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "School name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 200), message: "School name is too long." },
        ],
    },
    {
        field: "email",
        checks: [
            { test: (v) => isValidEmail(v), message: "Please enter a valid school email address." },
        ],
    },
    {
        field: "phone",
        checks: [
            { test: (v) => isValidPhone(v), message: "Please enter a valid 10-digit phone number." },
        ],
        optional: true,
    },
    {
        field: "pincode",
        checks: [
            { test: (v) => isValidPincode(v), message: "Please enter a valid 6-digit pincode." },
        ],
        optional: true,
    },
    {
        field: "gstin",
        checks: [
            { test: (v) => isValidGST(v), message: "Please enter a valid GSTIN." },
        ],
        optional: true,
    },
    {
        field: "pan",
        checks: [
            { test: (v) => isValidPAN(v), message: "Please enter a valid PAN number." },
        ],
        optional: true,
    },
    {
        field: "website",
        checks: [
            { test: (v) => isValidURL(v), message: "Please enter a valid website URL (http/https)." },
        ],
        optional: true,
    },
    {
        field: "admin_email",
        checks: [
            { test: (v) => isValidEmail(v), message: "Please enter a valid admin email address." },
        ],
        optional: true,
    },
    {
        field: "admin_password",
        checks: [
            { test: (v) => hasMinLength(v, 8), message: "Admin password must be at least 8 characters." },
            { test: (v) => isAcceptablePassword(v), message: "Admin password must contain letters and numbers." },
        ],
        optional: true,
    },
]);

const validatePlanAdd = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "Plan name is required." },
            { test: (v) => hasMaxLength(v, 150), message: "Plan name is too long." },
        ],
    },
    {
        field: "price",
        checks: [
            { test: (v) => isNonNegative(v), message: "Price must be a non-negative number." },
            { test: (v) => isInRange(v, 0, 9999999), message: "Price is out of valid range." },
        ],
    },
    {
        field: "duration_days",
        checks: [
            { test: (v) => isPositiveInt(v), message: "Duration must be a positive integer." },
            { test: (v) => isInRange(v, 1, 3650), message: "Duration must be between 1 and 3650 days." },
        ],
        optional: true,
    },
    {
        field: "max_students",
        checks: [
            { test: (v) => isPositiveInt(v), message: "Max students must be a positive number." },
            { test: (v) => isInRange(v, 1, 100000), message: "Max students value is out of range." },
        ],
        optional: true,
    },
]);

const validateHomeworkAdd = buildValidation([
    {
        field: "title",
        checks: [
            { test: (v) => hasMinLength(v, 3), message: "Homework title must be at least 3 characters." },
            { test: (v) => hasMaxLength(v, 255), message: "Homework title is too long." },
        ],
    },
    {
        field: "description",
        checks: [
            { test: (v) => hasMaxLength(v, 3000), message: "Description is too long (max 3000 chars)." },
        ],
        optional: true,
    },
    {
        field: "due_date",
        checks: [
            { test: (v) => isValidDate(v), message: "Please enter a valid due date." },
        ],
        optional: true,
    },
    {
        field: "class_id",
        checks: [
            { test: (v) => isSafeId(v), message: "Please select a valid class." },
        ],
    },
    {
        field: "subject_id",
        checks: [
            { test: (v) => isSafeId(v), message: "Please select a valid subject." },
        ],
        optional: true,
    },
]);

const validateFeeStructure = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "Fee structure name is required." },
            { test: (v) => hasMaxLength(v, 200), message: "Fee structure name is too long." },
        ],
    },
    {
        field: "amount",
        checks: [
            { test: (v) => isNonNegative(v), message: "Amount must be a non-negative number." },
            { test: (v) => isInRange(v, 0, 9999999), message: "Amount is out of valid range." },
        ],
    },
    {
        field: "class_id",
        checks: [
            { test: (v) => isSafeId(v), message: "Please select a valid class." },
        ],
        optional: true,
    },
    {
        field: "due_date",
        checks: [
            { test: (v) => isValidDate(v), message: "Please enter a valid due date." },
        ],
        optional: true,
    },
]);

const validateSalaryStructure = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "Salary structure name is required." },
            { test: (v) => hasMaxLength(v, 200), message: "Salary structure name is too long." },
        ],
    },
    {
        field: "basic_salary",
        checks: [
            { test: (v) => isNonNegative(v), message: "Basic salary must be a non-negative number." },
            { test: (v) => isInRange(v, 0, 9999999), message: "Basic salary is out of valid range." },
        ],
    },
]);

const validateRouteAdd = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "Route name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 200), message: "Route name is too long." },
        ],
    },
    {
        field: "fare",
        checks: [
            { test: (v) => isNonNegative(v), message: "Fare must be a non-negative number." },
            { test: (v) => isInRange(v, 0, 999999), message: "Fare is out of valid range." },
        ],
        optional: true,
    },
]);

const validateVehicleAdd = buildValidation([
    {
        field: "vehicle_number",
        checks: [
            { test: (v) => hasMinLength(v, 4), message: "Vehicle number is required." },
            { test: (v) => hasMaxLength(v, 20), message: "Vehicle number is too long." },
        ],
    },
    {
        field: "vehicle_type",
        checks: [
            { test: (v) => hasMaxLength(v, 100), message: "Vehicle type name is too long." },
        ],
        optional: true,
    },
    {
        field: "capacity",
        checks: [
            { test: (v) => isPositiveInt(v), message: "Capacity must be a positive number." },
            { test: (v) => isInRange(v, 1, 200), message: "Capacity must be between 1 and 200." },
        ],
        optional: true,
    },
]);

const validateBookIssue = buildValidation([
    {
        field: "book_id",
        checks: [{ test: (v) => isSafeId(v), message: "Please select a valid book." }],
    },
    {
        field: "member_id",
        checks: [{ test: (v) => isSafeId(v), message: "Please select a valid member." }],
    },
    {
        field: "due_date",
        checks: [
            { test: (v) => isValidDate(v), message: "Please enter a valid due date." },
        ],
        optional: true,
    },
]);

const validateLibraryCategory = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 2), message: "Category name must be at least 2 characters." },
            { test: (v) => hasMaxLength(v, 150), message: "Category name is too long." },
        ],
    },
]);

const validateLibraryRack = buildValidation([
    {
        field: "name",
        checks: [
            { test: (v) => hasMinLength(v, 1), message: "Rack name is required." },
            { test: (v) => hasMaxLength(v, 100), message: "Rack name is too long." },
        ],
    },
]);

module.exports = { validateLogin, validateRegister, validatePasswordReset, validateStudentAdd, validateTeacherAdd, validateClassAdd, validateSubjectAdd, validateDriverAdd, validateLibrarianAdd, validateFeeCollection, validateFeeStructure, validateSalaryStructure, validateBookAdd, validateNoticeAdd, validateExamAdd, validateHomeworkAdd, validateTimetableEntry, validatePeriodSlot, validateSchoolSettings, validateSchoolAdd, validatePlanAdd, validateRouteAdd, validateVehicleAdd, validateBookIssue, validateLibraryCategory, validateLibraryRack, buildValidation,};