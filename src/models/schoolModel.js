const db = require("../config/database");

exports.createSchool = (data, callback) => {
    const sql = "INSERT INTO schools SET ?";
    db.query(sql, data, callback);
};

exports.getAllSchools = (callback) => {
    db.query("SELECT * FROM schools ORDER BY created_at DESC", callback );
};

exports.findSchoolById = (id, callback) => {
    db.query("SELECT * FROM schools WHERE id = ?", [id], callback );
};

exports.findSchoolBySubdomain = (subdomain, callback) => {
    db.query("SELECT * FROM schools WHERE subdomain = ?", [subdomain], callback );
};

exports.updateSchool = (id, data, callback) => {
    db.query("UPDATE schools SET ? WHERE id = ?", [data, id], callback );
};

exports.deleteSchool = (id, callback) => {
    db.query("DELETE FROM schools WHERE id = ?", [id], callback );
};

exports.getStats = (callback) => {
    db.query(`
        SELECT 
            COUNT(*) as totalSchools,
            SUM(status = 'active') as activeSchools,
            SUM(status = 'trial') as trialSchools,
            SUM(status = 'inactive') as inactiveSchools
        FROM schools
    `, callback);
};

exports.getRecentSchools = (limit = 10, callback) => {
    db.query("SELECT * FROM schools ORDER BY created_at DESC LIMIT ?", [limit], callback );
};