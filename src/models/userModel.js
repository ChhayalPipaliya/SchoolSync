const db = require("../config/database");

const ALLOWED_USER_FIELDS = [
  "first_name", "last_name", "email", "password", "image", "role", "school_id", "status"
];

const buildInsertData = (data) => {
  const safeData = {};
  ALLOWED_USER_FIELDS.forEach((key) => {
    let dbKey = key;
    if (key === "first_name") dbKey = "first_name";
    if (key === "last_name") dbKey = "last_name";
    
    if (data[key] !== undefined) {
      safeData[dbKey] = data[key];
    } else if (data[dbKey] !== undefined) {
      safeData[dbKey] = data[dbKey];
    }
  });
  return safeData;
};

const buildUpdateData = (data) => {
  const safeData = {};
  ALLOWED_USER_FIELDS.forEach((key) => {
    let dbKey = key;
    if (key === "first_name") dbKey = "first_name";
    if (key === "last_name") dbKey = "last_name";
    
    if (data[key] !== undefined) {
      safeData[dbKey] = data[key];
    } else if (data[dbKey] !== undefined) {
      safeData[dbKey] = data[dbKey];
    }
  });
  return safeData;
};

exports.createUser = (data, callback) => {
  const safeData = buildInsertData(data);
  const fields = Object.keys(safeData);
  const placeholders = fields.map(() => "?").join(", ");
  const sql = `INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders})`;
  db.query(sql, Object.values(safeData), callback);
};

exports.findUserByEmail = (email, callback) => {
  db.query("SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND deleted_at IS NULL", [email], callback);
};

exports.findUserById = (id, callback) => {
  db.query("SELECT * FROM users WHERE id = ?", [id], callback);
};

exports.updateUser = (id, data, callback) => {
  const safeData = buildUpdateData(data);
  const fields = Object.keys(safeData);
  if (fields.length === 0) return callback(new Error("No valid fields to update"));
  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const sql = `UPDATE users SET ${setClause} WHERE id = ?`;
  db.query(sql, [...Object.values(safeData), id], callback);
};

exports.updatePassword = (email, password, callback) => {
  db.query("UPDATE users SET password = ? WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))", [password, email], callback);
};

exports.getUsersBySchool = (schoolId, callback) => {
  db.query("SELECT * FROM users WHERE school_id = ?", [schoolId], callback);
};

exports.deleteUser = (id, callback) => {
  db.query("DELETE FROM users WHERE id = ?", [id], callback);
};
