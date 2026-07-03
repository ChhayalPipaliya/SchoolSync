const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { queryAsync } = require("../config/database");

const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
);

const ROLE_TABLE_MAP = {
    teacher: { table: "teachers", column: "user_id" },
    student: { table: "students", column: "user_id" },
    librarian: { table: "librarians", column: "user_id" },
    driver: { table: "drivers", column: "user_id" },
    parent: { table: "parents", column: "user_id" },
    groupadmin: { table: "groupadmin", column:"user_id" },
};

const resolveUserSchoolId = async (user) => {
    if (user.school_id) return user.school_id;
    const config = ROLE_TABLE_MAP[user.role];
    if (!config) return null;
    const rows = await queryAsync(
        `SELECT school_id FROM ${config.table} WHERE ${config.column} = ? ORDER BY id DESC LIMIT 1`,
        [user.id]
    ).catch(() => []);
    return rows[0]?.school_id || null;
};

if (googleEnabled) {
    passport.use(
        new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
            async (accessToken, refreshToken, profile, done) => {
                try {
                    const email = String(profile.emails?.[0]?.value || "").trim().toLowerCase();
                    const emailVerified = profile._json?.email_verified !== false;
                    const first_name = profile.name?.givenName || "Google";
                    const last_name = profile.name?.familyName || "User";

                    if (!email) {
                        return done(new Error("Google account email is not available."));
                    };

                    if (!emailVerified) {
                        return done(null, false, { message: "Please verify your Google email before signing in." });
                    };

                    let existingUsers = await queryAsync(
                        "SELECT * FROM users WHERE LOWER(TRIM(email)) = ? AND deleted_at IS NULL LIMIT 1",
                        [email]
                    );

                    if (existingUsers.length === 0) {
                        existingUsers = await queryAsync(
                            `SELECT u.*
                            FROM schools s
                            JOIN users u ON u.school_id = s.id
                                AND u.role = 'school_admin'
                                AND u.deleted_at IS NULL
                            WHERE LOWER(TRIM(s.school_email)) = ?
                            ORDER BY u.status = 'active' DESC, u.id ASC
                            LIMIT 1`,
                            [email]
                        );
                    }

                    if (existingUsers.length === 0) {
                        return done(null, false, { message: "No SchoolSync account is linked with this Google email. Please start a demo or ask your school admin to add this email." });
                    }

                    const user = existingUsers[0];
                    if (user.status && user.status !== "active") {
                        return done(null, false, { message: "Your portal access is disabled. Please contact your school admin." });
                    }

                    user.first_name = user.first_name || first_name;
                    user.last_name = user.last_name || last_name;
                    user.school_id = await resolveUserSchoolId(user);
                    return done(null, user);
                } catch (error) {
                    return done(error);
                }
            } 
        )
    );
}

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const users = await queryAsync("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
        if (users.length > 0) {
            done(null, users[0]);
        } else {
            done(new Error("User not found"));
        }
    } catch (err) {
        done(err);
    }
});

passport.googleEnabled = googleEnabled;
module.exports = passport;